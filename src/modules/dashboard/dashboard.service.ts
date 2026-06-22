import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { UsersService } from '../users/users.service';
import { DASHBOARD_PAGE_PATH } from '../users/constants/disabled-page-actions';
import { UserPermissionsMap } from '../users/types/page-permission.type';
import { hasPageAccess, hasPageAction } from '../users/utils/permissions.util';
import {
  WarehouseDispatch,
  WarehouseDispatchDocument,
} from '../warehouse-dispatches/schemas/warehouse-dispatch.schema';
import { WarehouseDispatchStatus } from '../warehouse-dispatches/enums/warehouse-dispatch-status.enum';
import {
  WarehouseInventory,
  WarehouseInventoryDocument,
} from '../warehouse/schemas/warehouse-inventory.schema';
import {
  WarehouseExpense,
  WarehouseExpenseDocument,
} from '../warehouse/schemas/warehouse-expense.schema';
import {
  PurchaseRequest,
  PurchaseRequestDocument,
} from '../purchase-requests/schemas/purchase-request.schema';
import { PurchaseRequestStatus } from '../purchase-requests/enums/purchase-request-status.enum';
import {
  DASHBOARD_CALENDAR_EVENT_LABELS,
  DashboardCalendarEvent,
  DashboardCalendarEventType,
} from './dashboard-calendar.types';
import { WarehousePricingService } from '../warehouse/warehouse-pricing.service';

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
    @InjectModel(PurchaseRequest.name)
    private readonly purchaseRequestModel: Model<PurchaseRequestDocument>,
    private readonly usersService: UsersService,
    private readonly warehousePricingService: WarehousePricingService,
  ) {}

  private async resolveViewerStructureIdOrFail(userId: string) {
    const user = await this.usersService.findById(userId);
    const structureId = user?.structureId ? String(user.structureId) : null;

    if (!structureId) {
      throw new BadRequestException('Foydalanuvchiga tuzilma biriktirilmagan');
    }

    return structureId;
  }

  private async canUseDashboardAnalytics(
    userId: string,
    role?: UserRole,
  ): Promise<boolean> {
    if (isSuperAdminRole(role)) {
      return true;
    }

    const user = await this.usersService.findById(userId);

    if (!user) {
      return false;
    }

    const permissions = this.usersService.resolvePermissionsForRole(
      user.role,
      user.permissions as UserPermissionsMap,
    );

    return hasPageAction(permissions, DASHBOARD_PAGE_PATH, 'create', false);
  }

  private async assertDashboardPageAccess(
    userId: string,
    role?: UserRole,
  ) {
    if (isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new ForbiddenException('Foydalanuvchi topilmadi');
    }

    const permissions = this.usersService.resolvePermissionsForRole(
      user.role,
      user.permissions as UserPermissionsMap,
    );

    if (!hasPageAccess(permissions, DASHBOARD_PAGE_PATH, false)) {
      throw new ForbiddenException('Dashboard ko‘rish huquqi yo‘q');
    }
  }

  private async resolveScope(
    scope: Scope,
    userId: string,
    role?: UserRole,
  ) {
    const canUseAnalytics = await this.canUseDashboardAnalytics(userId, role);

    if (!canUseAnalytics) {
      const viewerStructureId = await this.resolveViewerStructureIdOrFail(userId);
      return { mode: 'single' as const, structureId: viewerStructureId };
    }

    const requested = scope.structureId?.trim();

    if (requested && requested.toLowerCase() === 'all') {
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

  private startOfUtcDay(date: Date) {
    const normalized = new Date(date);
    normalized.setUTCHours(0, 0, 0, 0);
    return normalized;
  }

  private isCalendarDayBeforeToday(date: Date) {
    const today = this.startOfUtcDay(new Date());
    return this.startOfUtcDay(date).getTime() < today.getTime();
  }

  private isPurchaseDeadlineOverdue(
    deadline: Date,
    status: PurchaseRequestStatus,
  ) {
    if (status === PurchaseRequestStatus.WAREHOUSE_COMPLETED) {
      return false;
    }

    return this.isCalendarDayBeforeToday(deadline);
  }

  private isDispatchArrivalOverdue(
    plannedAt: Date,
    status: WarehouseDispatchStatus,
  ) {
    if (status === WarehouseDispatchStatus.COMPLETED) {
      return false;
    }

    return this.isCalendarDayBeforeToday(plannedAt);
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

    await this.warehousePricingService.syncInventoryUnitPrices(structureId);

    const prices =
      await this.warehousePricingService.getUnitPriceMapForStructure(
        structureId,
      );
    const inventoryItems = await this.inventoryModel
      .find({ structureId: structureObjectId })
      .select('itemKey quantity unitPrice')
      .exec();

    const totalSum = inventoryItems.reduce((sum, item) => {
      const price =
        Number(item.unitPrice) > 0
          ? Math.round(Number(item.unitPrice))
          : (prices.get(item.itemKey) ?? 0);
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
    await this.assertDashboardPageAccess(userId, role);
    const resolved = await this.resolveScope(scope, userId, role);

    if (resolved.mode === 'single') {
      return {
        scope: { structureId: resolved.structureId },
        ...(await this.getSummaryForStructure(resolved.structureId)),
      };
    }

    // all structures (super-admin)
    const structureIds = (
      await this.inventoryModel.distinct('structureId').exec()
    ).map(String);

    const summaries = await Promise.all(
      structureIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => this.getSummaryForStructure(id)),
    );

    return {
      scope: { structureId: 'all' },
      itemTypesCount: summaries.reduce(
        (s, r) => s + (r.itemTypesCount ?? 0),
        0,
      ),
      totalQuantity: summaries.reduce((s, r) => s + (r.totalQuantity ?? 0), 0),
      totalSum: summaries.reduce((s, r) => s + (r.totalSum ?? 0), 0),
    };
  }

  async getMonthlyMaxInventory(
    input: Scope & { months: number },
    userId: string,
    role?: UserRole,
  ) {
    await this.assertDashboardPageAccess(userId, role);
    const resolved = await this.resolveScope(input, userId, role);
    const months = input.months ?? 12;
    const now = new Date();
    const from = this.subtractMonths(now, months - 1);

    const buildForStructure = async (structureId: string) => {
      const structureObjectId = new Types.ObjectId(structureId);

      const pipeline: PipelineStage[] = [
        {
          $match: {
            status: {
              $in: [
                WarehouseDispatchStatus.PARTIALLY_RECEIVED,
                WarehouseDispatchStatus.COMPLETED,
              ],
            },
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

      const rows = (await this.dispatchModel
        .aggregate(pipeline)
        .exec()) as Array<{
        month: string;
        receivedTotal: number;
      }>;

      // Fill months with 0 and compute cumulative (max stock, since only receipts increase stock in current model)
      const points: Array<{
        month: string;
        maxQuantity: number;
        received: number;
      }> = [];
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
    const structureIds = (
      await this.inventoryModel.distinct('structureId').exec()
    ).map(String);
    const allPointsByStructure = await Promise.all(
      structureIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => buildForStructure(id)),
    );

    const points = Array.from({ length: months }).map((_, idx) => {
      const month =
        allPointsByStructure[0]?.[idx]?.month ??
        this.monthKey(this.subtractMonths(now, months - 1 - idx));
      const maxQuantity = allPointsByStructure.reduce(
        (sum, arr) => sum + (arr[idx]?.maxQuantity ?? 0),
        0,
      );
      const received = allPointsByStructure.reduce(
        (sum, arr) => sum + (arr[idx]?.received ?? 0),
        0,
      );
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
    await this.assertDashboardPageAccess(userId, role);
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

      const points: Array<{
        day: string;
        maxQuantity: number;
        received: number;
      }> = [];
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
        allPointsByStructure[0]?.[idx]?.day ??
        this.dayKey(this.addDays(from, idx));
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

  private parseCalendarDate(value: string, endOfDay = false) {
    const trimmed = value?.trim();
    if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new BadRequestException('Sana formati YYYY-MM-DD bo‘lishi kerak');
    }

    const [year, month, day] = trimmed.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Sana noto‘g‘ri');
    }

    if (endOfDay) {
      date.setUTCHours(23, 59, 59, 999);
    }

    return date;
  }

  private resolvePurchaseDeadlinePath(
    status: PurchaseRequestStatus,
    id: string,
  ) {
    if (status === PurchaseRequestStatus.PURCHASING) {
      return `/xarid-qilish/sotib-olinadigan-tavarlar?detail=${id}`;
    }

    return `/xaridlar/arizalar-tarixi?detail=${id}`;
  }

  async getCalendarEvents(
    input: Scope & { from: string; to: string },
    userId: string,
    role?: UserRole,
  ) {
    await this.assertDashboardPageAccess(userId, role);
    const resolved = await this.resolveScope(input, userId, role);
    const from = this.parseCalendarDate(input.from);
    const to = this.parseCalendarDate(input.to, true);

    if (from > to) {
      throw new BadRequestException(
        'Boshlanish sanasi tugash sanasidan keyin bo‘lishi mumkin emas',
      );
    }

    const structureObjectId =
      resolved.mode === 'single' && resolved.structureId
        ? new Types.ObjectId(resolved.structureId)
        : null;

    const purchaseRequestFilter: Record<string, unknown> = {
      purchaseDeadline: { $gte: from, $lte: to },
      status: {
        $nin: [
          PurchaseRequestStatus.REJECTED,
          PurchaseRequestStatus.WAREHOUSE_COMPLETED,
        ],
      },
    };

    if (structureObjectId) {
      purchaseRequestFilter['applicantStructure.structureId'] =
        structureObjectId;
    }

    const dispatchDateFilter = { $gte: from, $lte: to };
    const dispatchStructureFilter = structureObjectId
      ? {
          $or: [
            { 'targetStructure.structureId': structureObjectId },
            { sourceStructureId: structureObjectId },
          ],
        }
      : {};

    const [purchaseRequests, purchaseDispatches, transferDispatches] =
      await Promise.all([
        this.purchaseRequestModel
          .find(purchaseRequestFilter)
          .select(
            'requestCode purchaseDeadline purchaseDeadlineMandatory status applicantStructure.shortName',
          )
          .lean()
          .exec(),
        this.dispatchModel
          .find({
            purchaseRequestId: { $exists: true, $ne: null },
            plannedArrivalAt: dispatchDateFilter,
            ...dispatchStructureFilter,
          })
          .select(
            'dispatchCode requestCode plannedArrivalAt targetStructure.shortName status',
          )
          .lean()
          .exec(),
        this.dispatchModel
          .find({
            plannedArrivalAt: dispatchDateFilter,
            $or: [{ purchaseRequestId: null }, { requestCode: /^TR-/i }],
            ...dispatchStructureFilter,
          })
          .select(
            'dispatchCode requestCode plannedArrivalAt targetStructure.shortName sourceStructure.shortName status',
          )
          .lean()
          .exec(),
      ]);

    const events: DashboardCalendarEvent[] = [];

    for (const request of purchaseRequests) {
      if (!request.purchaseDeadline) continue;

      const id = String(request._id);
      const overdue = this.isPurchaseDeadlineOverdue(
        request.purchaseDeadline,
        request.status,
      );

      events.push({
        id: `deadline-${id}`,
        type: DashboardCalendarEventType.PURCHASE_DEADLINE,
        date: this.dayKey(request.purchaseDeadline),
        title: request.requestCode,
        subtitle: [
          overdue
            ? 'Kechikkan vazifa'
            : DASHBOARD_CALENDAR_EVENT_LABELS[
                DashboardCalendarEventType.PURCHASE_DEADLINE
              ],
          request.applicantStructure?.shortName,
          request.purchaseDeadlineMandatory ? 'majburiy' : 'ixtiyoriy',
        ]
          .filter(Boolean)
          .join(' · '),
        navigatePath: this.resolvePurchaseDeadlinePath(request.status, id),
        mandatory: Boolean(request.purchaseDeadlineMandatory),
        overdue,
      });
    }

    for (const dispatch of purchaseDispatches) {
      if (!dispatch.plannedArrivalAt) continue;

      const id = String(dispatch._id);
      const overdue = this.isDispatchArrivalOverdue(
        dispatch.plannedArrivalAt,
        dispatch.status,
      );

      events.push({
        id: `purchase-arrival-${id}`,
        type: DashboardCalendarEventType.PURCHASE_ARRIVAL,
        date: this.dayKey(dispatch.plannedArrivalAt),
        title: dispatch.dispatchCode,
        subtitle: [
          overdue
            ? 'Kechikkan vazifa'
            : DASHBOARD_CALENDAR_EVENT_LABELS[
                DashboardCalendarEventType.PURCHASE_ARRIVAL
              ],
          dispatch.requestCode,
          dispatch.targetStructure?.shortName,
        ]
          .filter(Boolean)
          .join(' · '),
        navigatePath: `/xarid-qilish/xaridni-qabul-qilish?dispatch=${id}`,
        overdue,
      });
    }

    for (const dispatch of transferDispatches) {
      if (!dispatch.plannedArrivalAt) continue;

      const id = String(dispatch._id);
      const overdue = this.isDispatchArrivalOverdue(
        dispatch.plannedArrivalAt,
        dispatch.status,
      );

      events.push({
        id: `transfer-arrival-${id}`,
        type: DashboardCalendarEventType.TRANSFER_ARRIVAL,
        date: this.dayKey(dispatch.plannedArrivalAt),
        title: dispatch.dispatchCode,
        subtitle: [
          overdue
            ? 'Kechikkan vazifa'
            : DASHBOARD_CALENDAR_EVENT_LABELS[
                DashboardCalendarEventType.TRANSFER_ARRIVAL
              ],
          dispatch.sourceStructure?.shortName,
          '→',
          dispatch.targetStructure?.shortName,
        ]
          .filter(Boolean)
          .join(' '),
        navigatePath: `/transfer/transferni-qabul-qilish?dispatch=${id}`,
        overdue,
      });
    }

    events.sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    );

    const days: Record<string, Record<string, number>> = {};

    for (const event of events) {
      days[event.date] ??= {};
      days[event.date][event.type] = (days[event.date][event.type] ?? 0) + 1;
      if (event.overdue) {
        days[event.date].OVERDUE = (days[event.date].OVERDUE ?? 0) + 1;
      }
    }

    return {
      scope: {
        structureId: resolved.mode === 'all' ? 'all' : resolved.structureId,
      },
      from: input.from,
      to: input.to,
      events,
      days,
      typeLabels: DASHBOARD_CALENDAR_EVENT_LABELS,
    };
  }
}
