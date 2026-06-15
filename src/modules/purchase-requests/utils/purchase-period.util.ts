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

export const validatePurchasePeriod = (input: PurchasePeriodInput) => {
  if (!input.purchasePeriodType) {
    throw new BadRequestException('Sotib olish davrini tanlang');
  }

  if (!input.purchasePeriodYear) {
    throw new BadRequestException('Sotib olish yilini tanlang');
  }

  if (input.purchasePeriodType === PurchasePeriodType.QUARTER) {
    if (!input.purchasePeriodQuarter) {
      throw new BadRequestException('Chorakni tanlang');
    }
    return;
  }

  if (input.purchasePeriodType === PurchasePeriodType.MONTH) {
    if (!input.purchasePeriodMonth) {
      throw new BadRequestException('Oyni tanlang');
    }
    return;
  }

  throw new BadRequestException('Sotib olish davri noto‘g‘ri');
};

export const formatPurchasePeriodLabel = (input: PurchasePeriodInput): string | null => {
  if (!input.purchasePeriodType || !input.purchasePeriodYear) {
    return null;
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

export const normalizePurchasePeriodFields = (input: PurchasePeriodInput) => ({
  purchasePeriodType: input.purchasePeriodType,
  purchasePeriodYear: input.purchasePeriodYear,
  purchasePeriodQuarter:
    input.purchasePeriodType === PurchasePeriodType.QUARTER
      ? input.purchasePeriodQuarter
      : undefined,
  purchasePeriodMonth:
    input.purchasePeriodType === PurchasePeriodType.MONTH
      ? input.purchasePeriodMonth
      : undefined,
});
