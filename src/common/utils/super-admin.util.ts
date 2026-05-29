import { UserRole } from '../enums/user-role.enum';

export const isSuperAdminRole = (role?: UserRole | null): boolean =>
  role === UserRole.SUPER_ADMIN;
