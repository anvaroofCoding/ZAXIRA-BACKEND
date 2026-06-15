export const buildWarehouseItemKey = (name: string, characteristics: string) =>
  `${String(name ?? '')
    .trim()
    .toLowerCase()}|${String(characteristics ?? '')
    .trim()
    .toLowerCase()}`;
