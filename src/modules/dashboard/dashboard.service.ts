import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { UsersService } from '../users/users.service';
import { WarehouseDispatch, WarehouseDispatchDocument } from '../warehouse-dispatches/schemas/warehouse-dispatch.schema';
import { WarehouseDispatchStatus } from '../warehouse-dispatches/enums/warehouse-dispatch-status.enum';
import { WarehouseInventory, WarehouseInventoryDocument } from '../warehouse/schemas/warehouse-inventory.schema';
import {
  WarehouseExpense,
  WarehouseExpenseDocument,
} from '../warehouse/schemas/warehouse-expense.schema';

type Scope = { structureId?: string | undefined };

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(WarehouseInventory.name)
    private readonly inventoryModel: Model<WarehouseInventoryDocument>,
    @InjectModel(WarehouseDispatch.name)
    private readonly dispatchModel: Model<WarehouseDispatchDocument>,
    @InjectModel(WarehouseExpense.name)
    private readonly expenseModel: Model<WarehouseExpenseDocument>,
    private readonly usersService: UsersService,
  ) {}

  private async resolveViewerStructureIdOrFail(userId: string) {
    const user = await this.usersService.findById(userId);
    const structureId = user?.structureId ? String(user.structureId) : null;

    if (!structureId) {
      throw new BadRequestException('Foydalanuvchiga tuzilma biriktirilmagan');
    }

    return structureId;
  }

  private async resolveScope(scope: Scope, userId: string, role?: UserRole) {
    const requested = scope.structureId?.trim();
    const isSuperAdmin = isSuperAdminRole(role);

    if (requested && requested.toLowerCase() === 'all') {
      if (!isSuperAdmin) {
        const viewerStructureId = await this.resolveViewerStructureIdOrFail(userId);
        return { mode: 'single' as const, structureId: viewerStructureId };
      }
      return { mode: 'all' as const, structureId: null as string | null };
    }

    if (requested) {
      if (!Types.ObjectId.isValid(requested)) {
        throw new BadRequestException('Tuzilma ID noto‘g‘ri');
      }

      return { mode: 'single' as const, structureId: requested };
    }

    // default: viewer's structure
    const viewerStructureId = await this.resolveViewerStructureIdOrFail(userId);
    return { mode: 'single' as const, structureId: viewerStructureId };
  }

  private monthKey(date: Date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  private subtractMonths(from: Date, months: number) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    d.setUTCMonth(d.getUTCMonth() - months);
    return d;
  }

  private startOfUtcDay(date: Date) {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private addDays(from: Date, days: number) {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  private dayKey(date: Date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private async getLatestUnitPriceByItemKey(structureId: string) {
    const structureObjectId = new Types.ObjectId(structureId);

    const pipeline: PipelineStage[] = [
      {
        $match: {
          status: { $in: [WarehouseDispatchStatus.PARTIALLY_RECEIVED, WarehouseDispatchStatus.COMPLETED] },
          'targetStructure.structureId': structureObjectId,
        },
      },
      { $sort: { dispatchedAt: -1 } },
      { $unwind: '$items' },
      { $match: { 'items.quantityReceived': { $gt: 0 } } },
      {
        $addFields: {
          _itemKey: {
            $concat: [
              { $toLower: { $trim: { input: '$items.name' } } },
              '|',
              { $toLower: { $trim: { input: '$items.characteristics' } } },
            ],
          },
        },
      },
      {
        $lookup: {
          from: 'purchase_requests',
          localField: 'purchaseRequestId',
          foreignField: '_id',
          as: 'pr',
        },
      },
      { $unwind: '$pr' },
      {
        $project: {
          _id: 0,
          itemKey: '$_itemKey',
          dispatchedAt: 1,
          unitPrice: {
            $ifNull: [
              { $arrayElemAt: ['$pr.items.purchaseAmount', '$items.itemIndex'] },
              null,
            ],
          },
        },
      },
      { $match: { unitPrice: { $ne: null } } },
      {
        $group: {
          _id: '$itemKey',
          unitPrice: { $first: '$unitPrice' },
          dispatchedAt: { $first: '$dispatchedAt' },
        },
      },
      { $project: { _id: 0, itemKey: '$_id', unitPrice: 1, dispatchedAt: 1 } },
    ];

    const rows = await this.dispatchModel.aggregate(pipeline).exec();
    const map = new Map<string, number>();
    for (const row of rows as Array<{ itemKey: string; unitPrice: number }>) {
      if (row?.itemKey && Number.isFinite(row.unitPrice)) {
        map.set(row.itemKey, Math.round(row.unitPrice));
      }
    }
    return map;
  }

  private async getSummaryForStructure(structureId: string) {
    const structureObjectId = new Types.ObjectId(structureId);

    const [inventoryAgg] = await this.inventoryModel
      .aggregate([
        { $match: { structureId: structureObjectId } },
        {
          $group: {
            _id: null,
            itemTypesCount: { $addToSet: '$itemKey' },
            totalQuantity: { $sum: '$quantity' },
          },
        },
        {
          $project: {
            _id: 0,
            itemTypesCount: { $size: '$itemTypesCount' },
            totalQuantity: 1,
          },
        },
      ])
      .exec();

    const itemTypesCount = inventoryAgg?.itemTypesCount ?? 0;
    const totalQuantity = inventoryAgg?.totalQuantity ?? 0;

    // totalSum is approximate: current inventory qty * latest known unit price from receipts
    const prices = await this.getLatestUnitPriceByItemKey(structureId);
    const inventoryItems = await this.inventoryModel
      .find({ structureId: structureObjectId })
      .select('itemKey quantity')
      .exec();

    const totalSum = inventoryItems.reduce((sum, item) => {
      const price = prices.get(item.itemKey) ?? 0;
      const qty = Number(item.quantity) || 0;
      return sum + price * qty;
    }, 0);

    return {
      itemTypesCount,
      totalQuantity,
      totalSum,
    };
  }

  async getSummary(scope: Scope, userId: string, role?: UserRole) {
    const resolved = await this.resolveScope(scope, userId, role);

    if (resolved.mode === 'single') {
      return {
        scope: { structureId: resolved.structureId },
        ...await this.getSummaryForStructure(resolved.structureId),
      };
    }

    // all structures (super-admin)
    const structureIds = (await this.inventoryModel.distinct('structureId').exec()).map(String);

    const summaries = await Promise.all(
      structureIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => this.getSummaryForStructure(id)),
    );

    return {
      scope: { structureId: 'all' },
      itemTypesCount: summaries.reduce((s, r) => s + (r.itemTypesCount ?? 0), 0),
      totalQuantity: summaries.reduce((s, r) => s + (r.totalQuantity ?? 0), 0),
      totalSum: summaries.reduce((s, r) => s + (r.totalSum ?? 0), 0),
    };
  }

  async getMonthlyMaxInventory(
    input: Scope & { months: number },
    userId: string,
    role?: UserRole,
  ) {
    const resolved = await this.resolveScope(input, userId, role);
    const months = input.months ?? 12;
    const now = new Date();
    const from = this.subtractMonths(now, months - 1);

    const buildForStructure = async (structureId: string) => {
      const structureObjectId = new Types.ObjectId(structureId);

      const pipeline: PipelineStage[] = [
        {
          $match: {
            status: { $in: [WarehouseDispatchStatus.PARTIALLY_RECEIVED, WarehouseDispatchStatus.COMPLETED] },
            'targetStructure.structureId': structureObjectId,
            dispatchedAt: { $gte: from },
          },
        },
        { $unwind: '$items' },
        { $match: { 'items.quantityReceived': { $gt: 0 } } },
        {
          $project: {
            month: {
              $dateToString: { format: '%Y-%m', date: '$dispatchedAt' },
            },
            qty: '$items.quantityReceived',
          },
        },
        { $group: { _id: '$month', receivedTotal: { $sum: '$qty' } } },
        { $project: { _id: 0, month: '$_id', receivedTotal: 1 } },
        { $sort: { month: 1 } },
      ];

      const rows = (await this.dispatchModel.aggregate(pipeline).exec()) as Array<{
        month: string;
        receivedTotal: number;
      }>;

      // Fill months with 0 and compute cumulative (max stock, since only receipts increase stock in current model)
      const points: Array<{ month: string; maxQuantity: number; received: number }> = [];
      let running = 0;

      for (let i = 0; i < months; i++) {
        const d = this.subtractMonths(now, months - 1 - i);
        const key = this.monthKey(d);
        const found = rows.find((r) => r.month === key);
        const received = found?.receivedTotal ?? 0;
        running += received;
        points.push({ month: key, maxQuantity: running, received });
      }

      return points;
    };

    if (resolved.mode === 'single') {
      return {
        scope: { structureId: resolved.structureId },
        from,
        to: now,
        points: await buildForStructure(resolved.structureId),
      };
    }

    // all structures: sum cumulative received across all structures month-by-month
    const structureIds = (await this.inventoryModel.distinct('structureId').exec()).map(String);
    const allPointsByStructure = await Promise.all(
      structureIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => buildForStructure(id)),
    );

    const points = Array.from({ length: months }).map((_, idx) => {
      const month = allPointsByStructure[0]?.[idx]?.month ?? this.monthKey(this.subtractMonths(now, months - 1 - idx));
      const maxQuantity = allPointsByStructure.reduce((sum, arr) => sum + (arr[idx]?.maxQuantity ?? 0), 0);
      const received = allPointsByStructure.reduce((sum, arr) => sum + (arr[idx]?.received ?? 0), 0);
      return { month, maxQuantity, received };
    });

    return {
      scope: { structureId: 'all' },
      from,
      to: now,
      points,
    };
  }

  async getDailyMaxInventory(
    input: Scope & { days: number; offsetDays: number },
    userId: string,
    role?: UserRole,
  ) {
    const resolved = await this.resolveScope(input, userId, role);
    const days = input.days ?? 30;
    const offsetDays = input.offsetDays ?? 0;
    const today = this.startOfUtcDay(new Date());
    const to = this.addDays(today, offsetDays);
    const from = this.addDays(to, -(days - 1));
    const toExclusive = this.addDays(to, 1);

    const buildForStructure = async (structureId: string) => {
      const structureObjectId = new Types.ObjectId(structureId);

      const receivedDailyPipeline: PipelineStage[] = [
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
        { $group: { _id: '$day', receivedTotal: { $sum: '$qty' } } },
        { $project: { _id: 0, day: '$_id', receivedTotal: 1 } },
        { $sort: { day: 1 } },
      ];

      const receivedRows = (await this.dispatchModel
        .aggregate(receivedDailyPipeline)
        .exec()) as Array<{
        day: string;
        receivedTotal: number;
      }>;

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
              dispatchedAt: { $lt: from },
            },
          },
          { $unwind: '$items' },
          { $match: { 'items.quantityReceived': { $gt: 0 } } },
          { $group: { _id: null, total: { $sum: '$items.quantityReceived' } } },
          { $project: { _id: 0, total: 1 } },
        ])
        .exec()) as Array<{ total: number }>;

      const expenseDailyRows = (await this.expenseModel
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
          { $group: { _id: '$day', expenseTotal: { $sum: '$qty' } } },
          { $project: { _id: 0, day: '$_id', expenseTotal: 1 } },
          { $sort: { day: 1 } },
        ])
        .exec()) as Array<{ day: string; expenseTotal: number }>;

      const [expenseBeforeAgg] = (await this.expenseModel
        .aggregate([
          {
            $match: {
              structureId: structureObjectId,
              createdAt: { $lt: from },
            },
          },
          { $unwind: '$items' },
          { $group: { _id: null, total: { $sum: '$items.quantity' } } },
          { $project: { _id: 0, total: 1 } },
        ])
        .exec()) as Array<{ total: number }>;

      const points: Array<{ day: string; maxQuantity: number; received: number }> =
        [];
      let running =
        (receivedBeforeAgg?.total ?? 0) - (expenseBeforeAgg?.total ?? 0);

      for (let i = 0; i < days; i++) {
        const d = this.addDays(from, i);
        const key = this.dayKey(d);
        const received =
          receivedRows.find((r) => r.day === key)?.receivedTotal ?? 0;
        const expensed =
          expenseDailyRows.find((r) => r.day === key)?.expenseTotal ?? 0;
        running += received - expensed;
        points.push({ day: key, maxQuantity: running, received });
      }

      return points;
    };

    if (resolved.mode === 'single') {
      return {
        scope: { structureId: resolved.structureId },
        from,
        to,
        points: await buildForStructure(resolved.structureId),
      };
    }

    const structureIds = (
      await this.inventoryModel.distinct('structureId').exec()
    ).map(String);
    const allPointsByStructure = await Promise.all(
      structureIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => buildForStructure(id)),
    );

    const points = Array.from({ length: days }).map((_, idx) => {
      const day =
        allPointsByStructure[0]?.[idx]?.day ?? this.dayKey(this.addDays(from, idx));
      const maxQuantity = allPointsByStructure.reduce(
        (sum, arr) => sum + (arr[idx]?.maxQuantity ?? 0),
        0,
      );
      const received = allPointsByStructure.reduce(
        (sum, arr) => sum + (arr[idx]?.received ?? 0),
        0,
      );
      return { day, maxQuantity, received };
    });

    return {
      scope: { structureId: 'all' },
      from,
      to,
      points,
    };
  }
}

