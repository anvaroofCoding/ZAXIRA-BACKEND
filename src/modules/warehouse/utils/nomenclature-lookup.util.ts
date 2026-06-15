import { Model, Types } from 'mongoose';
import { WarehouseDispatchStatus } from '../../warehouse-dispatches/enums/warehouse-dispatch-status.enum';
import { WarehouseDispatchDocument } from '../../warehouse-dispatches/schemas/warehouse-dispatch.schema';
import { normalizeInventoryName } from './inventory-nomenclature.util';
import { buildWarehouseItemKey } from './item-key.util';
import { computeWarehouseBarcode } from './warehouse-barcode.util';

const RECEIVED_DISPATCH_STATUSES = [
  WarehouseDispatchStatus.COMPLETED,
  WarehouseDispatchStatus.PARTIALLY_RECEIVED,
];

const buildStructureIdMatch = (structureId: string) => {
  if (!Types.ObjectId.isValid(structureId)) {
    return structureId;
  }

  const objectId = new Types.ObjectId(structureId);
  return { $in: [objectId, structureId] };
};

export type InventoryNomenclatureLookupItem = {
  itemKey?: string;
  name: string;
  characteristics: string;
  barcode?: string;
};

const resolveDispatchItemNomenclature = (
  dispatch: WarehouseDispatchDocument,
  item: WarehouseDispatchDocument['items'][number],
) => {
  const fromReceipt = item.receiptNomenclatureCode?.trim();
  if (fromReceipt) {
    return fromReceipt;
  }

  const fromSource = item.sourceNomenclatureCode?.trim();
  if (fromSource) {
    return fromSource;
  }

  const fromDispatch =
    dispatch.confirmedNomenclatureCode?.trim() || dispatch.dispatchCode?.trim();
  return fromDispatch || '';
};

export async function resolveReceivedNomenclatureByItemKeys(
  dispatchModel: Model<WarehouseDispatchDocument>,
  structureId: string,
  items: InventoryNomenclatureLookupItem[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  if (!items.length) {
    return map;
  }

  const lookupItems = items.map((item) => {
    const itemKey = resolveInventoryItemKey(item);
    const barcode =
      item.barcode?.trim() ||
      computeWarehouseBarcode(item.name, item.characteristics);

    return { itemKey, barcode, normalizedName: normalizeInventoryName(item.name) };
  });

  const itemKeys = [...new Set(lookupItems.map((item) => item.itemKey))];

  const dispatches = await dispatchModel
    .find({
      'targetStructure.structureId': buildStructureIdMatch(structureId),
      status: { $in: RECEIVED_DISPATCH_STATUSES },
      'items.quantityReceived': { $gt: 0 },
    })
    .sort({ dispatchedAt: -1 })
    .select('items confirmedNomenclatureCode dispatchCode')
    .limit(300)
    .exec();

  for (const lookup of lookupItems) {
    for (const dispatch of dispatches) {
      let matchedCode = '';

      for (const item of dispatch.items) {
        if ((item.quantityReceived ?? 0) <= 0) {
          continue;
        }

        const dispatchItemKey = buildWarehouseItemKey(
          item.name,
          item.characteristics,
        );
        const dispatchBarcode =
          item.sourceBarcode?.trim() ||
          computeWarehouseBarcode(item.name, item.characteristics);

        const dispatchName = normalizeInventoryName(item.name);
        const receiptCode = item.receiptNomenclatureCode?.trim();

        if (
          dispatchItemKey !== lookup.itemKey &&
          dispatchBarcode !== lookup.barcode &&
          dispatchName !== lookup.normalizedName
        ) {
          continue;
        }

        const code =
          receiptCode || resolveDispatchItemNomenclature(dispatch, item);
        if (code) {
          matchedCode = code;
          break;
        }
      }

      if (matchedCode) {
        map.set(lookup.itemKey, matchedCode);
        break;
      }
    }
  }

  // Legacy aggregate fallback for any still-missing keys.
  const missingKeys = itemKeys.filter((key) => !map.has(key));
  if (!missingKeys.length) {
    return map;
  }

  const rows = await dispatchModel
    .aggregate<{
      _id: string;
      nomenclatureCode: string;
    }>([
      {
        $match: {
          'targetStructure.structureId': buildStructureIdMatch(structureId),
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
      { $match: { _itemKey: { $in: missingKeys } } },
      {
        $group: {
          _id: '$_itemKey',
          nomenclatureCode: {
            $first: {
              $ifNull: [
                '$items.receiptNomenclatureCode',
                {
                  $ifNull: [
                    '$items.sourceNomenclatureCode',
                    {
                      $ifNull: ['$confirmedNomenclatureCode', '$dispatchCode'],
                    },
                  ],
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
    if (code) {
      map.set(row._id, code);
    }
  }

  return map;
}

export async function resolveReceivedNomenclatureByProductNames(
  dispatchModel: Model<WarehouseDispatchDocument>,
  structureId: string,
  normalizedNames: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniqueNames = [
    ...new Set(
      normalizedNames.map((name) => normalizeInventoryName(name)).filter(Boolean),
    ),
  ];

  if (!uniqueNames.length) {
    return map;
  }

  const rows = await dispatchModel
    .aggregate<{
      _id: string;
      nomenclatureCode: string;
    }>([
      {
        $match: {
          'targetStructure.structureId': buildStructureIdMatch(structureId),
          status: { $in: RECEIVED_DISPATCH_STATUSES },
        },
      },
      { $sort: { dispatchedAt: -1 } },
      { $unwind: '$items' },
      {
        $match: {
          'items.quantityReceived': { $gt: 0 },
          'items.receiptNomenclatureCode': { $exists: true, $ne: '' },
        },
      },
      {
        $addFields: {
          _normalizedName: {
            $toLower: { $trim: { input: '$items.name' } },
          },
        },
      },
      { $match: { _normalizedName: { $in: uniqueNames } } },
      {
        $group: {
          _id: '$_normalizedName',
          nomenclatureCode: { $first: '$items.receiptNomenclatureCode' },
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

export function resolveInventoryItemKey(item: {
  itemKey?: string;
  name: string;
  characteristics: string;
}): string {
  return (
    item.itemKey?.trim() ||
    buildWarehouseItemKey(item.name, item.characteristics)
  );
}
