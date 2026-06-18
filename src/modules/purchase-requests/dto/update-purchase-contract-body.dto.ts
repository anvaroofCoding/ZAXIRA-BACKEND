import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdatePurchaseContractBodyDto {
  @IsNotEmpty()
  @IsString()
  batchId!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  contractNumber!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(240)
  organizationName!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(14)
  innOrPinfl!: string;

  @IsNotEmpty()
  @IsIn(['inn', 'pinfl'])
  innOrPinflType!: 'inn' | 'pinfl';
}
