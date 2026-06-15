const DEFAULT_PREFIX = 'ARZ';
const MIN_SUFFIX_LENGTH = 4;

export function normalizeStructurePrefix(shortName?: string | null) {
  const normalized = (shortName ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized || DEFAULT_PREFIX;
}

export function formatRequestCode(
  prefix: string | null | undefined,
  sequence: number,
) {
  const normalizedPrefix = normalizeStructurePrefix(prefix);
  const suffix =
    sequence < 10 ** MIN_SUFFIX_LENGTH
      ? String(sequence).padStart(MIN_SUFFIX_LENGTH, '0')
      : String(sequence);

  return `${normalizedPrefix}${suffix}`;
}

export function structureSequenceKey(structureId: string) {
  return `purchase_request:structure:${structureId}`;
}

export const GENERAL_SEQUENCE_KEY = 'purchase_request:general';

export const NUMBER_SEQUENCE_KEY = 'purchase_request:number';
