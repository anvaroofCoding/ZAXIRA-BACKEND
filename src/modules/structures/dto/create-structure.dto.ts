import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateStructureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(32)
  shortName!: string;
}
