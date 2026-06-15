import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PagePermissionActionsDto {
  @IsBoolean()
  @IsOptional()
  create?: boolean;

  @IsBoolean()
  @IsOptional()
  update?: boolean;

  @IsBoolean()
  @IsOptional()
  delete?: boolean;
}

export class PagePermissionDto {
  @IsBoolean()
  access!: boolean;

  @ValidateNested()
  @Type(() => PagePermissionActionsDto)
  @IsOptional()
  actions?: PagePermissionActionsDto;
}
