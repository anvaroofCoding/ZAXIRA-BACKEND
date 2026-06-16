import { resolveInventoryBarcodeForStorage } from './inventory-nomenclature.util';

export function mapNomenclatureCode(
  receiptNomenclatureCode?: string | null,
): string {
  return receiptNomenclatureCode?.trim() || '';
}

export function resolveInventoryBarcode(
  name: string,
  characteristics: string,
  barcode?: string | null,
  receiptNomenclatureCode?: string | null,
): string {
  return resolveInventoryBarcodeForStorage(
    name,
    characteristics,
    barcode,
    receiptNomenclatureCode,
  );
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
