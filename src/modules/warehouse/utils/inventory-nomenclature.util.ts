import { buildWarehouseItemKey } from './item-key.util';
import { computeWarehouseBarcode } from './warehouse-barcode.util';

export const normalizeInventoryName = (value: string) =>
  String(value ?? '').trim().toLowerCase();

export const normalizeNomenclatureCode = (value: string) =>
  String(value ?? '').trim();

export const inventoryNamesMatch = (left: string, right: string) =>
  normalizeInventoryName(left) === normalizeInventoryName(right);

export const buildNomenclatureInventoryItemKey = (
  name: string,
  nomenclatureCode: string,
) =>
  `nmk:${normalizeNomenclatureCode(nomenclatureCode).toLowerCase()}|${normalizeInventoryName(name)}`;

export const buildInventoryItemKey = (
  name: string,
  characteristics: string,
  nomenclatureCode?: string,
) => {
  const code = normalizeNomenclatureCode(nomenclatureCode ?? '');
  if (code) {
    return buildNomenclatureInventoryItemKey(name, code);
  }

  return buildWarehouseItemKey(name, characteristics);
};

export const resolveInventoryBarcodeForStorage = (
  name: string,
  characteristics: string,
  nomenclatureCode?: string,
) => {
  const code = normalizeNomenclatureCode(nomenclatureCode ?? '');
  if (code) {
    return code;
  }

  return computeWarehouseBarcode(name, characteristics);
};
