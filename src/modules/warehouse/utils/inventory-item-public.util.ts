import { computeWarehouseBarcode } from './warehouse-barcode.util';

export function mapNomenclatureCode(
  receiptNomenclatureCode?: string | null,
): string {
  return receiptNomenclatureCode?.trim() || '';
}

export function resolveInventoryBarcode(
  name: string,
  characteristics: string,
  barcode?: string | null,
): string {
  return barcode?.trim() || computeWarehouseBarcode(name, characteristics);
}

export function buildInventorySearchOr(search: string) {
  const regex = new RegExp(
    search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'i',
  );

  return [
    { name: regex },
    { characteristics: regex },
    { barcode: regex },
    { receiptNomenclatureCode: regex },
  ];
}
