import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MongoServerError } from 'mongodb';
import { UserRole } from '../../common/enums/user-role.enum';
import { appendDateRangeClause } from '../../common/utils/date-range-filter.util';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { PurchaseRequestStatus } from '../purchase-requests/enums/purchase-request-status.enum';
import { PurchaseRequestsService } from '../purchase-requests/purchase-requests.service';
import {
  Sequence,
  SequenceDocument,
} from '../purchase-requests/schemas/sequence.schema';
import { UserSnapshotEmbeddable } from '../purchase-requests/schemas/user-snapshot.schema';
import { PurchaseRequestsEventsService } from '../realtime/purchase-requests-events.service';
import { NotificationsEventsService } from '../notifications/notifications-events.service';
import { StructuresService } from '../structures/structures.service';
import {
  TRANSFER_RECEIPT_PAGE_PATH,
  TRANSFER_HISTORY_PAGE_PATH,
  TRANSFER_PAGE_PATH,
  WAREHOUSE_2D_TRANSFER_VIEW_PAGE_PATHS,
  WAREHOUSE_RECEIPT_PAGE_PATH,
  WAREHOUSES_2D_PAGE_PATH,
} from '../users/constants/disabled-page-actions';
import { UserPermissionsMap } from '../users/types/page-permission.type';
import { UsersService } from '../users/users.service';
import {
  hasAnyPageAccess,
  hasPageAccess,
  normalizePermissions,
} from '../users/utils/permissions.util';
import {
  buildInventoryItemKey,
  inventoryNamesMatch,
  normalizeNomenclatureCode,
  resolveInventoryBarcodeForStorage,
} from '../warehouse/utils/inventory-nomenclature.util';
import { buildWarehouseItemKey } from '../warehouse/utils/item-key.util';
import { computeWarehouseBarcode } from '../warehouse/utils/warehouse-barcode.util';
import { WarehousePricingService } from '../warehouse/warehouse-pricing.service';
import {
  WarehouseInventory,
  WarehouseInventoryDocument,
} from '../warehouse/schemas/warehouse-inventory.schema';
import {
  WarehouseLocation,
  WarehouseLocationDocument,
} from '../warehouse/schemas/warehouse-location.schema';
import { CreateWarehouseDispatchDto } from './dto/create-warehouse-dispatch.dto';
import { QueryWarehouseDispatchInboxDto } from './dto/query-warehouse-dispatch-inbox.dto';
import { ReceiveWarehouseDispatchDto } from './dto/receive-warehouse-dispatch.dto';
import { CreateTransferDispatchDto } from './dto/create-transfer-dispatch.dto';
import { CancelTransferDispatchDto } from './dto/cancel-transfer-dispatch.dto';
import {
  TRANSFER_CANCEL_OTHER_REASON_KEY,
  TRANSFER_CANCEL_REASONS,
  isTransferCancelReasonKey,
} from './constants/transfer-cancel-reasons';
import {
  WAREHOUSE_DISPATCH_STATUS_LABELS,
  WarehouseDispatchStatus,
} from './enums/warehouse-dispatch-status.enum';
import {
  WarehouseDispatch,
  WarehouseDispatchDocument,
} from './schemas/warehouse-dispatch.schema';

const DISPATCH_SEQUENCE_PREFIX = 'dispatch:';

const RECEIVED_DISPATCH_STATUSES = [
  WarehouseDispatchStatus.COMPLETED,
  WarehouseDispatchStatus.PARTIALLY_RECEIVED,
];

@Injectable()
export class WarehouseDispatchesService {
  constructor(
    @InjectModel(WarehouseDispatch.name)
    private readonly dispatchModel: Model<WarehouseDispatchDocument>,
    @InjectModel(Sequence.name)
    private readonly sequenceModel: Model<SequenceDocument>,
    @InjectModel(WarehouseLocation.name)
    private readonly locationModel: Model<WarehouseLocationDocument>,
    @InjectModel(WarehouseInventory.name)
    private readonly inventoryModel: Model<WarehouseInventoryDocument>,
    @Inject(forwardRef(() => PurchaseRequestsService))
    private readonly purchaseRequestsService: PurchaseRequestsService,
    private readonly structuresService: StructuresService,
    private readonly usersService: UsersService,
    private readonly purchaseRequestsEvents: PurchaseRequestsEventsService,
    private readonly notificationsEvents: NotificationsEventsService,
    private readonly warehousePricingService: WarehousePricingService,
  ) {}

  private async nextDispatchCode(shortName: string) {
    const key = `${DISPATCH_SEQUENCE_PREFIX}${shortName}`;
    const sequence = await this.sequenceModel
      .findOneAndUpdate(
        { key },
        { $inc: { value: 1 } },
        { upsert: true, new: true },
      )
      .exec();

    return `NK-${shortName}${String(sequence.value).padStart(4, '0')}`;
  }

  private resolveDispatchNomenclature(dispatch: WarehouseDispatchDocument) {
    return (
      dispatch.confirmedNomenclatureCode?.trim() || dispatch.dispatchCode || ''
    );
  }

  private resolveItemNomenclatureCode(
    dispatch: WarehouseDispatchDocument,
    item: WarehouseDispatchDocument['items'][number],
  ) {
    const fromTransfer = item.sourceNomenclatureCode?.trim();
    if (fromTransfer) {
      return fromTransfer;
    }

    const fromReceipt = item.receiptNomenclatureCode?.trim();
    if (fromReceipt) {
      return fromReceipt;
    }

    if (dispatch.purchaseRequestId) {
      return this.resolveDispatchNomenclature(dispatch);
    }

    return '';
  }

  private async assertNomenclatureCompatibleWithInventory(
    structureId: string,
    locationId: Types.ObjectId,
    nomenclatureCode: string,
    name: string,
  ) {
    const existing = await this.inventoryModel
      .findOne({
        structureId: new Types.ObjectId(structureId),
        locationId,
        receiptNomenclatureCode: nomenclatureCode,
      })
      .select('name')
      .lean()
      .exec();

    if (existing && !inventoryNamesMatch(existing.name, name)) {
      throw new BadRequestException(
        `«${nomenclatureCode}» nomeklatura raqami allaqachon «${existing.name}» tovariga biriktirilgan. Boshqa nom bilan ishlatib bo‘lmaydi.`,
      );
    }
  }

  private buildReceiptInventoryMatchFilters(
    item: WarehouseDispatchDocument['items'][number],
    receiptNomenclatureCode: string,
    itemKey: string,
  ) {
    const legacyBarcode =
      item.sourceBarcode?.trim() ||
      computeWarehouseBarcode(item.name, item.characteristics);
    const legacyItemKey = buildWarehouseItemKey(item.name, item.characteristics);
    const matchFilters: Record<string, unknown>[] = [{ itemKey }];

    if (receiptNomenclatureCode) {
      matchFilters.push({ receiptNomenclatureCode });
      matchFilters.push({ barcode: receiptNomenclatureCode });
    }

    matchFilters.push({ barcode: legacyBarcode });
    matchFilters.push({ itemKey: legacyItemKey });

    return matchFilters;
  }

  private async applyReceiptToInventory(
    receiverStructureId: string,
    locationObjectId: Types.ObjectId,
    item: WarehouseDispatchDocument['items'][number],
    qty: number,
    unitPrice: number,
    now: Date,
  ) {
    const receiptNomenclatureCode = normalizeNomenclatureCode(
      item.receiptNomenclatureCode ?? '',
    );
    const itemKey = buildInventoryItemKey(
      item.name,
      item.characteristics,
      receiptNomenclatureCode,
    );
    const barcode = resolveInventoryBarcodeForStorage(
      item.name,
      item.characteristics,
      item.sourceBarcode,
      receiptNomenclatureCode,
    );
    const structureObjectId = new Types.ObjectId(receiverStructureId);
    const matchFilters = this.buildReceiptInventoryMatchFilters(
      item,
      receiptNomenclatureCode,
      itemKey,
    );

    const setFields: Record<string, unknown> = {
      lastReceiptAt: now,
      name: item.name,
      characteristics: item.characteristics,
    };

    if (unitPrice > 0) {
      setFields.unitPrice = unitPrice;
    }

    if (receiptNomenclatureCode) {
      setFields.receiptNomenclatureCode = receiptNomenclatureCode;
      setFields.itemKey = itemKey;
    }

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
        receiptNomenclatureCode,
      );
      if (existing.barcode?.trim() !== resolvedBarcode) {
        setFields.barcode = resolvedBarcode;
      }

      await this.inventoryModel
        .updateOne(
          { _id: existing._id },
          { $inc: { quantity: qty }, $set: setFields },
        )
        .exec();
      return;
    }

    try {
      await this.inventoryModel.create({
        structureId: structureObjectId,
        locationId: locationObjectId,
        itemKey,
        name: item.name,
        characteristics: item.characteristics,
        barcode,
        ...(receiptNomenclatureCode
          ? { receiptNomenclatureCode }
          : {}),
        quantity: qty,
        unitPrice: unitPrice > 0 ? unitPrice : 0,
        lastReceiptAt: now,
      });
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 11000) {
        existing = await findExisting();

        if (existing) {
          const resolvedBarcode = resolveInventoryBarcodeForStorage(
            item.name,
            item.characteristics,
            existing.barcode,
            receiptNomenclatureCode,
          );
          if (existing.barcode?.trim() !== resolvedBarcode) {
            setFields.barcode = resolvedBarcode;
          }

          await this.inventoryModel
            .updateOne(
              { _id: existing._id },
              { $inc: { quantity: qty }, $set: setFields },
            )
            .exec();
          return;
        }

        throw new BadRequestException(
          'Omborga qabul qilishda nomlar yoki shtrix-kodlar ziddiyatli. Mavjud ombor qatorlarini tekshiring.',
        );
      }

      throw error;
    }
  }

  private buildReceiveInventoryMergeKey(
    item: WarehouseDispatchDocument['items'][number],
  ) {
    const nomenclatureCode = normalizeNomenclatureCode(
      item.receiptNomenclatureCode ?? '',
    );
    if (nomenclatureCode) {
      return `nmk:${nomenclatureCode.toLowerCase()}`;
    }

    return buildWarehouseItemKey(item.name, item.characteristics);
  }

  private async resolvePurchaseNomenclatureByItemKeys(
    structureId: string,
    itemKeys: string[],
  ): Promise<Map<string, string>> {
    const uniqueKeys = [
      ...new Set(itemKeys.map((key) => key.trim()).filter(Boolean)),
    ];
    const map = new Map<string, string>();

    if (!uniqueKeys.length) {
      return map;
    }

    const rows = await this.dispatchModel
      .aggregate<{
        _id: string;
        nomenclatureCode: string;
      }>([
        {
          $match: {
            purchaseRequestId: { $exists: true, $ne: null },
            'targetStructure.structureId': new Types.ObjectId(structureId),
            status: { $in: RECEIVED_DISPATCH_STATUSES },
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
        { $match: { _itemKey: { $in: uniqueKeys } } },
        {
          $group: {
            _id: '$_itemKey',
            nomenclatureCode: {
              $first: {
                $ifNull: [
                  '$items.receiptNomenclatureCode',
                  {
                    $ifNull: ['$confirmedNomenclatureCode', '$dispatchCode'],
                  },
                ],
              },
            },
          },
        },
      ])
      .exec();

    for (const row of rows) {
      const code = row.nomenclatureCode?.trim();
      if (row._id && code) {
        map.set(row._id, code);
      }
    }

    return map;
  }

  private async enrichTransferItemNomenclature(
    dispatch: WarehouseDispatchDocument,
  ) {
    if (!dispatch.sourceStructureId) {
      return;
    }

    const missing = dispatch.items.filter(
      (item) => !item.sourceNomenclatureCode?.trim(),
    );

    if (!missing.length) {
      return;
    }

    const structureId = String(dispatch.sourceStructureId);
    const purchaseMap = await this.resolvePurchaseNomenclatureByItemKeys(
      structureId,
      missing.map((item) =>
        buildWarehouseItemKey(item.name, item.characteristics),
      ),
    );

    let changed = false;

    for (const item of missing) {
      const itemKey = buildWarehouseItemKey(item.name, item.characteristics);
      const fromPurchase = purchaseMap.get(itemKey);

      if (fromPurchase) {
        item.sourceNomenclatureCode = fromPurchase;
        changed = true;
      }
    }

    if (changed) {
      dispatch.markModified('items');
      await dispatch.save();
    }
  }

  private async buildUserSnapshot(
    userId: string,
  ): Promise<UserSnapshotEmbeddable> {
    const user = await this.usersService.findByIdOrFail(userId);
    return {
      userId: new Types.ObjectId(user.id),
      displayName: user.displayName || user.login,
      login: user.login,
      position: user.position?.trim() ?? '',
    };
  }

  private normalizeStructureId(value: unknown): string | null {
    if (value == null || value === '') {
      return null;
    }

    if (value instanceof Types.ObjectId) {
      return value.toHexString();
    }

    if (typeof value === 'object' && value !== null) {
      if ('_id' in value) {
        return this.normalizeStructureId(value._id);
      }

      if (
        typeof (value as { toHexString?: () => string }).toHexString ===
        'function'
      ) {
        return (value as Types.ObjectId).toHexString();
      }
    }

    const raw = String(value).trim();
    if (!raw) {
      return null;
    }

    return Types.ObjectId.isValid(raw)
      ? new Types.ObjectId(raw).toHexString()
      : raw;
  }

  private async getUserStructureId(userId: string): Promise<string | null> {
    const user = await this.usersService.findById(userId);
    if (!user?.structureId) {
      return null;
    }

    return this.normalizeStructureId(user.structureId);
  }

  private buildTransferHistoryStructureOr(structureId: string) {
    const structObj = new Types.ObjectId(structureId);

    return {
      $or: [
        { 'targetStructure.structureId': structObj },
        { sourceStructureId: structObj },
        { 'sourceStructure.structureId': structObj },
      ],
    };
  }

  private isTransferDispatch(dispatch: WarehouseDispatchDocument) {
    return (
      !dispatch.purchaseRequestId ||
      /^TR-/i.test(dispatch.requestCode ?? '') ||
      Boolean(dispatch.sourceStructureId || dispatch.sourceStructure)
    );
  }

  private resolveDispatchSourceStructureId(
    dispatch: WarehouseDispatchDocument,
  ) {
    if (dispatch.sourceStructureId) {
      return this.normalizeStructureId(dispatch.sourceStructureId);
    }

    if (dispatch.sourceStructure?.structureId) {
      return this.normalizeStructureId(dispatch.sourceStructure.structureId);
    }

    return null;
  }

  private async userHasWarehouse2DAccess(userId: string, role?: UserRole) {
    if (isSuperAdminRole(role)) {
      return true;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      return false;
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );

    return hasPageAccess(permissions, WAREHOUSES_2D_PAGE_PATH, false);
  }

  private async assertCanViewTransferHistory(userId: string, role?: UserRole) {
    if (isSuperAdminRole(role)) {
      return;
    }

    const user = await this.usersService.findById(userId);
    if (!user?.isActive) {
      throw new ForbiddenException('Transfer tarixini ko‘rishga ruxsat yo‘q');
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap | undefined,
    );

    if (
      !hasAnyPageAccess(
        permissions,
        WAREHOUSE_2D_TRANSFER_VIEW_PAGE_PATHS,
        false,
      )
    ) {
      throw new ForbiddenException('Transfer tarixini ko‘rishga ruxsat yo‘q');
    }
  }

  private async isDispatchVisibleToUser(
    dispatch: WarehouseDispatchDocument,
    userId: string,
    role?: UserRole,
  ): Promise<boolean> {
    if (isSuperAdminRole(role)) {
      return true;
    }

    if (
      this.isTransferDispatch(dispatch) &&
      (await this.userHasWarehouse2DAccess(userId, role))
    ) {
      return true;
    }

    const structureId = await this.getUserStructureId(userId);
    if (!structureId) {
      return false;
    }

    const userStruct = this.normalizeStructureId(structureId);
    const targetStruct = this.normalizeStructureId(
      dispatch.targetStructure?.structureId,
    );
    const sourceStruct = this.resolveDispatchSourceStructureId(dispatch);

    if (userStruct && targetStruct && userStruct === targetStruct) {
      return true;
    }

    if (userStruct && sourceStruct && userStruct === sourceStruct) {
      return true;
    }

    if (!this.isTransferDispatch(dispatch)) {
      return false;
    }

    const dispatcherId = this.normalizeStructureId(
      dispatch.dispatchedBy?.userId,
    );
    const userIdNorm = this.normalizeStructureId(userId);

    if (dispatcherId && userIdNorm && dispatcherId === userIdNorm) {
      return true;
    }

    const count = await this.dispatchModel
      .countDocuments({
        _id: dispatch._id,
        ...this.buildTransferHistoryStructureOr(structureId),
      })
      .exec();

    return count > 0;
  }

  private async assertCanViewDispatch(
    dispatch: WarehouseDispatchDocument,
    userId: string,
    role?: UserRole,
  ) {
    const visible = await this.isDispatchVisibleToUser(dispatch, userId, role);

    if (!visible) {
      throw new ForbiddenException(
        'Ushbu jo‘natmani faqat qatnashgan tuzilma xodimi ko‘ra oladi',
      );
    }
  }

  private getReceiptPermissionPath(dispatch: WarehouseDispatchDocument) {
    return this.isTransferDispatch(dispatch)
      ? TRANSFER_RECEIPT_PAGE_PATH
      : WAREHOUSE_RECEIPT_PAGE_PATH;
  }

  private async assertReceiverAsync(
    dispatch: WarehouseDispatchDocument,
    userId: string,
    role?: UserRole,
  ) {
    if (isSuperAdminRole(role)) {
      return;
    }

    const userStructureId = await this.getUserStructureId(userId);

    if (
      !userStructureId ||
      userStructureId !== String(dispatch.targetStructure.structureId)
    ) {
      throw new ForbiddenException(
        'Faqat qabul qiluvchi tuzilma xodimi qabul qila oladi',
      );
    }

    const user = await this.usersService.findById(userId);

    if (!user?.isActive) {
      throw new ForbiddenException('Qabul qilish uchun ruxsat yo‘q');
    }

    const permissions = normalizePermissions(
      user.permissions as UserPermissionsMap,
    );
    const receiptPath = this.getReceiptPermissionPath(dispatch);

    if (!hasPageAccess(permissions, receiptPath, false)) {
      throw new ForbiddenException('Qabul qilish uchun ruxsat yo‘q');
    }
  }

  private recomputeDispatchStatus(dispatch: WarehouseDispatchDocument) {
    const allDone = dispatch.items.every((item) => {
      const pending =
        item.quantityDispatched - item.quantityReceived - item.quantityRejected;

      return pending <= 0;
    });

    if (allDone) {
      const anyReceived = dispatch.items.some(
        (item) => item.quantityReceived > 0,
      );

      dispatch.status = anyReceived
        ? WarehouseDispatchStatus.COMPLETED
        : WarehouseDispatchStatus.COMPLETED;

      return;
    }

    const anyReceived = dispatch.items.some(
      (item) => item.quantityReceived > 0,
    );

    dispatch.status = anyReceived
      ? WarehouseDispatchStatus.PARTIALLY_RECEIVED
      : WarehouseDispatchStatus.PENDING_RECEIPT;
  }

  private toPublic(
    dispatch: WarehouseDispatchDocument,
    viewerUserId?: string,
    viewerRole?: UserRole,
  ) {
    const pendingTotal = dispatch.items.reduce((sum, item) => {
      const pending =
        item.quantityDispatched - item.quantityReceived - item.quantityRejected;

      return sum + Math.max(0, pending);
    }, 0);

    const receivedTotal = dispatch.items.reduce(
      (sum, item) => sum + item.quantityReceived,
      0,
    );

    return {
      id: dispatch.id,
      dispatchCode: dispatch.dispatchCode,
      purchaseRequestId: dispatch.purchaseRequestId
        ? String(dispatch.purchaseRequestId)
        : null,
      requestCode: dispatch.requestCode,
      status: dispatch.status,
      statusLabel: WAREHOUSE_DISPATCH_STATUS_LABELS[dispatch.status],
      targetStructure: {
        structureId: String(dispatch.targetStructure.structureId),
        fullName: dispatch.targetStructure.fullName,
        shortName: dispatch.targetStructure.shortName,
      },
      sourceStructure: dispatch.sourceStructure
        ? {
            structureId: String(dispatch.sourceStructure.structureId),
            fullName: dispatch.sourceStructure.fullName,
            shortName: dispatch.sourceStructure.shortName,
          }
        : null,
      items: dispatch.items.map((item) => {
        const pending =
          item.quantityDispatched -
          item.quantityReceived -
          item.quantityRejected;

        return {
          itemIndex: item.itemIndex,
          name: item.name,
          characteristics: item.characteristics,
          barcode:
            item.sourceBarcode?.trim() ||
            computeWarehouseBarcode(item.name, item.characteristics),
          nomenclatureCode: this.resolveItemNomenclatureCode(dispatch, item),
          quantityDispatched: item.quantityDispatched,
          quantityReceived: item.quantityReceived,
          quantityRejected: item.quantityRejected,
          quantityPending: Math.max(0, pending),
          rejectReason: item.rejectReason,
        };
      }),
      plannedArrivalAt: dispatch.plannedArrivalAt ?? null,
      dispatchedBy: {
        userId: String(dispatch.dispatchedBy.userId),
        displayName: dispatch.dispatchedBy.displayName,
        login: dispatch.dispatchedBy.login,
      },
      dispatchedAt: dispatch.dispatchedAt,
      isSeenByReceiver: dispatch.isSeenByReceiver,
      pendingTotal,
      receivedTotal,
      canReceive:
        pendingTotal > 0 &&
        dispatch.status !== WarehouseDispatchStatus.COMPLETED &&
        dispatch.status !== WarehouseDispatchStatus.CANCELLED,
      canCancel:
        dispatch.status === WarehouseDispatchStatus.PENDING_RECEIPT &&
        pendingTotal > 0 &&
        dispatch.items.every((item) => item.quantityReceived <= 0),
      cancelReasonKey: dispatch.cancelReasonKey?.trim() || null,
      cancelReasonLabel: dispatch.cancelReasonLabel?.trim() || null,
      cancelReasonOther: dispatch.cancelReasonOther?.trim() || null,
      cancelledAt: dispatch.cancelledAt ?? null,
      cancelledBy: dispatch.cancelledBy
        ? {
            userId: String(dispatch.cancelledBy.userId),
            displayName: dispatch.cancelledBy.displayName,
            login: dispatch.cancelledBy.login,
          }
        : null,
      createdAt: dispatch.createdAt,
      updatedAt: dispatch.updatedAt,
    };
  }

  private resolveBatchItemIndexes(
    request: Awaited<
      ReturnType<PurchaseRequestsService['findByIdOrFail']>
    >,
    purchaseBatchId?: string,
  ) {
    if (!purchaseBatchId) {
      return request.items
        .map((item, itemIndex) => ({ item, itemIndex }))
        .filter(({ item }) => item.isPurchased)
        .map(({ itemIndex }) => itemIndex);
    }

    if (purchaseBatchId === 'legacy') {
      return request.items
        .map((item, itemIndex) => ({ item, itemIndex }))
        .filter(({ item }) => item.isPurchased)
        .map(({ itemIndex }) => itemIndex);
    }

    return request.items
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(
        ({ item }) =>
          item.isPurchased && item.purchaseBatchId === purchaseBatchId,
      )
      .map(({ itemIndex }) => itemIndex);
  }

  private async syncPurchaseRequestWarehouseStatus(requestId: string) {
    const request =
      await this.purchaseRequestsService.findByIdOrFail(requestId);
    const dispatches = await this.findAllByPurchaseRequestId(requestId);
    const hasPendingPurchaseItems = request.items.some(
      (item) => !item.isPurchased && !item.isPurchaseUnavailable,
    );

    if (hasPendingPurchaseItems) {
      if (request.status !== PurchaseRequestStatus.PURCHASING) {
        request.status = PurchaseRequestStatus.PURCHASING;
        await request.save();
        this.purchaseRequestsEvents.notifyChanged(request, 'updated');
        void this.notificationsEvents.handlePurchaseRequestChanged(
          request,
          'updated',
        );
      }

      return;
    }

    const purchasedBatchIds = new Set(
      request.items
        .filter((item) => item.isPurchased)
        .map((item) => item.purchaseBatchId ?? 'legacy'),
    );

    if (!purchasedBatchIds.size) {
      return;
    }

    const dispatchedBatchIds = new Set(
      dispatches
        .map((dispatch) => dispatch.purchaseBatchId)
        .filter((batchId): batchId is string => Boolean(batchId)),
    );

    const allPurchasedBatchesDispatched = [...purchasedBatchIds].every(
      (batchId) => dispatchedBatchIds.has(batchId),
    );

    if (!allPurchasedBatchesDispatched) {
      if (request.status === PurchaseRequestStatus.PURCHASED) {
        return;
      }

      return;
    }

    const allDispatchesCompleted = dispatches.every(
      (dispatch) => dispatch.status === WarehouseDispatchStatus.COMPLETED,
    );

    request.status = allDispatchesCompleted
      ? PurchaseRequestStatus.WAREHOUSE_COMPLETED
      : PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT;

    await request.save();
    this.purchaseRequestsEvents.notifyChanged(request, 'updated');
    void this.notificationsEvents.handlePurchaseRequestChanged(
      request,
      'updated',
    );
  }

  async create(
    dto: CreateWarehouseDispatchDto,
    userId: string,
    role?: UserRole,
  ) {
    const request = await this.purchaseRequestsService.findByIdOrFail(
      dto.purchaseRequestId,
      userId,
      role,
      { purchasingView: true },
    );

    const allowedStatuses = [
      PurchaseRequestStatus.PURCHASING,
      PurchaseRequestStatus.PURCHASED,
      PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT,
    ];

    if (!allowedStatuses.includes(request.status)) {
      throw new BadRequestException(
        'Ushbu arizani hozir omborga jo‘natish mumkin emas',
      );
    }

    const purchaseBatchId = dto.purchaseBatchId?.trim() || undefined;
    const batchItemIndexes = this.resolveBatchItemIndexes(
      request,
      purchaseBatchId,
    );

    if (!batchItemIndexes.length) {
      throw new BadRequestException(
        'Tanlangan partiyada omborga jo‘natiladigan tovarlar yo‘q',
      );
    }

    const existingFilter: Record<string, unknown> = {
      purchaseRequestId: request._id,
    };

    if (purchaseBatchId) {
      existingFilter.purchaseBatchId = purchaseBatchId;
    } else {
      existingFilter.purchaseBatchId = { $exists: false };
    }

    const existing = await this.dispatchModel.findOne(existingFilter).exec();

    if (existing) {
      throw new BadRequestException(
        purchaseBatchId
          ? 'Ushbu xarid partiyasi allaqachon omborga jo‘natilgan'
          : 'Ushbu ariza allaqachon omborga jo‘natilgan',
      );
    }

    await this.structuresService.assertHasWarehouse(dto.structureId);
    const structureSnapshot = await this.structuresService.buildSnapshot(
      dto.structureId,
    );

    const dispatcher = await this.buildUserSnapshot(userId);
    const now = new Date();
    const dispatchCode = await this.nextDispatchCode(
      structureSnapshot.shortName,
    );

    let plannedArrivalAt: Date | undefined;

    if (dto.plannedArrivalAt?.trim()) {
      const parsed = new Date(dto.plannedArrivalAt);

      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Rejalashtirilgan sana noto‘g‘ri');
      }

      plannedArrivalAt = parsed;
    }

    const dispatch = await this.dispatchModel.create({
      dispatchCode,
      purchaseRequestId: request._id,
      requestCode: request.requestCode,
      purchaseBatchId,
      status: WarehouseDispatchStatus.PENDING_RECEIPT,
      targetStructure: {
        structureId: new Types.ObjectId(structureSnapshot.structureId),
        fullName: structureSnapshot.fullName,
        shortName: structureSnapshot.shortName,
        capturedAt: structureSnapshot.capturedAt,
      },
      items: batchItemIndexes.map((itemIndex) => {
        const item = request.items[itemIndex]!;

        return {
          itemIndex,
          name: item.name,
          characteristics:
            item.characteristics?.trim() ||
            item.originalRequestedItem?.characteristics?.trim() ||
            '—',
          quantityDispatched: item.quantity,
          quantityReceived: 0,
          quantityRejected: 0,
          rejectReason: '',
          unitPrice: Math.max(
            0,
            Math.round(Number(item.purchaseAmount) || 0) +
              Math.round(Number(item.purchaseVatAmount) || 0),
          ),
        };
      }),
      plannedArrivalAt,
      dispatchedBy: dispatcher,
      dispatchedAt: now,
      isSeenByReceiver: false,
    });

    await this.syncPurchaseRequestWarehouseStatus(String(request._id));

    this.purchaseRequestsEvents.notifyChanged(request, 'updated');
    void this.notificationsEvents.handleWarehouseReceiptCreated(
      dispatch,
      request.requestCode,
    );

    return this.toPublic(dispatch, userId, role);
  }

  async createTransfer(
    dto: CreateTransferDispatchDto,
    userId: string,
    role?: UserRole,
  ) {
    const senderStructureId = await this.getUserStructureId(userId);
    if (!senderStructureId) {
      throw new BadRequestException('Foydalanuvchiga tuzilma biriktirilmagan');
    }

    await this.structuresService.assertHasWarehouse(senderStructureId);
    await this.structuresService.assertHasWarehouse(dto.structureId);

    const targetStructure = await this.structuresService.buildSnapshot(
      dto.structureId,
    );
    const sourceStructure =
      await this.structuresService.buildSnapshot(senderStructureId);
    const dispatcher = await this.buildUserSnapshot(userId);
    const now = new Date();
    const dispatchCode = await this.nextDispatchCode(targetStructure.shortName);

    const normalizedItems = (dto.items ?? [])
      .map((item) => ({
        locationId: item.locationId?.trim(),
        barcode: item.barcode?.trim(),
        quantity: Number(item.quantity),
      }))
      .filter((item) => item.locationId && item.barcode && item.quantity > 0);

    if (!normalizedItems.length) {
      throw new BadRequestException('Transfer uchun tovarlar kiritilmagan');
    }

    const mergedByKey = new Map<
      string,
      { locationId: string; barcode: string; quantity: number }
    >();
    for (const item of normalizedItems) {
      const key = `${item.locationId}|${item.barcode}`;
      const existing = mergedByKey.get(key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        mergedByKey.set(key, {
          locationId: item.locationId,
          barcode: item.barcode,
          quantity: item.quantity,
        });
      }
    }

    const mergedItems = Array.from(mergedByKey.values());
    const inventories = await this.inventoryModel
      .find({
        structureId: new Types.ObjectId(senderStructureId),
        $or: mergedItems.map((item) => ({
          locationId: new Types.ObjectId(item.locationId),
          barcode: item.barcode,
        })),
      })
      .select(
        'name characteristics barcode quantity locationId itemKey unitPrice receiptNomenclatureCode',
      )
      .exec();

    if (inventories.length !== mergedItems.length) {
      throw new BadRequestException('Ba’zi tovarlar omborda topilmadi');
    }

    const senderPriceMap =
      await this.warehousePricingService.getUnitPriceMapForStructure(
        senderStructureId,
      );

    const byLocationAndBarcode = new Map(
      inventories.map((inv) => [
        `${String(inv.locationId)}|${inv.barcode}`,
        inv,
      ]),
    );

    for (const item of mergedItems) {
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

    const nowUpdate = new Date();
    const bulkOps = mergedItems.map((item) => ({
      updateOne: {
        filter: {
          structureId: new Types.ObjectId(senderStructureId),
          locationId: new Types.ObjectId(item.locationId),
          barcode: item.barcode,
          quantity: { $gte: item.quantity },
        },
        update: {
          $inc: { quantity: -item.quantity },
          $set: { updatedAt: nowUpdate },
        },
      },
    }));

    const bulkResult = await this.inventoryModel.collection.bulkWrite(bulkOps, {
      ordered: true,
    });
    const modified = bulkResult.modifiedCount ?? 0;
    if (modified !== mergedItems.length) {
      throw new BadRequestException(
        'Transferni bajarib bo‘lmadi (miqdor yetarli emas)',
      );
    }

    let plannedArrivalAt: Date | undefined;
    if (dto.plannedArrivalAt?.trim()) {
      const parsed = new Date(dto.plannedArrivalAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Rejalashtirilgan sana noto‘g‘ri');
      }
      plannedArrivalAt = parsed;
    }

    const missingNomenclatureKeys = mergedItems
      .map((item) => {
        const inv = byLocationAndBarcode.get(
          `${item.locationId}|${item.barcode}`,
        );
        if (!inv || inv.receiptNomenclatureCode?.trim()) {
          return null;
        }
        return buildWarehouseItemKey(inv.name, inv.characteristics);
      })
      .filter((key): key is string => Boolean(key));
    const purchaseNomenclatureMap =
      await this.resolvePurchaseNomenclatureByItemKeys(
        senderStructureId,
        missingNomenclatureKeys,
      );

    const dispatch = await this.dispatchModel.create({
      dispatchCode,
      purchaseRequestId: null,
      requestCode: `TR-${dispatchCode}`,
      status: WarehouseDispatchStatus.PENDING_RECEIPT,
      sourceStructureId: new Types.ObjectId(senderStructureId),
      sourceStructure: {
        structureId: new Types.ObjectId(sourceStructure.structureId),
        fullName: sourceStructure.fullName,
        shortName: sourceStructure.shortName,
        capturedAt: sourceStructure.capturedAt,
      },
      targetStructure: {
        structureId: new Types.ObjectId(targetStructure.structureId),
        fullName: targetStructure.fullName,
        shortName: targetStructure.shortName,
        capturedAt: targetStructure.capturedAt,
      },
      items: mergedItems.map((item, itemIndex) => {
        const inv = byLocationAndBarcode.get(
          `${item.locationId}|${item.barcode}`,
        )!;
        const unitPrice = this.warehousePricingService.resolveUnitPriceFromMap(
          senderPriceMap,
          inv.itemKey,
          inv.unitPrice,
        );
        const sourceNomenclatureCode =
          inv.receiptNomenclatureCode?.trim() ||
          purchaseNomenclatureMap.get(inv.itemKey) ||
          '';
        return {
          itemIndex,
          name: inv.name,
          characteristics: inv.characteristics,
          quantityDispatched: item.quantity,
          quantityReceived: 0,
          quantityRejected: 0,
          rejectReason: '',
          sourceLocationId: new Types.ObjectId(item.locationId),
          sourceBarcode: item.barcode,
          sourceNomenclatureCode: sourceNomenclatureCode || undefined,
          unitPrice,
        };
      }),
      plannedArrivalAt,
      dispatchedBy: dispatcher,
      dispatchedAt: now,
      isSeenByReceiver: false,
    });

    void this.notificationsEvents.handleTransferCreated(dispatch);

    return this.toPublic(dispatch, userId, role);
  }

  async findByIdOrFail(id: string) {
    const dispatch = await this.dispatchModel.findById(id).exec();

    if (!dispatch) {
      throw new NotFoundException('Ombor jo‘natmasi topilmadi');
    }

    return dispatch;
  }

  async findByIdPublic(
    id: string,
    userId: string,
    role?: UserRole,
    options?: { markSeen?: boolean; source?: string; scope?: string },
  ) {
    const dispatch = await this.findByIdOrFail(id);
    await this.assertCanViewDispatch(dispatch, userId, role);

    if (options?.markSeen && !dispatch.isSeenByReceiver) {
      const userStructureId = await this.getUserStructureId(userId);
      const targetStructureId = this.normalizeStructureId(
        dispatch.targetStructure.structureId,
      );

      if (userStructureId && userStructureId === targetStructureId) {
        dispatch.isSeenByReceiver = true;
        await dispatch.save();
      }
    }

    if (dispatch.sourceStructureId) {
      await this.enrichTransferItemNomenclature(dispatch);
    }

    const user = await this.usersService.findById(userId);
    const userStructureId = await this.getUserStructureId(userId);
    const result: ReturnType<WarehouseDispatchesService['toPublic']> & {
      ishonchnoma?: ReturnType<
        PurchaseRequestsService['getPurchaseBatchIshonchnomaForWarehouse']
      >['ishonchnoma'];
      ishonchnomaSubmitted?: boolean;
    } = this.toPublic(dispatch, userId, role);

    if (dispatch.purchaseRequestId) {
      const request = await this.purchaseRequestsService
        .findByIdOrFail(String(dispatch.purchaseRequestId))
        .catch(() => null);

      if (request) {
        const ishonchnomaMeta =
          this.purchaseRequestsService.getPurchaseBatchIshonchnomaForWarehouse(
            request,
            dispatch.purchaseBatchId,
          );
        result.ishonchnoma = ishonchnomaMeta.ishonchnoma;
        result.ishonchnomaSubmitted = ishonchnomaMeta.ishonchnomaSubmitted;
      }
    }

    result.canCancel = this.resolveViewerCanCancelTransfer(
      dispatch,
      userId,
      role,
      userStructureId,
    );

    return result;
  }

  async findReceiptInboxPaginated(
    query: QueryWarehouseDispatchInboxDto,
    userId: string,
    role?: UserRole,
  ) {
    if (query.source === 'transfer' && query.scope === 'history') {
      await this.assertCanViewTransferHistory(userId, role);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const clauses: Record<string, unknown>[] = [];

    const historyStatuses = [
      WarehouseDispatchStatus.PENDING_RECEIPT,
      WarehouseDispatchStatus.PARTIALLY_RECEIVED,
      WarehouseDispatchStatus.COMPLETED,
      WarehouseDispatchStatus.CANCELLED,
    ];
    const receiptStatuses = [
      WarehouseDispatchStatus.PENDING_RECEIPT,
      WarehouseDispatchStatus.PARTIALLY_RECEIVED,
      WarehouseDispatchStatus.COMPLETED,
    ];

    clauses.push({
      status: {
        $in:
          query.source === 'transfer' && query.scope === 'history'
            ? historyStatuses
            : receiptStatuses,
      },
    });

    if (query.source === 'transfer') {
      clauses.push({
        $or: [{ purchaseRequestId: null }, { requestCode: /^TR-/i }],
      });
    }

    if (!isSuperAdminRole(role)) {
      const structureId = await this.getUserStructureId(userId);
      const canViewAllTransfersFor2D = await this.userHasWarehouse2DAccess(
        userId,
        role,
      );

      if (
        query.source === 'transfer' &&
        query.scope === 'history'
      ) {
        if (!structureId && !canViewAllTransfersFor2D) {
          return { items: [], total: 0, page, limit, totalPages: 1 };
        }
      } else if (!structureId && !canViewAllTransfersFor2D) {
        return { items: [], total: 0, page, limit, totalPages: 1 };
      }

      if (
        query.source !== 'transfer' ||
        query.scope !== 'history'
      ) {
        if (structureId) {
          clauses.push({
            'targetStructure.structureId': new Types.ObjectId(structureId),
          });
        }
      }
    }

    if (query.structureId?.trim()) {
      const filterStruct = new Types.ObjectId(query.structureId.trim());
      clauses.push({
        $or: [
          { 'targetStructure.structureId': filterStruct },
          { sourceStructureId: filterStruct },
          { 'sourceStructure.structureId': filterStruct },
        ],
      });
    }

    appendDateRangeClause(
      clauses,
      'dispatchedAt',
      query.dateFrom,
      query.dateTo,
    );

    const term = query.search?.trim();

    if (term) {
      const regex = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      clauses.push({
        $or: [
          { dispatchCode: regex },
          { requestCode: regex },
          { 'targetStructure.shortName': regex },
          { 'targetStructure.fullName': regex },
          { 'sourceStructure.shortName': regex },
          { 'sourceStructure.fullName': regex },
        ],
      });
    }

    const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };

    const [items, total] = await Promise.all([
      this.dispatchModel
        .find(filter)
        .sort({ isSeenByReceiver: 1, dispatchedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.dispatchModel.countDocuments(filter).exec(),
    ]);

    const userStructureId = await this.getUserStructureId(userId);

    return {
      items: items.map((item) => {
        const result = this.toPublic(item, userId, role);
        result.canCancel = this.resolveViewerCanCancelTransfer(
          item,
          userId,
          role,
          userStructureId,
        );
        return result;
      }),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async countPendingReceipt(userId: string, role?: UserRole) {
    const filter: Record<string, unknown> = {
      status: {
        $in: [
          WarehouseDispatchStatus.PENDING_RECEIPT,
          WarehouseDispatchStatus.PARTIALLY_RECEIVED,
        ],
      },
      isSeenByReceiver: false,
    };

    if (!isSuperAdminRole(role)) {
      const structureId = await this.getUserStructureId(userId);

      if (!structureId) {
        return 0;
      }

      filter['targetStructure.structureId'] = new Types.ObjectId(structureId);
    }

    return this.dispatchModel.countDocuments(filter).exec();
  }

  async receive(
    id: string,
    dto: ReceiveWarehouseDispatchDto,
    userId: string,
    role?: UserRole,
  ) {
    const dispatch = await this.findByIdOrFail(id);
    await this.assertReceiverAsync(dispatch, userId, role);

    const receiverStructureId = String(dispatch.targetStructure.structureId);
    const activeLocationsCount = await this.locationModel.countDocuments({
      structureId: new Types.ObjectId(receiverStructureId),
      isActive: true,
    });

    let locationObjectId: Types.ObjectId | null = null;

    if (activeLocationsCount > 0) {
      if (!dto.locationId?.trim()) {
        throw new BadRequestException('Ombor joyi tanlanishi shart');
      }

      const location = await this.locationModel
        .findOne({
          _id: new Types.ObjectId(dto.locationId),
          structureId: new Types.ObjectId(receiverStructureId),
          isActive: true,
        })
        .select('_id')
        .exec();

      if (!location) {
        throw new BadRequestException('Ombor joyi noto‘g‘ri');
      }

      locationObjectId = location._id;
    }

    if (dispatch.status === WarehouseDispatchStatus.CANCELLED) {
      throw new BadRequestException('Transfer bekor qilingan');
    }

    if (
      dispatch.status === WarehouseDispatchStatus.COMPLETED &&
      dispatch.items.every(
        (item) =>
          item.quantityDispatched -
            item.quantityReceived -
            item.quantityRejected <=
          0,
      )
    ) {
      throw new BadRequestException('Jo‘natma allaqachon yakunlangan');
    }

    const incomingNomenclature = dto.nomenclatureCode?.trim();
    if (incomingNomenclature && dispatch.purchaseRequestId) {
      if (!dispatch.confirmedNomenclatureCode) {
        dispatch.confirmedNomenclatureCode = incomingNomenclature;
      }
    }

    const requiresItemNomenclature = Boolean(dispatch.purchaseRequestId);

    for (const received of dto.receivedItems ?? []) {
      const item = dispatch.items.find(
        (row) => row.itemIndex === received.itemIndex,
      );

      if (!item) {
        throw new BadRequestException('Tovar topilmadi');
      }

      const pending =
        item.quantityDispatched - item.quantityReceived - item.quantityRejected;

      if (
        received.quantityReceived < 1 ||
        received.quantityReceived > pending
      ) {
        throw new BadRequestException(
          `«${item.name}» uchun qabul miqdori noto‘g‘ri (qolgan: ${pending})`,
        );
      }

      const incomingItemNomenclature = requiresItemNomenclature
        ? received.nomenclatureCode?.trim() || ''
        : received.nomenclatureCode?.trim() ||
          item.receiptNomenclatureCode?.trim() ||
          this.resolveItemNomenclatureCode(dispatch, item);

      if (requiresItemNomenclature && !incomingItemNomenclature) {
        throw new BadRequestException(
          `«${item.name}» uchun nomeklatura raqamini kiriting`,
        );
      }

      if (incomingItemNomenclature) {
        item.receiptNomenclatureCode = incomingItemNomenclature;
      }

      item.quantityReceived += received.quantityReceived;
    }

    const sourceStructureIdForPricing = dispatch.sourceStructureId
      ? String(dispatch.sourceStructureId)
      : null;

    if (locationObjectId) {
      const now = new Date();
      const receivedByIndex = new Map<number, number>();

      for (const received of dto.receivedItems ?? []) {
        if (received.quantityReceived > 0) {
          receivedByIndex.set(received.itemIndex, received.quantityReceived);
        }
      }

      const mergedByKey = new Map<
        string,
        { item: (typeof dispatch.items)[0]; qty: number; unitPrice: number }
      >();

      for (const item of dispatch.items) {
        if (!receivedByIndex.has(item.itemIndex)) continue;

        const qty = receivedByIndex.get(item.itemIndex) ?? 0;
        const mergeKey = this.buildReceiveInventoryMergeKey(item);
        let unitPrice = Math.max(0, Math.round(Number(item.unitPrice) || 0));

        if (unitPrice <= 0) {
          unitPrice =
            await this.warehousePricingService.resolveTransferItemUnitPrice(
              item,
              sourceStructureIdForPricing,
            );
        }

        if (unitPrice > 0 && (Number(item.unitPrice) || 0) <= 0) {
          item.unitPrice = unitPrice;
        }

        const existing = mergedByKey.get(mergeKey);

        if (existing) {
          const nomenclatureCode = normalizeNomenclatureCode(
            item.receiptNomenclatureCode ?? '',
          );
          if (
            nomenclatureCode &&
            !inventoryNamesMatch(existing.item.name, item.name)
          ) {
            throw new BadRequestException(
              `«${nomenclatureCode}» nomeklatura raqami bir xil bo‘lishi kerak, lekin turli nomlar kiritilgan: «${existing.item.name}» va «${item.name}».`,
            );
          }

          existing.qty += qty;
          if (unitPrice > 0) {
            existing.unitPrice = unitPrice;
          }
        } else {
          mergedByKey.set(mergeKey, { item, qty, unitPrice });
        }
      }

      const nomenclatureNameInBatch = new Map<string, string>();
      for (const { item } of mergedByKey.values()) {
        const nomenclatureCode = normalizeNomenclatureCode(
          item.receiptNomenclatureCode ?? '',
        );
        if (!nomenclatureCode) {
          continue;
        }

        const previousName = nomenclatureNameInBatch.get(nomenclatureCode);
        if (previousName && !inventoryNamesMatch(previousName, item.name)) {
          throw new BadRequestException(
            `«${nomenclatureCode}» nomeklatura raqami bir xil bo‘lishi kerak, lekin turli nomlar kiritilgan: «${previousName}» va «${item.name}».`,
          );
        }

        nomenclatureNameInBatch.set(nomenclatureCode, item.name);
        await this.assertNomenclatureCompatibleWithInventory(
          receiverStructureId,
          locationObjectId,
          nomenclatureCode,
          item.name,
        );
      }

      for (const { item, qty, unitPrice } of mergedByKey.values()) {
        await this.applyReceiptToInventory(
          receiverStructureId,
          locationObjectId,
          item,
          qty,
          unitPrice,
          now,
        );
      }
    }

    for (const rejected of dto.rejectedItems ?? []) {
      const item = dispatch.items.find(
        (row) => row.itemIndex === rejected.itemIndex,
      );

      if (!item) {
        throw new BadRequestException('Tovar topilmadi');
      }

      const pending =
        item.quantityDispatched - item.quantityReceived - item.quantityRejected;

      if (
        rejected.quantityRejected < 1 ||
        rejected.quantityRejected > pending ||
        !rejected.reason?.trim()
      ) {
        throw new BadRequestException(
          `«${item.name}» uchun rad etish ma’lumotlari noto‘g‘ri`,
        );
      }

      item.quantityRejected += rejected.quantityRejected;
      item.rejectReason = rejected.reason.trim();
    }

    const sourceStructureId = dispatch.sourceStructureId
      ? String(dispatch.sourceStructureId)
      : null;
    if (sourceStructureId && dto.rejectedItems?.length) {
      const mergedReturns = new Map<
        string,
        {
          locationId: Types.ObjectId;
          sourceBarcode: string;
          name: string;
          characteristics: string;
          qty: number;
        }
      >();

      for (const rejected of dto.rejectedItems) {
        if (!rejected.quantityRejected || rejected.quantityRejected < 1)
          continue;
        const item = dispatch.items.find(
          (row) => row.itemIndex === rejected.itemIndex,
        );
        if (!item?.sourceLocationId || !item.sourceBarcode?.trim()) continue;

        const key = `${String(item.sourceLocationId)}|${item.sourceBarcode}`;
        const existing = mergedReturns.get(key);
        if (existing) {
          existing.qty += rejected.quantityRejected;
        } else {
          mergedReturns.set(key, {
            locationId: item.sourceLocationId,
            sourceBarcode: item.sourceBarcode,
            name: item.name,
            characteristics: item.characteristics,
            qty: rejected.quantityRejected,
          });
        }
      }

      const returnOps = Array.from(mergedReturns.values()).map((row) => ({
        updateOne: {
          filter: {
            structureId: new Types.ObjectId(sourceStructureId),
            locationId: row.locationId,
            barcode: row.sourceBarcode,
          },
          update: {
            $setOnInsert: {
              structureId: new Types.ObjectId(sourceStructureId),
              locationId: row.locationId,
              itemKey: buildWarehouseItemKey(row.name, row.characteristics),
              name: row.name,
              characteristics: row.characteristics,
              barcode: row.sourceBarcode,
            },
            $inc: { quantity: row.qty },
            $set: { updatedAt: new Date() },
          },
          upsert: true,
        },
      }));

      if (returnOps.length) {
        await this.inventoryModel.collection.bulkWrite(returnOps, {
          ordered: false,
        });
      }
    }

    dispatch.markModified('items');
    this.recomputeDispatchStatus(dispatch);
    await dispatch.save();

    await this.warehousePricingService.syncInventoryUnitPrices(
      receiverStructureId,
    );

    const dispatchStatus = dispatch.status;

    if (
      dispatchStatus === WarehouseDispatchStatus.COMPLETED &&
      dispatch.purchaseRequestId
    ) {
      await this.syncPurchaseRequestWarehouseStatus(
        String(dispatch.purchaseRequestId),
      );
    }

    return this.toPublic(dispatch, userId, role);
  }

  async findByPurchaseRequestId(purchaseRequestId: string) {
    return this.dispatchModel
      .findOne({ purchaseRequestId: new Types.ObjectId(purchaseRequestId) })
      .sort({ dispatchedAt: -1 })
      .exec();
  }

  async findAllByPurchaseRequestId(purchaseRequestId: string) {
    return this.dispatchModel
      .find({ purchaseRequestId: new Types.ObjectId(purchaseRequestId) })
      .sort({ dispatchedAt: -1 })
      .exec();
  }

  async findByPurchaseRequestAndBatchId(
    purchaseRequestId: string,
    purchaseBatchId: string,
  ) {
    return this.dispatchModel
      .findOne({
        purchaseRequestId: new Types.ObjectId(purchaseRequestId),
        purchaseBatchId,
      })
      .exec();
  }

  mapReceiptPublic(dispatch: WarehouseDispatchDocument) {
    return {
      dispatchCode: dispatch.dispatchCode,
      dispatchedAt: dispatch.dispatchedAt,
      dispatchedBy: {
        displayName: dispatch.dispatchedBy.displayName,
        login: dispatch.dispatchedBy.login,
      },
      targetStructure: {
        shortName: dispatch.targetStructure.shortName,
        fullName: dispatch.targetStructure.fullName,
      },
      items: dispatch.items.map((item) => {
        const pending =
          item.quantityDispatched -
          item.quantityReceived -
          item.quantityRejected;

        return {
          itemIndex: item.itemIndex,
          name: item.name,
          characteristics: item.characteristics,
          nomenclatureCode: this.resolveItemNomenclatureCode(dispatch, item),
          quantityDispatched: item.quantityDispatched,
          quantityReceived: item.quantityReceived,
          quantityRejected: item.quantityRejected,
          quantityPending: Math.max(0, pending),
          rejectReason: item.rejectReason?.trim() || null,
        };
      }),
    };
  }

  async findMapByPurchaseRequestIds(purchaseRequestIds: string[]) {
    const grouped =
      await this.findGroupedMapByPurchaseRequestIds(purchaseRequestIds);
    const map = new Map<string, WarehouseDispatchDocument>();

    for (const [requestId, dispatches] of grouped.entries()) {
      if (dispatches[0]) {
        map.set(requestId, dispatches[0]);
      }
    }

    return map;
  }

  async findGroupedMapByPurchaseRequestIds(purchaseRequestIds: string[]) {
    if (!purchaseRequestIds.length) {
      return new Map<string, WarehouseDispatchDocument[]>();
    }

    const dispatches = await this.dispatchModel
      .find({
        purchaseRequestId: {
          $in: purchaseRequestIds.map((id) => new Types.ObjectId(id)),
        },
      })
      .sort({ dispatchedAt: -1 })
      .exec();

    const map = new Map<string, WarehouseDispatchDocument[]>();

    for (const dispatch of dispatches) {
      const requestId = String(dispatch.purchaseRequestId);
      const bucket = map.get(requestId) ?? [];
      bucket.push(dispatch);
      map.set(requestId, bucket);
    }

    return map;
  }

  getTransferCancelReasons() {
    return TRANSFER_CANCEL_REASONS;
  }

  private isDispatchCancelableState(dispatch: WarehouseDispatchDocument) {
    if (!this.isTransferDispatch(dispatch)) {
      return false;
    }

    if (dispatch.status !== WarehouseDispatchStatus.PENDING_RECEIPT) {
      return false;
    }

    if (dispatch.items.some((item) => item.quantityReceived > 0)) {
      return false;
    }

    return dispatch.items.some((item) => {
      const pending =
        item.quantityDispatched -
        item.quantityReceived -
        item.quantityRejected;

      return pending > 0;
    });
  }

  private isViewerTransferSender(
    dispatch: WarehouseDispatchDocument,
    userId: string,
    userStructureId: string | null,
    role?: UserRole,
  ) {
    if (isSuperAdminRole(role)) {
      return true;
    }

    const sourceStruct = this.resolveDispatchSourceStructureId(dispatch);

    if (userStructureId && sourceStruct && userStructureId === sourceStruct) {
      return true;
    }

    const dispatchedByUserId = this.normalizeStructureId(
      dispatch.dispatchedBy?.userId,
    );
    const userIdNorm = this.normalizeStructureId(userId);

    return Boolean(
      dispatchedByUserId && userIdNorm && dispatchedByUserId === userIdNorm,
    );
  }

  private resolveViewerCanCancelTransfer(
    dispatch: WarehouseDispatchDocument,
    userId: string,
    role: UserRole | undefined,
    userStructureId: string | null,
  ) {
    if (!this.isDispatchCancelableState(dispatch)) {
      return false;
    }

    return this.isViewerTransferSender(
      dispatch,
      userId,
      userStructureId,
      role,
    );
  }

  private async assertCanCancelTransfer(
    dispatch: WarehouseDispatchDocument,
    userId: string,
    role?: UserRole,
  ) {
    if (!this.isTransferDispatch(dispatch)) {
      throw new BadRequestException('Faqat transfer bekor qilinadi');
    }

    if (dispatch.status === WarehouseDispatchStatus.CANCELLED) {
      throw new BadRequestException('Transfer allaqachon bekor qilingan');
    }

    if (dispatch.status !== WarehouseDispatchStatus.PENDING_RECEIPT) {
      throw new BadRequestException(
        'Faqat qabul kutilayotgan transferni bekor qilish mumkin',
      );
    }

    const anyReceived = dispatch.items.some(
      (item) => item.quantityReceived > 0,
    );

    if (anyReceived) {
      throw new BadRequestException(
        'Qisman qabul qilingan transferni bekor qilib bo‘lmaydi',
      );
    }

    if (isSuperAdminRole(role)) {
      return;
    }

    const userStructureId = await this.getUserStructureId(userId);
    const sourceStruct = this.resolveDispatchSourceStructureId(dispatch);

    if (!userStructureId || userStructureId !== sourceStruct) {
      const dispatchedByUserId = this.normalizeStructureId(
        dispatch.dispatchedBy?.userId,
      );
      const userIdNorm = this.normalizeStructureId(userId);

      if (
        !dispatchedByUserId ||
        !userIdNorm ||
        dispatchedByUserId !== userIdNorm
      ) {
        throw new ForbiddenException(
          'Faqat jo‘natuvchi tuzilma xodimi yoki transferni yuborgan xodim bekor qila oladi',
        );
      }
    }

    const user = await this.usersService.findById(userId);

    if (!user?.isActive) {
      throw new ForbiddenException('Transferni bekor qilish uchun ruxsat yo‘q');
    }
  }

  async cancelTransfer(
    id: string,
    dto: CancelTransferDispatchDto,
    userId: string,
    role?: UserRole,
  ) {
    const dispatch = await this.findByIdOrFail(id);
    await this.assertCanCancelTransfer(dispatch, userId, role);

    if (!isTransferCancelReasonKey(dto.reasonKey)) {
      throw new BadRequestException('Bekor qilish sababi noto‘g‘ri');
    }

    const reason = TRANSFER_CANCEL_REASONS.find((r) => r.key === dto.reasonKey)!;
    const reasonOther = dto.reasonOther?.trim() ?? '';

    if (dto.reasonKey === TRANSFER_CANCEL_OTHER_REASON_KEY && !reasonOther) {
      throw new BadRequestException('Boshqa sabab uchun izoh kiriting');
    }

    const sourceStructureId = dispatch.sourceStructureId
      ? String(dispatch.sourceStructureId)
      : null;

    if (!sourceStructureId) {
      throw new BadRequestException('Transfer jo‘natuvchi tuzilmasi topilmadi');
    }

    const mergedReturns = new Map<
      string,
      {
        locationId: Types.ObjectId;
        sourceBarcode: string;
        name: string;
        characteristics: string;
        qty: number;
      }
    >();

    for (const item of dispatch.items) {
      const pending =
        item.quantityDispatched -
        item.quantityReceived -
        item.quantityRejected;

      if (pending < 1 || !item.sourceLocationId || !item.sourceBarcode?.trim()) {
        continue;
      }

      const key = `${String(item.sourceLocationId)}|${item.sourceBarcode}`;
      const existing = mergedReturns.get(key);

      if (existing) {
        existing.qty += pending;
      } else {
        mergedReturns.set(key, {
          locationId: item.sourceLocationId,
          sourceBarcode: item.sourceBarcode,
          name: item.name,
          characteristics: item.characteristics,
          qty: pending,
        });
      }
    }

    const returnOps = Array.from(mergedReturns.values()).map((row) => ({
      updateOne: {
        filter: {
          structureId: new Types.ObjectId(sourceStructureId),
          locationId: row.locationId,
          barcode: row.sourceBarcode,
        },
        update: {
          $setOnInsert: {
            structureId: new Types.ObjectId(sourceStructureId),
            locationId: row.locationId,
            itemKey: buildWarehouseItemKey(row.name, row.characteristics),
            name: row.name,
            characteristics: row.characteristics,
            barcode: row.sourceBarcode,
          },
          $inc: { quantity: row.qty },
          $set: { updatedAt: new Date() },
        },
        upsert: true,
      },
    }));

    if (returnOps.length) {
      await this.inventoryModel.collection.bulkWrite(returnOps, {
        ordered: false,
      });
    }

    const canceller = await this.buildUserSnapshot(userId);
    const now = new Date();

    dispatch.status = WarehouseDispatchStatus.CANCELLED;
    dispatch.cancelReasonKey = reason.key;
    dispatch.cancelReasonLabel = reason.label;
    dispatch.cancelReasonOther =
      dto.reasonKey === TRANSFER_CANCEL_OTHER_REASON_KEY ? reasonOther : '';
    dispatch.cancelledBy = canceller;
    dispatch.cancelledAt = now;

    await dispatch.save();

    await this.warehousePricingService.syncInventoryUnitPrices(
      sourceStructureId,
    );

    return this.toPublic(dispatch, userId, role);
  }
}
