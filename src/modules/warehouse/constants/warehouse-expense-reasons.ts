export const WAREHOUSE_EXPENSE_REASONS = [
  { key: 'internal_use', label: 'Ichki ishlatish' },
  { key: 'operational_use', label: 'Operatsion ishlatish (kundalik ish)' },
  { key: 'production_use', label: 'Ishlab chiqarishda sarflangan' },
  { key: 'service_delivery', label: 'Xizmat ko‘rsatishda sarflangan' },
  { key: 'maintenance_repair', label: 'Ta’mirlash va texnik xizmat' },
  { key: 'cleaning_hygiene', label: 'Tozalash va gigiyena' },
  { key: 'office_supplies', label: 'Ofis va ma’muriy ehtiyojlar' },
  { key: 'food_catering', label: 'Ovqatlanish / oziq-ovqat' },
  { key: 'medical_first_aid', label: 'Davolash / birinchi yordam' },
  { key: 'employee_issued', label: 'Xodimga berilgan' },
  { key: 'event_ceremony', label: 'Tadbir yoki marosimda ishlatilgan' },
  { key: 'sample_demo', label: 'Namuna yoki sinov uchun' },
  { key: 'marketing_promo', label: 'Reklama va targ‘ibot uchun' },
  { key: 'training_education', label: 'O‘qitish / trening uchun' },
  { key: 'damaged', label: 'Buzilgan yoki shikastlangan' },
  { key: 'transport_damage', label: 'Yetkazib berishda shikastlangan' },
  { key: 'storage_damage', label: 'Omborda saqlashda shikastlangan' },
  { key: 'defective', label: 'Nuqsonli mahsulot' },
  { key: 'expired', label: 'Yaroqlilik muddati o‘tgan' },
  { key: 'spoiled', label: 'Buzuilgan / yaroqsizlangan' },
  { key: 'lost', label: 'Yo‘qolgan' },
  { key: 'theft', label: 'O‘g‘irlik' },
  { key: 'inventory_shortage', label: 'Inventarizatsiya kamomadi' },
  { key: 'writeoff', label: 'Hisobdan chiqarish' },
  { key: 'non_compliant', label: 'Standart yoki talabga mos emas' },
  { key: 'other', label: 'Boshqa' },
] as const;

export type WarehouseExpenseReasonKey =
  (typeof WAREHOUSE_EXPENSE_REASONS)[number]['key'];

export const isWarehouseExpenseReasonKey = (
  value: unknown,
): value is WarehouseExpenseReasonKey =>
  typeof value === 'string' &&
  WAREHOUSE_EXPENSE_REASONS.some((r) => r.key === value);
