import {
  IsBoolean,
  IsMongoId,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  position?: string;

  @IsString()
  @IsOptional()
  @MinLength(6)
  password?: string;

  @IsString()
  @IsOptional()
  @MinLength(4)
  secondCode?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsMongoId()
  @IsOptional()
  structureId?: string;
}
