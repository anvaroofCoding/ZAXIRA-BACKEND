export const computeWarehouseBarcode = (
  name: string,
  characteristics: string,
) => {
  const raw = `${String(name ?? '')}|${String(characteristics ?? '')}`;
  let hash = 0;

  for (let i = 0; i < raw.length; i += 1) {
    // Uint32 overflow like JS (>>> 0)
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }

  const suffix = String(hash).padStart(10, '0');
  return `WH${suffix.slice(0, 10)}`;
};

