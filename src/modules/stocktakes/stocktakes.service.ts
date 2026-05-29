import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { UsersService } from '../users/users.service';
import { Sequence, SequenceDocument } from '../purchase-requests/schemas/sequence.schema';
import { Structure, StructureDocument } from '../structures/schemas/structure.schema';
import {
  WarehouseInventory,
  WarehouseInventoryDocument,
} from '../warehouse/schemas/warehouse-inventory.schema';
import {
  WarehouseLocation,
  WarehouseLocationDocument,
} from '../warehouse/schemas/warehouse-location.schema';
import { computeWarehouseBarcode } from '../warehouse/utils/warehouse-barcode.util';
import { buildWarehouseItemKey } from '../warehouse/utils/item-key.util';
import { CreateStocktakeDto } from './dto/create-stocktake.dto';
import { QueryStocktakesDto } from './dto/query-stocktakes.dto';
import { ScanStocktakeBarcodeDto } from './dto/scan-stocktake-barcode.dto';
import { UpdateStocktakeLineDto } from './dto/update-stocktake-line.dto';
import { StocktakeMode } from './enums/stocktake-mode.enum';
import { StocktakeStatus } from './enums/stocktake-status.enum';
import { Stocktake, StocktakeDocument } from './schemas/stocktake.schema';
import { StocktakeLine } from './schemas/stocktake-line.schema';
import { ApplyExcessAdjustmentsDto } from './dto/apply-excess-adjustments.dto';
import {
  hasPageAccess,
  hasPageAction,
  normalizePermissions,
} from '../users/utils/permissions.util';
import { UserPermissionsMap } from '../users/types/page-permission.type';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';

const STOCKTAKE_SEQUENCE_PREFIX = 'stocktake:';
const STOCKTAKE_MANAGEMENT_PATH = '/invertarizatsiya/boshqaruv';

const normalizeNameKey = (name: string) => name.trim().toLowerCase();

@Injectable()
export class StocktakesService {
  constructor(
    @InjectModel(Stocktake.name)
    private readonly stocktakeModel: Model<StocktakeDocument>,
    @InjectModel(WarehouseInventory.name)
    private readonly inventoryModel: Model<WarehouseInventoryDocument>,
    @InjectModel(WarehouseLocation.name)
    private readonly locationModel: Model<WarehouseLocationDocument>,
    @InjectModel(Structure.name)
    private readonly structureModel: Model<StructureDocument>,
    @InjectModel(Sequence.name)
    private readonly sequenceModel: Model<SequenceDocument>,
    private readonly usersService: UsersService,
  ) {}

  private async nextStocktakeCode(structureId: string) {
    const key = `${STOCKTAKE_SEQUENCE_PREFIX}${structureId}`;
    const sequence = await this.sequenceModel
      .findOneAndUpdate({ key }, { $inc: { value: 1 } }, { upsert: true, new: true })
      .exec();

    return `INV-${String(sequence.value).padStart(6, '0')}`;
  }

  private async resolveUserStructureId(userId: string) {
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

    const isPrivileged = role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;
    if (isPrivileged) {
      return;
    }

    const userStructureId = await this.resolveUserStructureId(userId);
    if (userStructureId !== structureId) {
      throw new ForbiddenException('Bu tuzilma uchun invertarizatsiya qilishga ruxsat yo‘q');
    }
  }

  private getLineExcess(line: StocktakeLine) {
    const bookQuantity = line.bookQuantity ?? 0;
    const countedQuantity = line.countedQuantity ?? 0;
    return Math.max(0, countedQuantity - bookQuantity);
  }

  private getLineShortage(line: StocktakeLine) {
    const bookQuantity = line.bookQuantity ?? 0;
    const countedQuantity = line.countedQuantity ?? 0;
    if (countedQuantity > 0 && countedQuantity < bookQuantity) {
      return bookQuantity - countedQuantity;
    }
    return 0;
  }

  private toPublicLine(line: StocktakeLine) {
    const bookQuantity = line.bookQuantity ?? 0;
    const countedQuantity = line.countedQuantity ?? 0;
    const excessQuantity = this.getLineExcess(line);
    const shortageQuantity = this.getLineShortage(line);
    const excessDeductQuantity = line.excessDeductQuantity ?? 0;
    const shortageAddQuantity = line.shortageAddQuantity ?? 0;
    const diff = countedQuantity - bookQuantity;
    const warehouseQuantity =
      excessQuantity > 0
        ? countedQuantity - excessDeductQuantity
        : shortageQuantity > 0
          ? countedQuantity + shortageAddQuantity
          : countedQuantity;

    return {
      lineKey: line.lineKey,
      name: line.name,
      characteristics: line.characteristics,
      barcode: line.barcode,
      bookQuantity,
      countedQuantity,
      excessQuantity,
      excessDeductQuantity,
      excessRemaining: Math.max(0, excessQuantity - excessDeductQuantity),
      shortageQuantity,
      shortageAddQuantity,
      shortageRemaining: Math.max(0, shortageQuantity - shortageAddQuantity),
      warehouseQuantity,
      diff,
      tab: this.resolveLineTab(bookQuantity, countedQuantity),
    };
  }

  private async assertManagementAccess(userId: string, role?: UserRole, requireUpdate = false) {
    if (isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      throw new ForbiddenException('Boshqaruv sahifasiga ruxsat yo‘q');
    }

    const permissions = normalizePermissions(user.permissions as UserPermissionsMap);
    const allowed = requireUpdate
      ? hasPageAction(permissions, STOCKTAKE_MANAGEMENT_PATH, 'update', false)
      : hasPageAccess(permissions, STOCKTAKE_MANAGEMENT_PATH, false);

    if (!allowed) {
      throw new ForbiddenException('Boshqaruv sahifasiga ruxsat yo‘q');
    }
  }

  private getExcessLinesFromStocktake(stocktake: StocktakeDocument) {
    return (stocktake.lines ?? []).filter((line) => this.getLineExcess(line) > 0);
  }

  private getShortageLinesFromStocktake(stocktake: StocktakeDocument) {
    return (stocktake.lines ?? []).filter((line) => this.getLineShortage(line) > 0);
  }

  private resolveLineTab(bookQuantity: number, countedQuantity: number) {
    if (countedQuantity > bookQuantity) return 'ko_p';
    if (countedQuantity > 0 && countedQuantity < bookQuantity) return 'kam';
    return 'hammasi';
  }

  private toPublic(stocktake: StocktakeDocument) {
    const lines = (stocktake.lines ?? []).map((line) => this.toPublicLine(line));
    const summary = {
      total: lines.length,
      kam: lines.filter((l) => l.tab === 'kam').length,
      ko_p: lines.filter((l) => l.tab === 'ko_p').length,
      unscanned: lines.filter((l) => l.countedQuantity === 0).length,
    };

    return {
      id: stocktake.id,
      code: stocktake.code,
      structureId: String(stocktake.structureId),
      structureName: stocktake.structureName,
      mode: stocktake.mode,
      locationId: stocktake.locationId ? String(stocktake.locationId) : null,
      locationName: stocktake.locationName || '',
      status: stocktake.status,
      comment: stocktake.comment || '',
      lines,
      summary,
      createdAt: stocktake.createdAt,
      updatedAt: stocktake.updatedAt,
    };
  }

  private async buildGeneralLines(structureId: string): Promise<StocktakeLine[]> {
    const rows = await this.inventoryModel
      .aggregate<{
        _id: string;
        name: string;
        characteristics: string;
        bookQuantity: number;
      }>([
        {
          $match: {
            structureId: new Types.ObjectId(structureId),
            quantity: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: { $toLower: { $trim: { input: '$name' } } },
            name: { $first: '$name' },
            characteristics: { $first: '$characteristics' },
            bookQuantity: { $sum: '$quantity' },
          },
        },
        { $sort: { name: 1 } },
      ])
      .exec();

    return rows.map((row) => {
      const name = row.name?.trim() || '';
      const characteristics = row.characteristics?.trim() || '';
      const barcode = computeWarehouseBarcode(name, characteristics);

      return {
        lineKey: `name:${normalizeNameKey(name)}`,
        name,
        characteristics,
        barcode,
        bookQuantity: row.bookQuantity ?? 0,
        countedQuantity: 0,
        excessDeductQuantity: 0,
        shortageAddQuantity: 0,
      };
    });
  }

  private async buildLocationLines(
    structureId: string,
    locationId: string,
  ): Promise<StocktakeLine[]> {
    const items = await this.inventoryModel
      .find({
        structureId: new Types.ObjectId(structureId),
        locationId: new Types.ObjectId(locationId),
        quantity: { $gt: 0 },
      })
      .sort({ name: 1 })
      .select('itemKey name characteristics barcode quantity')
      .exec();

    return items.map((item) => {
      const name = item.name?.trim() || '';
      const characteristics = item.characteristics?.trim() || '';
      const barcode =
        item.barcode?.trim() || computeWarehouseBarcode(name, characteristics);
      const itemKey = item.itemKey?.trim() || buildWarehouseItemKey(name, characteristics);

      return {
        lineKey: `item:${itemKey}`,
        name,
        characteristics,
        barcode,
        bookQuantity: item.quantity ?? 0,
        countedQuantity: 0,
        excessDeductQuantity: 0,
        shortageAddQuantity: 0,
      };
    });
  }

  async create(dto: CreateStocktakeDto, userId: string, role?: UserRole) {
    await this.assertStructureAccess(dto.structureId, userId, role);

    const structure = await this.structureModel
      .findById(dto.structureId)
      .select('fullName shortName isActive')
      .exec();

    if (!structure || structure.isActive === false) {
      throw new NotFoundException('Tuzilma topilmadi');
    }

    let locationId: Types.ObjectId | null = null;
    let locationName = '';

    if (dto.mode === StocktakeMode.LOCATION) {
      if (!dto.locationId || !Types.ObjectId.isValid(dto.locationId)) {
        throw new BadRequestException('Joy tanlanishi shart');
      }

      const location = await this.locationModel
        .findOne({
          _id: new Types.ObjectId(dto.locationId),
          structureId: new Types.ObjectId(dto.structureId),
          isActive: true,
        })
        .select('name')
        .exec();

      if (!location) {
        throw new NotFoundException('Joy topilmadi');
      }

      locationId = new Types.ObjectId(dto.locationId);
      locationName = location.name;
    }

    const existing = await this.stocktakeModel
      .findOne({
        structureId: new Types.ObjectId(dto.structureId),
        createdBy: new Types.ObjectId(userId),
        status: StocktakeStatus.IN_PROGRESS,
        ...(locationId ? { locationId } : { mode: StocktakeMode.GENERAL }),
      })
      .select('_id code')
      .exec();

    if (existing) {
      throw new BadRequestException(
        `Bu tuzilma uchun faol invertarizatsiya mavjud (${existing.code})`,
      );
    }

    const lines =
      dto.mode === StocktakeMode.GENERAL
        ? await this.buildGeneralLines(dto.structureId)
        : await this.buildLocationLines(dto.structureId, dto.locationId!);

    const code = await this.nextStocktakeCode(dto.structureId);

    const created = await this.stocktakeModel.create({
      structureId: new Types.ObjectId(dto.structureId),
      structureName: structure.shortName || structure.fullName,
      mode: dto.mode,
      locationId,
      locationName,
      code,
      status: StocktakeStatus.IN_PROGRESS,
      comment: dto.comment?.trim() || '',
      lines,
      createdBy: new Types.ObjectId(userId),
    });

    return this.toPublic(created);
  }

  async findActive(userId: string) {
    const stocktake = await this.stocktakeModel
      .findOne({
        createdBy: new Types.ObjectId(userId),
        status: StocktakeStatus.IN_PROGRESS,
      })
      .sort({ createdAt: -1 })
      .exec();

    if (!stocktake) {
      return null;
    }

    return this.toPublic(stocktake);
  }

  async findAll(query: QueryStocktakesDto, userId: string, role?: UserRole) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};

    if (query.status) {
      filter.status = query.status;
    }

    const isPrivileged = role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;
    if (query.structureId && Types.ObjectId.isValid(query.structureId)) {
      await this.assertStructureAccess(query.structureId, userId, role);
      filter.structureId = new Types.ObjectId(query.structureId);
    } else if (!isPrivileged) {
      const userStructureId = await this.resolveUserStructureId(userId);
      filter.structureId = new Types.ObjectId(userStructureId);
    }

    const [items, total] = await Promise.all([
      this.stocktakeModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          'code structureId structureName mode locationId locationName status comment lines createdAt updatedAt',
        )
        .lean()
        .exec(),
      this.stocktakeModel.countDocuments(filter).exec(),
    ]);

    return {
      items: items.map((item) => {
        const lines = item.lines ?? [];
        return {
          id: String(item._id),
          code: item.code,
          structureId: String(item.structureId),
          structureName: item.structureName,
          mode: item.mode,
          locationId: item.locationId ? String(item.locationId) : null,
          locationName: item.locationName || '',
          status: item.status,
          comment: item.comment || '',
          summary: {
            total: lines.length,
            kam: lines.filter(
              (l) =>
                (l.countedQuantity ?? 0) > 0 && (l.countedQuantity ?? 0) < (l.bookQuantity ?? 0),
            ).length,
            ko_p: lines.filter((l) => (l.countedQuantity ?? 0) > (l.bookQuantity ?? 0)).length,
          },
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
      total,
      page,
      limit,
    };
  }

  private async getEditableStocktake(id: string, userId: string, role?: UserRole) {
    const stocktake = await this.stocktakeModel.findById(id).exec();

    if (!stocktake) {
      throw new NotFoundException('Invertarizatsiya topilmadi');
    }

    if (stocktake.status !== StocktakeStatus.IN_PROGRESS) {
      throw new BadRequestException('Invertarizatsiya allaqachon yakunlangan');
    }

    const isOwner = String(stocktake.createdBy) === userId;
    const isPrivileged = role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;

    if (!isOwner && !isPrivileged) {
      throw new ForbiddenException('Bu invertarizatsiyani tahrirlashga ruxsat yo‘q');
    }

    await this.assertStructureAccess(String(stocktake.structureId), userId, role);

    return stocktake;
  }

  async findById(id: string, userId: string, role?: UserRole) {
    const stocktake = await this.stocktakeModel.findById(id).exec();

    if (!stocktake) {
      throw new NotFoundException('Invertarizatsiya topilmadi');
    }

    await this.assertStructureAccess(String(stocktake.structureId), userId, role);

    return this.toPublic(stocktake);
  }

  async searchLines(id: string, search: string | undefined, userId: string, role?: UserRole) {
    const stocktake = await this.getEditableStocktake(id, userId, role);
    const term = search?.trim().toLowerCase();

    if (!term) {
      return { items: [] };
    }

    const items = (stocktake.lines ?? [])
      .filter((line) => {
        const name = line.name?.toLowerCase() ?? '';
        const characteristics = line.characteristics?.toLowerCase() ?? '';
        return name.includes(term) || characteristics.includes(term);
      })
      .slice(0, 30)
      .map((line) => this.toPublicLine(line));

    return { items };
  }

  async updateLine(
    id: string,
    dto: UpdateStocktakeLineDto,
    userId: string,
    role?: UserRole,
  ) {
    const stocktake = await this.getEditableStocktake(id, userId, role);
    const lineKey = dto.lineKey?.trim();
    const barcode = dto.barcode?.trim();

    if (!lineKey && !barcode) {
      throw new BadRequestException('lineKey yoki barcode kiriting');
    }

    const lineIndex = (stocktake.lines ?? []).findIndex((line) => {
      if (lineKey) return line.lineKey === lineKey;
      return line.barcode === barcode;
    });

    if (lineIndex < 0) {
      throw new NotFoundException('Tovar invertarizatsiya ro‘yxatida topilmadi');
    }

    stocktake.lines[lineIndex].countedQuantity = dto.countedQuantity;
    stocktake.markModified('lines');
    await stocktake.save();

    return this.toPublic(stocktake);
  }

  async scanBarcode(
    id: string,
    dto: ScanStocktakeBarcodeDto,
    userId: string,
    role?: UserRole,
  ) {
    const stocktake = await this.getEditableStocktake(id, userId, role);
    const value = dto.barcode.trim();

    const lineIndex = (stocktake.lines ?? []).findIndex((line) => line.barcode === value);

    if (lineIndex < 0) {
      const computedIndex = (stocktake.lines ?? []).findIndex((line) => {
        const computed = computeWarehouseBarcode(line.name, line.characteristics);
        return computed === value;
      });

      if (computedIndex < 0) {
        throw new NotFoundException('Barcode invertarizatsiya ro‘yxatida topilmadi');
      }

      stocktake.lines[computedIndex].countedQuantity =
        (stocktake.lines[computedIndex].countedQuantity ?? 0) + 1;

      if (!stocktake.lines[computedIndex].barcode?.trim()) {
        stocktake.lines[computedIndex].barcode = value;
      }
    } else {
      stocktake.lines[lineIndex].countedQuantity =
        (stocktake.lines[lineIndex].countedQuantity ?? 0) + 1;
    }

    stocktake.markModified('lines');
    await stocktake.save();

    return this.toPublic(stocktake);
  }

  private async setLineInventoryTarget(
    stocktake: StocktakeDocument,
    line: StocktakeLine,
    targetQuantity: number,
  ) {
    if (stocktake.mode === StocktakeMode.LOCATION) {
      const structureId = String(stocktake.structureId);
      const locationId = String(stocktake.locationId);
      const itemKey = line.lineKey.startsWith('item:')
        ? line.lineKey.slice('item:'.length)
        : buildWarehouseItemKey(line.name, line.characteristics);
      const now = new Date();

      await this.inventoryModel
        .updateOne(
          {
            structureId: new Types.ObjectId(structureId),
            locationId: new Types.ObjectId(locationId),
            itemKey,
          },
          {
            $set: {
              quantity: targetQuantity,
              barcode: line.barcode,
              updatedAt: now,
            },
          },
        )
        .exec();
      return;
    }

    await this.setGeneralInventoryTarget(String(stocktake.structureId), line, targetQuantity);
  }

  private async applyLocationInventory(stocktake: StocktakeDocument) {
    for (const line of stocktake.lines ?? []) {
      const target = (line.countedQuantity ?? 0) - (line.excessDeductQuantity ?? 0);
      await this.setLineInventoryTarget(stocktake, line, target);
    }
  }

  private async setGeneralInventoryTarget(
    structureId: string,
    line: StocktakeLine,
    targetQuantity: number,
  ) {
    const now = new Date();
    const nameKey = normalizeNameKey(line.name);
    const inventories = await this.inventoryModel
      .find({
        structureId: new Types.ObjectId(structureId),
        $expr: {
          $eq: [{ $toLower: { $trim: { input: '$name' } } }, nameKey],
        },
      })
      .sort({ quantity: -1 })
      .exec();

    if (!inventories.length) {
      return;
    }

    const target = targetQuantity;
    const ids = inventories.map((inv) => inv._id);

    if (target === 0) {
      await this.inventoryModel
        .updateMany(
          { _id: { $in: ids } },
          { $set: { quantity: 0, barcode: line.barcode, updatedAt: now } },
        )
        .exec();
      return;
    }

    const currentTotal = inventories.reduce((sum, inv) => sum + (inv.quantity ?? 0), 0);
    const delta = target - currentTotal;

    if (delta === 0) {
      await this.inventoryModel
        .updateMany({ _id: { $in: ids } }, { $set: { barcode: line.barcode, updatedAt: now } })
        .exec();
      return;
    }

    if (delta < 0) {
      let toRemove = -delta;
      for (const inv of inventories) {
        if (toRemove <= 0) break;
        const remove = Math.min(inv.quantity ?? 0, toRemove);
        toRemove -= remove;
        await this.inventoryModel
          .updateOne(
            { _id: inv._id },
            {
              $set: {
                quantity: (inv.quantity ?? 0) - remove,
                barcode: line.barcode,
                updatedAt: now,
              },
            },
          )
          .exec();
      }
      return;
    }

    const primary = inventories[0];
    await this.inventoryModel
      .updateOne(
        { _id: primary._id },
        {
          $inc: { quantity: delta },
          $set: { barcode: line.barcode, updatedAt: now },
        },
      )
      .exec();
  }

  private async applyGeneralInventory(stocktake: StocktakeDocument) {
    for (const line of stocktake.lines ?? []) {
      const target = (line.countedQuantity ?? 0) - (line.excessDeductQuantity ?? 0);
      await this.setGeneralInventoryTarget(String(stocktake.structureId), line, target);
    }
  }

  async listForManagement(query: QueryStocktakesDto, userId: string, role?: UserRole) {
    await this.assertManagementAccess(userId, role, false);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {
      status: StocktakeStatus.COMPLETED,
    };

    const isPrivileged = role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;
    if (!isPrivileged) {
      const userStructureId = await this.resolveUserStructureId(userId);
      filter.structureId = new Types.ObjectId(userStructureId);
    }

    const [agg] = await this.stocktakeModel
      .aggregate<{
        items: Array<Record<string, unknown>>;
        meta: Array<{ total: number }>;
      }>([
        { $match: filter },
        {
          $addFields: {
            excessLines: {
              $filter: {
                input: '$lines',
                as: 'line',
                cond: {
                  $gt: [{ $subtract: ['$$line.countedQuantity', '$$line.bookQuantity'] }, 0],
                },
              },
            },
            shortageLines: {
              $filter: {
                input: '$lines',
                as: 'line',
                cond: {
                  $and: [
                    { $gt: ['$$line.countedQuantity', 0] },
                    {
                      $lt: ['$$line.countedQuantity', '$$line.bookQuantity'],
                    },
                  ],
                },
              },
            },
          },
        },
        {
          $match: {
            $expr: {
              $or: [
                { $gt: [{ $size: '$excessLines' }, 0] },
                { $gt: [{ $size: '$shortageLines' }, 0] },
              ],
            },
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $facet: {
            items: [{ $skip: skip }, { $limit: limit }],
            meta: [{ $count: 'total' }],
          },
        },
      ])
      .exec();

    const items = agg?.items ?? [];
    const total = agg?.meta?.[0]?.total ?? 0;

    return {
      items: items.map((item) => {
        const lines = (item.lines as StocktakeLine[]) ?? [];
        const excessLines = lines.filter(
          (line) => (line.countedQuantity ?? 0) > (line.bookQuantity ?? 0),
        );
        const shortageLines = lines.filter((line) => {
          const counted = line.countedQuantity ?? 0;
          const book = line.bookQuantity ?? 0;
          return counted > 0 && counted < book;
        });
        const pendingExcessCount = excessLines.filter((line) => {
          const excess = (line.countedQuantity ?? 0) - (line.bookQuantity ?? 0);
          return (line.excessDeductQuantity ?? 0) < excess;
        }).length;
        const pendingShortageCount = shortageLines.filter((line) => {
          const shortage = (line.bookQuantity ?? 0) - (line.countedQuantity ?? 0);
          return (line.shortageAddQuantity ?? 0) < shortage;
        }).length;

        return {
          id: String(item._id),
          code: item.code,
          structureId: String(item.structureId),
          structureName: item.structureName,
          mode: item.mode,
          locationName: item.locationName || '',
          status: item.status,
          comment: item.comment || '',
          excessLinesCount: excessLines.length,
          shortageLinesCount: shortageLines.length,
          pendingExcessCount,
          pendingShortageCount,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
      total,
      page,
      limit,
    };
  }

  async getManagementDetail(id: string, userId: string, role?: UserRole) {
    await this.assertManagementAccess(userId, role, false);

    const stocktake = await this.stocktakeModel.findById(id).exec();
    if (!stocktake) {
      throw new NotFoundException('Invertarizatsiya topilmadi');
    }

    if (stocktake.status !== StocktakeStatus.COMPLETED) {
      throw new BadRequestException('Faqat yakunlangan invertarizatsiyalar boshqariladi');
    }

    await this.assertStructureAccess(String(stocktake.structureId), userId, role);

    const excessLines = this.getExcessLinesFromStocktake(stocktake).map((line) =>
      this.toPublicLine(line),
    );
    const shortageLines = this.getShortageLinesFromStocktake(stocktake).map((line) =>
      this.toPublicLine(line),
    );

    if (!excessLines.length && !shortageLines.length) {
      throw new BadRequestException('Bu partiyada ko‘p yoki kam sanalgan tovar yo‘q');
    }

    return {
      id: stocktake.id,
      code: stocktake.code,
      structureId: String(stocktake.structureId),
      structureName: stocktake.structureName,
      mode: stocktake.mode,
      locationId: stocktake.locationId ? String(stocktake.locationId) : null,
      locationName: stocktake.locationName || '',
      status: stocktake.status,
      comment: stocktake.comment || '',
      excessLines,
      shortageLines,
      createdAt: stocktake.createdAt,
      updatedAt: stocktake.updatedAt,
    };
  }

  async applyExcessAdjustments(
    id: string,
    dto: ApplyExcessAdjustmentsDto,
    userId: string,
    role?: UserRole,
  ) {
    await this.assertManagementAccess(userId, role, true);

    const stocktake = await this.stocktakeModel.findById(id).exec();
    if (!stocktake) {
      throw new NotFoundException('Invertarizatsiya topilmadi');
    }

    if (stocktake.status !== StocktakeStatus.COMPLETED) {
      throw new BadRequestException('Faqat yakunlangan invertarizatsiyalar boshqariladi');
    }

    await this.assertStructureAccess(String(stocktake.structureId), userId, role);

    const lineByKey = new Map((stocktake.lines ?? []).map((line) => [line.lineKey, line]));

    for (const item of dto.items) {
      const line = lineByKey.get(item.lineKey);
      if (!line) {
        throw new BadRequestException(`Tovar topilmadi: ${item.lineKey}`);
      }

      const hasDeduct = item.deductQuantity !== undefined;
      const hasAdd = item.addQuantity !== undefined;

      if (hasDeduct === hasAdd) {
        throw new BadRequestException(
          `«${line.name}» uchun faqat ayirish yoki qo‘shish miqdorini yuboring`,
        );
      }

      if (hasDeduct) {
        const excess = this.getLineExcess(line);
        if (excess <= 0) {
          throw new BadRequestException(`«${line.name}» ko‘p sanalmagan`);
        }

        const newDeduct = item.deductQuantity ?? 0;
        if (newDeduct > excess) {
          throw new BadRequestException(
            `«${line.name}» uchun maksimal ${excess} ta ayirish mumkin`,
          );
        }

        const oldDeduct = line.excessDeductQuantity ?? 0;
        if (oldDeduct === newDeduct) {
          continue;
        }

        const targetQuantity = (line.countedQuantity ?? 0) - newDeduct;
        await this.setLineInventoryTarget(stocktake, line, targetQuantity);
        line.excessDeductQuantity = newDeduct;
        continue;
      }

      const shortage = this.getLineShortage(line);
      if (shortage <= 0) {
        throw new BadRequestException(`«${line.name}» kam sanalmagan`);
      }

      const newAdd = item.addQuantity ?? 0;
      if (newAdd > shortage) {
        throw new BadRequestException(
          `«${line.name}» uchun maksimal ${shortage} ta qo‘shish mumkin`,
        );
      }

      const oldAdd = line.shortageAddQuantity ?? 0;
      if (oldAdd === newAdd) {
        continue;
      }

      const targetQuantity = (line.countedQuantity ?? 0) + newAdd;
      await this.setLineInventoryTarget(stocktake, line, targetQuantity);
      line.shortageAddQuantity = newAdd;
    }

    stocktake.markModified('lines');
    await stocktake.save();

    return this.getManagementDetail(id, userId, role);
  }

  async complete(id: string, userId: string, role?: UserRole) {
    const stocktake = await this.getEditableStocktake(id, userId, role);

    if (stocktake.mode === StocktakeMode.LOCATION) {
      await this.applyLocationInventory(stocktake);
    } else {
      await this.applyGeneralInventory(stocktake);
    }

    stocktake.status = StocktakeStatus.COMPLETED;
    await stocktake.save();

    return this.toPublic(stocktake);
  }

  async cancel(id: string, userId: string, role?: UserRole) {
    const stocktake = await this.getEditableStocktake(id, userId, role);
    stocktake.status = StocktakeStatus.CANCELLED;
    await stocktake.save();
    return this.toPublic(stocktake);
  }
}
