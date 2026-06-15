/** Ombor bo‘lmagan tuzilmaga berilmasligi kerak bo‘lgan sahifa ruxsatlari. */
export const WAREHOUSE_PERMISSION_PATHS = [
  '/omborlar/mening-omborim',
  '/omborlar/boshqa-omborlar',
  '/omborlar/chiqim-qilish',
] as const;

export const WAREHOUSE_PERMISSION_DENIED_MESSAGE =
  'Ushbu tuzilmaning ombori mavjud emas';
