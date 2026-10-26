import { BadRequestException } from '@nestjs/common';

export type SessionDocumentSource = 'uploads' | 'session';

export function parseOptionalBooleanFlag(value: unknown): boolean | undefined {
  if (value === true || value === 'true' || value === '1' || value === 1) {
    return true;
  }

  if (value === false || value === 'false' || value === '0' || value === 0) {
    return false;
  }

  return undefined;
}

export function resolveSessionDocumentSource(options: {
  manualDocuments: boolean;
  hasBildirgiUpload: boolean;
  hasKelishuvUpload: boolean;
  sessionDocsReady: boolean;
}): SessionDocumentSource {
  const {
    manualDocuments,
    hasBildirgiUpload,
    hasKelishuvUpload,
    sessionDocsReady,
  } = options;
  const hasBothUploads = hasBildirgiUpload && hasKelishuvUpload;
  const hasPartialUploads = hasBildirgiUpload !== hasKelishuvUpload;

  if (manualDocuments) {
    if (hasBothUploads) {
      return 'uploads';
    }

    if (!hasPartialUploads && sessionDocsReady) {
      return 'session';
    }

    if (!hasBildirgiUpload && !hasKelishuvUpload) {
      throw new BadRequestException(
        'Qo‘lda yuklash rejimida bildirgi va kelishuv Word fayllari yuborilishi shart',
      );
    }

    throw new BadRequestException(
      hasBildirgiUpload
        ? 'Qo‘lda yuklash rejimida kelishuv Word fayli yuborilmadi'
        : 'Qo‘lda yuklash rejimida bildirgi Word fayli yuborilmadi',
    );
  }

  if (hasBothUploads) {
    return 'uploads';
  }

  if (hasPartialUploads) {
    throw new BadRequestException(
      'Bildirgi va kelishuv Word fayllari juft holda yuborilishi kerak',
    );
  }

  if (sessionDocsReady) {
    return 'session';
  }

  throw new BadRequestException(
    'Bildirgi va kelishuv hujjatlari tayyor emas — avval yuklab oling va qayta yuklang',
  );
}
