import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';
import { AssignedTaskStatus } from '../enums/assigned-task-status.enum';

export class QueryAssignedTasksDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsMongoId()
  structureId?: string;

  @IsOptional()
  @IsEnum(AssignedTaskStatus)
  status?: AssignedTaskStatus;

  @IsOptional()
  @IsString()
  search?: string;
}
