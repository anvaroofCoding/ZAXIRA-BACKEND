import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateStocktakeLineDto {
  @IsOptional()
  @IsString()
  lineKey?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsInt()
  @Min(0)
  countedQuantity!: number;
}
