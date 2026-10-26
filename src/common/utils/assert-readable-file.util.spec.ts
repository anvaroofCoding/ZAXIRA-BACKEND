import { NotFoundException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  assertReadableFile,
  isMissingStoredFileError,
} from './assert-readable-file.util';

describe('isMissingStoredFileError', () => {
  it('detects ENOENT and NoSuchKey style errors', () => {
    expect(isMissingStoredFileError({ code: 'ENOENT' })).toBe(true);
    expect(isMissingStoredFileError({ code: 'NoSuchKey' })).toBe(true);
    expect(isMissingStoredFileError({ name: 'NoSuchKey' })).toBe(true);
    expect(isMissingStoredFileError(new Error('NoSuchKey'))).toBe(true);
    expect(isMissingStoredFileError({ code: 'EACCES' })).toBe(false);
  });
});

describe('assertReadableFile', () => {
  it('returns 404 for a missing path instead of leaking ENOENT', async () => {
    await expect(
      assertReadableFile('/tmp/zaxira-missing-file-404.docx', 'Hujjat topilmadi'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts an existing non-empty file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zaxira-docs-'));
    const filePath = path.join(dir, 'bildirgi.docx');
    await writeFile(filePath, 'docx');

    await expect(assertReadableFile(filePath)).resolves.toBeUndefined();
    await rm(dir, { recursive: true, force: true });
  });
});
