import { createRequire } from 'node:module';

const nodeRequire = createRequire(__filename);

const FONT_FILES = {
  regular: 'DejaVuSans.ttf',
  bold: 'DejaVuSans-Bold.ttf',
} as const;

function resolvePdfFontPath(weight: keyof typeof FONT_FILES): string {
  return nodeRequire.resolve(`dejavu-fonts-ttf/ttf/${FONT_FILES[weight]}`);
}

/** PDFKit uchun barqaror font yo‘li (serverda cwd dan mustaqil). */
export const PDF_FONT_REGULAR_PATH = resolvePdfFontPath('regular');
export const PDF_FONT_BOLD_PATH = resolvePdfFontPath('bold');
