import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class OverrideLoginDto {
  @IsString()
  @IsNotEmpty()
  targetUserId!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  codeConfirm!: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}
