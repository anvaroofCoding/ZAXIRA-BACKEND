import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CancelTransferDispatchDto {
  @IsString()
  @MinLength(1)
  reasonKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonOther?: string;
}
