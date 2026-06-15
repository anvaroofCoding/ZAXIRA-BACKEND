import {
  BadRequestException,
  ValidationPipe,
  ValidationPipeOptions,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { translateValidationMessages } from '../utils/validation-messages.util';

export const createValidationPipe = (
  options: ValidationPipeOptions = {},
): ValidationPipe =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    ...options,
    exceptionFactory: (errors: ValidationError[]) => {
      const messages = errors.flatMap((error) => {
        const direct = error.constraints
          ? Object.values(error.constraints)
          : [];

        const childMessages =
          error.children?.flatMap((child) =>
            child.constraints ? Object.values(child.constraints) : [],
          ) ?? [];

        return [...direct, ...childMessages];
      });

      throw new BadRequestException(
        translateValidationMessages(
          messages.length
            ? messages
            : ['So‘rov ma’lumotlari noto‘g‘ri'],
        ),
      );
    },
  });
