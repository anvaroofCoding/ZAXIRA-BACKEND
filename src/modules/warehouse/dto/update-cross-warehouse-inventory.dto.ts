import { Type } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateCrossWarehouseInventoryDto {
  @IsMongoId()
  structureId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  characteristics?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  nomenclatureCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  barcode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsInt()
  @Min(0)
  quantity?: number;
}
