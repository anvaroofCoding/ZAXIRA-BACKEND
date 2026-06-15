import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ToBoolean } from '../../../common/transforms/to-boolean.transform';

export class CreateStructureDto {
  @IsString({ message: 'To‘liq nomi matn bo‘lishi kerak' })
  @IsNotEmpty({ message: 'To‘liq nomini kiriting' })
  @MaxLength(200, { message: 'To‘liq nomi 200 belgidan oshmasligi kerak' })
  fullName!: string;

  @IsString({ message: 'Qisqa nomi matn bo‘lishi kerak' })
  @IsNotEmpty({ message: 'Qisqa nomini kiriting' })
  @MinLength(1, { message: 'Qisqa nomini kiriting' })
  @MaxLength(32, { message: 'Qisqa nom 32 belgidan oshmasligi kerak' })
  shortName!: string;

  @ToBoolean()
  @IsBoolean({ message: 'Ombori bormi — Ha yoki Yo‘q tanlang' })
  hasWarehouse!: boolean;

  @ToBoolean()
  @IsBoolean({ message: 'Raxbarmi — Ha yoki Yo‘q tanlang' })
  hasLeader!: boolean;

  @IsString({ message: 'Raxbari F.I.O. matn bo‘lishi kerak' })
  @IsNotEmpty({ message: 'Raxbari F.I.O. ni kiriting' })
  @MaxLength(120, { message: 'Raxbari F.I.O. 120 belgidan oshmasligi kerak' })
  leaderName!: string;
}
