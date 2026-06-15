import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ToBoolean } from '../../../common/transforms/to-boolean.transform';

export class UpdateStructureDto {
  @IsString({ message: 'To‘liq nomi matn bo‘lishi kerak' })
  @IsOptional()
  @MaxLength(200, { message: 'To‘liq nomi 200 belgidan oshmasligi kerak' })
  fullName?: string;

  @IsString({ message: 'Qisqa nomi matn bo‘lishi kerak' })
  @IsOptional()
  @MinLength(1, { message: 'Qisqa nomini kiriting' })
  @MaxLength(32, { message: 'Qisqa nom 32 belgidan oshmasligi kerak' })
  shortName?: string;

  @ToBoolean()
  @IsBoolean({ message: 'Holat faqat Ha yoki Yo‘q bo‘lishi kerak' })
  @IsOptional()
  isActive?: boolean;

  @ToBoolean()
  @IsBoolean({ message: 'Ombori bormi — Ha yoki Yo‘q tanlang' })
  @IsOptional()
  hasWarehouse?: boolean;

  @ToBoolean()
  @IsBoolean({ message: 'Raxbarmi — Ha yoki Yo‘q tanlang' })
  @IsOptional()
  hasLeader?: boolean;

  @IsString({ message: 'Raxbari F.I.O. matn bo‘lishi kerak' })
  @IsOptional()
  @IsNotEmpty({ message: 'Raxbari F.I.O. ni kiriting' })
  @MaxLength(120, { message: 'Raxbari F.I.O. 120 belgidan oshmasligi kerak' })
  leaderName?: string;
}
