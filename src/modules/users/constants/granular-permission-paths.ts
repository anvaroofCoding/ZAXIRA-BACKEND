import { DASHBOARD_PAGE_PATH, ISHONCHNOMA_PAGE_PATH, PRODUCTS_PAGE_PATH } from './disabled-page-actions';

/** Kirish va amallar alohida boshqariladigan sahifalar — legacy auto-enable qo‘llanmaydi */
export const GRANULAR_PERMISSION_PATHS = new Set<string>([
  DASHBOARD_PAGE_PATH,
  PRODUCTS_PAGE_PATH,
  ISHONCHNOMA_PAGE_PATH,
  '/invertarizatsiya/invertarizatsiya-qilish',
  '/invertarizatsiya/barcha-invertarizatsiyalar',
  '/invertarizatsiya/boshqaruv',
  '/royxatga-olish/foydalanuvchilar',
  '/royxatga-olish/tuzilmalar',
  '/royxatga-olish/komissiya-azolari',
]);

export const isGranularPermissionPath = (path: string): boolean =>
  GRANULAR_PERMISSION_PATHS.has(path);
