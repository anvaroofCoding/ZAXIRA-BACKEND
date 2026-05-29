import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { StocktakeStatus } from '../enums/stocktake-status.enum';

export class QueryStocktakesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(StocktakeStatus)
  status?: StocktakeStatus;

  @IsOptional()
  @IsString()
  structureId?: string;
}
