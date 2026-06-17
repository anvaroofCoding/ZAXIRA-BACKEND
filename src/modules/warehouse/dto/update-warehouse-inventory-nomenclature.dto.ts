import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateWarehouseInventoryNomenclatureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  nomenclatureCode!: string;
}
