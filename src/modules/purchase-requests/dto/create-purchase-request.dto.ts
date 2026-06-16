import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PurchasePeriodType } from '../enums/purchase-period-type.enum';
import { PurchaseRequestItemDto } from './purchase-request-item.dto';

export class CreatePurchaseRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  commissionMemberIds!: string[];

  @IsMongoId()
  bossId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequestItemDto)
  items!: PurchaseRequestItemDto[];

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  commissionAgreementText?: string;

  /** ISO 8601 sana (masalan: 2026-06-15) */
  @IsOptional()
  @IsDateString()
  purchaseDeadline?: string;

  /** Muddat majburiy bo‘lsa true */
  @IsOptional()
  @IsBoolean()
  purchaseDeadlineMandatory?: boolean;

  @IsOptional()
  @IsEnum(PurchasePeriodType)
  purchasePeriodType?: PurchasePeriodType;

  @ValidateIf((dto) => dto.purchasePeriodType !== PurchasePeriodType.PLAIN)
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  purchasePeriodYear?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  purchasePeriodQuarter?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  purchasePeriodMonth?: number;
}
