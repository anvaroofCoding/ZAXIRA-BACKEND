import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ALL_PERMISSION_PATHS } from '../constants/permission-catalog';

const ACTION_KEYS = ['create', 'update', 'delete'] as const;

const isValidActions = (actions: unknown): boolean => {
  if (actions === undefined) {
    return true;
  }

  if (
    typeof actions !== 'object' ||
    actions === null ||
    Array.isArray(actions)
  ) {
    return false;
  }

  const record = actions as Record<string, unknown>;

  return ACTION_KEYS.every(
    (key) => record[key] === undefined || typeof record[key] === 'boolean',
  );
};

const isValidPagePermission = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const permission = value as Record<string, unknown>;

  return (
    typeof permission.access === 'boolean' && isValidActions(permission.actions)
  );
};

@ValidatorConstraint({ name: 'isUserPermissionsMap', async: false })
export class IsUserPermissionsMapConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const permissions = value as Record<string, unknown>;

    return Object.entries(permissions).every(
      ([path, permission]) =>
        ALL_PERMISSION_PATHS.includes(path) &&
        isValidPagePermission(permission),
    );
  }

  defaultMessage(_args?: ValidationArguments): string {
    return 'permissions noto‘g‘ri formatda';
  }
}

export const IsUserPermissionsMap = (validationOptions?: ValidationOptions) =>
  function register(object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsUserPermissionsMapConstraint,
    });
  };
