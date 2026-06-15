import { Transform, Type } from 'class-transformer';
import {
  IsArray,
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
      : [],
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
  @Transform(({ value }) => (Array.isArray(value) ? value : []))
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
