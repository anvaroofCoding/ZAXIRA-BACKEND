export const PURCHASE_REJECTION_REASON_KEYS = [
  'PRICE_MISMATCH',
  'NO_VENDOR',
  'BUDGET',
  'OUT_OF_STOCK',
  'INVALID_REQUEST',
  'OTHER',
] as const;

export type PurchaseRejectionReasonKey =
  (typeof PURCHASE_REJECTION_REASON_KEYS)[number];

export const PURCHASE_REJECTION_REASON_LABELS: Record<
  PurchaseRejectionReasonKey,
  string
> = {
  PRICE_MISMATCH: 'Narx mos kelmadi',
  NO_VENDOR: 'Yetkazib beruvchi topilmadi',
  BUDGET: 'Byudjet yetarli emas',
  OUT_OF_STOCK: 'Tovar mavjud emas',
  INVALID_REQUEST: 'Ariza ma’lumotlari noto‘g‘ri',
  OTHER: 'Boshqa',
};

export const isPurchaseRejectionReasonKey = (
  value: string,
): value is PurchaseRejectionReasonKey =>
  (PURCHASE_REJECTION_REASON_KEYS as readonly string[]).includes(value);
