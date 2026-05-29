export const WAREHOUSE_EXPENSE_REASONS = [
  { key: 'damaged', label: 'Buzilgan' },
  { key: 'lost', label: "Yo'qotilgan" },
  { key: 'expired', label: 'Yaroqlilik muddati o‘tgan' },
  { key: 'writeoff', label: 'Hisobdan chiqarish' },
  { key: 'other', label: 'Boshqa' },
] as const;

export type WarehouseExpenseReasonKey =
  (typeof WAREHOUSE_EXPENSE_REASONS)[number]['key'];

export const isWarehouseExpenseReasonKey = (
  value: unknown,
): value is WarehouseExpenseReasonKey =>
  typeof value === 'string' &&
  WAREHOUSE_EXPENSE_REASONS.some((r) => r.key === value);

