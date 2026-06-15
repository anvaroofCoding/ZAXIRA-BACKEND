import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class MarkItemsUnavailableDto {
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  itemIndexes!: number[];

  @IsString()
  @MinLength(5, { message: 'Izoh kamida 5 belgidan iborat bo‘lishi kerak' })
  comment!: string;
}
