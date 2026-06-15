import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trimToUndefined = ({ value }: { value: unknown }) => {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
};

/** Qidiruv uchun xususiyat matnini qisqartirish (to‘liq matn saqlanadi) */
const trimCharacteristics = ({ value }: { value: unknown }) => {
  const trimmed = trimToUndefined({ value });
  if (!trimmed) return undefined;
  const max = 20_000;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

export class SearchProductPricesDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  name!: string;

  @Transform(trimCharacteristics)
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  characteristics?: string;
}
