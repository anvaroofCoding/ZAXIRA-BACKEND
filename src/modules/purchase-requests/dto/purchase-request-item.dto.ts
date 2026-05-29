import { Type } from 'class-transformer';
import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class PurchaseRequestItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  characteristics!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}
