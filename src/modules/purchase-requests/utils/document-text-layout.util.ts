export const AGREEMENT_TITLE_LINES = [
  '"Tovarlar, ishlar va xizmatlar xaridi maqsadga',
  'muvofiqligi va zarurligi to\'g\'risida"gi',
] as const;

/** Kelishuv varaqasidagi 1–2 band matnini hujjat paragraflariga ajratadi */
export function parseAgreementParagraphs(text?: string | null): string[] {
  const raw = (text ?? '').trim();
  if (!raw) return [];

  const byBlankLine = raw
    .split(/\r?\n\s*\r?\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (byBlankLine.length > 1) {
    return byBlankLine;
  }

  const byLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return byLine.length ? byLine : [raw];
}

export const STRUCTURE_TITLE_SUFFIX = "xizmati boshlig'i";

/** A4 hujjatdagi buyurtmachi/tuzilma matni uchun maksimal kenglik (pt). */
export const DOCUMENT_BUYER_TEXT_MAX_WIDTH_PT = 340;

export function splitStructureTitle(fullName: string) {
  const trimmed = fullName.trim();
  const suffixPattern = /\s*xizmati\s+boshlig['']i\s*$/i;

  if (suffixPattern.test(trimmed)) {
    return {
      body: trimmed.replace(suffixPattern, '').trim(),
      suffix: STRUCTURE_TITLE_SUFFIX,
      includesSuffix: true,
    };
  }

  return {
    body: trimmed,
    suffix: STRUCTURE_TITLE_SUFFIX,
    includesSuffix: false,
  };
}

export function wrapWords(
  text: string,
  maxWidth: number,
  measureWidth: (value: string) => number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [''];
  }

  const lines: string[] = [];
  let current = words[0];

  for (let index = 1; index < words.length; index += 1) {
    const candidate = `${current} ${words[index]}`;
    if (measureWidth(candidate) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[index];
    }
  }

  lines.push(current);
  return lines;
}

export function buildBuyerTitleLines(
  structureName: string,
  maxWidth: number,
  measureWidth: (value: string) => number,
): string[] {
  const { body, suffix } = splitStructureTitle(structureName);
  const source = body || structureName.trim() || '—';
  const wrapped = wrapWords(source, maxWidth, measureWidth);

  if (!wrapped.length) {
    return [suffix];
  }

  const lastIndex = wrapped.length - 1;
  wrapped[lastIndex] = `${wrapped[lastIndex]} ${suffix}`.trim();
  return wrapped;
}

/** DOCX uchun taxminiy o'lchov (11pt shrift, A4 chap blok). */
export function estimateTextWidth(value: string, fontSizeHalfPoints = 22) {
  const fontSizePt = fontSizeHalfPoints / 2;
  return value.length * fontSizePt * 0.48;
}
