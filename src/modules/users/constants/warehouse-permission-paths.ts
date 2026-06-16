/** Ombor bo‘lmagan tuzilmaga berilmasligi kerak bo‘lgan sahifa ruxsatlari. */
export const WAREHOUSE_PERMISSION_PATHS = [
  '/omborlar/mening-omborim',
  '/omborlar/tavar-import-qilish',
  '/omborlar/boshqa-omborlar',
  '/omborlar/2d-omborlar',
  '/omborlar/chiqim-qilish',
] as const;

export const WAREHOUSE_PERMISSION_DENIED_MESSAGE =
  'Ushbu tuzilmaning ombori mavjud emas';
