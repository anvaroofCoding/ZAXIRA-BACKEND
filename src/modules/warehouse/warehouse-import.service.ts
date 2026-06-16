import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { MongoServerError } from 'mongodb';
import { Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { appendDateRangeClause } from '../../common/utils/date-range-filter.util';
import {
  Sequence,
  SequenceDocument,
} from '../purchase-requests/schemas/sequence.schema';
import { UsersService } from '../users/users.service';
import { UserPermissionsMap } from '../users/types/page-permission.type';
import {
  hasPageAction,
  hasPageAccess,
  normalizePermissions,
} from '../users/utils/permissions.util';
import { WAREHOUSE_IMPORT_PAGE_PATH } from '../users/constants/disabled-page-actions';
import { QueryWarehouseImportsDto } from './dto/query-warehouse-imports.dto';
import { SaveWarehouseImportSessionDto } from './dto/save-warehouse-import-session.dto';
import {
  WarehouseImport,
  WarehouseImportDocument,
} from './schemas/warehouse-import.schema';
import {
  WarehouseImportSession,
  WarehouseImportSessionDocument,
} from './schemas/warehouse-import-session.schema';
import {
  WarehouseInventory,
  WarehouseInventoryDocument,
} from './schemas/warehouse-inventory.schema';
import {
  WarehouseLocation,
  WarehouseLocationDocument,
} from './schemas/warehouse-location.schema';
import {
  Structure,
  StructureDocument,
} from '../structures/schemas/structure.schema';
import {
  buildInventoryItemKey,
  resolveInventoryBarcodeForStorage,
} from './utils/inventory-nomenclature.util';

const IMPORT_PAGE_PATH = WAREHOUSE_IMPORT_PAGE_PATH;
const MAX_ACTIVE_IMPORT_SESSIONS = 10;
const IMPORT_SEQUENCE_PREFIX = 'import:';

@Injectable()
export class WarehouseImportService {
  constructor(
    @InjectModel(WarehouseImportSession.name)
    private readonly sessionModel: Model<WarehouseImportSessionDocument>,
    @InjectModel(WarehouseImport.name)
    private readonly importModel: Model<WarehouseImportDocument>,
    @InjectModel(WarehouseInventory.name)
    private readonly inventoryModel: Model<WarehouseInventoryDocument>,
    @InjectModel(WarehouseLocation.name)
    private readonly locationModel: Model<WarehouseLocationDocument>,
    @InjectModel(Sequence.name)
    private readonly sequenceModel: Model<SequenceDocument>,
    @InjectModel(Structure.name)
    private readonly structureModel: Model<StructureDocument>,
    private readonly usersService: UsersService,
  ) {}

  private async assertCanViewImportPage(userId: string, role?: UserRole) {
    if (isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      throw new ForbiddenException('Sahifaga kirishga ruxsat yo‘q');
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );

    if (!hasPageAccess(permissions, IMPORT_PAGE_PATH, false)) {
      throw new ForbiddenException('Sahifaga kirishga ruxsat yo‘q');
    }
  }

  private async assertCanImport(userId: string, role?: UserRole) {
    if (isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      throw new ForbiddenException('Tovar import qilishga ruxsat yo‘q');
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );

    if (!hasPageAction(permissions, IMPORT_PAGE_PATH, 'create', false)) {
      throw new ForbiddenException('Tovar import qilishga ruxsat yo‘q');
    }
  }

  private async resolveViewerStructureWithWarehouseOrFail(
    userId: string,
    role?: UserRole,
  ) {
    const user = await this.usersService.findById(userId);
    const structureId = user?.structureId ? String(user.structureId) : null;

    if (!structureId) {
      throw new BadRequestException('Foydalanuvchiga tuzilma biriktirilmagan');
    }

    const structure = await this.structureModel.findById(structureId).exec();

    if (!structure) {
      throw new NotFoundException('Tuzilma topilmadi');
    }

    if (!structure.hasWarehouse) {
      throw new BadRequestException('Ushbu tuzilmaning ombori mavjud emas');
    }

    return structureId;
  }

  private resolveSessionTitle(
    session: WarehouseImportSessionDocument,
    fallbackIndex = 1,
  ) {
    if (session.title?.trim()) {
      return session.title.trim();
    }

    const firstItem = (session.items ?? []).find((item) => item.name?.trim());
    if (firstItem?.name?.trim()) {
      return firstItem.name.trim();
    }

    return `Import ${fallbackIndex}`;
  }

  private toSessionPublic(
    session: WarehouseImportSessionDocument,
    fallbackIndex = 1,
  ) {
    const firstNamedItem = (session.items ?? []).find((item) =>
      item.name?.trim(),
    );

    return {
      id: session.id,
      title: this.resolveSessionTitle(session, fallbackIndex),
      preview:
        firstNamedItem?.name?.trim() || session.comment?.trim() || '',
      locationId: session.locationId ? String(session.locationId) : '',
      items: (session.items ?? []).map((item) => ({
        name: item.name ?? '',
        characteristics: item.characteristics ?? '',
        quantity: item.quantity ?? 1,
        unit: item.unit ?? 'dona',
        manufacturingCountry: item.manufacturingCountry ?? '',
      })),
      comment: session.comment ?? '',
      createdAt: session.createdAt ?? null,
      updatedAt: session.updatedAt ?? null,
    };
  }

  private async findActiveSessionOrFail(userId: string, sessionId: string) {
    const session = await this.sessionModel
      .findOne({
        _id: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
      })
      .exec();

    if (!session) {
      throw new NotFoundException('Faol seans topilmadi');
    }

    return session;
  }

  private normalizeSessionItems(dto: SaveWarehouseImportSessionDto) {
    return (dto.items ?? []).map((item) => ({
      name: item.name?.trim() ?? '',
      characteristics: item.characteristics?.trim() ?? '',
      quantity:
        item.quantity && Number.isFinite(item.quantity) && item.quantity >= 1
          ? item.quantity
          : 1,
      unit: item.unit?.trim() || 'dona',
      manufacturingCountry: item.manufacturingCountry?.trim() ?? '',
    }));
  }

  private async nextImportCode(structureId: string) {
    const key = `${IMPORT_SEQUENCE_PREFIX}${structureId}`;
    const sequence = await this.sequenceModel
      .findOneAndUpdate(
        { key },
        { $inc: { value: 1 } },
        { upsert: true, new: true },
      )
      .exec();

    return `IMP-${String(sequence.value).padStart(6, '0')}`;
  }

  private async assertLocationBelongsToStructure(
    structureId: string,
    locationId: string,
  ) {
    const location = await this.locationModel
      .findOne({
        _id: new Types.ObjectId(locationId),
        structureId: new Types.ObjectId(structureId),
        isActive: true,
      })
      .exec();

    if (!location) {
      throw new BadRequestException('Ombor joyi topilmadi');
    }

    return location;
  }

  private buildReceiptInventoryMatchFilters(
    name: string,
    characteristics: string,
    itemKey: string,
  ) {
    return [
      { itemKey },
      {
        name,
        characteristics,
      },
    ];
  }

  private async upsertImportedInventory(
    structureId: string,
    locationId: string,
    item: {
      name: string;
      characteristics: string;
      quantity: number;
    },
    now: Date,
  ) {
    const itemKey = buildInventoryItemKey(item.name, item.characteristics);
    const barcode = resolveInventoryBarcodeForStorage(
      item.name,
      item.characteristics,
    );
    const structureObjectId = new Types.ObjectId(structureId);
    const locationObjectId = new Types.ObjectId(locationId);
    const matchFilters = this.buildReceiptInventoryMatchFilters(
      item.name,
      item.characteristics,
      itemKey,
    );

    const findExisting = () =>
      this.inventoryModel
        .findOne({
          structureId: structureObjectId,
          locationId: locationObjectId,
          $or: matchFilters,
        })
        .exec();

    let existing = await findExisting();

    if (existing) {
      const resolvedBarcode = resolveInventoryBarcodeForStorage(
        item.name,
        item.characteristics,
        existing.barcode,
      );

      await this.inventoryModel
        .updateOne(
          { _id: existing._id },
          {
            $inc: { quantity: item.quantity },
            $set: {
              lastReceiptAt: now,
              name: item.name,
              characteristics: item.characteristics,
              ...(existing.barcode?.trim() !== resolvedBarcode
                ? { barcode: resolvedBarcode }
                : {}),
            },
          },
        )
        .exec();

      return itemKey;
    }

    try {
      await this.inventoryModel.create({
        structureId: structureObjectId,
        locationId: locationObjectId,
        itemKey,
        name: item.name,
        characteristics: item.characteristics,
        barcode,
        quantity: item.quantity,
        unitPrice: 0,
        lastReceiptAt: now,
      });
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 11000) {
        existing = await findExisting();

        if (existing) {
          await this.inventoryModel
            .updateOne(
              { _id: existing._id },
              {
                $inc: { quantity: item.quantity },
                $set: {
                  lastReceiptAt: now,
                  name: item.name,
                  characteristics: item.characteristics,
                },
              },
            )
            .exec();

          return itemKey;
        }
      }

      throw error;
    }

    return itemKey;
  }

  private async loadLocationNameMap(locationIds: string[]) {
    const uniqueIds = [
      ...new Set(locationIds.filter((id) => Types.ObjectId.isValid(id))),
    ];

    if (!uniqueIds.length) {
      return new Map<string, string>();
    }

    const locations = await this.locationModel
      .find({ _id: { $in: uniqueIds.map((id) => new Types.ObjectId(id)) } })
      .select('name')
      .exec();

    return new Map(locations.map((loc) => [String(loc._id), loc.name?.trim() || '—']));
  }

  private async loadCreatorNameMap(userIds: string[]) {
    const uniqueIds = [
      ...new Set(userIds.filter((id) => Types.ObjectId.isValid(id))),
    ];

    const map = new Map<string, string>();
    if (!uniqueIds.length) {
      return map;
    }

    await Promise.all(
      uniqueIds.map(async (id) => {
        const user = await this.usersService.findById(id);
        if (!user) return;

        const displayName =
          user.displayName?.trim() || user.login?.trim() || '—';
        map.set(id, displayName);
      }),
    );

    return map;
  }

  private toImportPublic(
    importDoc: WarehouseImportDocument,
    locationNames: Map<string, string>,
    creatorName: string,
  ) {
    const items = (importDoc.items ?? []).map((item) => {
      const locationId = String(item.locationId);
      return {
        locationId,
        locationName: locationNames.get(locationId) ?? '—',
        name: item.name,
        characteristics: item.characteristics,
        quantity: item.quantity,
        unit: item.unit,
        manufacturingCountry: item.manufacturingCountry,
      };
    });

    const locationIds = [...new Set(items.map((item) => item.locationId))];
    const locationName =
      locationIds.length === 1
        ? items[0]?.locationName ?? '—'
        : locationIds.length > 1
          ? `${locationIds.length} ta joy`
          : '—';

    return {
      id: importDoc.id,
      code: importDoc.code,
      comment: importDoc.comment ?? '',
      createdAt: importDoc.createdAt ?? null,
      createdBy: {
        id: String(importDoc.createdBy),
        displayName: creatorName,
      },
      locationId: locationIds.length === 1 ? locationIds[0] : null,
      locationName,
      itemCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + (item.quantity ?? 0), 0),
      items,
    };
  }

  async listImportsPaginated(
    query: QueryWarehouseImportsDto,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertCanViewImportPage(userId, role);

    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(
      userId,
      role,
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const matchClauses: Record<string, unknown>[] = [
      { structureId: new Types.ObjectId(structureId) },
    ];

    appendDateRangeClause(
      matchClauses,
      'createdAt',
      query.dateFrom,
      query.dateTo,
    );

    const term = query.search?.trim();
    if (term) {
      const regex = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      matchClauses.push({
        $or: [
          { code: regex },
          { comment: regex },
          { 'items.name': regex },
          { 'items.characteristics': regex },
          { 'items.manufacturingCountry': regex },
        ],
      });
    }

    const match =
      matchClauses.length === 1
        ? matchClauses[0]
        : { $and: matchClauses };

    const [rows, total] = await Promise.all([
      this.importModel
        .find(match)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.importModel.countDocuments(match).exec(),
    ]);

    const locationIds = rows.flatMap((row) =>
      (row.items ?? []).map((item) => String(item.locationId)),
    );
    const creatorIds = rows.map((row) => String(row.createdBy));

    const [locationNames, creatorNames] = await Promise.all([
      this.loadLocationNameMap(locationIds),
      this.loadCreatorNameMap(creatorIds),
    ]);

    return {
      items: rows.map((row) =>
        this.toImportPublic(
          row,
          locationNames,
          creatorNames.get(String(row.createdBy)) ?? '—',
        ),
      ),
      total,
      page,
      limit,
    };
  }

  async findImportById(id: string, userId: string, role?: UserRole) {
    await this.assertCanViewImportPage(userId, role);

    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(
      userId,
      role,
    );

    const importDoc = await this.importModel
      .findOne({
        _id: new Types.ObjectId(id),
        structureId: new Types.ObjectId(structureId),
      })
      .exec();

    if (!importDoc) {
      throw new NotFoundException('Import yozuvi topilmadi');
    }

    const locationIds = (importDoc.items ?? []).map((item) =>
      String(item.locationId),
    );
    const [locationNames, creatorNames] = await Promise.all([
      this.loadLocationNameMap(locationIds),
      this.loadCreatorNameMap([String(importDoc.createdBy)]),
    ]);

    return this.toImportPublic(
      importDoc,
      locationNames,
      creatorNames.get(String(importDoc.createdBy)) ?? '—',
    );
  }

  async listActiveSessions(userId: string, role?: UserRole) {
    await this.assertCanImport(userId, role);

    const sessions = await this.sessionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ updatedAt: -1 })
      .exec();

    return {
      items: sessions.map((session, index) =>
        this.toSessionPublic(session, sessions.length - index),
      ),
      total: sessions.length,
      limit: MAX_ACTIVE_IMPORT_SESSIONS,
    };
  }

  async createActiveSession(userId: string, role?: UserRole) {
    await this.assertCanImport(userId, role);

    const userObjectId = new Types.ObjectId(userId);
    const total = await this.sessionModel
      .countDocuments({ userId: userObjectId })
      .exec();

    if (total >= MAX_ACTIVE_IMPORT_SESSIONS) {
      throw new BadRequestException(
        `Ko‘pi bilan ${MAX_ACTIVE_IMPORT_SESSIONS} ta faol seans bo‘lishi mumkin`,
      );
    }

    const session = await this.sessionModel.create({
      userId: userObjectId,
      title: `Import ${total + 1}`,
      items: [
        {
          name: '',
          characteristics: '',
          quantity: 1,
          unit: 'dona',
          manufacturingCountry: '',
        },
      ],
      comment: '',
    });

    return this.toSessionPublic(session, total + 1);
  }

  async saveActiveSession(
    userId: string,
    sessionId: string,
    dto: SaveWarehouseImportSessionDto,
    role?: UserRole,
  ) {
    await this.assertCanImport(userId, role);

    const session = await this.findActiveSessionOrFail(userId, sessionId);
    const items = this.normalizeSessionItems(dto);

    session.items = items;
    session.comment = dto.comment?.trim() ?? '';

    if (dto.locationId && Types.ObjectId.isValid(dto.locationId)) {
      session.locationId = new Types.ObjectId(dto.locationId);
    }

    if (dto.title?.trim()) {
      session.title = dto.title.trim();
    } else {
      const autoTitle = items.find((item) => item.name)?.name;
      if (autoTitle) {
        session.title = autoTitle;
      }
    }

    session.markModified('items');
    await session.save();

    return this.toSessionPublic(session);
  }

  async deleteActiveSession(
    userId: string,
    sessionId: string,
    role?: UserRole,
  ) {
    await this.assertCanImport(userId, role);

    const result = await this.sessionModel
      .deleteOne({
        _id: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
      })
      .exec();

    if (!result.deletedCount) {
      throw new NotFoundException('Faol seans topilmadi');
    }

    return { id: sessionId, deleted: true };
  }

  async submitActiveSession(
    userId: string,
    sessionId: string,
    dto: SaveWarehouseImportSessionDto,
    role?: UserRole,
  ) {
    await this.assertCanImport(userId, role);

    await this.saveActiveSession(userId, sessionId, dto, role);

    const session = await this.findActiveSessionOrFail(userId, sessionId);
    const locationId = session.locationId ? String(session.locationId) : '';

    if (!locationId) {
      throw new BadRequestException('Ombor joyini tanlang');
    }

    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(
      userId,
      role,
    );

    await this.assertLocationBelongsToStructure(structureId, locationId);

    const normalizedItems = (session.items ?? []).map((item) => ({
      name: item.name?.trim() ?? '',
      characteristics: item.characteristics?.trim() ?? '',
      quantity: item.quantity ?? 1,
      unit: item.unit?.trim() || 'dona',
      manufacturingCountry: item.manufacturingCountry?.trim() ?? '',
    }));

    if (!normalizedItems.length) {
      throw new BadRequestException('Kamida bitta tovar kiriting');
    }

    if (normalizedItems.some((item) => !item.name)) {
      throw new BadRequestException('Har bir tovar uchun nom kiriting');
    }

    if (normalizedItems.some((item) => !item.characteristics)) {
      throw new BadRequestException('Har bir tovar uchun xususiyat kiriting');
    }

    if (normalizedItems.some((item) => item.quantity < 1)) {
      throw new BadRequestException('Tovar soni kamida 1 bo‘lishi kerak');
    }

    if (normalizedItems.some((item) => !item.unit)) {
      throw new BadRequestException('Har bir tovar uchun birlikni tanlang');
    }

    if (normalizedItems.some((item) => !item.manufacturingCountry)) {
      throw new BadRequestException(
        'Har bir tovar uchun ishlab chiqarilgan davlatni tanlang',
      );
    }

    const now = new Date();
    const code = await this.nextImportCode(structureId);
    const importItems: WarehouseImport['items'] = [];

    for (const item of normalizedItems) {
      const itemKey = await this.upsertImportedInventory(
        structureId,
        locationId,
        {
          name: item.name,
          characteristics: item.characteristics,
          quantity: item.quantity,
        },
        now,
      );

      importItems.push({
        locationId: new Types.ObjectId(locationId),
        name: item.name,
        characteristics: item.characteristics,
        quantity: item.quantity,
        unit: item.unit,
        manufacturingCountry: item.manufacturingCountry,
        itemKey,
      });
    }

    const created = await this.importModel.create({
      structureId: new Types.ObjectId(structureId),
      code,
      items: importItems,
      comment: session.comment?.trim() ?? '',
      createdBy: new Types.ObjectId(userId),
    });

    await this.sessionModel
      .deleteOne({
        _id: session._id,
        userId: new Types.ObjectId(userId),
      })
      .exec();

    return {
      id: created.id,
      code: created.code,
      itemCount: importItems.length,
      totalQuantity: importItems.reduce((sum, item) => sum + item.quantity, 0),
      locationId,
      createdAt: created.createdAt ?? now,
    };
  }
}

export { WAREHOUSE_IMPORT_PAGE_PATH } from '../users/constants/disabled-page-actions';
