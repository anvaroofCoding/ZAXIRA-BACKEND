import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
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

export class ResubmitPurchaseRequestDto {
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

  /** `boss` — faqat boshliqqa; `commission` — rad etgan a’zolarga */
  @IsOptional()
  @IsIn(['boss', 'commission'])
  resubmitTarget?: 'boss' | 'commission';

  /** Rad etgan komissiya a’zolaridan qaysilariga qayta kelishish yuboriladi */
  @ValidateIf((dto) => dto.resubmitTarget !== 'boss')
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  resubmitToMemberIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  commissionMemberIds?: string[];

  @IsOptional()
  @IsMongoId()
  bossId?: string;

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
