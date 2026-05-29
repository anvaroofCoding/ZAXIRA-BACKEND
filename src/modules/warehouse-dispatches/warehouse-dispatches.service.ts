import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { appendDateRangeClause } from '../../common/utils/date-range-filter.util';
import { isSuperAdminRole } from '../../common/utils/super-admin.util';
import { PurchaseRequestStatus } from '../purchase-requests/enums/purchase-request-status.enum';
import { PurchaseRequestsService } from '../purchase-requests/purchase-requests.service';
import { Sequence, SequenceDocument } from '../purchase-requests/schemas/sequence.schema';
import { UserSnapshotEmbeddable } from '../purchase-requests/schemas/user-snapshot.schema';
import { PurchaseRequestsEventsService } from '../realtime/purchase-requests-events.service';
import { StructuresService } from '../structures/structures.service';
import { UsersService } from '../users/users.service';
import { buildWarehouseItemKey } from '../warehouse/utils/item-key.util';
import { computeWarehouseBarcode } from '../warehouse/utils/warehouse-barcode.util';
import { WarehouseInventory, WarehouseInventoryDocument } from '../warehouse/schemas/warehouse-inventory.schema';
import { WarehouseLocation, WarehouseLocationDocument } from '../warehouse/schemas/warehouse-location.schema';
import { CreateWarehouseDispatchDto } from './dto/create-warehouse-dispatch.dto';
import { QueryWarehouseDispatchInboxDto } from './dto/query-warehouse-dispatch-inbox.dto';
import { ReceiveWarehouseDispatchDto } from './dto/receive-warehouse-dispatch.dto';
import { CreateTransferDispatchDto } from './dto/create-transfer-dispatch.dto';
import {
  WAREHOUSE_DISPATCH_STATUS_LABELS,
  WarehouseDispatchStatus,
} from './enums/warehouse-dispatch-status.enum';
import {
  WarehouseDispatch,
  WarehouseDispatchDocument,
} from './schemas/warehouse-dispatch.schema';

const DISPATCH_SEQUENCE_PREFIX = 'dispatch:';

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
    private readonly purchaseRequestsService: PurchaseRequestsService,
    private readonly structuresService: StructuresService,
    private readonly usersService: UsersService,
    private readonly purchaseRequestsEvents: PurchaseRequestsEventsService,
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

  private async buildUserSnapshot(userId: string): Promise<UserSnapshotEmbeddable> {
    const user = await this.usersService.findByIdOrFail(userId);
    return {
      userId: new Types.ObjectId(user.id),
      displayName: user.displayName || user.login,
      login: user.login,
    };
  }

  private async getUserStructureId(userId: string): Promise<string | null> {
    const user = await this.usersService.findById(userId);
    if (!user?.structureId) {
      return null;
    }

    return String(user.structureId);
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
      throw new ForbiddenException('Faqat qabul qiluvchi tuzilma xodimi qabul qila oladi');
    }
  }

  private recomputeDispatchStatus(dispatch: WarehouseDispatchDocument) {
    const allDone = dispatch.items.every((item) => {
      const pending =
        item.quantityDispatched -
        item.quantityReceived -
        item.quantityRejected;

      return pending <= 0;
    });

    if (allDone) {
      const anyReceived = dispatch.items.some((item) => item.quantityReceived > 0);

      dispatch.status = anyReceived
        ? WarehouseDispatchStatus.COMPLETED
        : WarehouseDispatchStatus.COMPLETED;

      return;
    }

    const anyReceived = dispatch.items.some((item) => item.quantityReceived > 0);

    dispatch.status = anyReceived
      ? WarehouseDispatchStatus.PARTIALLY_RECEIVED
      : WarehouseDispatchStatus.PENDING_RECEIPT;
  }

  private toPublic(dispatch: WarehouseDispatchDocument, viewerUserId?: string, viewerRole?: UserRole) {
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
        dispatch.status !== WarehouseDispatchStatus.COMPLETED,
      createdAt: dispatch.createdAt,
      updatedAt: dispatch.updatedAt,
    };
  }

  async create(dto: CreateWarehouseDispatchDto, userId: string, role?: UserRole) {
    const request = await this.purchaseRequestsService.findByIdOrFail(
      dto.purchaseRequestId,
      userId,
      role,
      { purchasingView: true },
    );

    if (request.status !== PurchaseRequestStatus.PURCHASED) {
      throw new BadRequestException(
        'Faqat xarid qilingan arizani omborga jo‘natish mumkin',
      );
    }

    const existing = await this.dispatchModel
      .findOne({ purchaseRequestId: request._id })
      .exec();

    if (existing) {
      throw new BadRequestException('Ushbu ariza allaqachon omborga jo‘natilgan');
    }

    const structureSnapshot = await this.structuresService.buildSnapshot(
      dto.structureId,
    );

    const dispatcher = await this.buildUserSnapshot(userId);
    const now = new Date();
    const dispatchCode = await this.nextDispatchCode(structureSnapshot.shortName);

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
      status: WarehouseDispatchStatus.PENDING_RECEIPT,
      targetStructure: {
        structureId: new Types.ObjectId(structureSnapshot.structureId),
        fullName: structureSnapshot.fullName,
        shortName: structureSnapshot.shortName,
        capturedAt: structureSnapshot.capturedAt,
      },
      items: request.items.map((item, itemIndex) => ({
        itemIndex,
        name: item.name,
        characteristics: item.characteristics,
        quantityDispatched: item.quantity,
        quantityReceived: 0,
        quantityRejected: 0,
        rejectReason: '',
      })),
      plannedArrivalAt,
      dispatchedBy: dispatcher,
      dispatchedAt: now,
      isSeenByReceiver: false,
    });

    request.status = PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT;
    await request.save();

    this.purchaseRequestsEvents.notifyChanged(request, 'updated');

    return this.toPublic(dispatch, userId, role);
  }

  async createTransfer(dto: CreateTransferDispatchDto, userId: string, role?: UserRole) {
    const senderStructureId = await this.getUserStructureId(userId);
    if (!senderStructureId) {
      throw new BadRequestException('Foydalanuvchiga tuzilma biriktirilmagan');
    }

    const targetStructure = await this.structuresService.buildSnapshot(dto.structureId);
    const sourceStructure = await this.structuresService.buildSnapshot(senderStructureId);
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

    const mergedByKey = new Map<string, { locationId: string; barcode: string; quantity: number }>();
    for (const item of normalizedItems) {
      const key = `${item.locationId}|${item.barcode}`;
      const existing = mergedByKey.get(key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        mergedByKey.set(key, {
          locationId: item.locationId!,
          barcode: item.barcode!,
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
      .select('name characteristics barcode quantity locationId')
      .exec();

    if (inventories.length !== mergedItems.length) {
      throw new BadRequestException('Ba’zi tovarlar omborda topilmadi');
    }

    const byLocationAndBarcode = new Map(
      inventories.map((inv) => [`${String(inv.locationId)}|${inv.barcode}`, inv]),
    );

    for (const item of mergedItems) {
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

    const nowUpdate = new Date();
    const bulkOps = mergedItems.map((item) => ({
      updateOne: {
        filter: {
          structureId: new Types.ObjectId(senderStructureId),
          locationId: new Types.ObjectId(item.locationId),
          barcode: item.barcode,
          quantity: { $gte: item.quantity },
        },
        update: { $inc: { quantity: -item.quantity }, $set: { updatedAt: nowUpdate } },
      },
    }));

    const bulkResult = await this.inventoryModel.collection.bulkWrite(bulkOps, {
      ordered: true,
    });
    const modified = bulkResult.modifiedCount ?? 0;
    if (modified !== mergedItems.length) {
      throw new BadRequestException('Transferni bajarib bo‘lmadi (miqdor yetarli emas)');
    }

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
        const inv = byLocationAndBarcode.get(`${item.locationId}|${item.barcode}`)!;
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
        };
      }),
      plannedArrivalAt,
      dispatchedBy: dispatcher,
      dispatchedAt: now,
      isSeenByReceiver: false,
    });

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
    options?: { markSeen?: boolean },
  ) {
    const dispatch = await this.findByIdOrFail(id);
    await this.assertReceiverAsync(dispatch, userId, role);

    if (options?.markSeen && !dispatch.isSeenByReceiver) {
      dispatch.isSeenByReceiver = true;
      await dispatch.save();
    }

    return this.toPublic(dispatch, userId, role);
  }

  async findReceiptInboxPaginated(
    query: QueryWarehouseDispatchInboxDto,
    userId: string,
    role?: UserRole,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const clauses: Record<string, unknown>[] = [
      {
        status: {
          $in: [
            WarehouseDispatchStatus.PENDING_RECEIPT,
            WarehouseDispatchStatus.PARTIALLY_RECEIVED,
            WarehouseDispatchStatus.COMPLETED,
          ],
        },
      },
    ];

    if (query.source === 'transfer') {
      clauses.push({
        $or: [{ purchaseRequestId: null }, { requestCode: /^TR-/i }],
      });
    }

    if (!isSuperAdminRole(role)) {
      const structureId = await this.getUserStructureId(userId);

      if (!structureId) {
        return { items: [], total: 0, page, limit, totalPages: 1 };
      }

      if (query.source === 'transfer' && query.scope === 'history') {
        clauses.push({
          $or: [
            { 'targetStructure.structureId': new Types.ObjectId(structureId) },
            { sourceStructureId: new Types.ObjectId(structureId) },
          ],
        });
      } else {
        clauses.push({
          'targetStructure.structureId': new Types.ObjectId(structureId),
        });
      }
    }

    appendDateRangeClause(clauses, 'dispatchedAt', query.dateFrom, query.dateTo);

    const term = query.search?.trim();

    if (term) {
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      clauses.push({
        $or: [
          { dispatchCode: regex },
          { requestCode: regex },
          { 'targetStructure.shortName': regex },
          { 'targetStructure.fullName': regex },
        ],
      });
    }

    const filter =
      clauses.length === 1 ? clauses[0] : { $and: clauses };

    const [items, total] = await Promise.all([
      this.dispatchModel
        .find(filter)
        .sort({ isSeenByReceiver: 1, dispatchedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.dispatchModel.countDocuments(filter).exec(),
    ]);

    return {
      items: items.map((item) => this.toPublic(item, userId, role)),
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

    for (const received of dto.receivedItems ?? []) {
      const item = dispatch.items.find((row) => row.itemIndex === received.itemIndex);

      if (!item) {
        throw new BadRequestException('Tovar topilmadi');
      }

      const pending =
        item.quantityDispatched - item.quantityReceived - item.quantityRejected;

      if (received.quantityReceived < 1 || received.quantityReceived > pending) {
        throw new BadRequestException(
          `«${item.name}» uchun qabul miqdori noto‘g‘ri (qolgan: ${pending})`,
        );
      }

      item.quantityReceived += received.quantityReceived;
    }

    if (locationObjectId) {
      const now = new Date();
      const receivedByIndex = new Map<number, number>();

      for (const received of dto.receivedItems ?? []) {
        if (received.quantityReceived > 0) {
          receivedByIndex.set(received.itemIndex, received.quantityReceived);
        }
      }

      // Group items by itemKey to avoid MongoDB conflict when multiple items
      // share the same name+characteristics (same document target in bulkWrite).
      const mergedByKey = new Map<
        string,
        { item: (typeof dispatch.items)[0]; qty: number }
      >();

      for (const item of dispatch.items) {
        if (!receivedByIndex.has(item.itemIndex)) continue;

        const qty = receivedByIndex.get(item.itemIndex) ?? 0;
        const itemKey = buildWarehouseItemKey(item.name, item.characteristics);
        const existing = mergedByKey.get(itemKey);

        if (existing) {
          existing.qty += qty;
        } else {
          mergedByKey.set(itemKey, { item, qty });
        }
      }

      const bulkOps = Array.from(mergedByKey.entries()).map(
        ([itemKey, { item, qty }]) => ({
          updateOne: {
            filter: {
              structureId: new Types.ObjectId(receiverStructureId),
              locationId: locationObjectId,
              itemKey,
            },
            update: {
              $setOnInsert: {
                structureId: new Types.ObjectId(receiverStructureId),
                locationId: locationObjectId,
                itemKey,
                name: item.name,
                characteristics: item.characteristics,
                barcode: computeWarehouseBarcode(item.name, item.characteristics),
              },
              $inc: { quantity: qty },
              $set: { lastReceiptAt: now },
            },
            upsert: true,
          },
        }),
      );

      if (bulkOps.length) {
        // Mongoose upsert defaultlari ($setOnInsert) quantity bilan $inc ni konfliktga olib kelishi mumkin.
        // Native collection bulkWrite ishlatsak, update document o'zgarmaydi.
        await this.inventoryModel.collection.bulkWrite(bulkOps, { ordered: false });
      }
    }

    for (const rejected of dto.rejectedItems ?? []) {
      const item = dispatch.items.find((row) => row.itemIndex === rejected.itemIndex);

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
        if (!rejected.quantityRejected || rejected.quantityRejected < 1) continue;
        const item = dispatch.items.find((row) => row.itemIndex === rejected.itemIndex);
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
        await this.inventoryModel.collection.bulkWrite(returnOps, { ordered: false });
      }
    }

    dispatch.markModified('items');
    this.recomputeDispatchStatus(dispatch);
    await dispatch.save();

    const dispatchStatus = dispatch.status as WarehouseDispatchStatus;

    if (dispatchStatus === WarehouseDispatchStatus.COMPLETED && dispatch.purchaseRequestId) {
      const request = await this.purchaseRequestsService.findByIdOrFail(
        String(dispatch.purchaseRequestId),
      );
      request.status = PurchaseRequestStatus.WAREHOUSE_COMPLETED;
      await request.save();
      this.purchaseRequestsEvents.notifyChanged(request, 'updated');
    }

    return this.toPublic(dispatch, userId, role);
  }

  async findByPurchaseRequestId(purchaseRequestId: string) {
    return this.dispatchModel
      .findOne({ purchaseRequestId: new Types.ObjectId(purchaseRequestId) })
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
    if (!purchaseRequestIds.length) {
      return new Map<string, WarehouseDispatchDocument>();
    }

    const dispatches = await this.dispatchModel
      .find({
        purchaseRequestId: {
          $in: purchaseRequestIds.map((id) => new Types.ObjectId(id)),
        },
      })
      .exec();

    const map = new Map<string, WarehouseDispatchDocument>();

    for (const dispatch of dispatches) {
      map.set(String(dispatch.purchaseRequestId), dispatch);
    }

    return map;
  }
}
