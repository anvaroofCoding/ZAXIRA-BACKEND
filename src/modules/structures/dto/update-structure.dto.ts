import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateStructureDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  fullName?: string;

  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(32)
  shortName?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
