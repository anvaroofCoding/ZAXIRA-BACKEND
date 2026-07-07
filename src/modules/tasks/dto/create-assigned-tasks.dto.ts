import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsMongoId,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateAssignedTasksDto {
  @IsMongoId()
  structureId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  assigneeIds!: string[];

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  description!: string;

  @IsDateString()
  dueDate!: string;
}
