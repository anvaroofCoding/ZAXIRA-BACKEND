import { BadRequestException } from '@nestjs/common';
import {
  parseOptionalBooleanFlag,
  resolveSessionDocumentSource,
} from './session-documents-mode.util';

describe('parseOptionalBooleanFlag', () => {
  it('accepts true-like values', () => {
    expect(parseOptionalBooleanFlag(true)).toBe(true);
    expect(parseOptionalBooleanFlag('true')).toBe(true);
    expect(parseOptionalBooleanFlag('1')).toBe(true);
    expect(parseOptionalBooleanFlag(1)).toBe(true);
  });

  it('accepts false-like values', () => {
    expect(parseOptionalBooleanFlag(false)).toBe(false);
    expect(parseOptionalBooleanFlag('false')).toBe(false);
    expect(parseOptionalBooleanFlag('0')).toBe(false);
    expect(parseOptionalBooleanFlag(0)).toBe(false);
  });

  it('leaves unknown values undefined', () => {
    expect(parseOptionalBooleanFlag(undefined)).toBeUndefined();
    expect(parseOptionalBooleanFlag(null)).toBeUndefined();
    expect(parseOptionalBooleanFlag('')).toBeUndefined();
    expect(parseOptionalBooleanFlag('maybe')).toBeUndefined();
  });
});

describe('resolveSessionDocumentSource', () => {
  it('uses uploads in auto mode when both files are present', () => {
    expect(
      resolveSessionDocumentSource({
        manualDocuments: false,
        hasBildirgiUpload: true,
        hasKelishuvUpload: true,
        sessionDocsReady: false,
      }),
    ).toBe('uploads');
  });

  it('uses prepared session docs in auto mode when uploads are omitted', () => {
    expect(
      resolveSessionDocumentSource({
        manualDocuments: false,
        hasBildirgiUpload: false,
        hasKelishuvUpload: false,
        sessionDocsReady: true,
      }),
    ).toBe('session');
  });

  it('rejects auto mode when documents are missing', () => {
    expect(() =>
      resolveSessionDocumentSource({
        manualDocuments: false,
        hasBildirgiUpload: false,
        hasKelishuvUpload: false,
        sessionDocsReady: false,
      }),
    ).toThrow(BadRequestException);
  });

  it('requires both uploads in manual mode unless session files already exist', () => {
    expect(() =>
      resolveSessionDocumentSource({
        manualDocuments: true,
        hasBildirgiUpload: false,
        hasKelishuvUpload: false,
        sessionDocsReady: false,
      }),
    ).toThrow(/Qo‘lda yuklash rejimida bildirgi va kelishuv/);

    expect(() =>
      resolveSessionDocumentSource({
        manualDocuments: true,
        hasBildirgiUpload: true,
        hasKelishuvUpload: false,
        sessionDocsReady: false,
      }),
    ).toThrow(/kelishuv Word fayli yuborilmadi/);

    expect(
      resolveSessionDocumentSource({
        manualDocuments: true,
        hasBildirgiUpload: true,
        hasKelishuvUpload: true,
        sessionDocsReady: false,
      }),
    ).toBe('uploads');

    expect(
      resolveSessionDocumentSource({
        manualDocuments: true,
        hasBildirgiUpload: false,
        hasKelishuvUpload: false,
        sessionDocsReady: true,
      }),
    ).toBe('session');
  });
});
