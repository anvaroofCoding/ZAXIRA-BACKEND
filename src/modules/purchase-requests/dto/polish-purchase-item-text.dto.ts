import { IsString, MaxLength } from 'class-validator';

export class PolishPurchaseItemTextDto {
  @IsString()
  @MaxLength(1000)
  name!: string;

  @IsString()
  @MaxLength(4000)
  characteristics!: string;
}
