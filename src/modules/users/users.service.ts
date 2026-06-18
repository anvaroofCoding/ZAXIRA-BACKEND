import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { StructureSnapshot } from '../../common/types/structure-snapshot.interface';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import { UpdateProfileDto } from '../auth/dto/update-profile.dto';
import { StructuresService } from '../structures/structures.service';
import { WAREHOUSE_PERMISSION_PATHS } from './constants/warehouse-permission-paths';
import { QueryUsersDto } from './dto/query-users.dto';
import { CreateUserPayload } from './pipes/create-user-validation.pipe';
import { UpdateUserPayload } from './pipes/update-user-validation.pipe';
import { User, UserDocument } from './schemas/user.schema';
import { UserPermissionsMap } from './types/page-permission.type';
import {
  createEmptyPermissions,
  createFullPermissions,
  hasPageAction,
  hasPageAccess,
  normalizePermissions,
} from './utils/permissions.util';

const BCRYPT_ROUNDS = 12;
const USERS_PAGE_PATH = '/royxatga-olish/foydalanuvchilar';
type UsersActionKey = 'create' | 'update' | 'delete';

export interface CreateUserInput {
  login: string;
  password: string;
  role?: UserRole;
  displayName?: string;
  position?: string;
  structureId?: string;
  createdById?: string;
  permissions?: UserPermissionsMap;
}

@Injectable()
export class UsersService {
  private async assertUsersActionPermission(
    requesterId: string | undefined,
    requesterRole: UserRole | undefined,
    action: UsersActionKey,
  ) {
    if (!requesterId || isSuperAdminRole(requesterRole)) {
      return;
    }

    const requester = await this.findById(requesterId);
    if (!requester?.isActive) {
      throw new ForbiddenException('Sahifa amali uchun ruxsat yo‘q');
    }

    const permissions = this.resolvePermissionsForRole(
      requester.role,
      requester.permissions as UserPermissionsMap | undefined,
    );

    if (!hasPageAction(permissions, USERS_PAGE_PATH, action, false)) {
      throw new ForbiddenException('Sahifa amali uchun ruxsat yo‘q');
    }
  }

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly structuresService: StructuresService,
  ) {}

  private parseStructureFromUser(user: UserDocument) {
    const structureRef = user.structureId as
      | {
          _id: Types.ObjectId;
          fullName: string;
          shortName: string;
          hasWarehouse?: boolean;
        }
      | Types.ObjectId
      | undefined
      | null;

    const structure =
      structureRef &&
      typeof structureRef === 'object' &&
      'fullName' in structureRef
        ? {
            id: String(structureRef._id),
            fullName: structureRef.fullName,
            shortName: structureRef.shortName,
            hasWarehouse: structureRef.hasWarehouse === true,
          }
        : null;

    const structureId =
      structure?.id ?? (structureRef ? String(structureRef) : null);

    return { structure, structureId };
  }

  private parseCreatedByFromUser(user: UserDocument) {
    const creatorRef = user.createdBy as
      | { _id: Types.ObjectId; displayName: string; login: string }
      | Types.ObjectId
      | undefined
      | null;

    const createdBy =
      creatorRef &&
      typeof creatorRef === 'object' &&
      'displayName' in creatorRef
        ? {
            id: String(creatorRef._id),
            displayName: creatorRef.displayName || creatorRef.login,
            login: creatorRef.login,
          }
        : null;

    const createdById =
      createdBy?.id ?? (creatorRef ? String(creatorRef) : null);

    return { createdBy, createdById };
  }

  private toPublicUser(user: UserDocument) {
    const { structure, structureId } = this.parseStructureFromUser(user);
    const { createdBy, createdById } = this.parseCreatedByFromUser(user);

    return {
      id: user.id,
      login: user.login,
      displayName: user.displayName,
      position: user.position ?? '',
      role: user.role,
      isActive: user.isActive,
      structureId,
      structure,
      createdById,
      createdBy,
      permissions: this.resolvePermissionsForRole(
        user.role,
        user.permissions as UserPermissionsMap,
      ),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastOnline: user.lastOnline ?? null,
    };
  }

  async updateLastOnline(userId: string, at: Date = new Date()): Promise<void> {
    await this.userModel
      .updateOne({ _id: userId }, { $set: { lastOnline: at } })
      .exec();
  }

  private buildListFilter(query: QueryUsersDto): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    const term = query.search?.trim();

    if (term) {
      const regex = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      filter.$or = [{ login: regex }, { displayName: regex }];
    }

    if (query.structureId) {
      filter.structureId = new Types.ObjectId(query.structureId);
    }

    return filter;
  }

  findByLogin(login: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ login: login.toLowerCase() }).exec();
  }

  findByLoginWithPassword(login: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ login: login.toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  async resolveDeactivatedByInfo(
    deactivatedBy?: Types.ObjectId | string | null,
  ) {
    if (!deactivatedBy) {
      return null;
    }

    const actor = await this.findById(String(deactivatedBy));

    if (!actor) {
      return null;
    }

    return {
      id: actor.id,
      displayName: actor.displayName || actor.login,
      login: actor.login,
    };
  }

  buildDeactivatedLoginMessage(
    deactivatedBy?: {
      displayName?: string;
      login?: string;
    } | null,
  ) {
    const actorName = deactivatedBy?.displayName || deactivatedBy?.login;

    if (actorName) {
      return `Ruxsat olish zarur. Profil ${actorName} tomonidan nofaol qilingan.`;
    }

    return 'Ruxsat olish zarur. Profil nofaol qilingan.';
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  findByIdWithStructure(id: string): Promise<UserDocument | null> {
    return this.userModel
      .findById(id)
      .populate({
        path: 'structureId',
        select: 'fullName shortName isActive hasWarehouse',
      })
      .exec();
  }

  /**
   * Yangi biznes yozuvi yaratishda chaqiriladi — o'sha paytdagi tuzilma snapshot qaytariladi.
   * Foydalanuvchi keyin tuzilmasini o'zgartirsa, avvalgi yozuvlardagi snapshot o'zgarmaydi.
   */
  async resolveStructureSnapshotForUser(
    userId: string,
  ): Promise<StructureSnapshot | null> {
    const user = await this.findById(userId);

    if (!user?.structureId) {
      return null;
    }

    return this.structuresService.buildSnapshot(String(user.structureId));
  }

  async findActiveLookup() {
    const users = await this.userModel
      .find({ isActive: true })
      .populate({
        path: 'structureId',
        select: 'fullName shortName hasWarehouse',
      })
      .sort({ displayName: 1, login: 1 })
      .select('displayName login structureId')
      .exec();

    return users.map((user) => ({
      id: user.id,
      displayName: user.displayName || user.login,
      login: user.login,
      structureShortName:
        typeof user.structureId === 'object' &&
        user.structureId !== null &&
        'shortName' in user.structureId
          ? ((user.structureId as any).shortName as string)
          : null,
    }));
  }

  async findAllPaginated(
    query: QueryUsersDto,
    viewerId?: string,
    viewerRole?: UserRole,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter = this.buildListFilter(query);

    if (viewerId && !isSuperAdminRole(viewerRole)) {
      const viewer = await this.findById(viewerId);
      const viewerPermissions = this.resolvePermissionsForRole(
        viewer?.role ?? UserRole.USER,
        viewer?.permissions as UserPermissionsMap | undefined,
      );
      const hasUsersPageAccess = Boolean(
        viewerPermissions[USERS_PAGE_PATH]?.access,
      );

      if (!hasUsersPageAccess) {
        filter._id = new Types.ObjectId(viewerId);
      }
    }

    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .populate({
          path: 'structureId',
          select: 'fullName shortName isActive hasWarehouse',
        })
        .populate({
          path: 'createdBy',
          select: 'displayName login',
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      items: users.map((user) => this.toPublicUser(user)),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findByIdOrFail(id: string, viewerId?: string, viewerRole?: UserRole) {
    const user = await this.userModel
      .findById(id)
      .populate({
        path: 'structureId',
        select: 'fullName shortName isActive hasWarehouse',
      })
      .populate({
        path: 'createdBy',
        select: 'displayName login',
      })
      .exec();

    if (!user) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    if (
      viewerId &&
      !isSuperAdminRole(viewerRole) &&
      String(user._id) !== viewerId
    ) {
      throw new ForbiddenException(
        'Boshqa foydalanuvchi ma’lumotlarini ko‘rish huquqi yo‘q',
      );
    }

    return this.toPublicUser(user);
  }

  resolvePermissionsForRole(
    role: UserRole,
    permissions?: UserPermissionsMap,
  ): UserPermissionsMap {
    if (role === UserRole.SUPER_ADMIN) {
      return createFullPermissions();
    }

    return normalizePermissions(permissions ?? createEmptyPermissions());
  }

  private async resolveStructureId(structureId: string) {
    const structure = await this.structuresService.findByIdOrFail(structureId);

    if (!structure.isActive) {
      throw new BadRequestException('Tanlangan tuzilma faol emas');
    }

    return new Types.ObjectId(structureId);
  }

  private async assertWarehousePermissionsAllowed(
    structureId: string | undefined,
    permissions: UserPermissionsMap,
  ) {
    if (!structureId) {
      return;
    }

    const structure = await this.structuresService.findByIdOrFail(structureId);

    if (structure.hasWarehouse) {
      return;
    }

    const hasWarehousePermission = WAREHOUSE_PERMISSION_PATHS.some(
      (path) => permissions[path]?.access,
    );

    if (hasWarehousePermission) {
      throw new BadRequestException('Ushbu tuzilmaning ombori mavjud emas');
    }
  }

  async createUser(input: CreateUserInput): Promise<UserDocument> {
    const existing = await this.findByLogin(input.login);

    if (existing) {
      throw new ConflictException('Bu login band');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const role = input.role ?? UserRole.USER;

    if (role !== UserRole.SUPER_ADMIN && !input.structureId) {
      throw new BadRequestException('Tarkibiy tuzilmani tanlang');
    }

    const structureObjectId =
      role !== UserRole.SUPER_ADMIN && input.structureId
        ? await this.resolveStructureId(input.structureId)
        : undefined;

    const resolvedPermissions = this.resolvePermissionsForRole(
      role,
      input.permissions,
    );

    if (role !== UserRole.SUPER_ADMIN && input.structureId) {
      await this.assertWarehousePermissionsAllowed(
        input.structureId,
        resolvedPermissions,
      );
    }

    const createdByObjectId = input.createdById
      ? new Types.ObjectId(input.createdById)
      : undefined;

    return this.userModel.create({
      login: input.login.toLowerCase(),
      passwordHash,
      role,
      displayName: input.displayName ?? input.login,
      position: input.position?.trim() ?? '',
      isActive: true,
      ...(structureObjectId ? { structureId: structureObjectId } : {}),
      ...(createdByObjectId ? { createdBy: createdByObjectId } : {}),
      permissions: resolvedPermissions,
    });
  }

  async createFromDto(
    dto: CreateUserPayload,
    createdById?: string,
    requesterRole?: UserRole,
  ) {
    await this.assertUsersActionPermission(
      createdById,
      requesterRole,
      'create',
    );

    const user = await this.createUser({
      login: dto.login,
      password: dto.password,
      displayName: dto.displayName,
      position: dto.position,
      structureId: dto.structureId,
      createdById,
      permissions: normalizePermissions(dto.permissions),
    });

    const populated = await this.userModel
      .findById(user.id)
      .populate({
        path: 'structureId',
        select: 'fullName shortName isActive hasWarehouse',
      })
      .populate({
        path: 'createdBy',
        select: 'displayName login',
      })
      .exec();

    return this.toPublicUser(populated ?? user);
  }

  async findActiveUserIdsWithPageAccess(
    pagePath: string,
    structureId?: string | null,
  ): Promise<string[]> {
    const filter: Record<string, unknown> = { isActive: true };

    if (structureId) {
      filter.$or = [
        { structureId: new Types.ObjectId(structureId) },
        { role: UserRole.SUPER_ADMIN },
      ];
    }

    const users = await this.userModel
      .find(filter)
      .select('role permissions structureId')
      .exec();

    const ids = new Set<string>();

    for (const user of users) {
      if (
        isSuperAdminRole(user.role) ||
        hasPageAccess(
          normalizePermissions(user.permissions as UserPermissionsMap),
          pagePath,
          false,
        )
      ) {
        ids.add(String(user._id));
      }
    }

    return [...ids];
  }

  async updateFromDto(
    id: string,
    dto: UpdateUserPayload,
    requesterId?: string,
    requesterRole?: UserRole,
  ) {
    await this.assertUsersActionPermission(
      requesterId,
      requesterRole,
      'update',
    );

    const user = await this.findById(id);

    if (!user) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    if (dto.displayName !== undefined) {
      user.displayName = dto.displayName;
    }

    if (dto.position !== undefined) {
      user.position = dto.position.trim();
    }

    if (dto.isActive !== undefined) {
      if (dto.isActive) {
        user.isActive = true;
        user.deactivatedBy = undefined;
        user.deactivatedAt = null;
      } else if (user.isActive) {
        user.isActive = false;
        user.deactivatedBy = new Types.ObjectId(requesterId);
        user.deactivatedAt = new Date();
      }
    }

    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    }

    if (dto.structureId !== undefined && user.role !== UserRole.SUPER_ADMIN) {
      user.structureId = await this.resolveStructureId(dto.structureId);
    }

    if (dto.permissions !== undefined) {
      user.permissions =
        user.role === UserRole.SUPER_ADMIN
          ? createFullPermissions()
          : normalizePermissions(dto.permissions);
    }

    if (user.role !== UserRole.SUPER_ADMIN) {
      const structureId = user.structureId ? String(user.structureId) : undefined;
      await this.assertWarehousePermissionsAllowed(
        structureId,
        user.permissions as UserPermissionsMap,
      );
    }

    await user.save();

    const populated = await this.userModel
      .findById(user.id)
      .populate({
        path: 'structureId',
        select: 'fullName shortName isActive hasWarehouse',
      })
      .exec();

    return this.toPublicUser(populated ?? user);
  }

  async remove(id: string, requesterId: string, requesterRole: UserRole) {
    await this.assertUsersActionPermission(
      requesterId,
      requesterRole,
      'delete',
    );

    const user = await this.findById(id);

    if (!user) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    if (
      user.role === UserRole.SUPER_ADMIN &&
      requesterRole !== UserRole.SUPER_ADMIN
    ) {
      throw new ConflictException('Super adminni nofaol qilib bo‘lmaydi');
    }

    user.isActive = false;
    user.deactivatedBy = new Types.ObjectId(requesterId);
    user.deactivatedAt = new Date();
    await user.save();

    return { success: true };
  }

  async permanentRemove(id: string, requesterId: string) {
    if (id === requesterId) {
      throw new BadRequestException('O‘zingizni o‘chirib bo‘lmaydi');
    }

    const user = await this.findById(id);

    if (!user) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    await this.userModel.findByIdAndDelete(id).exec();

    return { success: true };
  }

  async validatePassword(
    plainPassword: string,
    passwordHash: string,
  ): Promise<boolean> {
    return bcrypt.compare(plainPassword, passwordHash);
  }

  getAuthProfile(user: UserDocument) {
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
    const { structure, structureId } = this.parseStructureFromUser(user);

    return {
      id: user.id,
      login: user.login,
      role: user.role,
      displayName: user.displayName,
      position: user.position ?? '',
      isSuperAdmin,
      structureId,
      structure,
      permissions: this.resolvePermissionsForRole(
        user.role,
        user.permissions as UserPermissionsMap,
      ),
      lastOnline: user.lastOnline ?? null,
    };
  }

  async updateOwnProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.findById(userId);

    if (!user || !user.isActive) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    if (dto.displayName !== undefined) {
      const trimmed = dto.displayName.trim();
      user.displayName = trimmed || user.login;
    }

    if (dto.position !== undefined) {
      user.position = dto.position.trim();
    }

    if (dto.structureId !== undefined && user.role !== UserRole.SUPER_ADMIN) {
      user.structureId = await this.resolveStructureId(dto.structureId);
    }

    await user.save();

    const populated = await this.findByIdWithStructure(userId);

    if (!populated) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    return this.getAuthProfile(populated);
  }

  async changeOwnPassword(userId: string, dto: ChangePasswordDto) {
    if (dto.newPassword !== dto.confirmNewPassword) {
      throw new BadRequestException('Yangi parollar mos emas');
    }

    const user = await this.userModel
      .findById(userId)
      .select('+passwordHash')
      .exec();

    if (!user || !user.isActive) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    const isCurrentValid = await this.validatePassword(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!isCurrentValid) {
      throw new UnauthorizedException('Joriy parol noto‘g‘ri');
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await user.save();

    return { success: true };
  }

  async backfillIshonchnomaPermissions(): Promise<number> {
    const users = await this.userModel
      .find({ role: { $ne: UserRole.SUPER_ADMIN } })
      .exec();

    let updated = 0;

    for (const user of users) {
      const before = JSON.stringify(
        user.permissions?.['/xarid-qilish/ishonchnoma'] ?? null,
      );
      const normalized = normalizePermissions(
        user.permissions as UserPermissionsMap,
      );
      const after = JSON.stringify(
        normalized['/xarid-qilish/ishonchnoma'] ?? null,
      );

      if (before === after) {
        continue;
      }

      user.permissions = normalized;
      user.markModified('permissions');
      await user.save();
      updated += 1;
    }

    return updated;
  }
}
