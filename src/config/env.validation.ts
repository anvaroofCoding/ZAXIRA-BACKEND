import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV?: Environment;

  @IsInt()
  @Min(1)
  @IsOptional()
  PORT?: number;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  MONGODB_URI?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  JWT_SECRET?: string;
}

export const validateEnv = (config: Record<string, unknown>) => {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validated;
};
