import type { PermissionActionKey } from './permission-catalog';

/** Vaqtinchalik (ticket) — ruxsatlar UI va API da majburiy o‘chiriladi */
export const PURCHASE_APPROVAL_PAGE_PATH = '/xaridlar/arizalarni-tasdiqlash';
export const PURCHASE_HISTORY_PAGE_PATH = '/xaridlar/arizalar-tarixi';
export const PURCHASED_ITEMS_PAGE_PATH =
  '/xarid-qilish/xarid-qilingan-tavarlar';
export const PURCHASING_QUEUE_PAGE_PATH =
  '/xarid-qilish/sotib-olinadigan-tavarlar';
export const WAREHOUSE_RECEIPT_PAGE_PATH = '/xarid-qilish/xaridni-qabul-qilish';
export const ISHONCHNOMA_PAGE_PATH = '/xarid-qilish/ishonchnoma';
export const OTHER_WAREHOUSES_PAGE_PATH = '/omborlar/boshqa-omborlar';
export const WAREHOUSES_2D_PAGE_PATH = '/dashboard/2d-omborlar';
export const WAREHOUSES_2D_LEGACY_PAGE_PATH = '/omborlar/2d-omborlar';
export const WAREHOUSE_EXPENSE_PAGE_PATH = '/omborlar/chiqim-qilish';
export const WAREHOUSE_IMPORT_PAGE_PATH = '/omborlar/tavar-import-qilish';
export const PRODUCTS_PAGE_PATH = '/dashboard/maxsulotlar';
export const TRANSFER_PAGE_PATH = '/transfer/transfer-qilish';
export const TRANSFER_RECEIPT_PAGE_PATH = '/transfer/transferni-qabul-qilish';
export const TRANSFER_HISTORY_PAGE_PATH = '/transfer/transferlar-tarixi';

export const DISABLED_PAGE_ACTIONS: Record<string, PermissionActionKey[]> = {
  [PURCHASE_APPROVAL_PAGE_PATH]: ['update', 'delete'],
  [PURCHASE_HISTORY_PAGE_PATH]: ['create', 'update', 'delete'],
  [PURCHASED_ITEMS_PAGE_PATH]: ['create', 'update', 'delete'],
  [PURCHASING_QUEUE_PAGE_PATH]: ['update', 'delete'],
  [WAREHOUSE_RECEIPT_PAGE_PATH]: ['update', 'delete'],
  [ISHONCHNOMA_PAGE_PATH]: ['delete'],
  [OTHER_WAREHOUSES_PAGE_PATH]: ['create', 'update', 'delete'],
  [WAREHOUSES_2D_PAGE_PATH]: ['create', 'update', 'delete'],
  [WAREHOUSE_EXPENSE_PAGE_PATH]: ['update'],
  [WAREHOUSE_IMPORT_PAGE_PATH]: ['update', 'delete'],
  [PRODUCTS_PAGE_PATH]: ['create', 'update'],
  [TRANSFER_PAGE_PATH]: ['create', 'update', 'delete'],
  [TRANSFER_RECEIPT_PAGE_PATH]: ['update', 'delete'],
  [TRANSFER_HISTORY_PAGE_PATH]: ['create', 'delete'],
};

export const ALL_WAREHOUSES_OVERVIEW_PAGE_PATHS = [
  OTHER_WAREHOUSES_PAGE_PATH,
  WAREHOUSES_2D_PAGE_PATH,
] as const;

export const WAREHOUSE_2D_TRANSFER_VIEW_PAGE_PATHS = [
  WAREHOUSES_2D_PAGE_PATH,
  TRANSFER_HISTORY_PAGE_PATH,
] as const;

export const isPageActionDisabled = (
  path: string,
  action: PermissionActionKey,
): boolean => DISABLED_PAGE_ACTIONS[path]?.includes(action) ?? false;
