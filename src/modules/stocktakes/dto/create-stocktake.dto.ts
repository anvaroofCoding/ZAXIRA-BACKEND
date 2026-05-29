import { IsEnum, IsMongoId, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { StocktakeMode } from '../enums/stocktake-mode.enum';

export class CreateStocktakeDto {
  @IsMongoId()
  structureId!: string;

  @IsEnum(StocktakeMode)
  mode!: StocktakeMode;

  @ValidateIf((dto: CreateStocktakeDto) => dto.mode === StocktakeMode.LOCATION)
  @IsMongoId()
  locationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
