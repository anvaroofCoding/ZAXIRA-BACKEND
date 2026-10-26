import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Types } from 'mongoose';
import { PurchasePeriodType } from '../enums/purchase-period-type.enum';

export class SavePurchaseRequestSessionItemDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  characteristics?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value == null) return 1;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return parsed;
  })
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  manufacturingCountry?: string;
}

export class SavePurchaseRequestSessionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsArray()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.filter((id) => typeof id === 'string' && Types.ObjectId.isValid(id))
      : undefined,
  )
  @IsMongoId({ each: true })
  commissionMemberIds?: string[];

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value == null ? undefined : value,
  )
  @IsMongoId()
  bossId?: string;

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (Array.isArray(value) ? value : undefined))
  @ValidateNested({ each: true })
  @Type(() => SavePurchaseRequestSessionItemDto)
  items?: SavePurchaseRequestSessionItemDto[];

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  commissionAgreementText?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1' || value === 1) {
      return true;
    }
    if (value === false || value === 'false' || value === '0' || value === 0) {
      return false;
    }
    return undefined;
  })
  @IsBoolean()
  manualDocuments?: boolean;

  @IsOptional()
  @IsEnum(PurchasePeriodType)
  purchasePeriodType?: PurchasePeriodType;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value == null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  purchasePeriodYear?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value == null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  purchasePeriodQuarter?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value == null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  purchasePeriodMonth?: number;
}
