import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { WAREHOUSE_FIXED_ASSET_STATUSES } from '../schemas/warehouse-fixed-asset.schema';

export class QueryWarehouseFixedAssetsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  serviceStructureId?: string;

  @IsString()
  @IsOptional()
  @IsIn(WAREHOUSE_FIXED_ASSET_STATUSES)
  status?: string;
}
