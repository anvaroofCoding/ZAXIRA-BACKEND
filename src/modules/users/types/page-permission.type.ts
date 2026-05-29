import { PermissionActionKey } from '../constants/permission-catalog';

export interface PagePermissionActions {
  create: boolean;
  update: boolean;
  delete: boolean;
}

export interface PagePermission {
  access: boolean;
  actions: PagePermissionActions;
}

export type UserPermissionsMap = Record<string, PagePermission>;

export type PermissionActionToggle = PermissionActionKey;
