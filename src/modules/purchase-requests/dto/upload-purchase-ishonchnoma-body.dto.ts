import { IsNotEmpty, IsString } from 'class-validator';

export class UploadPurchaseIshonchnomaBodyDto {
  @IsString()
  @IsNotEmpty()
  batchId!: string;
}
