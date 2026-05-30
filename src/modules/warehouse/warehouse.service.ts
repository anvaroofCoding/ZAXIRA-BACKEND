import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { UsersService } from '../users/users.service';
import { UserPermissionsMap } from '../users/types/page-permission.type';
import {
  hasPageAccess,
  hasPageAction,
  normalizePermissions,
} from '../users/utils/permissions.util';
import { Sequence, SequenceDocument } from '../purchase-requests/schemas/sequence.schema';
import { CreateWarehouseLocationDto } from './dto/create-warehouse-location.dto';
import { CreateWarehouseExpenseDto } from './dto/create-warehouse-expense.dto';
import { appendDateRangeClause } from '../../common/utils/date-range-filter.util';
import { QueryWarehouseExpensesDto } from './dto/query-warehouse-expenses.dto';
import { QueryWarehouseInventoryDto } from './dto/query-warehouse-inventory.dto';
import {
  isWarehouseExpenseReasonKey,
  WAREHOUSE_EXPENSE_REASONS,
} from './constants/warehouse-expense-reasons';
import { computeWarehouseBarcode } from './utils/warehouse-barcode.util';
import {
  WarehouseInventory,
  WarehouseInventoryDocument,
} from './schemas/warehouse-inventory.schema';
import {
  WarehouseLocation,
  WarehouseLocationDocument,
} from './schemas/warehouse-location.schema';
import {
  WarehouseExpense,
  WarehouseExpenseDocument,
} from './schemas/warehouse-expense.schema';
import { Structure, StructureDocument } from '../structures/schemas/structure.schema';

const EXPENSE_SEQUENCE_PREFIX = 'expense:';
const OTHER_WAREHOUSES_PATH = '/omborlar/boshqa-omborlar';
const WAREHOUSE_EXPENSE_PAGE_PATH = '/omborlar/chiqim-qilish';

@Injectable()
export class WarehouseService {
  constructor(
    @InjectModel(WarehouseLocation.name)
    private readonly locationModel: Model<WarehouseLocationDocument>,
    @InjectModel(WarehouseInventory.name)
    private readonly inventoryModel: Model<WarehouseInventoryDocument>,
    @InjectModel(WarehouseExpense.name)
    private readonly expenseModel: Model<WarehouseExpenseDocument>,
    @InjectModel(Sequence.name)
    private readonly sequenceModel: Model<SequenceDocument>,
    @InjectModel(Structure.name)
    private readonly structureModel: Model<StructureDocument>,
    private readonly usersService: UsersService,
  ) {}

  private async nextExpenseCode(structureId: string) {
    const key = `${EXPENSE_SEQUENCE_PREFIX}${structureId}`;
    const sequence = await this.sequenceModel
      .findOneAndUpdate(
        { key },
        { $inc: { value: 1 } },
        { upsert: true, new: true },
      )
      .exec();

    return `CH-${String(sequence.value).padStart(6, '0')}`;
  }

  private isPrivilegedRole(role?: UserRole) {
    return role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;
  }

  private async canBrowseExpensesAcrossStructures(userId: string, role?: UserRole) {
    if (this.isPrivilegedRole(role) || isSuperAdminRole(role)) {
      return true;
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      return false;
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );
    return hasPageAccess(
      permissions,
      OTHER_WAREHOUSES_PATH,
      isSuperAdminRole(role),
    );
  }

  private async resolveViewerStructureIdOrFail(userId: string, role?: UserRole) {
    const user = await this.usersService.findById(userId);
    const structureId = user?.structureId ? String(user.structureId) : null;

    if (!structureId) {
      throw new BadRequestException('Foydalanuvchiga tuzilma biriktirilmagan');
    }

    return structureId;
  }

  private async assertStructureAccess(structureId: string, userId: string, role?: UserRole) {
    if (!Types.ObjectId.isValid(structureId)) {
      throw new BadRequestException('Tuzilma identifikatori noto‘g‘ri');
    }

    if (await this.canBrowseExpensesAcrossStructures(userId, role)) {
      return;
    }

    const userStructureId = await this.resolveViewerStructureIdOrFail(userId, role);
    if (userStructureId !== structureId) {
      throw new ForbiddenException('Bu tuzilma uchun chiqim tarixini ko‘rishga ruxsat yo‘q');
    }
  }

  private async assertCanDeleteExpense(userId: string, role?: UserRole) {
    if (this.isPrivilegedRole(role) || isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new ForbiddenException('Chiqimni o‘chirishga ruxsat yo‘q');
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );

    if (
      !hasPageAction(permissions, WAREHOUSE_EXPENSE_PAGE_PATH, 'delete', false)
    ) {
      throw new ForbiddenException('Chiqimni o‘chirishga ruxsat yo‘q');
    }
  }

  private async resolveExpenseListScope(
    queryStructureId: string | undefined,
    userId: string,
    role?: UserRole,
  ): Promise<{ mode: 'all' } | { mode: 'single'; structureId: string }> {
    const requested = queryStructureId?.trim();

    if (requested) {
      if (!Types.ObjectId.isValid(requested)) {
        throw new BadRequestException('Tuzilma identifikatori noto‘g‘ri');
      }
      await this.assertStructureAccess(requested, userId, role);
      return { mode: 'single', structureId: requested };
    }

    if (await this.canBrowseExpensesAcrossStructures(userId, role)) {
      return { mode: 'all' };
    }

    const structureId = await this.resolveViewerStructureIdOrFail(userId, role);
    return { mode: 'single', structureId };
  }

  async listLocations(userId: string, role?: UserRole) {
    const user = await this.usersService.findById(userId);
    const structureId = user?.structureId ? String(user.structureId) : null;

    if (!structureId || !Types.ObjectId.isValid(structureId)) {
      return [];
    }

    const locations = await this.locationModel
      .find({ structureId: new Types.ObjectId(structureId), isActive: true })
      .sort({ name: 1 })
      .select('name isActive createdAt updatedAt')
      .exec();

    return locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      isActive: loc.isActive,
      createdAt: loc.createdAt,
      updatedAt: loc.updatedAt,
    }));
  }

  async createLocation(dto: CreateWarehouseLocationDto, userId: string, role?: UserRole) {
    const structureId = await this.resolveViewerStructureIdOrFail(userId, role);

    const name = dto.name.trim();

    const created = await this.locationModel.create({
      structureId: new Types.ObjectId(structureId),
      name,
      isActive: true,
    });

    return {
      id: created.id,
      name: created.name,
      isActive: created.isActive,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async listInventoryByLocation(
    locationId: string,
    query: QueryWarehouseInventoryDto,
    userId: string,
    role?: UserRole,
  ) {
    const structureId = await this.resolveViewerStructureIdOrFail(userId, role);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const search = query.search?.trim();
    const skip = (page - 1) * limit;

    const location = await this.locationModel
      .findOne({
        _id: new Types.ObjectId(locationId),
        structureId: new Types.ObjectId(structureId),
        isActive: true,
      })
      .select('_id name')
      .exec();

    if (!location) {
      throw new ForbiddenException('Joy topilmadi yoki sizga tegishli emas');
    }

    const filter: Record<string, unknown> = {
      structureId: new Types.ObjectId(structureId),
      locationId: new Types.ObjectId(locationId),
    };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { characteristics: { $regex: search, $options: 'i' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.inventoryModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('name characteristics barcode quantity lastReceiptAt createdAt updatedAt')
        .exec(),
      this.inventoryModel.countDocuments(filter).exec(),
    ]);

    const updates: Promise<unknown>[] = [];
    const mapped = items.map((item) => {
      const barcode =
        item.barcode?.trim() ||
        computeWarehouseBarcode(item.name, item.characteristics);

      if (!item.barcode?.trim()) {
        updates.push(
          this.inventoryModel
            .updateOne({ _id: item._id }, { $set: { barcode } })
            .exec(),
        );
      }

      return {
        id: item.id,
        name: item.name,
        characteristics: item.characteristics,
        barcode,
        quantity: item.quantity,
        lastReceiptAt: item.lastReceiptAt ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    if (updates.length) {
      await Promise.allSettled(updates);
    }

    return {
      location: { id: location.id, name: location.name },
      items: mapped,
      total,
      page,
      limit,
    };
  }

  async listAllWarehousesOverview() {
    const rows = await this.locationModel
      .aggregate<{
        _id: Types.ObjectId;
        name: string;
        structureId: Types.ObjectId;
        structureFullName?: string;
        structureShortName?: string;
        totalQuantity: number;
        itemTypesCount: number;
      }>([
        { $match: { isActive: true } },
        {
          $lookup: {
            from: 'warehouse_inventory',
            let: { locationId: '$_id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$locationId', '$$locationId'] } } },
              {
                $group: {
                  _id: null,
                  totalQuantity: { $sum: '$quantity' },
                  itemTypesCount: { $sum: 1 },
                },
              },
            ],
            as: 'inventoryStats',
          },
        },
        {
          $lookup: {
            from: 'structures',
            localField: 'structureId',
            foreignField: '_id',
            as: 'structure',
          },
        },
        { $unwind: { path: '$structure', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            name: 1,
            structureId: 1,
            structureFullName: '$structure.fullName',
            structureShortName: '$structure.shortName',
            totalQuantity: { $ifNull: [{ $arrayElemAt: ['$inventoryStats.totalQuantity', 0] }, 0] },
            itemTypesCount: { $ifNull: [{ $arrayElemAt: ['$inventoryStats.itemTypesCount', 0] }, 0] },
          },
        },
        { $sort: { totalQuantity: -1, name: 1 } },
      ])
      .exec();

    const grouped = new Map<
      string,
      {
        structure: { id: string; fullName: string; shortName: string };
        totalQuantity: number;
        itemTypesCount: number;
        locations: Array<{
          id: string;
          name: string;
          totalQuantity: number;
          itemTypesCount: number;
        }>;
      }
    >();

    for (const row of rows) {
      const structureId = String(row.structureId);
      const existing = grouped.get(structureId);
      const location = {
        id: String(row._id),
        name: row.name,
        totalQuantity: row.totalQuantity ?? 0,
        itemTypesCount: row.itemTypesCount ?? 0,
      };

      if (!existing) {
        grouped.set(structureId, {
          structure: {
            id: structureId,
            fullName: row.structureFullName || 'Noma’lum tuzilma',
            shortName: row.structureShortName || '—',
          },
          totalQuantity: location.totalQuantity,
          itemTypesCount: location.itemTypesCount,
          locations: [location],
        });
        continue;
      }

      existing.totalQuantity += location.totalQuantity;
      existing.itemTypesCount += location.itemTypesCount;
      existing.locations.push(location);
    }

    return Array.from(grouped.values()).sort((a, b) => b.totalQuantity - a.totalQuantity);
  }

  async listInventoryByAnyLocation(
    locationId: string,
    structureIdRaw: string | undefined,
    query: QueryWarehouseInventoryDto,
  ) {
    const structureId = structureIdRaw?.trim();
    if (!structureId || !Types.ObjectId.isValid(structureId)) {
      throw new BadRequestException('Tuzilma ID noto‘g‘ri');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const search = query.search?.trim();
    const skip = (page - 1) * limit;

    const location = await this.locationModel
      .findOne({
        _id: new Types.ObjectId(locationId),
        structureId: new Types.ObjectId(structureId),
        isActive: true,
      })
      .select('_id name')
      .exec();

    if (!location) {
      throw new NotFoundException('Ombor joyi topilmadi');
    }

    const filter: Record<string, unknown> = {
      structureId: new Types.ObjectId(structureId),
      locationId: new Types.ObjectId(locationId),
    };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { characteristics: { $regex: search, $options: 'i' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.inventoryModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('name characteristics barcode quantity lastReceiptAt createdAt updatedAt')
        .exec(),
      this.inventoryModel.countDocuments(filter).exec(),
    ]);

    return {
      location: { id: location.id, name: location.name },
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        characteristics: item.characteristics,
        barcode: item.barcode?.trim() || computeWarehouseBarcode(item.name, item.characteristics),
        quantity: item.quantity,
        lastReceiptAt: item.lastReceiptAt ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      total,
      page,
      limit,
    };
  }

  async findInventoryItemByBarcode(
    locationId: string,
    barcode: string | undefined,
    userId: string,
    role?: UserRole,
  ) {
    const structureId = await this.resolveViewerStructureIdOrFail(userId, role);
    const value = barcode?.trim();

    if (!value) {
      throw new BadRequestException('Barcode kiriting');
    }

    const location = await this.locationModel
      .findOne({
        _id: new Types.ObjectId(locationId),
        structureId: new Types.ObjectId(structureId),
        isActive: true,
      })
      .select('_id')
      .exec();

    if (!location) {
      throw new ForbiddenException('Joy topilmadi yoki sizga tegishli emas');
    }

    const found = await this.inventoryModel
      .findOne({
        structureId: new Types.ObjectId(structureId),
        locationId: new Types.ObjectId(locationId),
        barcode: value,
      })
      .select('name characteristics barcode quantity')
      .exec();

    if (found) {
      return {
        id: found.id,
        name: found.name,
        characteristics: found.characteristics,
        barcode: found.barcode,
        quantity: found.quantity,
      };
    }

    const candidates = await this.inventoryModel
      .find({
        structureId: new Types.ObjectId(structureId),
        locationId: new Types.ObjectId(locationId),
      })
      .select('name characteristics barcode quantity')
      .limit(2500)
      .exec();

    for (const item of candidates) {
      const computed =
        item.barcode?.trim() ||
        computeWarehouseBarcode(item.name, item.characteristics);

      if (!item.barcode?.trim()) {
        await this.inventoryModel
          .updateOne({ _id: item._id }, { $set: { barcode: computed } })
          .exec();
      }

      if (computed === value) {
        return {
          id: item.id,
          name: item.name,
          characteristics: item.characteristics,
          barcode: computed,
          quantity: item.quantity,
        };
      }
    }

    throw new NotFoundException('Tovar topilmadi');
  }

  async findInventoryItemByBarcodeGlobally(
    barcode: string | undefined,
    userId: string,
    role?: UserRole,
  ) {
    const structureId = await this.resolveViewerStructureIdOrFail(userId, role);
    const value = barcode?.trim();

    if (!value) {
      throw new BadRequestException('Barcode kiriting');
    }

    const found = await this.inventoryModel
      .findOne({
        structureId: new Types.ObjectId(structureId),
        barcode: value,
        quantity: { $gt: 0 },
      })
      .sort({ quantity: -1, updatedAt: -1 })
      .populate({
        path: 'locationId',
        select: 'name isActive',
      })
      .select('name characteristics barcode quantity locationId')
      .exec();

    if (!found) {
      throw new NotFoundException('Tovar topilmadi');
    }

    const locationRef = found.locationId as unknown as { _id?: Types.ObjectId; id?: string; name?: string } | null;

    return {
      id: found.id,
      locationId: locationRef?.id ?? (locationRef?._id ? String(locationRef._id) : null),
      locationName: locationRef?.name ?? 'Noma’lum joy',
      name: found.name,
      characteristics: found.characteristics,
      barcode: found.barcode,
      quantity: found.quantity,
    };
  }

  listExpenseReasons() {
    return WAREHOUSE_EXPENSE_REASONS;
  }

  async createExpense(dto: CreateWarehouseExpenseDto, userId: string, role?: UserRole) {
    const structureId = await this.resolveViewerStructureIdOrFail(userId, role);

    if (!isWarehouseExpenseReasonKey(dto.reasonKey)) {
      throw new BadRequestException('Chiqim sababi noto‘g‘ri');
    }

    const reason = WAREHOUSE_EXPENSE_REASONS.find((r) => r.key === dto.reasonKey)!;

    const locationIdFromHeader = dto.locationId?.trim();
    const itemsInput = (dto.items ?? [])
      .map((i) => ({
        locationId: (locationIdFromHeader || i.locationId || '').trim(),
        barcode: i.barcode?.trim(),
        quantity: Number(i.quantity),
      }))
      .filter((i) => i.barcode && i.quantity > 0);

    if (!itemsInput.length) {
      throw new BadRequestException('Chiqim uchun tovar tanlanmagan');
    }

    if (itemsInput.some((i) => !i.locationId || !Types.ObjectId.isValid(i.locationId))) {
      throw new BadRequestException('Har bir tovar uchun ombor joyi bo‘lishi shart');
    }

    const merged = new Map<string, { locationId: string; barcode: string; quantity: number }>();
    for (const item of itemsInput) {
      const key = `${item.locationId}|${item.barcode}`;
      const prev = merged.get(key);
      if (prev) {
        prev.quantity += item.quantity;
      } else {
        merged.set(key, {
          locationId: item.locationId,
          barcode: item.barcode!,
          quantity: item.quantity,
        });
      }
    }

    const requestItems = Array.from(merged.values());

    const inventories = await this.inventoryModel
      .find({
        structureId: new Types.ObjectId(structureId),
        $or: requestItems.map((row) => ({
          locationId: new Types.ObjectId(row.locationId),
          barcode: row.barcode,
        })),
      })
      .select('locationId itemKey name characteristics barcode quantity')
      .exec();

    if (inventories.length !== requestItems.length) {
      throw new BadRequestException('Ba’zi barcode bo‘yicha tovar topilmadi');
    }

    const byLocationAndBarcode = new Map(
      inventories.map((inv) => [`${String(inv.locationId)}|${inv.barcode}`, inv]),
    );

    for (const item of requestItems) {
      const inv = byLocationAndBarcode.get(`${item.locationId}|${item.barcode}`);
      if (!inv) {
        throw new BadRequestException('Tovar topilmadi');
      }
      if (inv.quantity < item.quantity) {
        throw new BadRequestException(
          `«${inv.name}» uchun omborda yetarli miqdor yo‘q (bor: ${inv.quantity})`,
        );
      }
    }

    const code = await this.nextExpenseCode(structureId);
    const now = new Date();

    const bulkOps = requestItems.map((row) => ({
      updateOne: {
        filter: {
          structureId: new Types.ObjectId(structureId),
          locationId: new Types.ObjectId(row.locationId),
          barcode: row.barcode,
          quantity: { $gte: row.quantity },
        },
        update: { $inc: { quantity: -row.quantity }, $set: { updatedAt: now } },
      },
    }));

    const bulkResult = await this.inventoryModel.collection.bulkWrite(bulkOps, {
      ordered: true,
    });
    const modified = bulkResult.modifiedCount ?? 0;

    if (modified !== requestItems.length) {
      throw new BadRequestException('Chiqimni bajarib bo‘lmadi (miqdor yetarli emas)');
    }

    const itemsByLocation = new Map<string, typeof requestItems>();
    for (const row of requestItems) {
      const current = itemsByLocation.get(row.locationId) ?? [];
      current.push(row);
      itemsByLocation.set(row.locationId, current);
    }

    let firstCreated: WarehouseExpenseDocument | null = null;
    for (const [locationId, rows] of itemsByLocation.entries()) {
      const created = await this.expenseModel.create({
        structureId: new Types.ObjectId(structureId),
        locationId: new Types.ObjectId(locationId),
        code,
        reasonKey: reason.key,
        reasonLabel: reason.label,
        comment: dto.comment?.trim() || '',
        items: rows.map((row) => {
          const inv = byLocationAndBarcode.get(`${row.locationId}|${row.barcode}`)!;
          return {
            itemKey: inv.itemKey,
            name: inv.name,
            characteristics: inv.characteristics,
            barcode: inv.barcode,
            quantity: row.quantity,
          };
        }),
        createdBy: new Types.ObjectId(userId),
      });
      if (!firstCreated) firstCreated = created;
    }

    return {
      id: firstCreated?.id,
      code,
      reasonKey: reason.key,
      reasonLabel: reason.label,
      createdAt: firstCreated?.createdAt ?? now,
    };
  }

  private expenseGroupToPublic(row: {
    code: string;
    structureId: Types.ObjectId;
    structureName?: string;
    reasonKey: string;
    reasonLabel: string;
    comment?: string;
    createdAt: Date;
    itemsCount: number;
    totalQuantity: number;
    createdByUser?: {
      userId: Types.ObjectId;
      displayName: string;
      login: string;
    } | null;
  }) {
    return {
      code: row.code,
      structureId: String(row.structureId),
      structureName: row.structureName?.trim() || '—',
      reasonKey: row.reasonKey,
      reasonLabel: row.reasonLabel,
      comment: row.comment?.trim() || '',
      createdAt: row.createdAt,
      itemsCount: row.itemsCount,
      totalQuantity: row.totalQuantity,
      createdBy: row.createdByUser
        ? {
            userId: String(row.createdByUser.userId),
            displayName: row.createdByUser.displayName,
            login: row.createdByUser.login,
          }
        : null,
    };
  }

  async listExpensesPaginated(
    query: QueryWarehouseExpensesDto,
    userId: string,
    role?: UserRole,
  ) {
    const scope = await this.resolveExpenseListScope(query.structureId, userId, role);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const matchClauses: Record<string, unknown>[] = [];
    if (scope.mode === 'single') {
      matchClauses.push({ structureId: new Types.ObjectId(scope.structureId) });
    }

    appendDateRangeClause(matchClauses, 'createdAt', query.dateFrom, query.dateTo);

    const term = query.search?.trim();
    if (term) {
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      matchClauses.push({
        $or: [
          { code: regex },
          { reasonLabel: regex },
          { comment: regex },
          { 'items.name': regex },
          { 'items.barcode': regex },
        ],
      });
    }

    if (query.reasonKey?.trim()) {
      matchClauses.push({ reasonKey: query.reasonKey.trim() });
    }

    const match =
      matchClauses.length === 0
        ? {}
        : matchClauses.length === 1
          ? matchClauses[0]
          : { $and: matchClauses };

    const [facetResult] = await this.expenseModel
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: { structureId: '$structureId', code: '$code' },
            structureId: { $first: '$structureId' },
            code: { $first: '$code' },
            reasonKey: { $first: '$reasonKey' },
            reasonLabel: { $first: '$reasonLabel' },
            comment: { $first: '$comment' },
            createdAt: { $max: '$createdAt' },
            createdBy: { $first: '$createdBy' },
            items: { $push: '$items' },
          },
        },
        {
          $lookup: {
            from: 'structures',
            localField: 'structureId',
            foreignField: '_id',
            as: 'structure',
          },
        },
        {
          $addFields: {
            structureName: {
              $ifNull: [
                { $arrayElemAt: ['$structure.shortName', 0] },
                { $arrayElemAt: ['$structure.fullName', 0] },
              ],
            },
          },
        },
        {
          $addFields: {
            items: {
              $reduce: {
                input: '$items',
                initialValue: [],
                in: { $concatArrays: ['$$value', '$$this'] },
              },
            },
          },
        },
        {
          $addFields: {
            itemsCount: { $size: '$items' },
            totalQuantity: { $sum: '$items.quantity' },
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: 'createdBy',
            foreignField: '_id',
            as: 'creator',
          },
        },
        {
          $addFields: {
            createdByUser: {
              $let: {
                vars: { creator: { $arrayElemAt: ['$creator', 0] } },
                in: {
                  userId: '$$creator._id',
                  displayName: {
                    $ifNull: ['$$creator.displayName', '$$creator.login'],
                  },
                  login: '$$creator.login',
                },
              },
            },
          },
        },
        { $project: { creator: 0, items: 0, structure: 0 } },
        { $sort: { createdAt: -1 } },
        {
          $facet: {
            items: [{ $skip: skip }, { $limit: limit }],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    const rows = (facetResult?.items ?? []) as Array<{
      code: string;
      structureId: Types.ObjectId;
      structureName?: string;
      reasonKey: string;
      reasonLabel: string;
      comment?: string;
      createdAt: Date;
      itemsCount: number;
      totalQuantity: number;
      createdByUser?: {
        userId: Types.ObjectId;
        displayName: string;
        login: string;
      } | null;
    }>;
    const total = facetResult?.total?.[0]?.count ?? 0;

    return {
      items: rows.map((row) => this.expenseGroupToPublic(row)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async findExpenseByCode(
    code: string,
    userId: string,
    role?: UserRole,
    queryStructureId?: string,
  ) {
    const normalizedCode = code?.trim();

    if (!normalizedCode) {
      throw new BadRequestException('Chiqim kodi noto‘g‘ri');
    }

    let structureId: string;
    const requestedStructureId = queryStructureId?.trim();

    if (requestedStructureId) {
      if (!Types.ObjectId.isValid(requestedStructureId)) {
        throw new BadRequestException('Tuzilma identifikatori noto‘g‘ri');
      }
      await this.assertStructureAccess(requestedStructureId, userId, role);
      structureId = requestedStructureId;
    } else {
      structureId = await this.resolveViewerStructureIdOrFail(userId, role);
    }

    const docs = await this.expenseModel
      .find({
        structureId: new Types.ObjectId(structureId),
        code: normalizedCode,
      })
      .sort({ locationId: 1, createdAt: 1 })
      .exec();

    if (!docs.length) {
      throw new NotFoundException('Chiqim topilmadi');
    }

    const locationIds = docs.map((doc) => doc.locationId);
    const locations = await this.locationModel
      .find({ _id: { $in: locationIds } })
      .select('name')
      .exec();
    const locationNameById = new Map(
      locations.map((loc) => [String(loc._id), loc.name]),
    );

    const creator = await this.usersService.findById(String(docs[0].createdBy));
    const structure = await this.structureModel
      .findById(docs[0].structureId)
      .select('fullName shortName')
      .exec();

    const items = docs.flatMap((doc) =>
      doc.items.map((item) => ({
        name: item.name,
        characteristics: item.characteristics,
        barcode: item.barcode,
        quantity: item.quantity,
        locationId: String(doc.locationId),
        locationName: locationNameById.get(String(doc.locationId)) ?? '—',
      })),
    );

    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const createdAt = docs.reduce<Date>(
      (latest, doc) =>
        doc.createdAt && doc.createdAt > latest ? doc.createdAt : latest,
      docs[0].createdAt ?? new Date(),
    );

    return {
      code: docs[0].code,
      structureId: String(docs[0].structureId),
      structureName:
        structure?.shortName?.trim() || structure?.fullName?.trim() || '—',
      reasonKey: docs[0].reasonKey,
      reasonLabel: docs[0].reasonLabel,
      comment: docs[0].comment?.trim() || '',
      createdAt,
      createdBy: creator
        ? {
            userId: String(creator.id),
            displayName: creator.displayName || creator.login,
            login: creator.login,
          }
        : null,
      itemsCount: items.length,
      totalQuantity,
      items,
    };
  }

  async deleteExpenseByCode(
    code: string,
    userId: string,
    role?: UserRole,
    queryStructureId?: string,
  ) {
    await this.assertCanDeleteExpense(userId, role);

    const normalizedCode = code?.trim();
    if (!normalizedCode) {
      throw new BadRequestException('Chiqim kodi noto‘g‘ri');
    }

    let structureId: string;
    const requestedStructureId = queryStructureId?.trim();

    if (requestedStructureId) {
      if (!Types.ObjectId.isValid(requestedStructureId)) {
        throw new BadRequestException('Tuzilma identifikatori noto‘g‘ri');
      }
      await this.assertStructureAccess(requestedStructureId, userId, role);
      structureId = requestedStructureId;
    } else {
      structureId = await this.resolveViewerStructureIdOrFail(userId, role);
    }

    const structureObjectId = new Types.ObjectId(structureId);
    const docs = await this.expenseModel
      .find({
        structureId: structureObjectId,
        code: normalizedCode,
      })
      .exec();

    if (!docs.length) {
      throw new NotFoundException('Chiqim topilmadi');
    }

    type RestoreRow = {
      locationId: Types.ObjectId;
      barcode: string;
      itemKey: string;
      name: string;
      characteristics: string;
      quantity: number;
    };

    const restoreByKey = new Map<string, RestoreRow>();

    for (const doc of docs) {
      const locationId = doc.locationId;
      for (const item of doc.items ?? []) {
        const barcode = item.barcode?.trim();
        if (!barcode || item.quantity < 1) {
          continue;
        }
        const key = `${String(locationId)}|${barcode}`;
        const prev = restoreByKey.get(key);
        if (prev) {
          prev.quantity += item.quantity;
          continue;
        }
        restoreByKey.set(key, {
          locationId,
          barcode,
          itemKey: item.itemKey,
          name: item.name,
          characteristics: item.characteristics,
          quantity: item.quantity,
        });
      }
    }

    const restoreItems = Array.from(restoreByKey.values());
    if (!restoreItems.length) {
      throw new BadRequestException('Chiqimda qaytariladigan tovar yo‘q');
    }

    const now = new Date();

    for (const row of restoreItems) {
      const restored = await this.inventoryModel
        .updateOne(
          {
            structureId: structureObjectId,
            locationId: row.locationId,
            barcode: row.barcode,
          },
          {
            $inc: { quantity: row.quantity },
            $set: { updatedAt: now },
          },
        )
        .exec();

      if (restored.matchedCount > 0) {
        continue;
      }

      await this.inventoryModel
        .updateOne(
          {
            structureId: structureObjectId,
            locationId: row.locationId,
            itemKey: row.itemKey,
          },
          {
            $inc: { quantity: row.quantity },
            $set: { updatedAt: now },
            $setOnInsert: {
              structureId: structureObjectId,
              locationId: row.locationId,
              itemKey: row.itemKey,
              name: row.name,
              characteristics: row.characteristics,
              barcode: row.barcode,
              unitPrice: 0,
            },
          },
          { upsert: true },
        )
        .exec();
    }

    const deleteResult = await this.expenseModel
      .deleteMany({
        structureId: structureObjectId,
        code: normalizedCode,
      })
      .exec();

    if (!deleteResult.deletedCount) {
      throw new NotFoundException('Chiqim topilmadi');
    }

    const restoredQuantity = restoreItems.reduce((sum, row) => sum + row.quantity, 0);

    return {
      code: normalizedCode,
      structureId,
      deletedDocuments: deleteResult.deletedCount,
      restoredLines: restoreItems.length,
      restoredQuantity,
    };
  }
}

