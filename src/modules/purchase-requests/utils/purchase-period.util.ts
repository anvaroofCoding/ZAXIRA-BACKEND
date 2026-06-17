import { BadRequestException } from '@nestjs/common';
import { PurchasePeriodType } from '../enums/purchase-period-type.enum';

const UZ_MONTHS = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentyabr',
  'oktyabr',
  'noyabr',
  'dekabr',
] as const;

const QUARTER_MONTHS: Record<number, string> = {
  1: 'yanvar, fevral, mart',
  2: 'aprel, may, iyun',
  3: 'iyul, avgust, sentyabr',
  4: 'oktyabr, noyabr, dekabr',
};

export type PurchasePeriodInput = {
  purchasePeriodType?: PurchasePeriodType;
  purchasePeriodYear?: number;
  purchasePeriodQuarter?: number;
  purchasePeriodMonth?: number;
};

export const parsePurchasePeriodType = (
  value: unknown,
): PurchasePeriodType | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized === PurchasePeriodType.PLAIN ||
    normalized === PurchasePeriodType.YEAR ||
    normalized === PurchasePeriodType.QUARTER ||
    normalized === PurchasePeriodType.MONTH
  ) {
    return normalized as PurchasePeriodType;
  }

  return undefined;
};

export const resolvePurchasePeriodType = (
  value: unknown,
  fallback: PurchasePeriodType = PurchasePeriodType.PLAIN,
): PurchasePeriodType => parsePurchasePeriodType(value) ?? fallback;

export const validatePurchasePeriod = (input: PurchasePeriodInput) => {
  const rawPeriodType = input.purchasePeriodType;

  if (
    rawPeriodType != null &&
    String(rawPeriodType).trim() !== '' &&
    !parsePurchasePeriodType(rawPeriodType)
  ) {
    throw new BadRequestException('Sotib olish davri noto‘g‘ri');
  }

  const purchasePeriodType = resolvePurchasePeriodType(input.purchasePeriodType);

  if (purchasePeriodType === PurchasePeriodType.PLAIN) {
    return;
  }

  if (!input.purchasePeriodYear) {
    throw new BadRequestException('Sotib olish yilini tanlang');
  }

  if (purchasePeriodType === PurchasePeriodType.YEAR) {
    return;
  }

  if (purchasePeriodType === PurchasePeriodType.QUARTER) {
    if (!input.purchasePeriodQuarter) {
      throw new BadRequestException('Chorakni tanlang');
    }
    return;
  }

  if (purchasePeriodType === PurchasePeriodType.MONTH) {
    if (!input.purchasePeriodMonth) {
      throw new BadRequestException('Oyni tanlang');
    }
    return;
  }

  throw new BadRequestException('Sotib olish davri noto‘g‘ri');
};

export const formatPurchasePeriodLabel = (input: PurchasePeriodInput): string | null => {
  if (!input.purchasePeriodType) {
    return null;
  }

  if (input.purchasePeriodType === PurchasePeriodType.PLAIN) {
    return 'Oddiy';
  }

  if (!input.purchasePeriodYear) {
    return null;
  }

  if (input.purchasePeriodType === PurchasePeriodType.YEAR) {
    return `${input.purchasePeriodYear} yil`;
  }

  if (input.purchasePeriodType === PurchasePeriodType.QUARTER) {
    if (!input.purchasePeriodQuarter) return null;
    return `${input.purchasePeriodYear} yil, ${input.purchasePeriodQuarter}-chorak (${QUARTER_MONTHS[input.purchasePeriodQuarter]})`;
  }

  if (input.purchasePeriodType === PurchasePeriodType.MONTH) {
    if (!input.purchasePeriodMonth) return null;
    const monthName = UZ_MONTHS[input.purchasePeriodMonth - 1] ?? '';
    return `${input.purchasePeriodYear} yil, ${monthName}`;
  }

  return null;
};

export const normalizePurchasePeriodFields = (input: PurchasePeriodInput) => {
  const purchasePeriodType = resolvePurchasePeriodType(input.purchasePeriodType);

  if (purchasePeriodType === PurchasePeriodType.PLAIN) {
    return {
      purchasePeriodType: PurchasePeriodType.PLAIN,
      purchasePeriodYear: undefined,
      purchasePeriodQuarter: undefined,
      purchasePeriodMonth: undefined,
    };
  }

  return {
    purchasePeriodType,
    purchasePeriodYear: input.purchasePeriodYear,
    purchasePeriodQuarter:
      purchasePeriodType === PurchasePeriodType.QUARTER
        ? input.purchasePeriodQuarter
        : undefined,
    purchasePeriodMonth:
      purchasePeriodType === PurchasePeriodType.MONTH
        ? input.purchasePeriodMonth
        : undefined,
  };
};
