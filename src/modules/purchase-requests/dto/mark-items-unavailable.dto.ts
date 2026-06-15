import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class MarkUnavailableItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  itemIndex!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class MarkItemsUnavailableDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  itemIndexes?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MarkUnavailableItemDto)
  unavailableItems?: MarkUnavailableItemDto[];

  @IsString()
  @MinLength(5, { message: 'Izoh kamida 5 belgidan iborat bo‘lishi kerak' })
  comment!: string;
}
