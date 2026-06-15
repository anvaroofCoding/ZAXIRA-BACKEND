import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ExcessAdjustmentItemDto {
  @IsString()
  lineKey!: string;

  /** Ko‘p sanalgan tovar — skladdan ayirish */
  @IsOptional()
  @IsInt()
  @Min(0)
  deductQuantity?: number;

  /** Kam sanalgan tovar — skladga qo‘shish */
  @IsOptional()
  @IsInt()
  @Min(0)
  addQuantity?: number;
}

export class ApplyExcessAdjustmentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExcessAdjustmentItemDto)
  items!: ExcessAdjustmentItemDto[];
}
