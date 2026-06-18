import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePurchaseBatchContractDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contractNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  organizationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(14)
  innOrPinfl?: string;

  @IsOptional()
  @IsIn(['', 'inn', 'pinfl'])
  innOrPinflType?: '' | 'inn' | 'pinfl';
}
