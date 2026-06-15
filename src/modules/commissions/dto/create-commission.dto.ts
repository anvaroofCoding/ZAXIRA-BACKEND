import {
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCommissionDto {
  @IsString({ message: 'Komissiya nomi matn bo‘lishi kerak' })
  @IsNotEmpty({ message: 'Komissiya nomini kiriting' })
  @MaxLength(200, { message: 'Komissiya nomi 200 belgidan oshmasligi kerak' })
  name!: string;

  @IsArray({ message: 'A’zolar ro‘yxati massiv bo‘lishi kerak' })
  @ArrayMinSize(1, { message: 'Kamida bitta a’zo tanlang' })
  @IsMongoId({ each: true, message: 'Noto‘g‘ri foydalanuvchi identifikatori' })
  memberIds!: string[];

  @IsMongoId({ message: 'Boshliqni tanlang' })
  @IsNotEmpty({ message: 'Boshliqni tanlang' })
  bossId!: string;
}
