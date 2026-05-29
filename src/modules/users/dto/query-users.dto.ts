import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class QueryUsersDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 10;

  @IsString()
  @IsOptional()
  search?: string;

  @IsMongoId()
  @IsOptional()
  structureId?: string;

  /** Forma selectlari uchun: `1` yuborilsa faqat id, displayName, login qaytadi */
  @IsOptional()
  @IsIn(['1', 'true'])
  forSelect?: string;
}
