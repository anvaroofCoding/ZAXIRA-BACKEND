import { NotFoundException } from '@nestjs/common';
import { stat } from 'node:fs/promises';

const MISSING_FILE_CODES = new Set([
  'ENOENT',
  'ENOTDIR',
  'NoSuchKey',
  'NotFound',
  'NoSuchBucket',
]);

export function isMissingStoredFileError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  const name = 'name' in error ? String((error as { name?: unknown }).name) : '';
  const message =
    error instanceof Error ? error.message : String(error ?? '');

  return (
    MISSING_FILE_CODES.has(code) ||
    MISSING_FILE_CODES.has(name) ||
    /enoent|no such file|nosuchkey|not found/i.test(message)
  );
}

export async function assertReadableFile(
  filePath: string,
  message = 'Hujjat topilmadi',
) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size <= 0) {
      throw new NotFoundException(message);
    }
  } catch (error) {
    if (error instanceof NotFoundException) {
      throw error;
    }

    if (isMissingStoredFileError(error)) {
      throw new NotFoundException(message);
    }

    throw new NotFoundException(message);
  }
}
