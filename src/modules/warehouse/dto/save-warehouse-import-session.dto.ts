import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class WarehouseImportSessionItemDto {
  @IsString()
  @MaxLength(300)
  name!: string;

  @IsString()
  @MaxLength(500)
  characteristics!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  @MaxLength(50)
  unit!: string;

  @IsString()
  @MaxLength(120)
  manufacturingCountry!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  nomenclatureCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitPrice?: number;
}

export class SaveWarehouseImportSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsMongoId()
  locationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WarehouseImportSessionItemDto)
  items?: WarehouseImportSessionItemDto[];
}
