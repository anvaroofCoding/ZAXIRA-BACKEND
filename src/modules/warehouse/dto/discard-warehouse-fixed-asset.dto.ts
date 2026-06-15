import { IsOptional, IsString } from 'class-validator';

export class DiscardWarehouseFixedAssetDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
