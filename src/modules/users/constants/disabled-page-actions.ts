import type { PermissionActionKey } from './permission-catalog';

/** Vaqtinchalik (ticket) — ruxsatlar UI va API da majburiy o‘chiriladi */
export const PURCHASE_APPROVAL_PAGE_PATH = '/xaridlar/arizalarni-tasdiqlash';
export const PURCHASE_HISTORY_PAGE_PATH = '/xaridlar/arizalar-tarixi';
export const PURCHASED_ITEMS_PAGE_PATH =
  '/xarid-qilish/xarid-qilingan-tavarlar';
export const PURCHASING_QUEUE_PAGE_PATH =
  '/xarid-qilish/sotib-olinadigan-tavarlar';
export const WAREHOUSE_RECEIPT_PAGE_PATH = '/xarid-qilish/xaridni-qabul-qilish';
export const OTHER_WAREHOUSES_PAGE_PATH = '/omborlar/boshqa-omborlar';
export const WAREHOUSE_EXPENSE_PAGE_PATH = '/omborlar/chiqim-qilish';
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
  [OTHER_WAREHOUSES_PAGE_PATH]: ['create', 'update', 'delete'],
  [WAREHOUSE_EXPENSE_PAGE_PATH]: ['update'],
  [PRODUCTS_PAGE_PATH]: ['create', 'update'],
  [TRANSFER_PAGE_PATH]: ['create', 'update', 'delete'],
  [TRANSFER_RECEIPT_PAGE_PATH]: ['update', 'delete'],
  [TRANSFER_HISTORY_PAGE_PATH]: ['create', 'update', 'delete'],
};

export const isPageActionDisabled = (
  path: string,
  action: PermissionActionKey,
): boolean => DISABLED_PAGE_ACTIONS[path]?.includes(action) ?? false;
