import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class WarehouseExpenseItemDto {
  @IsString()
  @IsOptional()
  locationId?: string;

  @IsString()
  @IsNotEmpty()
  barcode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateWarehouseExpenseDto {
  @IsString()
  @IsOptional()
  locationId?: string;

  @IsString()
  @IsNotEmpty()
  reasonKey!: string;

  @IsString()
  @IsOptional()
  @MinLength(0)
  comment?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WarehouseExpenseItemDto)
  items!: WarehouseExpenseItemDto[];
}

