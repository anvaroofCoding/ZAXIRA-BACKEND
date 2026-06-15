import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class QueryPurchasingInboxDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN)
  dateFrom?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN)
  dateTo?: string;

  @IsOptional()
  @IsIn(['purchased', 'unavailable'])
  inboxType?: 'purchased' | 'unavailable';

  @IsOptional()
  @IsMongoId()
  structureId?: string;
}
