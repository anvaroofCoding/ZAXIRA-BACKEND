import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ToBoolean } from '../../../common/transforms/to-boolean.transform';

export class UpdateCommissionDto {
  @IsString({ message: 'Komissiya nomi matn bo‘lishi kerak' })
  @IsOptional()
  @MaxLength(200, { message: 'Komissiya nomi 200 belgidan oshmasligi kerak' })
  name?: string;

  @IsArray({ message: 'A’zolar ro‘yxati massiv bo‘lishi kerak' })
  @ArrayMinSize(1, { message: 'Kamida bitta a’zo tanlang' })
  @IsMongoId({ each: true, message: 'Noto‘g‘ri foydalanuvchi identifikatori' })
  @IsOptional()
  memberIds?: string[];

  @IsMongoId({ message: 'Noto‘g‘ri boshliq identifikatori' })
  @IsOptional()
  bossId?: string;

  @ToBoolean()
  @IsBoolean({ message: 'Holat faqat Ha yoki Yo‘q bo‘lishi kerak' })
  @IsOptional()
  isActive?: boolean;
}
