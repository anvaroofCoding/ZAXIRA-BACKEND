import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
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
}
