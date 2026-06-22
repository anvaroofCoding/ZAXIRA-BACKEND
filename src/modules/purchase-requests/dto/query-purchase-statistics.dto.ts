import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class QueryPurchaseStatisticsDto {
  @IsOptional()
  @IsMongoId()
  structureId?: string;

  @IsOptional()
  @IsIn(['yearly', 'monthly'])
  granularity?: 'yearly' | 'monthly' = 'yearly';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
