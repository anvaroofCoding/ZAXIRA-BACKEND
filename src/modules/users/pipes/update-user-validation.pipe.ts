import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserPermissionsMap } from '../types/page-permission.type';
import { IsUserPermissionsMapConstraint } from '../validators/is-user-permissions-map.validator';

export class UpdateUserPayload extends UpdateUserDto {
  permissions?: UserPermissionsMap;
}

@Injectable()
export class UpdateUserValidationPipe implements PipeTransform {
  async transform(
    value: unknown,
    _metadata: ArgumentMetadata,
  ): Promise<UpdateUserPayload> {
    if (typeof value !== 'object' || value === null) {
      throw new BadRequestException('Noto‘g‘ri so‘rov formati');
    }

    const raw = value as Record<string, unknown>;
    const { permissions, ...rest } = raw;

    const dto = plainToInstance(UpdateUserDto, rest);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }

    if (permissions !== undefined) {
      const validator = new IsUserPermissionsMapConstraint();

      if (!validator.validate(permissions)) {
        throw new BadRequestException(
          validator.defaultMessage?.() ?? 'permissions noto‘g‘ri formatda',
        );
      }
    }

    const payload = new UpdateUserPayload();
    Object.assign(payload, dto);
    payload.permissions = permissions as UserPermissionsMap | undefined;
    return payload;
  }
}
