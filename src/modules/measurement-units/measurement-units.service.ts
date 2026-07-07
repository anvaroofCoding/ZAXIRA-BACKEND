import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { MEASUREMENT_UNITS } from '../purchase-requests/constants/measurement-units';
import {
  PurchaseRequest,
  PurchaseRequestDocument,
} from '../purchase-requests/schemas/purchase-request.schema';
import {
  PurchaseRequestSession,
  PurchaseRequestSessionDocument,
} from '../purchase-requests/schemas/purchase-request-session.schema';
import type { UserPermissionsMap } from '../users/types/page-permission.type';
import { UsersService } from '../users/users.service';
import { hasPageAccess } from '../users/utils/permissions.util';
import {
  WarehouseImport,
  WarehouseImportDocument,
} from '../warehouse/schemas/warehouse-import.schema';
import {
  WarehouseImportSession,
  WarehouseImportSessionDocument,
} from '../warehouse/schemas/warehouse-import-session.schema';
import { MEASUREMENT_UNITS_PAGE_PATH } from './constants/measurement-units-page-path';
import { CreateCustomMeasurementUnitDto } from './dto/create-custom-measurement-unit.dto';
import { QueryCustomMeasurementUnitsDto } from './dto/query-custom-measurement-units.dto';
import { UpdateCustomMeasurementUnitDto } from './dto/update-custom-measurement-unit.dto';
import {
  CustomMeasurementUnit,
  CustomMeasurementUnitDocument,
} from './schemas/custom-measurement-unit.schema';

const SYSTEM_UNITS_LOWER = new Set(
  MEASUREMENT_UNITS.map((unit) => unit.toLowerCase()),
);

@Injectable()
export class MeasurementUnitsService {
  constructor(
    @InjectModel(CustomMeasurementUnit.name)
    private readonly customUnitModel: Model<CustomMeasurementUnitDocument>,
    @InjectModel(PurchaseRequest.name)
    private readonly purchaseRequestModel: Model<PurchaseRequestDocument>,
    @InjectModel(PurchaseRequestSession.name)
    private readonly purchaseRequestSessionModel: Model<PurchaseRequestSessionDocument>,
    @InjectModel(WarehouseImport.name)
    private readonly warehouseImportModel: Model<WarehouseImportDocument>,
    @InjectModel(WarehouseImportSession.name)
    private readonly warehouseImportSessionModel: Model<WarehouseImportSessionDocument>,
    private readonly usersService: UsersService,
  ) {}

  private normalizeName(name: string) {
    return name.trim();
  }

  private normalizeNameLower(name: string) {
    return this.normalizeName(name).toLowerCase();
  }

  private assertValidCustomName(name: string) {
    const normalized = this.normalizeName(name);

    if (!normalized) {
      throw new BadRequestException('Birlik nomini kiriting');
    }

    if (SYSTEM_UNITS_LOWER.has(normalized.toLowerCase())) {
      throw new BadRequestException(
        'Bu nom dastur birliklari ro‘yxatida allaqachon mavjud',
      );
    }

    return normalized;
  }

  private toPublic(
    unit: CustomMeasurementUnitDocument,
    owner?: { displayName: string; login: string },
    usage?: { isUsed: boolean; usedCount: number },
  ) {
    return {
      id: unit.id,
      name: unit.name,
      userId: String(unit.userId),
      ownerName: owner?.displayName?.trim() || owner?.login || '—',
      ownerLogin: owner?.login ?? '',
      isUsed: usage?.isUsed ?? false,
      usedCount: usage?.usedCount ?? 0,
      createdAt: unit.createdAt,
      updatedAt: unit.updatedAt,
    };
  }

  async assertPageAccess(userId: string, role?: UserRole) {
    if (isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findByIdOrFail(userId);

    if (!user?.isActive) {
      throw new ForbiddenException('Sahifaga ruxsat yo‘q');
    }

    const permissions = this.usersService.resolvePermissionsForRole(
      user.role,
      user.permissions as UserPermissionsMap | undefined,
    );

    if (!hasPageAccess(permissions, MEASUREMENT_UNITS_PAGE_PATH, false)) {
      throw new ForbiddenException('Sahifaga ruxsat yo‘q');
    }
  }

  getOptions(userId: string) {
    return this.customUnitModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ name: 1 })
      .exec()
      .then((items) => ({
        system: [...MEASUREMENT_UNITS],
        custom: items.map((item) => item.name),
      }));
  }

  async createForUser(userId: string, dto: CreateCustomMeasurementUnitDto) {
    const name = this.assertValidCustomName(dto.name);
    const nameLower = this.normalizeNameLower(name);
    const userObjectId = new Types.ObjectId(userId);

    const existing = await this.customUnitModel
      .findOne({ userId: userObjectId, nameLower })
      .exec();

    if (existing) {
      return this.toPublic(existing);
    }

    try {
      const created = await this.customUnitModel.create({
        userId: userObjectId,
        name,
        nameLower,
      });

      return this.toPublic(created);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        const duplicate = await this.customUnitModel
          .findOne({ userId: userObjectId, nameLower })
          .exec();

        if (duplicate) {
          return this.toPublic(duplicate);
        }

        throw new ConflictException('Bu birlik nomi band');
      }

      throw error;
    }
  }

  private buildListFilter(query: QueryCustomMeasurementUnitsDto) {
    const filter: Record<string, unknown> = {};
    const term = query.search?.trim();

    if (term) {
      const regex = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      filter.name = regex;
    }

    return filter;
  }

  async findAllPaginated(query: QueryCustomMeasurementUnitsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter = this.buildListFilter(query);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.customUnitModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.customUnitModel.countDocuments(filter).exec(),
    ]);

    const ownerIds = [...new Set(items.map((item) => String(item.userId)))];
    const owners = await Promise.all(
      ownerIds.map(async (id) => {
        try {
          const user = await this.usersService.findByIdOrFail(id);
          return {
            id,
            displayName: user.displayName,
            login: user.login,
          };
        } catch {
          return { id, displayName: '', login: '' };
        }
      }),
    );
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));

    const usageList = await Promise.all(
      items.map((item) => this.getUnitUsage(item.userId, item.name)),
    );

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      items: items.map((item, index) => {
        const owner = ownerMap.get(String(item.userId));
        const usage = usageList[index];

        return this.toPublic(item, owner, usage);
      }),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async update(id: string, dto: UpdateCustomMeasurementUnitDto) {
    const unit = await this.customUnitModel.findById(id).exec();

    if (!unit) {
      throw new NotFoundException('Birlik topilmadi');
    }

    const newName = this.assertValidCustomName(dto.name);
    const newNameLower = this.normalizeNameLower(newName);
    const oldName = unit.name;

    if (newNameLower === unit.nameLower) {
      const owner = await this.usersService.findByIdOrFail(String(unit.userId));
      const usage = await this.getUnitUsage(unit.userId, unit.name);
      return this.toPublic(unit, owner, usage);
    }

    const duplicate = await this.customUnitModel
      .findOne({
        userId: unit.userId,
        nameLower: newNameLower,
        _id: { $ne: unit._id },
      })
      .exec();

    if (duplicate) {
      throw new ConflictException('Bu foydalanuvchi uchun birlik nomi band');
    }

    unit.name = newName;
    unit.nameLower = newNameLower;
    await unit.save();

    if (oldName !== newName) {
      await this.propagateUnitRename(unit.userId, oldName, newName);
    }

    const owner = await this.usersService.findByIdOrFail(String(unit.userId));
    const usage = await this.getUnitUsage(unit.userId, unit.name);

    return this.toPublic(unit, owner, usage);
  }

  async remove(id: string) {
    const unit = await this.customUnitModel.findById(id).exec();

    if (!unit) {
      throw new NotFoundException('Birlik topilmadi');
    }

    const usage = await this.getUnitUsage(unit.userId, unit.name);

    if (usage.isUsed) {
      throw new BadRequestException(
        'Birlik ishlatilgani uchun o‘chirib bo‘lmaydi',
      );
    }

    await unit.deleteOne();

    return { success: true };
  }

  private async getUnitUsage(userId: Types.ObjectId, unitName: string) {
    const name = this.normalizeName(unitName);
    const usedCount = await this.countUnitUsage(userId, name);

    return {
      isUsed: usedCount > 0,
      usedCount,
    };
  }

  private async countUnitUsage(userId: Types.ObjectId, unitName: string) {
    const [
      requestItems,
      requestSubstitutions,
      sessions,
      imports,
      importSessions,
    ] = await Promise.all([
      this.purchaseRequestModel.countDocuments({
        createdById: userId,
        'items.unit': unitName,
      }),
      this.purchaseRequestModel.countDocuments({
        createdById: userId,
        $or: [
          { 'history.itemSubstitutions.originalUnit': unitName },
          { 'history.itemSubstitutions.deliveredUnit': unitName },
          { 'purchaseBatches.itemSubstitutions.originalUnit': unitName },
          { 'purchaseBatches.itemSubstitutions.deliveredUnit': unitName },
        ],
      }),
      this.purchaseRequestSessionModel.countDocuments({
        userId,
        'items.unit': unitName,
      }),
      this.warehouseImportModel.countDocuments({
        createdBy: userId,
        'items.unit': unitName,
      }),
      this.warehouseImportSessionModel.countDocuments({
        userId,
        'items.unit': unitName,
      }),
    ]);

    return (
      requestItems +
      requestSubstitutions +
      sessions +
      imports +
      importSessions
    );
  }

  private async propagateUnitRename(
    userId: Types.ObjectId,
    oldName: string,
    newName: string,
  ) {
    await Promise.all([
      this.purchaseRequestModel.updateMany(
        { createdById: userId, 'items.unit': oldName },
        { $set: { 'items.$[item].unit': newName } },
        { arrayFilters: [{ 'item.unit': oldName }] },
      ),
      this.purchaseRequestSessionModel.updateMany(
        { userId, 'items.unit': oldName },
        { $set: { 'items.$[item].unit': newName } },
        { arrayFilters: [{ 'item.unit': oldName }] },
      ),
      this.warehouseImportModel.updateMany(
        { createdBy: userId, 'items.unit': oldName },
        { $set: { 'items.$[item].unit': newName } },
        { arrayFilters: [{ 'item.unit': oldName }] },
      ),
      this.warehouseImportSessionModel.updateMany(
        { userId, 'items.unit': oldName },
        { $set: { 'items.$[item].unit': newName } },
        { arrayFilters: [{ 'item.unit': oldName }] },
      ),
      this.purchaseRequestModel.updateMany(
        { createdById: userId, 'history.itemSubstitutions.originalUnit': oldName },
        {
          $set: {
            'history.$[].itemSubstitutions.$[sub].originalUnit': newName,
          },
        },
        { arrayFilters: [{ 'sub.originalUnit': oldName }] },
      ),
      this.purchaseRequestModel.updateMany(
        { createdById: userId, 'history.itemSubstitutions.deliveredUnit': oldName },
        {
          $set: {
            'history.$[].itemSubstitutions.$[sub].deliveredUnit': newName,
          },
        },
        { arrayFilters: [{ 'sub.deliveredUnit': oldName }] },
      ),
      this.purchaseRequestModel.updateMany(
        {
          createdById: userId,
          'purchaseBatches.itemSubstitutions.originalUnit': oldName,
        },
        {
          $set: {
            'purchaseBatches.$[].itemSubstitutions.$[sub].originalUnit': newName,
          },
        },
        { arrayFilters: [{ 'sub.originalUnit': oldName }] },
      ),
      this.purchaseRequestModel.updateMany(
        {
          createdById: userId,
          'purchaseBatches.itemSubstitutions.deliveredUnit': oldName,
        },
        {
          $set: {
            'purchaseBatches.$[].itemSubstitutions.$[sub].deliveredUnit': newName,
          },
        },
        { arrayFilters: [{ 'sub.deliveredUnit': oldName }] },
      ),
    ]);
  }

  private isDuplicateKeyError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
