import { IsString, MinLength } from 'class-validator';

export class ScanStocktakeBarcodeDto {
  @IsString()
  @MinLength(1)
  barcode!: string;
}
