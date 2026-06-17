export const TRANSFER_CANCEL_OTHER_REASON_KEY = 'other' as const;

export const TRANSFER_CANCEL_REASONS = [
  { key: 'wrong_recipient', label: 'Noto‘g‘ri qabul qiluvchi tanlangan' },
  { key: 'wrong_items', label: 'Noto‘g‘ri tovarlar tanlangan' },
  { key: 'duplicate', label: 'Takroriy transfer' },
  { key: 'no_longer_needed', label: 'Endi kerak emas' },
  { key: 'quantity_mistake', label: 'Miqdor xatosi' },
  { key: TRANSFER_CANCEL_OTHER_REASON_KEY, label: 'Boshqa' },
] as const;

export type TransferCancelReasonKey =
  (typeof TRANSFER_CANCEL_REASONS)[number]['key'];

export const isTransferCancelReasonKey = (
  value: unknown,
): value is TransferCancelReasonKey =>
  typeof value === 'string' &&
  TRANSFER_CANCEL_REASONS.some((r) => r.key === value);
