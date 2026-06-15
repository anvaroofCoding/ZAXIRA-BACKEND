export const FIXED_ASSET_REASON_KEY = 'fixed_asset' as const;

export const WAREHOUSE_EXPENSE_REASONS = [
  { key: 'station_use', label: 'Bekatga ishlatish' },
  { key: 'structure_use', label: 'Tuzilmaga ishlatish' },
  { key: 'line_use', label: 'Liniya va rels yo‘nalishiga ishlatish' },
  { key: 'maintenance_repair', label: 'Ta’mirlash va texnik xizmat' },
  { key: 'electrical_work', label: 'Elektr montaj va ulash ishlari' },
  { key: 'ventilation_work', label: 'Ventilyatsiya va konditsioner ishlari' },
  { key: 'signaling_work', label: 'Signalizatsiya va aloqa ishlari' },
  { key: 'cleaning_hygiene', label: 'Tozalash va gigiyena' },
  { key: 'safety_equipment', label: 'Xavfsizlik va yong‘in xavfsizligi' },
  { key: 'employee_issued', label: 'Xodimga berilgan' },
  { key: 'construction_work', label: 'Qurilish va rekonstruksiya ishlari' },
  { key: 'operational_use', label: 'Kundalik operatsion ishlatish' },
  { key: FIXED_ASSET_REASON_KEY, label: 'Asosiy vosita qilish' },
  { key: 'damaged', label: 'Buzilgan yoki shikastlangan' },
  { key: 'expired', label: 'Yaroqlilik muddati o‘tgan' },
  { key: 'spoiled', label: 'Tovar eskirib ketgan / yaroqsizlangan' },
  { key: 'lost', label: 'Yo‘qolgan' },
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

export const isFixedAssetReasonKey = (value: unknown) =>
  value === FIXED_ASSET_REASON_KEY;
