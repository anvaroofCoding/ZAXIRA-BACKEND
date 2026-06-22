import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SetGlobalSecondCodeDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  codeConfirm!: string;
}
