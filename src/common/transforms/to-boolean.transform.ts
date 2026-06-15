import { Transform } from 'class-transformer';

export const toBoolean = ({ value }: { value: unknown }) => {
  if (value === true || value === false) {
    return value;
  }

  if (value === 'true' || value === 1 || value === '1') {
    return true;
  }

  if (value === 'false' || value === 0 || value === '0') {
    return false;
  }

  return value;
};

export const ToBoolean = () => Transform(toBoolean);
