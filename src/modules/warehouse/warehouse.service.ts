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
import {
  ALL_WAREHOUSES_OVERVIEW_PAGE_PATHS,
  TRANSFER_RECEIPT_PAGE_PATH,
  WAREHOUSE_RECEIPT_PAGE_PATH,
} from '../users/constants/disabled-page-actions';
import { UserPermissionsMap } from '../users/types/page-permission.type';
import {
  hasAnyPageAccess,
  hasPageAccess,
  hasPageAction,
  normalizePermissions,
} from '../users/utils/permissions.util';
import {
  Sequence,
  SequenceDocument,
} from '../purchase-requests/schemas/sequence.schema';
import { CreateWarehouseLocationDto } from './dto/create-warehouse-location.dto';
import { UpdateWarehouseLocationDto } from './dto/update-warehouse-location.dto';
import { CreateWarehouseExpenseDto } from './dto/create-warehouse-expense.dto';
import { appendDateRangeClause } from '../../common/utils/date-range-filter.util';
import { QueryWarehouseExpensesDto } from './dto/query-warehouse-expenses.dto';
import { QueryWarehouseFixedAssetsDto } from './dto/query-warehouse-fixed-assets.dto';
import { QueryWarehouseInventoryDto } from './dto/query-warehouse-inventory.dto';
import {
  isFixedAssetReasonKey,
  isWarehouseExpenseReasonKey,
  WAREHOUSE_EXPENSE_REASONS,
} from './constants/warehouse-expense-reasons';
import {
  buildInventorySearchOr,
  mapNomenclatureCode,
  resolveInventoryBarcode,
} from './utils/inventory-item-public.util';
import {
  buildInventoryItemKey,
  inventoryNamesMatch,
  normalizeInventoryName,
  normalizeNomenclatureCode,
} from './utils/inventory-nomenclature.util';
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
import {
  WarehouseFixedAsset,
  WarehouseFixedAssetDocument,
} from './schemas/warehouse-fixed-asset.schema';
import {
  WarehouseImport,
  WarehouseImportDocument,
} from './schemas/warehouse-import.schema';
import {
  Structure,
  StructureDocument,
} from '../structures/schemas/structure.schema';
import { Stocktake, StocktakeDocument } from '../stocktakes/schemas/stocktake.schema';
import { StocktakeMode } from '../stocktakes/enums/stocktake-mode.enum';
import { StocktakeStatus } from '../stocktakes/enums/stocktake-status.enum';
import { WarehousePricingService } from './warehouse-pricing.service';
import {
  WarehouseDispatch,
  WarehouseDispatchDocument,
} from '../warehouse-dispatches/schemas/warehouse-dispatch.schema';
import { WarehouseDispatchStatus } from '../warehouse-dispatches/enums/warehouse-dispatch-status.enum';
import {
  resolveInventoryItemKey,
  resolveReceivedNomenclatureByItemKeys,
  resolveReceivedNomenclatureByProductNames,
} from './utils/nomenclature-lookup.util';
import { buildWarehouseItemKey } from './utils/item-key.util';
import { DispatchItemEmbeddable } from '../warehouse-dispatches/schemas/dispatch-item.schema';

const EXPENSE_SEQUENCE_PREFIX = 'expense:';
const MY_WAREHOUSE_PAGE_PATH = '/omborlar/mening-omborim';
const WAREHOUSE_EXPENSE_PAGE_PATH = '/omborlar/chiqim-qilish';
type WarehouseActionKey = 'create' | 'update' | 'delete';

@Injectable()
export class WarehouseService {
  private async assertPageActionPermission(
    userId: string,
    role: UserRole | undefined,
    path: string,
    action: WarehouseActionKey,
    message: string,
  ) {
    if (isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      throw new ForbiddenException(message);
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );
    if (!hasPageAction(permissions, path, action, false)) {
      throw new ForbiddenException(message);
    }
  }

  constructor(
    @InjectModel(WarehouseLocation.name)
    private readonly locationModel: Model<WarehouseLocationDocument>,
    @InjectModel(WarehouseInventory.name)
    private readonly inventoryModel: Model<WarehouseInventoryDocument>,
    @InjectModel(WarehouseExpense.name)
    private readonly expenseModel: Model<WarehouseExpenseDocument>,
    @InjectModel(WarehouseFixedAsset.name)
    private readonly fixedAssetModel: Model<WarehouseFixedAssetDocument>,
    @InjectModel(WarehouseImport.name)
    private readonly importModel: Model<WarehouseImportDocument>,
    @InjectModel(Sequence.name)
    private readonly sequenceModel: Model<SequenceDocument>,
    @InjectModel(Structure.name)
    private readonly structureModel: Model<StructureDocument>,
    @InjectModel(WarehouseDispatch.name)
    private readonly dispatchModel: Model<WarehouseDispatchDocument>,
    @InjectModel(Stocktake.name)
    private readonly stocktakeModel: Model<StocktakeDocument>,
    private readonly usersService: UsersService,
    private readonly warehousePricingService: WarehousePricingService,
  ) {}

  private isMissingInventoryNomenclature(item: {
    receiptNomenclatureCode?: string | null;
  }) {
    return !item.receiptNomenclatureCode?.trim();
  }

  private async enrichInventoryNomenclature(
    structureId: string,
    items: WarehouseInventoryDocument[],
  ) {
    const missing = items.filter((item) =>
      this.isMissingInventoryNomenclature(item),
    );
    if (!missing.length) {
      return;
    }

    const [nomenclatureMap, nomenclatureByNameMap] = await Promise.all([
      resolveReceivedNomenclatureByItemKeys(
        this.dispatchModel,
        structureId,
        missing.map((item) => ({
          itemKey: item.itemKey,
          name: item.name,
          characteristics: item.characteristics,
          barcode: item.barcode,
        })),
      ),
      resolveReceivedNomenclatureByProductNames(
        this.dispatchModel,
        structureId,
        missing.map((item) => item.name),
      ),
    ]);

    if (!nomenclatureMap.size && !nomenclatureByNameMap.size) {
      return;
    }

    const backfillOps: Promise<unknown>[] = [];

    for (const item of missing) {
      const itemKey = resolveInventoryItemKey({
        itemKey: item.itemKey,
        name: item.name,
        characteristics: item.characteristics,
      });
      const code =
        nomenclatureMap.get(itemKey) ??
        nomenclatureByNameMap.get(normalizeInventoryName(item.name));

      if (!code) {
        continue;
      }

      item.receiptNomenclatureCode = code;
      item.itemKey = buildInventoryItemKey(
        item.name,
        item.characteristics,
        code,
      );
      const backfillSet: Record<string, string> = {
        receiptNomenclatureCode: code,
        itemKey: item.itemKey,
      };
      const resolvedBarcode = resolveInventoryBarcode(
        item.name,
        item.characteristics,
        item.barcode,
        code,
      );
      if (item.barcode?.trim() !== resolvedBarcode) {
        item.barcode = resolvedBarcode;
        backfillSet.barcode = resolvedBarcode;
      }
      backfillOps.push(
        this.inventoryModel
          .updateOne(
            { _id: item._id },
            {
              $set: backfillSet,
            },
          )
          .exec(),
      );
    }

    if (backfillOps.length) {
      await Promise.allSettled(backfillOps);
    }
  }

  private async syncLocationInventoryNomenclature(
    structureId: string,
    locationId: string,
  ) {
    const missingItems = await this.inventoryModel
      .find({
        structureId: new Types.ObjectId(structureId),
        locationId: new Types.ObjectId(locationId),
        $or: [
          { receiptNomenclatureCode: { $exists: false } },
          { receiptNomenclatureCode: null },
          { receiptNomenclatureCode: '' },
        ],
      })
      .select(
        'name characteristics barcode receiptNomenclatureCode quantity itemKey',
      )
      .exec();

    if (!missingItems.length) {
      return;
    }

    await this.enrichInventoryNomenclature(structureId, missingItems);
  }

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

  private async assertCanViewExpenseHistory(userId: string, role?: UserRole) {
    if (this.isPrivilegedRole(role) || isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      throw new ForbiddenException('Chiqim tarixini ko‘rishga ruxsat yo‘q');
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );

    if (!hasPageAccess(permissions, WAREHOUSE_EXPENSE_PAGE_PATH, false)) {
      throw new ForbiddenException('Chiqim tarixini ko‘rishga ruxsat yo‘q');
    }
  }

  private async assertExpenseHistoryStructureReadable(structureId: string) {
    if (!Types.ObjectId.isValid(structureId)) {
      throw new BadRequestException('Tuzilma identifikatori noto‘g‘ri');
    }

    const structure = await this.structureModel
      .findOne({ _id: new Types.ObjectId(structureId), isActive: true })
      .select('_id hasWarehouse')
      .exec();

    if (!structure) {
      throw new NotFoundException('Tuzilma topilmadi');
    }

    if (!structure.hasWarehouse) {
      throw new BadRequestException('Ushbu tuzilmaning ombori mavjud emas');
    }
  }

  private async resolveViewerStructureIdOrFail(
    userId: string,
    role?: UserRole,
  ) {
    const user = await this.usersService.findById(userId);
    const structureId = user?.structureId ? String(user.structureId) : null;

    if (!structureId) {
      throw new BadRequestException('Foydalanuvchiga tuzilma biriktirilmagan');
    }

    return structureId;
  }

  private async assertStructureHasWarehouse(structureId: string) {
    const structure = await this.structureModel.findById(structureId).exec();

    if (!structure) {
      throw new NotFoundException('Tuzilma topilmadi');
    }

    if (!structure.hasWarehouse) {
      throw new BadRequestException('Ushbu tuzilmaning ombori mavjud emas');
    }
  }

  private async resolveViewerStructureWithWarehouseOrFail(
    userId: string,
    role?: UserRole,
  ) {
    const structureId = await this.resolveViewerStructureIdOrFail(userId, role);
    await this.assertStructureAccessibleForWarehouseViewer(
      structureId,
      userId,
      role,
    );
    return structureId;
  }

  private async assertStructureAccessibleForWarehouseViewer(
    structureId: string,
    userId: string,
    role?: UserRole,
  ) {
    if (isSuperAdminRole(role)) {
      return;
    }

    const structure = await this.structureModel.findById(structureId).exec();

    if (!structure) {
      throw new NotFoundException('Tuzilma topilmadi');
    }

    if (structure.hasWarehouse) {
      return;
    }

    const user = await this.usersService.findById(userId);
    const permissions = normalizePermissions(
      user?.permissions as UserPermissionsMap | undefined,
    );
    const canReceive =
      hasPageAccess(permissions, WAREHOUSE_RECEIPT_PAGE_PATH, false) ||
      hasPageAccess(permissions, TRANSFER_RECEIPT_PAGE_PATH, false);

    if (!canReceive) {
      throw new BadRequestException('Ushbu tuzilmaning ombori mavjud emas');
    }

    const hasActiveLocations = await this.locationModel
      .countDocuments({
        structureId: new Types.ObjectId(structureId),
        isActive: true,
      })
      .exec();

    if (!hasActiveLocations) {
      throw new BadRequestException('Ushbu tuzilmaning ombori mavjud emas');
    }
  }

  private async assertCanDeleteExpense(userId: string, role?: UserRole) {
    if (isSuperAdminRole(role)) {
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
    await this.assertCanViewExpenseHistory(userId, role);

    const requested = queryStructureId?.trim();

    if (requested) {
      await this.assertExpenseHistoryStructureReadable(requested);
      return { mode: 'single', structureId: requested };
    }

    return { mode: 'all' };
  }

  async listLocations(userId: string, role?: UserRole) {
    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(
      userId,
      role,
    );

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

  async createLocation(
    dto: CreateWarehouseLocationDto,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertPageActionPermission(
      userId,
      role,
      MY_WAREHOUSE_PAGE_PATH,
      'create',
      'Ombor joyi qo‘shishga ruxsat yo‘q',
    );

    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(userId, role);

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

  async updateLocation(
    locationId: string,
    dto: UpdateWarehouseLocationDto,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertPageActionPermission(
      userId,
      role,
      MY_WAREHOUSE_PAGE_PATH,
      'update',
      'Ombor joyi nomini tahrirlashga ruxsat yo‘q',
    );

    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(userId, role);
    const name = dto.name.trim();

    const location = await this.locationModel
      .findOne({
        _id: new Types.ObjectId(locationId),
        structureId: new Types.ObjectId(structureId),
        isActive: true,
      })
      .exec();

    if (!location) {
      throw new NotFoundException('Ombor joyi topilmadi');
    }

    if (location.name === name) {
      return {
        id: location.id,
        name: location.name,
        isActive: location.isActive,
        createdAt: location.createdAt,
        updatedAt: location.updatedAt,
      };
    }

    try {
      location.name = name;
      await location.save();
    } catch (error: unknown) {
      const code = (error as { code?: number })?.code;
      if (code === 11000) {
        throw new BadRequestException('Bu nomdagi joy allaqachon mavjud');
      }
      throw error;
    }

    return {
      id: location.id,
      name: location.name,
      isActive: location.isActive,
      createdAt: location.createdAt,
      updatedAt: location.updatedAt,
    };
  }

  async deleteLocation(locationId: string, userId: string, role?: UserRole) {
    await this.assertPageActionPermission(
      userId,
      role,
      MY_WAREHOUSE_PAGE_PATH,
      'delete',
      'Ombor joyini o‘chirishga ruxsat yo‘q',
    );

    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(userId, role);

    const location = await this.locationModel
      .findOne({
        _id: new Types.ObjectId(locationId),
        structureId: new Types.ObjectId(structureId),
        isActive: true,
      })
      .exec();

    if (!location) {
      throw new NotFoundException('Ombor joyi topilmadi');
    }

    const stockedItems = await this.inventoryModel.countDocuments({
      locationId: location._id,
      quantity: { $gt: 0 },
    });

    if (stockedItems > 0) {
      throw new BadRequestException(
        'Joyda tovarlar qolgan. Avval tovarlarni boshqa joyga ko‘chiring yoki chiqim qiling.',
      );
    }

    location.isActive = false;
    await location.save();

    return { success: true };
  }

  async listInventoryByLocation(
    locationId: string,
    query: QueryWarehouseInventoryDto,
    userId: string,
    role?: UserRole,
  ) {
    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(userId, role);
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

    await this.syncLocationInventoryNomenclature(structureId, locationId);

    const filter: Record<string, unknown> = {
      structureId: new Types.ObjectId(structureId),
      locationId: new Types.ObjectId(locationId),
    };

    if (search) {
      filter.$or = buildInventorySearchOr(search);
    }

    if (query.minQuantity != null) {
      filter.quantity = { $gte: query.minQuantity };
    }

    const [items, total, priceMap] = await Promise.all([
      this.inventoryModel
        .find(filter)
        .sort({ quantity: -1, name: 1 })
        .skip(skip)
        .limit(limit)
        .select(
          'name characteristics barcode receiptNomenclatureCode quantity unitPrice itemKey structureId locationId lastReceiptAt createdAt updatedAt',
        )
        .exec(),
      this.inventoryModel.countDocuments(filter).exec(),
      this.warehousePricingService.getUnitPriceMapForStructure(structureId),
    ]);

    await this.enrichInventoryNomenclature(structureId, items);

    const updates: Promise<unknown>[] = [];
    const mapped = items.map((item) => {
      const barcode = resolveInventoryBarcode(
        item.name,
        item.characteristics,
        item.barcode,
        item.receiptNomenclatureCode,
      );

      const storedBarcode = item.barcode?.trim() || '';
      const nomenclature = item.receiptNomenclatureCode?.trim() || '';
      const needsBarcodePersist =
        !storedBarcode || (nomenclature && storedBarcode === nomenclature);

      if (needsBarcodePersist) {
        updates.push(
          this.inventoryModel
            .updateOne({ _id: item._id }, { $set: { barcode } })
            .exec(),
        );
      }

      const unitPrice = this.warehousePricingService.resolveUnitPriceFromMap(
        priceMap,
        item.itemKey,
        item.unitPrice,
        item.name,
        item.characteristics,
      );
      const quantity = item.quantity ?? 0;

      return {
        id: item.id,
        name: item.name,
        characteristics: item.characteristics,
        barcode,
        nomenclatureCode: mapNomenclatureCode(item.receiptNomenclatureCode),
        quantity,
        unitPrice,
        lineTotal: unitPrice * quantity,
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

  async updateInventoryNomenclature(
    locationId: string,
    inventoryId: string,
    nomenclatureCodeRaw: string,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertPageActionPermission(
      userId,
      role,
      MY_WAREHOUSE_PAGE_PATH,
      'update',
      'Nomeklatura yozishga ruxsat yo‘q',
    );

    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(
      userId,
      role,
    );
    const nomenclatureCode = normalizeNomenclatureCode(nomenclatureCodeRaw);

    if (!nomenclatureCode) {
      throw new BadRequestException('Nomeklatura raqamini kiriting');
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
      throw new NotFoundException('Ombor joyi topilmadi');
    }

    const inventory = await this.inventoryModel
      .findOne({
        _id: new Types.ObjectId(inventoryId),
        structureId: new Types.ObjectId(structureId),
        locationId: new Types.ObjectId(locationId),
      })
      .exec();

    if (!inventory) {
      throw new NotFoundException('Tovar topilmadi');
    }

    if (inventory.receiptNomenclatureCode?.trim()) {
      throw new BadRequestException('Bu tovarda nomeklatura allaqachon mavjud');
    }

    const existing = await this.inventoryModel
      .findOne({
        structureId: new Types.ObjectId(structureId),
        locationId: new Types.ObjectId(locationId),
        receiptNomenclatureCode: nomenclatureCode,
        _id: { $ne: inventory._id },
      })
      .select('name')
      .lean()
      .exec();

    if (existing && !inventoryNamesMatch(existing.name, inventory.name)) {
      throw new BadRequestException(
        `«${nomenclatureCode}» nomeklatura raqami allaqachon «${existing.name}» tovariga biriktirilgan. Boshqa nom bilan ishlatib bo‘lmaydi.`,
      );
    }

    const itemKey = buildInventoryItemKey(
      inventory.name,
      inventory.characteristics,
      nomenclatureCode,
    );
    const barcode = resolveInventoryBarcode(
      inventory.name,
      inventory.characteristics,
      inventory.barcode,
      nomenclatureCode,
    );

    inventory.receiptNomenclatureCode = nomenclatureCode;
    inventory.itemKey = itemKey;
    inventory.barcode = barcode;
    await inventory.save();

    return {
      id: inventory.id,
      name: inventory.name,
      characteristics: inventory.characteristics,
      barcode,
      nomenclatureCode: mapNomenclatureCode(inventory.receiptNomenclatureCode),
      quantity: inventory.quantity ?? 0,
    };
  }

  private async assertCanViewAllWarehousesOverview(
    userId: string,
    role?: UserRole,
  ) {
    if (this.isPrivilegedRole(role) || isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      throw new ForbiddenException('Boshqa omborlarni ko‘rishga ruxsat yo‘q');
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );

    if (
      !hasAnyPageAccess(
        permissions,
        ALL_WAREHOUSES_OVERVIEW_PAGE_PATHS,
        false,
      )
    ) {
      throw new ForbiddenException('Boshqa omborlarni ko‘rishga ruxsat yo‘q');
    }
  }

  private async getStructureInventoryTotalSum(structureId: string) {
    await this.warehousePricingService.syncInventoryUnitPrices(structureId);
    const prices =
      await this.warehousePricingService.getUnitPriceMapForStructure(
        structureId,
      );
    const inventoryItems = await this.inventoryModel
      .find({ structureId: new Types.ObjectId(structureId) })
      .select('itemKey quantity unitPrice')
      .exec();

    return inventoryItems.reduce((sum, item) => {
      const price =
        Number(item.unitPrice) > 0
          ? Math.round(Number(item.unitPrice))
          : (prices.get(item.itemKey) ?? 0);
      const qty = Number(item.quantity) || 0;
      return sum + price * qty;
    }, 0);
  }

  async listAllWarehousesOverview(userId: string, role?: UserRole) {
    await this.assertCanViewAllWarehousesOverview(userId, role);

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
        { $match: { 'structure.hasWarehouse': true } },
        {
          $project: {
            name: 1,
            structureId: 1,
            structureFullName: '$structure.fullName',
            structureShortName: '$structure.shortName',
            totalQuantity: {
              $ifNull: [
                { $arrayElemAt: ['$inventoryStats.totalQuantity', 0] },
                0,
              ],
            },
            itemTypesCount: {
              $ifNull: [
                { $arrayElemAt: ['$inventoryStats.itemTypesCount', 0] },
                0,
              ],
            },
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
        totalSum: number;
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
          totalSum: 0,
          itemTypesCount: location.itemTypesCount,
          locations: [location],
        });
        continue;
      }

      existing.totalQuantity += location.totalQuantity;
      existing.itemTypesCount += location.itemTypesCount;
      existing.locations.push(location);
    }

    const results = Array.from(grouped.values()).sort(
      (a, b) => b.totalQuantity - a.totalQuantity,
    );

    await Promise.all(
      results.map(async (entry) => {
        entry.totalSum = await this.getStructureInventoryTotalSum(
          entry.structure.id,
        );
      }),
    );

    return results;
  }

  private startOfUtcDay(date: Date) {
    const normalized = new Date(date);
    normalized.setUTCHours(0, 0, 0, 0);
    return normalized;
  }

  private addUtcDays(date: Date, days: number) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  private subtractUtcMonths(from: Date, months: number) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    d.setUTCMonth(d.getUTCMonth() - months);
    return d;
  }

  private utcDayKey(date: Date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private utcMonthKey(date: Date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  private startOfUtcWeek(date: Date) {
    const d = this.startOfUtcDay(date);
    const weekday = d.getUTCDay();
    const diff = weekday === 0 ? -6 : 1 - weekday;
    return this.addUtcDays(d, diff);
  }

  private async aggregateWarehouseMovementsByDay(
    structureObjectId: Types.ObjectId,
    from: Date,
    toExclusive: Date,
  ) {
    const receivedRows = (await this.dispatchModel
      .aggregate([
        {
          $match: {
            status: {
              $in: [
                WarehouseDispatchStatus.PARTIALLY_RECEIVED,
                WarehouseDispatchStatus.COMPLETED,
              ],
            },
            'targetStructure.structureId': structureObjectId,
            dispatchedAt: { $gte: from, $lt: toExclusive },
          },
        },
        { $unwind: '$items' },
        { $match: { 'items.quantityReceived': { $gt: 0 } } },
        {
          $project: {
            day: {
              $dateToString: { format: '%Y-%m-%d', date: '$dispatchedAt' },
            },
            qty: '$items.quantityReceived',
          },
        },
        { $group: { _id: '$day', total: { $sum: '$qty' } } },
      ])
      .exec()) as Array<{ _id: string; total: number }>;

    const dispatchedOutRows = (await this.dispatchModel
      .aggregate([
        {
          $match: {
            $or: [
              { sourceStructureId: structureObjectId },
              { 'sourceStructure.structureId': structureObjectId },
            ],
            dispatchedAt: { $gte: from, $lt: toExclusive },
          },
        },
        { $unwind: '$items' },
        { $match: { 'items.quantityDispatched': { $gt: 0 } } },
        {
          $project: {
            day: {
              $dateToString: { format: '%Y-%m-%d', date: '$dispatchedAt' },
            },
            qty: '$items.quantityDispatched',
          },
        },
        { $group: { _id: '$day', total: { $sum: '$qty' } } },
      ])
      .exec()) as Array<{ _id: string; total: number }>;

    const expenseRows = (await this.expenseModel
      .aggregate([
        {
          $match: {
            structureId: structureObjectId,
            createdAt: { $gte: from, $lt: toExclusive },
          },
        },
        { $unwind: '$items' },
        {
          $project: {
            day: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            qty: '$items.quantity',
          },
        },
        { $group: { _id: '$day', total: { $sum: '$qty' } } },
      ])
      .exec()) as Array<{ _id: string; total: number }>;

    const receivedByDay = new Map(
      receivedRows.map((row) => [row._id, row.total ?? 0]),
    );
    const dispatchedOutByDay = new Map(
      dispatchedOutRows.map((row) => [row._id, row.total ?? 0]),
    );
    const expenseByDay = new Map(
      expenseRows.map((row) => [row._id, row.total ?? 0]),
    );

    return { receivedByDay, dispatchedOutByDay, expenseByDay };
  }

  private async getNetBalanceBefore(
    structureObjectId: Types.ObjectId,
    before: Date,
  ) {
    const [receivedBeforeAgg] = (await this.dispatchModel
      .aggregate([
        {
          $match: {
            status: {
              $in: [
                WarehouseDispatchStatus.PARTIALLY_RECEIVED,
                WarehouseDispatchStatus.COMPLETED,
              ],
            },
            'targetStructure.structureId': structureObjectId,
            dispatchedAt: { $lt: before },
          },
        },
        { $unwind: '$items' },
        { $match: { 'items.quantityReceived': { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$items.quantityReceived' } } },
      ])
      .exec()) as Array<{ total: number }>;

    const [dispatchedOutBeforeAgg] = (await this.dispatchModel
      .aggregate([
        {
          $match: {
            $or: [
              { sourceStructureId: structureObjectId },
              { 'sourceStructure.structureId': structureObjectId },
            ],
            dispatchedAt: { $lt: before },
          },
        },
        { $unwind: '$items' },
        { $match: { 'items.quantityDispatched': { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$items.quantityDispatched' } } },
      ])
      .exec()) as Array<{ total: number }>;

    const [expenseBeforeAgg] = (await this.expenseModel
      .aggregate([
        {
          $match: {
            structureId: structureObjectId,
            createdAt: { $lt: before },
          },
        },
        { $unwind: '$items' },
        { $group: { _id: null, total: { $sum: '$items.quantity' } } },
      ])
      .exec()) as Array<{ total: number }>;

    return (
      (receivedBeforeAgg?.total ?? 0) -
      (dispatchedOutBeforeAgg?.total ?? 0) -
      (expenseBeforeAgg?.total ?? 0)
    );
  }

  private buildWarehouseAnalyticsPoints(input: {
    from: Date;
    dayCount: number;
    balanceBefore: number;
    receivedByDay: Map<string, number>;
    dispatchedOutByDay: Map<string, number>;
    expenseByDay: Map<string, number>;
  }) {
    const points: Array<{
      label: string;
      received: number;
      expensed: number;
      transferred: number;
      balance: number;
    }> = [];
    let running = input.balanceBefore;

    for (let i = 0; i < input.dayCount; i++) {
      const dayDate = this.addUtcDays(input.from, i);
      const key = this.utcDayKey(dayDate);
      const received = input.receivedByDay.get(key) ?? 0;
      const transferred = input.dispatchedOutByDay.get(key) ?? 0;
      const expensed = input.expenseByDay.get(key) ?? 0;
      const outgoing = transferred + expensed;
      running += received - outgoing;

      points.push({
        label: key,
        received,
        expensed,
        transferred,
        balance: running,
      });
    }

    return points;
  }

  async getStructureWarehouseAnalytics(
    structureId: string,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertCanViewAllWarehousesOverview(userId, role);

    if (!Types.ObjectId.isValid(structureId)) {
      throw new BadRequestException('Tuzilma ID noto‘g‘ri');
    }

    const structureObjectId = new Types.ObjectId(structureId);
    const structure = await this.structureModel
      .findById(structureObjectId)
      .select('_id hasWarehouse shortName')
      .exec();

    if (!structure?.hasWarehouse) {
      throw new NotFoundException('Ombor topilmadi');
    }

    const [inventoryAgg] = (await this.inventoryModel
      .aggregate([
        { $match: { structureId: structureObjectId } },
        { $group: { _id: null, totalQuantity: { $sum: '$quantity' } } },
      ])
      .exec()) as Array<{ totalQuantity: number }>;

    const currentQuantity = inventoryAgg?.totalQuantity ?? 0;
    const today = this.startOfUtcDay(new Date());
    const dailyDays = 7;
    const weeklyWeeks = 8;
    const monthlyMonths = 6;

    const dailyFrom = this.addUtcDays(today, -(dailyDays - 1));
    const weekStart = this.startOfUtcWeek(today);
    const weeklyFrom = this.addUtcDays(weekStart, -(weeklyWeeks - 1) * 7);
    const monthlyFrom = this.subtractUtcMonths(today, monthlyMonths - 1);
    const toExclusive = this.addUtcDays(today, 1);

    const earliestFrom = [dailyFrom, weeklyFrom, monthlyFrom].reduce((min, d) =>
      d.getTime() < min.getTime() ? d : min,
    );

    const balanceBefore = await this.getNetBalanceBefore(
      structureObjectId,
      earliestFrom,
    );
    const { receivedByDay, dispatchedOutByDay, expenseByDay } =
      await this.aggregateWarehouseMovementsByDay(
        structureObjectId,
        earliestFrom,
        toExclusive,
      );

    const allDailyPoints = this.buildWarehouseAnalyticsPoints({
      from: earliestFrom,
      dayCount: Math.round(
        (toExclusive.getTime() - earliestFrom.getTime()) / (24 * 60 * 60 * 1000),
      ),
      balanceBefore,
      receivedByDay,
      dispatchedOutByDay,
      expenseByDay,
    });

    const dailyPoints = allDailyPoints.slice(-dailyDays);

    const weeklyBuckets = new Map<
      string,
      { received: number; expensed: number; transferred: number }
    >();
    allDailyPoints.forEach((point) => {
      const weekKey = this.utcDayKey(
        this.startOfUtcWeek(new Date(`${point.label}T00:00:00.000Z`)),
      );
      const bucket = weeklyBuckets.get(weekKey) ?? {
        received: 0,
        expensed: 0,
        transferred: 0,
      };
      bucket.received += point.received;
      bucket.expensed += point.expensed;
      bucket.transferred += point.transferred;
      weeklyBuckets.set(weekKey, bucket);
    });

    const weeklyPoints = Array.from({ length: weeklyWeeks }).map((_, index) => {
      const weekDate = this.addUtcDays(weeklyFrom, index * 7);
      const label = this.utcDayKey(weekDate);
      const bucket = weeklyBuckets.get(label) ?? {
        received: 0,
        expensed: 0,
        transferred: 0,
      };
      const outgoing = bucket.expensed + bucket.transferred;
      const lastDayOfWeek = this.addUtcDays(weekDate, 6);
      const lastDayKey = this.utcDayKey(
        lastDayOfWeek.getTime() > today.getTime() ? today : lastDayOfWeek,
      );
      const balance =
        allDailyPoints.find((p) => p.label === lastDayKey)?.balance ??
        currentQuantity;

      return {
        label,
        received: bucket.received,
        expensed: bucket.expensed,
        transferred: bucket.transferred,
        balance,
        outgoing,
      };
    });

    const monthlyBuckets = new Map<
      string,
      { received: number; expensed: number; transferred: number }
    >();
    allDailyPoints.forEach((point) => {
      const monthKey = point.label.slice(0, 7);
      const bucket = monthlyBuckets.get(monthKey) ?? {
        received: 0,
        expensed: 0,
        transferred: 0,
      };
      bucket.received += point.received;
      bucket.expensed += point.expensed;
      bucket.transferred += point.transferred;
      monthlyBuckets.set(monthKey, bucket);
    });

    const monthlyPoints = Array.from({ length: monthlyMonths }).map((_, index) => {
      const monthDate = this.subtractUtcMonths(today, monthlyMonths - 1 - index);
      const label = this.utcMonthKey(monthDate);
      const bucket = monthlyBuckets.get(label) ?? {
        received: 0,
        expensed: 0,
        transferred: 0,
      };
      const outgoing = bucket.expensed + bucket.transferred;
      const balance =
        [...allDailyPoints].reverse().find((p) => p.label.startsWith(label))?.balance ??
        currentQuantity;

      return {
        label,
        received: bucket.received,
        expensed: bucket.expensed,
        transferred: bucket.transferred,
        balance,
        outgoing,
      };
    });

    return {
      structureId,
      currentQuantity,
      daily: { points: dailyPoints },
      weekly: { points: weeklyPoints },
      monthly: { points: monthlyPoints },
    };
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

    await this.syncLocationInventoryNomenclature(structureId, locationId);

    const filter: Record<string, unknown> = {
      structureId: new Types.ObjectId(structureId),
      locationId: new Types.ObjectId(locationId),
    };

    if (search) {
      filter.$or = buildInventorySearchOr(search);
    }

    const [items, total] = await Promise.all([
      this.inventoryModel
        .find(filter)
        .sort({ quantity: -1, name: 1 })
        .skip(skip)
        .limit(limit)
        .select(
          'name characteristics barcode receiptNomenclatureCode quantity lastReceiptAt createdAt updatedAt',
        )
        .exec(),
      this.inventoryModel.countDocuments(filter).exec(),
    ]);

    await this.enrichInventoryNomenclature(structureId, items);

    const barcodeUpdates: Promise<unknown>[] = [];
    const mappedItems = items.map((item) => {
      const barcode = resolveInventoryBarcode(
        item.name,
        item.characteristics,
        item.barcode,
        item.receiptNomenclatureCode,
      );

      const storedBarcode = item.barcode?.trim() || '';
      const nomenclature = item.receiptNomenclatureCode?.trim() || '';
      const needsBarcodePersist =
        !storedBarcode || (nomenclature && storedBarcode === nomenclature);

      if (needsBarcodePersist) {
        barcodeUpdates.push(
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
        nomenclatureCode: mapNomenclatureCode(item.receiptNomenclatureCode),
        quantity: item.quantity,
        lastReceiptAt: item.lastReceiptAt ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    if (barcodeUpdates.length) {
      await Promise.allSettled(barcodeUpdates);
    }

    return {
      location: { id: location.id, name: location.name },
      items: mappedItems,
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
    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(userId, role);
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
      .select(
        'name characteristics barcode receiptNomenclatureCode quantity itemKey',
      )
      .exec();

    if (found) {
      await this.enrichInventoryNomenclature(structureId, [found]);

      return {
        id: found.id,
        name: found.name,
        characteristics: found.characteristics,
        barcode: resolveInventoryBarcode(
          found.name,
          found.characteristics,
          found.barcode,
          found.receiptNomenclatureCode,
        ),
        nomenclatureCode: mapNomenclatureCode(found.receiptNomenclatureCode),
        quantity: found.quantity,
      };
    }

    const candidates = await this.inventoryModel
      .find({
        structureId: new Types.ObjectId(structureId),
        locationId: new Types.ObjectId(locationId),
      })
      .select(
        'name characteristics barcode receiptNomenclatureCode quantity itemKey',
      )
      .limit(2500)
      .exec();

    for (const item of candidates) {
      const computed = resolveInventoryBarcode(
        item.name,
        item.characteristics,
        item.barcode,
        item.receiptNomenclatureCode,
      );

      const storedBarcode = item.barcode?.trim() || '';
      const nomenclature = item.receiptNomenclatureCode?.trim() || '';
      const needsBarcodePersist =
        !storedBarcode || (nomenclature && storedBarcode === nomenclature);

      if (needsBarcodePersist) {
        await this.inventoryModel
          .updateOne({ _id: item._id }, { $set: { barcode: computed } })
          .exec();
      }

      if (computed === value) {
        await this.enrichInventoryNomenclature(structureId, [item]);

        return {
          id: item.id,
          name: item.name,
          characteristics: item.characteristics,
          barcode: computed,
          nomenclatureCode: mapNomenclatureCode(item.receiptNomenclatureCode),
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
    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(userId, role);
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
      .select(
        'name characteristics barcode receiptNomenclatureCode quantity locationId itemKey',
      )
      .exec();

    if (!found) {
      throw new NotFoundException('Tovar topilmadi');
    }

    await this.enrichInventoryNomenclature(structureId, [found]);

    const locationRef = found.locationId as unknown as {
      _id?: Types.ObjectId;
      id?: string;
      name?: string;
    } | null;

    return {
      id: found.id,
      locationId:
        locationRef?.id ?? (locationRef?._id ? String(locationRef._id) : null),
      locationName: locationRef?.name ?? 'Noma’lum joy',
      name: found.name,
      characteristics: found.characteristics,
      barcode: found.barcode,
      nomenclatureCode: mapNomenclatureCode(found.receiptNomenclatureCode),
      quantity: found.quantity,
    };
  }

  listExpenseReasons() {
    return WAREHOUSE_EXPENSE_REASONS;
  }

  private async resolveExpenseServiceStructure(
    reasonKey: string,
    serviceStructureIdInput?: string,
  ): Promise<{
    serviceStructureId: Types.ObjectId | null;
    serviceStructureName: string;
  }> {
    const rawServiceStructureId = serviceStructureIdInput?.trim();
    const isRequired = isFixedAssetReasonKey(reasonKey);

    if (!rawServiceStructureId) {
      if (isRequired) {
        throw new BadRequestException('Asosiy vosita uchun tuzilma tanlang');
      }

      return { serviceStructureId: null, serviceStructureName: '' };
    }

    if (!Types.ObjectId.isValid(rawServiceStructureId)) {
      throw new BadRequestException('Tuzilma noto‘g‘ri');
    }

    const serviceStructure = await this.structureModel
      .findOne({
        _id: new Types.ObjectId(rawServiceStructureId),
        isActive: true,
      })
      .select('fullName shortName')
      .exec();

    if (!serviceStructure) {
      throw new BadRequestException('Tuzilma topilmadi');
    }

    return {
      serviceStructureId: serviceStructure._id,
      serviceStructureName:
        serviceStructure.shortName?.trim() ||
        serviceStructure.fullName?.trim() ||
        '—',
    };
  }

  async createExpense(
    dto: CreateWarehouseExpenseDto,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertPageActionPermission(
      userId,
      role,
      WAREHOUSE_EXPENSE_PAGE_PATH,
      'create',
      'Chiqim yaratishga ruxsat yo‘q',
    );

    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(userId, role);

    if (!isWarehouseExpenseReasonKey(dto.reasonKey)) {
      throw new BadRequestException('Chiqim sababi noto‘g‘ri');
    }

    const reason = WAREHOUSE_EXPENSE_REASONS.find(
      (r) => r.key === dto.reasonKey,
    )!;

    const { serviceStructureId, serviceStructureName } =
      await this.resolveExpenseServiceStructure(dto.reasonKey, dto.serviceStructureId);

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

    if (
      itemsInput.some(
        (i) => !i.locationId || !Types.ObjectId.isValid(i.locationId),
      )
    ) {
      throw new BadRequestException(
        'Har bir tovar uchun ombor joyi bo‘lishi shart',
      );
    }

    const merged = new Map<
      string,
      { locationId: string; barcode: string; quantity: number }
    >();
    for (const item of itemsInput) {
      const key = `${item.locationId}|${item.barcode}`;
      const prev = merged.get(key);
      if (prev) {
        prev.quantity += item.quantity;
      } else {
        merged.set(key, {
          locationId: item.locationId,
          barcode: item.barcode,
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
      .select(
        'locationId itemKey name characteristics barcode receiptNomenclatureCode quantity',
      )
      .exec();

    if (inventories.length !== requestItems.length) {
      throw new BadRequestException('Ba’zi barcode bo‘yicha tovar topilmadi');
    }

    const byLocationAndBarcode = new Map(
      inventories.map((inv) => [
        `${String(inv.locationId)}|${inv.barcode}`,
        inv,
      ]),
    );

    for (const item of requestItems) {
      const inv = byLocationAndBarcode.get(
        `${item.locationId}|${item.barcode}`,
      );
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
      throw new BadRequestException(
        'Chiqimni bajarib bo‘lmadi (miqdor yetarli emas)',
      );
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
        serviceStructureId,
        serviceStructureName,
        items: rows.map((row) => {
          const inv = byLocationAndBarcode.get(
            `${row.locationId}|${row.barcode}`,
          )!;
          return {
            itemKey: inv.itemKey,
            name: inv.name,
            characteristics: inv.characteristics,
            barcode: inv.barcode,
            nomenclatureCode: mapNomenclatureCode(inv.receiptNomenclatureCode),
            quantity: row.quantity,
          };
        }),
        createdBy: new Types.ObjectId(userId),
      });
      if (!firstCreated) firstCreated = created;
    }

    if (isFixedAssetReasonKey(dto.reasonKey) && serviceStructureId) {
      const fixedAssetRows = requestItems.map((row) => {
        const inv = byLocationAndBarcode.get(
          `${row.locationId}|${row.barcode}`,
        )!;
        return {
          structureId: new Types.ObjectId(structureId),
          locationId: new Types.ObjectId(row.locationId),
          expenseCode: code,
          serviceStructureId,
          serviceStructureName,
          itemKey: inv.itemKey,
          name: inv.name,
          characteristics: inv.characteristics,
          barcode: inv.barcode,
          nomenclatureCode: mapNomenclatureCode(inv.receiptNomenclatureCode),
          quantity: row.quantity,
          status: 'active' as const,
          comment: dto.comment?.trim() || '',
          createdBy: new Types.ObjectId(userId),
        };
      });

      if (fixedAssetRows.length) {
        await this.fixedAssetModel.insertMany(fixedAssetRows);
      }
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
    serviceStructureId?: Types.ObjectId | null;
    serviceStructureName?: string;
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
      serviceStructureId: row.serviceStructureId
        ? String(row.serviceStructureId)
        : null,
      serviceStructureName: row.serviceStructureName?.trim() || '',
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
    const scope = await this.resolveExpenseListScope(
      query.structureId,
      userId,
      role,
    );
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const matchClauses: Record<string, unknown>[] = [];
    if (scope.mode === 'single') {
      matchClauses.push({ structureId: new Types.ObjectId(scope.structureId) });
    }

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
          { reasonLabel: regex },
          { comment: regex },
          { 'items.name': regex },
          { 'items.barcode': regex },
          { 'items.nomenclatureCode': regex },
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
            serviceStructureId: { $first: '$serviceStructureId' },
            serviceStructureName: { $first: '$serviceStructureName' },
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
      serviceStructureId?: Types.ObjectId | null;
      serviceStructureName?: string;
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
    await this.assertCanViewExpenseHistory(userId, role);

    const normalizedCode = code?.trim();

    if (!normalizedCode) {
      throw new BadRequestException('Chiqim kodi noto‘g‘ri');
    }

    let structureId: string;
    const requestedStructureId = queryStructureId?.trim();

    if (requestedStructureId) {
      await this.assertExpenseHistoryStructureReadable(requestedStructureId);
      structureId = requestedStructureId;
    } else {
      structureId = await this.resolveViewerStructureWithWarehouseOrFail(userId, role);
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
        nomenclatureCode: item.nomenclatureCode?.trim() || '',
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
      serviceStructureId: docs[0].serviceStructureId
        ? String(docs[0].serviceStructureId)
        : null,
      serviceStructureName: docs[0].serviceStructureName?.trim() || '',
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
      await this.assertExpenseHistoryStructureReadable(requestedStructureId);
      structureId = requestedStructureId;
    } else {
      structureId = await this.resolveViewerStructureWithWarehouseOrFail(userId, role);
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

    await this.fixedAssetModel
      .updateMany(
        {
          structureId: structureObjectId,
          expenseCode: normalizedCode,
          status: 'active',
        },
        { $set: { status: 'returned', returnedAt: now } },
      )
      .exec();

    const restoredQuantity = restoreItems.reduce(
      (sum, row) => sum + row.quantity,
      0,
    );

    return {
      code: normalizedCode,
      structureId,
      deletedDocuments: deleteResult.deletedCount,
      restoredLines: restoreItems.length,
      restoredQuantity,
    };
  }

  private fixedAssetToPublic(
    row: WarehouseFixedAssetDocument,
    locationName?: string,
  ) {
    return {
      id: row.id,
      structureId: String(row.structureId),
      locationId: String(row.locationId),
      locationName: locationName?.trim() || '—',
      expenseCode: row.expenseCode,
      serviceStructureId: String(row.serviceStructureId),
      serviceStructureName: row.serviceStructureName?.trim() || '—',
      itemKey: row.itemKey,
      name: row.name,
      characteristics: row.characteristics,
      barcode: row.barcode,
      nomenclatureCode: row.nomenclatureCode?.trim() || '',
      quantity: row.quantity,
      status: row.status,
      comment: row.comment?.trim() || '',
      discardReason: row.discardReason?.trim() || '',
      returnedAt: row.returnedAt ?? null,
      discardedAt: row.discardedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listFixedAssetsPaginated(
    query: QueryWarehouseFixedAssetsDto,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertCanViewExpenseHistory(userId, role);

    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(
      userId,
      role,
    );
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const status = query.status?.trim() || 'active';

    const filter: Record<string, unknown> = {
      structureId: new Types.ObjectId(structureId),
      status,
    };

    if (query.serviceStructureId?.trim()) {
      if (!Types.ObjectId.isValid(query.serviceStructureId.trim())) {
        throw new BadRequestException('Xizmat identifikatori noto‘g‘ri');
      }
      filter.serviceStructureId = new Types.ObjectId(
        query.serviceStructureId.trim(),
      );
    }

    if (search) {
      const regex = new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      filter.$or = [
        { name: regex },
        { barcode: regex },
        { nomenclatureCode: regex },
        { expenseCode: regex },
        { serviceStructureName: regex },
        { characteristics: regex },
      ];
    }

    const [items, total] = await Promise.all([
      this.fixedAssetModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.fixedAssetModel.countDocuments(filter).exec(),
    ]);

    const locationIds = [
      ...new Set(items.map((item) => String(item.locationId))),
    ];
    const locations = locationIds.length
      ? await this.locationModel
          .find({ _id: { $in: locationIds.map((id) => new Types.ObjectId(id)) } })
          .select('name')
          .exec()
      : [];
    const locationNameById = new Map(
      locations.map((loc) => [String(loc._id), loc.name]),
    );

    return {
      items: items.map((item) =>
        this.fixedAssetToPublic(
          item,
          locationNameById.get(String(item.locationId)),
        ),
      ),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async returnFixedAssetToWarehouse(
    fixedAssetId: string,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertPageActionPermission(
      userId,
      role,
      WAREHOUSE_EXPENSE_PAGE_PATH,
      'create',
      'Asosiy vositani skladga qaytarishga ruxsat yo‘q',
    );

    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(
      userId,
      role,
    );

    if (!Types.ObjectId.isValid(fixedAssetId)) {
      throw new BadRequestException('Asosiy vosita identifikatori noto‘g‘ri');
    }

    const asset = await this.fixedAssetModel
      .findOne({
        _id: new Types.ObjectId(fixedAssetId),
        structureId: new Types.ObjectId(structureId),
      })
      .exec();

    if (!asset) {
      throw new NotFoundException('Asosiy vosita topilmadi');
    }

    if (asset.status !== 'active') {
      throw new BadRequestException(
        'Faqat faol asosiy vositalarni skladga qaytarish mumkin',
      );
    }

    const now = new Date();
    const restored = await this.inventoryModel
      .updateOne(
        {
          structureId: asset.structureId,
          locationId: asset.locationId,
          barcode: asset.barcode,
        },
        {
          $inc: { quantity: asset.quantity },
          $set: { updatedAt: now },
        },
      )
      .exec();

    if (restored.matchedCount === 0) {
      await this.inventoryModel
        .updateOne(
          {
            structureId: asset.structureId,
            locationId: asset.locationId,
            itemKey: asset.itemKey,
          },
          {
            $inc: { quantity: asset.quantity },
            $set: { updatedAt: now },
            $setOnInsert: {
              structureId: asset.structureId,
              locationId: asset.locationId,
              itemKey: asset.itemKey,
              name: asset.name,
              characteristics: asset.characteristics,
              barcode: asset.barcode,
              nomenclatureCode: asset.nomenclatureCode || '',
              unitPrice: 0,
            },
          },
          { upsert: true },
        )
        .exec();
    }

    asset.status = 'returned';
    asset.returnedAt = now;
    await asset.save();

    return this.fixedAssetToPublic(asset);
  }

  async discardFixedAsset(
    fixedAssetId: string,
    reason: string | undefined,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertPageActionPermission(
      userId,
      role,
      WAREHOUSE_EXPENSE_PAGE_PATH,
      'create',
      'Asosiy vositani hisobdan chiqarishga ruxsat yo‘q',
    );

    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(
      userId,
      role,
    );

    if (!Types.ObjectId.isValid(fixedAssetId)) {
      throw new BadRequestException('Asosiy vosita identifikatori noto‘g‘ri');
    }

    const asset = await this.fixedAssetModel
      .findOne({
        _id: new Types.ObjectId(fixedAssetId),
        structureId: new Types.ObjectId(structureId),
      })
      .exec();

    if (!asset) {
      throw new NotFoundException('Asosiy vosita topilmadi');
    }

    if (asset.status !== 'active') {
      throw new BadRequestException(
        'Faqat faol asosiy vositalarni hisobdan chiqarish mumkin',
      );
    }

    const now = new Date();
    asset.status = 'discarded';
    asset.discardedAt = now;
    asset.discardReason = reason?.trim() || 'Tovar eskirib ketgan yoki yaroqsizlangan';
    await asset.save();

    return this.fixedAssetToPublic(asset);
  }

  private inventoryMatchesDispatchItem(
    inventory: {
      itemKey: string;
      barcode: string;
      name: string;
      characteristics: string;
    },
    item: DispatchItemEmbeddable,
  ) {
    const receiptKey = buildInventoryItemKey(
      item.name,
      item.characteristics,
      item.receiptNomenclatureCode,
    );
    const legacyKey = buildWarehouseItemKey(item.name, item.characteristics);
    if (
      receiptKey === inventory.itemKey ||
      legacyKey === inventory.itemKey
    ) {
      return true;
    }

    const sourceBarcode = item.sourceBarcode?.trim();
    const computedBarcode = computeWarehouseBarcode(
      item.name,
      item.characteristics,
    );
    return (
      (sourceBarcode && sourceBarcode === inventory.barcode) ||
      computedBarcode === inventory.barcode
    );
  }

  private expenseItemQuantity(
    items: WarehouseExpenseDocument['items'],
    itemKey: string,
    barcode: string,
  ) {
    return (items ?? []).reduce((sum, row) => {
      if (row.itemKey === itemKey || row.barcode === barcode) {
        return sum + (row.quantity ?? 0);
      }
      return sum;
    }, 0);
  }

  private stocktakeLineMatchesInventory(
    stocktake: StocktakeDocument,
    line: {
      lineKey: string;
      barcode?: string;
      name: string;
    },
    inventory: {
      itemKey: string;
      barcode: string;
      name: string;
      locationId: string;
    },
  ) {
    const itemKeyMatch = line.lineKey === `item:${inventory.itemKey}`;
    const nameKeyMatch =
      line.lineKey === `name:${normalizeInventoryName(inventory.name)}`;
    const barcodeMatch = Boolean(
      line.barcode?.trim() && line.barcode === inventory.barcode,
    );
    const nameMatch = inventoryNamesMatch(line.name, inventory.name);

    if (!itemKeyMatch && !nameKeyMatch && !barcodeMatch && !nameMatch) {
      return false;
    }

    if (stocktake.mode === StocktakeMode.LOCATION) {
      return String(stocktake.locationId ?? '') === String(inventory.locationId);
    }

    return nameKeyMatch || nameMatch || barcodeMatch;
  }

  async getInventoryItemHistory(
    locationId: string,
    inventoryId: string,
    userId: string,
    role?: UserRole,
  ) {
    const structureId = await this.resolveViewerStructureWithWarehouseOrFail(
      userId,
      role,
    );

    const inventory = await this.inventoryModel
      .findOne({
        _id: new Types.ObjectId(inventoryId),
        structureId: new Types.ObjectId(structureId),
        locationId: new Types.ObjectId(locationId),
      })
      .select(
        'itemKey name characteristics barcode receiptNomenclatureCode structureId locationId createdAt lastReceiptAt',
      )
      .exec();

    if (!inventory) {
      throw new NotFoundException('Tovar topilmadi');
    }

    const itemKey = resolveInventoryItemKey(inventory);
    const barcode = resolveInventoryBarcode(
      inventory.name,
      inventory.characteristics,
      inventory.barcode,
      inventory.receiptNomenclatureCode,
    );
    const structureObjectId = new Types.ObjectId(structureId);
    const locationObjectId = new Types.ObjectId(locationId);

    type HistoryEvent = {
      id: string;
      type:
        | 'purchase_receipt'
        | 'transfer_in'
        | 'transfer_out'
        | 'transfer_cancelled'
        | 'expense'
        | 'fixed_asset'
        | 'fixed_asset_return'
        | 'fixed_asset_discard'
        | 'import'
        | 'stocktake_increase'
        | 'stocktake_decrease';
      title: string;
      description: string;
      quantity?: number;
      occurredAt: Date;
      linkPath?: string;
      linkLabel?: string;
    };

    const events: HistoryEvent[] = [];
    const nameLineKey = `name:${normalizeInventoryName(inventory.name)}`;
    const stocktakeLineMatchers: Record<string, unknown>[] = [
      { lineKey: `item:${itemKey}` },
      { lineKey: nameLineKey },
    ];
    if (barcode) {
      stocktakeLineMatchers.push({ barcode });
    }

    const [inboundDispatches, outboundDispatches, expenses, fixedAssets, imports, stocktakes] =
      await Promise.all([
        this.dispatchModel
          .find({
            'targetStructure.structureId': structureObjectId,
            status: {
              $in: [
                WarehouseDispatchStatus.PARTIALLY_RECEIVED,
                WarehouseDispatchStatus.COMPLETED,
              ],
            },
            'items.quantityReceived': { $gt: 0 },
          })
          .select(
            'dispatchCode requestCode purchaseRequestId sourceStructureId sourceStructure items updatedAt createdAt',
          )
          .sort({ updatedAt: 1 })
          .exec(),
        this.dispatchModel
          .find({
            sourceStructureId: structureObjectId,
            'items.sourceLocationId': locationObjectId,
          })
          .select(
            'dispatchCode targetStructure items dispatchedAt createdAt updatedAt status cancelReasonLabel cancelReasonOther cancelledAt',
          )
          .sort({ dispatchedAt: 1 })
          .exec(),
        this.expenseModel
          .find({
            structureId: structureObjectId,
            locationId: locationObjectId,
            $or: [{ 'items.itemKey': itemKey }, { 'items.barcode': barcode }],
          })
          .select('code reasonKey reasonLabel comment items createdAt')
          .sort({ createdAt: 1 })
          .exec(),
        this.fixedAssetModel
          .find({
            structureId: structureObjectId,
            locationId: locationObjectId,
            itemKey,
          })
          .select(
            'expenseCode serviceStructureName quantity status returnedAt discardedAt discardReason createdAt',
          )
          .sort({ createdAt: 1 })
          .exec(),
        this.importModel
          .find({
            structureId: structureObjectId,
            items: {
              $elemMatch: {
                locationId: locationObjectId,
                itemKey,
              },
            },
          })
          .select('code items comment createdAt')
          .sort({ createdAt: 1 })
          .exec(),
        this.stocktakeModel
          .find({
            structureId: structureObjectId,
            status: StocktakeStatus.COMPLETED,
            lines: {
              $elemMatch: {
                $or: stocktakeLineMatchers,
              },
            },
          })
          .select('code mode locationId locationName lines updatedAt createdAt comment')
          .sort({ updatedAt: 1 })
          .exec(),
      ]);

    for (const dispatch of inboundDispatches) {
      const isPurchase = Boolean(dispatch.purchaseRequestId);
      const sourceName =
        dispatch.sourceStructure?.shortName?.trim() ||
        dispatch.sourceStructure?.fullName?.trim() ||
        '';

      for (const item of dispatch.items ?? []) {
        if (!this.inventoryMatchesDispatchItem({ itemKey, barcode, name: inventory.name, characteristics: inventory.characteristics }, item)) {
          continue;
        }
        const qty = item.quantityReceived ?? 0;
        if (qty < 1) continue;

        const occurredAt = dispatch.updatedAt ?? dispatch.createdAt ?? new Date();
        if (isPurchase) {
          events.push({
            id: `dispatch-in-purchase-${dispatch.id}-${item.itemIndex}`,
            type: 'purchase_receipt',
            title: 'Xarid orqali omborga qabul qilindi',
            description: `${dispatch.dispatchCode} · Ariza ${dispatch.requestCode}`,
            quantity: qty,
            occurredAt,
            linkPath: `/xarid-qilish/xaridni-qabul-qilish?dispatch=${dispatch.id}`,
            linkLabel: 'Qabul varaqasini ko‘rish',
          });
        } else {
          events.push({
            id: `dispatch-in-transfer-${dispatch.id}-${item.itemIndex}`,
            type: 'transfer_in',
            title: 'Transfer orqali omborga qabul qilindi',
            description: sourceName
              ? `${dispatch.dispatchCode} · ${sourceName} dan`
              : dispatch.dispatchCode,
            quantity: qty,
            occurredAt,
            linkPath: `/transfer/transferni-qabul-qilish?dispatch=${dispatch.id}`,
            linkLabel: 'Transferni ko‘rish',
          });
        }
      }
    }

    for (const dispatch of outboundDispatches) {
      const targetName =
        dispatch.targetStructure?.shortName?.trim() ||
        dispatch.targetStructure?.fullName?.trim() ||
        'boshqa tuzilma';

      for (const item of dispatch.items ?? []) {
        if (String(item.sourceLocationId ?? '') !== String(locationObjectId)) {
          continue;
        }
        if (!this.inventoryMatchesDispatchItem({ itemKey, barcode, name: inventory.name, characteristics: inventory.characteristics }, item)) {
          continue;
        }
        const qty = item.quantityDispatched ?? 0;
        if (qty < 1) continue;

        events.push({
          id: `dispatch-out-${dispatch.id}-${item.itemIndex}`,
          type: 'transfer_out',
          title: 'Transfer bilan jo‘natildi',
          description: `${dispatch.dispatchCode} · ${targetName} ga`,
          quantity: qty,
          occurredAt: dispatch.dispatchedAt ?? dispatch.createdAt ?? new Date(),
          linkPath: `/transfer/transferlar-tarixi?dispatch=${dispatch.id}`,
          linkLabel: 'Transfer tarixini ko‘rish',
        });
      }

      if (dispatch.status === WarehouseDispatchStatus.CANCELLED) {
        for (const item of dispatch.items ?? []) {
          if (String(item.sourceLocationId ?? '') !== String(locationObjectId)) {
            continue;
          }
          if (
            !this.inventoryMatchesDispatchItem(
              {
                itemKey,
                barcode,
                name: inventory.name,
                characteristics: inventory.characteristics,
              },
              item,
            )
          ) {
            continue;
          }

          const qty = item.quantityDispatched ?? 0;
          if (qty < 1) continue;

          const reasonLabel = dispatch.cancelReasonLabel?.trim() || '';
          const reasonOther = dispatch.cancelReasonOther?.trim() || '';
          const reasonText = reasonOther
            ? `${reasonLabel}: ${reasonOther}`
            : reasonLabel;

          events.push({
            id: `dispatch-cancelled-${dispatch.id}-${item.itemIndex}`,
            type: 'transfer_cancelled',
            title: 'Transfer bekor qilindi',
            description: `${dispatch.dispatchCode} · ${targetName} ga jo‘natilgan transfer bekor qilindi${
              reasonText ? ` · Sabab: ${reasonText}` : ''
            }`,
            quantity: qty,
            occurredAt:
              dispatch.cancelledAt ??
              dispatch.updatedAt ??
              dispatch.createdAt ??
              new Date(),
            linkPath: `/transfer/transferlar-tarixi?dispatch=${dispatch.id}`,
            linkLabel: 'Transfer tarixini ko‘rish',
          });
        }
      }
    }

    for (const expense of expenses) {
      const qty = this.expenseItemQuantity(expense.items, itemKey, barcode);
      if (qty < 1) continue;

      const isFixedAsset = isFixedAssetReasonKey(expense.reasonKey);
      events.push({
        id: `expense-${expense.id}`,
        type: 'expense',
        title: isFixedAsset ? 'Asosiy vosita qilindi (chiqim)' : 'Chiqim qilindi',
        description: `${expense.code} · ${expense.reasonLabel}${
          expense.comment?.trim() ? ` · ${expense.comment.trim()}` : ''
        }`,
        quantity: qty,
        occurredAt: expense.createdAt ?? new Date(),
        linkPath: `/omborlar/chiqim-tarixi?chiqim=${encodeURIComponent(expense.code)}&structureId=${structureId}`,
        linkLabel: 'Chiqim tafsiloti',
      });
    }

    for (const importRecord of imports) {
      for (const [itemIndex, item] of (importRecord.items ?? []).entries()) {
        if (String(item.locationId ?? '') !== String(locationObjectId)) {
          continue;
        }

        if (item.itemKey !== itemKey) {
          continue;
        }

        events.push({
          id: `import-${importRecord.id}-${itemIndex}`,
          type: 'import',
          title: 'Import qilingan',
          description: `${importRecord.code}${
            importRecord.comment?.trim()
              ? ` · ${importRecord.comment.trim()}`
              : ''
          }`,
          quantity: item.quantity,
          occurredAt: importRecord.createdAt ?? new Date(),
          linkPath: `/omborlar/tavar-import-qilish?import=${importRecord.id}`,
          linkLabel: 'Import tafsiloti',
        });
      }
    }

    for (const asset of fixedAssets) {
      events.push({
        id: `fixed-asset-${asset.id}`,
        type: 'fixed_asset',
        title: 'Asosiy vosita ro‘yxatga olindi',
        description: `${asset.expenseCode} · ${asset.serviceStructureName}`,
        quantity: asset.quantity,
        occurredAt: asset.createdAt ?? new Date(),
        linkPath: `/omborlar/asosiy-vositalar?search=${encodeURIComponent(asset.expenseCode)}`,
        linkLabel: 'Asosiy vositalarni ko‘rish',
      });

      if (asset.returnedAt) {
        events.push({
          id: `fixed-asset-return-${asset.id}`,
          type: 'fixed_asset_return',
          title: 'Asosiy vositadan skladga qaytarildi',
          description: `${asset.expenseCode} · ${asset.serviceStructureName}`,
          quantity: asset.quantity,
          occurredAt: asset.returnedAt,
          linkPath: `/omborlar/asosiy-vositalar?search=${encodeURIComponent(asset.expenseCode)}`,
          linkLabel: 'Asosiy vositalarni ko‘rish',
        });
      }

      if (asset.discardedAt) {
        events.push({
          id: `fixed-asset-discard-${asset.id}`,
          type: 'fixed_asset_discard',
          title: 'Asosiy vosita hisobdan chiqarildi',
          description: `${asset.expenseCode}${
            asset.discardReason?.trim() ? ` · ${asset.discardReason.trim()}` : ''
          }`,
          quantity: asset.quantity,
          occurredAt: asset.discardedAt,
          linkPath: `/omborlar/asosiy-vositalar?search=${encodeURIComponent(asset.expenseCode)}`,
          linkLabel: 'Asosiy vositalarni ko‘rish',
        });
      }
    }

    for (const stocktake of stocktakes) {
      const modeLabel =
        stocktake.mode === StocktakeMode.LOCATION && stocktake.locationName?.trim()
          ? ` · Joy: ${stocktake.locationName.trim()}`
          : stocktake.mode === StocktakeMode.GENERAL
            ? ' · Umumiy invertarizatsiya'
            : '';
      const commentSuffix = stocktake.comment?.trim()
        ? ` · ${stocktake.comment.trim()}`
        : '';
      const occurredAt =
        stocktake.updatedAt ?? stocktake.createdAt ?? new Date();

      for (const [lineIndex, line] of (stocktake.lines ?? []).entries()) {
        if (
          !this.stocktakeLineMatchesInventory(stocktake, line, {
            itemKey,
            barcode,
            name: inventory.name,
            locationId,
          })
        ) {
          continue;
        }

        const bookQuantity = line.bookQuantity ?? 0;
        const countedQuantity = line.countedQuantity ?? 0;
        const completeDiff = countedQuantity - bookQuantity;
        const lineId = `${stocktake.id}-${line.lineKey || lineIndex}`;

        if (completeDiff > 0) {
          events.push({
            id: `stocktake-complete-inc-${lineId}`,
            type: 'stocktake_increase',
            title: 'Invertarizatsiya — omborda ko‘paydi',
            description: `${stocktake.code} · Kitobda ${bookQuantity} ta, sanaldi ${countedQuantity} ta (+${completeDiff})${modeLabel}${commentSuffix}`,
            quantity: completeDiff,
            occurredAt,
            linkPath: '/invertarizatsiya/barcha-invertarizatsiyalar',
            linkLabel: 'Invertarizatsiyani ko‘rish',
          });
        } else if (completeDiff < 0) {
          events.push({
            id: `stocktake-complete-dec-${lineId}`,
            type: 'stocktake_decrease',
            title: 'Invertarizatsiya — omborda kamaydi',
            description: `${stocktake.code} · Kitobda ${bookQuantity} ta, sanaldi ${countedQuantity} ta (${completeDiff})${modeLabel}${commentSuffix}`,
            quantity: -completeDiff,
            occurredAt,
            linkPath: '/invertarizatsiya/barcha-invertarizatsiyalar',
            linkLabel: 'Invertarizatsiyani ko‘rish',
          });
        }

        const excessDeduct = line.excessDeductQuantity ?? 0;
        if (excessDeduct > 0) {
          events.push({
            id: `stocktake-excess-${lineId}`,
            type: 'stocktake_decrease',
            title: 'Invertarizatsiya boshqaruvi — ortiqcha ayirildi',
            description: `${stocktake.code} · Ko‘p qismidan ${excessDeduct} ta ayirildi${modeLabel}${commentSuffix}`,
            quantity: excessDeduct,
            occurredAt,
            linkPath: '/invertarizatsiya/boshqaruv',
            linkLabel: 'Boshqaruvni ko‘rish',
          });
        }

        const shortageAdd = line.shortageAddQuantity ?? 0;
        if (shortageAdd > 0) {
          events.push({
            id: `stocktake-shortage-${lineId}`,
            type: 'stocktake_increase',
            title: 'Invertarizatsiya boshqaruvi — yetishmovchilik qo‘shildi',
            description: `${stocktake.code} · Kam qismi uchun ${shortageAdd} ta qo‘shildi${modeLabel}${commentSuffix}`,
            quantity: shortageAdd,
            occurredAt,
            linkPath: '/invertarizatsiya/boshqaruv',
            linkLabel: 'Boshqaruvni ko‘rish',
          });
        }
      }
    }

    events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    return {
      item: {
        id: inventory.id,
        itemKey,
        name: inventory.name,
        barcode,
      },
      events,
    };
  }
}
