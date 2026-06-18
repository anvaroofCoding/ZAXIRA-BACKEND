export const PERMISSION_ACTION_KEYS = ['create', 'update', 'delete'] as const;

export type PermissionActionKey = (typeof PERMISSION_ACTION_KEYS)[number];

export interface PermissionCatalogPage {
  path: string;
  label: string;
}

export interface PermissionCatalogGroup {
  key: string;
  label: string;
  pages: PermissionCatalogPage[];
}

export interface PermissionCatalogLink {
  path: string;
  label: string;
}

export const PERMISSION_CATALOG = {
  links: [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/dashboard/maxsulotlar', label: 'Maxsulotlar' },
    { path: '/dashboard/2d-omborlar', label: '2D Omborlar' },
  ] satisfies PermissionCatalogLink[],
  groups: [
    {
      key: 'royxatga-olish',
      label: "Ro'yxatga olish",
      pages: [
        {
          path: '/royxatga-olish/foydalanuvchilar',
          label: 'Foydalanuvchilar',
        },
        { path: '/royxatga-olish/tuzilmalar', label: 'Tarkibiy tuzilmalar' },
        {
          path: '/royxatga-olish/komissiya-azolari',
          label: "Komissiya a'zolari",
        },
      ],
    },
    {
      key: 'xaridlar',
      label: 'Xaridlar',
      pages: [
        { path: '/xaridlar/arizalar-yuborish', label: 'Arizalar yuborish' },
        {
          path: '/xaridlar/arizalarni-tasdiqlash',
          label: 'Arizalarni tasdiqlash',
        },
        { path: '/xaridlar/arizalar-tarixi', label: 'Arizalar tarixi' },
      ],
    },
    {
      key: 'xarid-qilish',
      label: 'Xarid qilish',
      pages: [
        {
          path: '/xarid-qilish/sotib-olinadigan-tavarlar',
          label: 'Sotib olinadigan maxsulotlar',
        },
        {
          path: '/xarid-qilish/xarid-qilingan-tavarlar',
          label: 'Xarid qilingan tavarlar',
        },
        {
          path: '/xarid-qilish/xaridni-qabul-qilish',
          label: 'Xaridni qabul qilish',
        },
        {
          path: '/xarid-qilish/ishonchnoma',
          label: 'Ishonchnoma',
        },
      ],
    },
    {
      key: 'omborlar',
      label: 'Omborlar',
      pages: [
        { path: '/omborlar/mening-omborim', label: 'Mening omborim' },
        { path: '/omborlar/tavar-import-qilish', label: 'Tavar import qilish' },
        { path: '/omborlar/boshqa-omborlar', label: 'Boshqa omborlar' },
        { path: '/omborlar/chiqim-qilish', label: 'Chiqim' },
      ],
    },
    {
      key: 'transfer',
      label: 'Transfer',
      pages: [
        { path: '/transfer/transfer-qilish', label: 'Transfer qilish' },
        {
          path: '/transfer/transferni-qabul-qilish',
          label: 'Transferni qabul qilish',
        },
        { path: '/transfer/transferlar-tarixi', label: 'Transferlar tarixi' },
      ],
    },
    {
      key: 'invertarizatsiya',
      label: 'Invertarizatsiya',
      pages: [
        {
          path: '/invertarizatsiya/invertarizatsiya-qilish',
          label: 'Invertarizatsiya qilish',
        },
        {
          path: '/invertarizatsiya/barcha-invertarizatsiyalar',
          label: 'Barcha invertarizatsiyalar',
        },
        {
          path: '/invertarizatsiya/boshqaruv',
          label: 'Boshqaruv',
        },
      ],
    },
  ] satisfies PermissionCatalogGroup[],
};

export const ALL_PERMISSION_PATHS = [
  ...PERMISSION_CATALOG.links.map((item) => item.path),
  ...PERMISSION_CATALOG.groups.flatMap((group) =>
    group.pages.map((page) => page.path),
  ),
];
