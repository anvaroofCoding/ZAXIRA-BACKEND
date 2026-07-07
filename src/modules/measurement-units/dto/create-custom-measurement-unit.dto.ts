import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCustomMeasurementUnitDto {
  @IsString({ message: 'Birlik nomi matn bo‘lishi kerak' })
  @IsNotEmpty({ message: 'Birlik nomini kiriting' })
  @MaxLength(64, { message: 'Birlik nomi 64 belgidan oshmasligi kerak' })
  name!: string;
}
