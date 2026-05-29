import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  WarehouseDispatch,
  WarehouseDispatchDocument,
} from '../warehouse-dispatches/schemas/warehouse-dispatch.schema';
import { WarehouseDispatchStatus } from '../warehouse-dispatches/enums/warehouse-dispatch-status.enum';
import {
  WarehouseInventory,
  WarehouseInventoryDocument,
} from './schemas/warehouse-inventory.schema';
import { buildWarehouseItemKey } from './utils/item-key.util';

const RECEIVED_DISPATCH_STATUSES = [
  WarehouseDispatchStatus.PARTIALLY_RECEIVED,
  WarehouseDispatchStatus.COMPLETED,
];

@Injectable()
export class WarehousePricingService {
  constructor(
    @InjectModel(WarehouseInventory.name)
    private readonly inventoryModel: Model<WarehouseInventoryDocument>,
    @InjectModel(WarehouseDispatch.name)
    private readonly dispatchModel: Model<WarehouseDispatchDocument>,
  ) {}

  /** Tuzilma bo‘yicha tovar kaliti → birlik narxi (so‘m). */
  async getUnitPriceMapForStructure(structureId: string): Promise<Map<string, number>> {
    const map = await this.buildBaseUnitPriceMap(structureId);
    await this.applyLegacyTransferPrices(structureId, map);
    return map;
  }

  /** Omborda unitPrice bo‘lmagan qatorlarni hisoblangan narx bilan yangilaydi. */
  async syncInventoryUnitPrices(structureId: string): Promise<void> {
    const structureObjectId = new Types.ObjectId(structureId);
    const priceMap = await this.getUnitPriceMapForStructure(structureId);

    const rows = await this.inventoryModel
      .find({
        structureId: structureObjectId,
        quantity: { $gt: 0 },
        $or: [{ unitPrice: { $exists: false } }, { unitPrice: { $lte: 0 } }],
      })
      .select('_id itemKey')
      .lean()
      .exec();

    if (!rows.length) return;

    const ops = rows
      .map((row) => {
        const price = priceMap.get(row.itemKey) ?? 0;
        if (price <= 0) return null;
        return {
          updateOne: {
            filter: { _id: row._id },
            update: { $set: { unitPrice: price } },
          },
        };
      })
      .filter((op): op is NonNullable<typeof op> => op !== null);

    if (ops.length) {
      await this.inventoryModel.bulkWrite(ops, { ordered: false });
    }
  }

  private async buildBaseUnitPriceMap(structureId: string): Promise<Map<string, number>> {
    const structureObjectId = new Types.ObjectId(structureId);
    const map = new Map<string, number>();

    const inventoryRows = await this.inventoryModel
      .aggregate([
        { $match: { structureId: structureObjectId, unitPrice: { $gt: 0 } } },
        {
          $group: {
            _id: '$itemKey',
            unitPrice: { $max: '$unitPrice' },
          },
        },
      ])
      .exec();

    for (const row of inventoryRows as Array<{ _id: string; unitPrice: number }>) {
      if (row?._id && Number.isFinite(row.unitPrice) && row.unitPrice > 0) {
        map.set(row._id, Math.round(row.unitPrice));
      }
    }

    const purchasePipeline: PipelineStage[] = [
      {
        $match: {
          status: { $in: RECEIVED_DISPATCH_STATUSES },
          'targetStructure.structureId': structureObjectId,
          purchaseRequestId: { $exists: true, $ne: null },
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
          itemKey: '$_itemKey',
          dispatchedAt: 1,
          unitPrice: {
            $ifNull: [
              '$items.unitPrice',
              { $arrayElemAt: ['$pr.items.purchaseAmount', '$items.itemIndex'] },
            ],
          },
        },
      },
      { $match: { unitPrice: { $gt: 0 } } },
      {
        $group: {
          _id: '$itemKey',
          unitPrice: { $first: '$unitPrice' },
          dispatchedAt: { $first: '$dispatchedAt' },
        },
      },
      { $project: { _id: 0, itemKey: '$_id', unitPrice: 1 } },
    ];

    const purchaseRows = await this.dispatchModel.aggregate(purchasePipeline).exec();
    for (const row of purchaseRows as Array<{ itemKey: string; unitPrice: number }>) {
      if (!row?.itemKey || !Number.isFinite(row.unitPrice) || row.unitPrice <= 0) continue;
      if (!map.has(row.itemKey)) {
        map.set(row.itemKey, Math.round(row.unitPrice));
      }
    }

    const transferPipeline: PipelineStage[] = [
      {
        $match: {
          status: { $in: RECEIVED_DISPATCH_STATUSES },
          'targetStructure.structureId': structureObjectId,
          $or: [{ purchaseRequestId: null }, { purchaseRequestId: { $exists: false } }],
          'items.unitPrice': { $gt: 0 },
        },
      },
      { $sort: { dispatchedAt: -1 } },
      { $unwind: '$items' },
      { $match: { 'items.quantityReceived': { $gt: 0 }, 'items.unitPrice': { $gt: 0 } } },
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
        $group: {
          _id: '$_itemKey',
          unitPrice: { $first: '$items.unitPrice' },
        },
      },
      { $project: { _id: 0, itemKey: '$_id', unitPrice: 1 } },
    ];

    const transferRows = await this.dispatchModel.aggregate(transferPipeline).exec();
    for (const row of transferRows as Array<{ itemKey: string; unitPrice: number }>) {
      if (!row?.itemKey || !Number.isFinite(row.unitPrice) || row.unitPrice <= 0) continue;
      if (!map.has(row.itemKey)) {
        map.set(row.itemKey, Math.round(row.unitPrice));
      }
    }

    return map;
  }

  /** Transfer qatoridagi birlik narxini aniqlash (jo‘natuvchi tarixidan). */
  async resolveTransferItemUnitPrice(
    item: { name: string; characteristics: string; unitPrice?: number | null },
    sourceStructureId?: string | null,
  ): Promise<number> {
    const onItem = Math.round(Number(item.unitPrice) || 0);
    if (onItem > 0) return onItem;

    if (!sourceStructureId) return 0;

    const itemKey = buildWarehouseItemKey(item.name, item.characteristics);
    const sourceMap = await this.getUnitPriceMapForStructure(String(sourceStructureId));
    return sourceMap.get(itemKey) ?? 0;
  }

  /** Barcha tuzilmalar omboridagi narxlarni qayta hisoblab yozadi. */
  async backfillAllInventoryUnitPrices(): Promise<number> {
    const structureIds = (await this.inventoryModel.distinct('structureId').exec()).map(String);
    let updated = 0;

    for (const structureId of structureIds) {
      if (!Types.ObjectId.isValid(structureId)) continue;
      const before = await this.inventoryModel.countDocuments({
        structureId: new Types.ObjectId(structureId),
        quantity: { $gt: 0 },
        $or: [{ unitPrice: { $exists: false } }, { unitPrice: { $lte: 0 } }],
      });
      await this.syncInventoryUnitPrices(structureId);
      const after = await this.inventoryModel.countDocuments({
        structureId: new Types.ObjectId(structureId),
        quantity: { $gt: 0 },
        $or: [{ unitPrice: { $exists: false } }, { unitPrice: { $lte: 0 } }],
      });
      updated += Math.max(0, before - after);
    }

    return updated;
  }

  /** Eski transferlar: jo‘natuvchi tuzilmaning narx tarixidan olish. */
  private async applyLegacyTransferPrices(
    structureId: string,
    map: Map<string, number>,
    visited: Set<string> = new Set(),
  ): Promise<void> {
    if (visited.has(structureId)) return;
    visited.add(structureId);

    const structureObjectId = new Types.ObjectId(structureId);

    const dispatches = await this.dispatchModel
      .find({
        'targetStructure.structureId': structureObjectId,
        status: { $in: RECEIVED_DISPATCH_STATUSES },
        $or: [{ purchaseRequestId: null }, { purchaseRequestId: { $exists: false } }],
      })
      .select('sourceStructureId items')
      .lean()
      .exec();

    const sourceCache = new Map<string, Map<string, number>>();

    for (const dispatch of dispatches) {
      const sourceId = dispatch.sourceStructureId
        ? String(dispatch.sourceStructureId)
        : null;
      if (!sourceId || sourceId === structureId) continue;

      if (!sourceCache.has(sourceId)) {
        const sourceMap = await this.buildBaseUnitPriceMap(sourceId);
        await this.applyLegacyTransferPrices(sourceId, sourceMap, visited);
        sourceCache.set(sourceId, sourceMap);
      }
      const sourceMap = sourceCache.get(sourceId)!;

      for (const item of dispatch.items ?? []) {
        if ((item.quantityReceived ?? 0) <= 0) continue;

        const itemKey = buildWarehouseItemKey(item.name, item.characteristics);
        if (map.has(itemKey)) continue;

        const fromItem = Number(item.unitPrice) || 0;
        const price = fromItem > 0 ? fromItem : (sourceMap.get(itemKey) ?? 0);
        if (price > 0) {
          map.set(itemKey, Math.round(price));
        }
      }
    }
  }

  resolveUnitPriceFromMap(
    priceMap: Map<string, number>,
    itemKey: string,
    inventoryUnitPrice?: number | null,
  ): number {
    if (Number.isFinite(inventoryUnitPrice) && (inventoryUnitPrice ?? 0) > 0) {
      return Math.round(inventoryUnitPrice as number);
    }
    return priceMap.get(itemKey) ?? 0;
  }
}
