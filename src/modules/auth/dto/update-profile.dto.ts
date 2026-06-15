import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  displayName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  position?: string;

  @IsMongoId()
  @IsOptional()
  structureId?: string;
}
