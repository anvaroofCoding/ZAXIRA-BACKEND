import {
  ALL_PERMISSION_PATHS,
  PERMISSION_ACTION_KEYS,
} from '../constants/permission-catalog';
import {
  PagePermission,
  PagePermissionActions,
  UserPermissionsMap,
} from '../types/page-permission.type';

export const createDefaultActions = (
  enabled = false,
): PagePermissionActions => ({
  create: enabled,
  update: enabled,
  delete: enabled,
});

export const createDefaultPagePermission = (
  access = false,
  actionsEnabled = false,
): PagePermission => ({
  access,
  actions: createDefaultActions(access && actionsEnabled),
});

export const createEmptyPermissions = (): UserPermissionsMap =>
  ALL_PERMISSION_PATHS.reduce<UserPermissionsMap>((acc, path) => {
    acc[path] = createDefaultPagePermission(false, false);
    return acc;
  }, {});

export const createFullPermissions = (): UserPermissionsMap =>
  ALL_PERMISSION_PATHS.reduce<UserPermissionsMap>((acc, path) => {
    acc[path] = createDefaultPagePermission(true, true);
    return acc;
  }, {});

const normalizeActions = (
  access: boolean,
  actions?: Partial<PagePermissionActions>,
): PagePermissionActions => {
  if (!access) {
    return createDefaultActions(false);
  }

  return {
    create: actions?.create ?? true,
    update: actions?.update ?? true,
    delete: actions?.delete ?? true,
  };
};

export const normalizePermissions = (
  input?: UserPermissionsMap | null,
): UserPermissionsMap => {
  const base = createEmptyPermissions();

  if (!input) {
    return base;
  }

  for (const path of ALL_PERMISSION_PATHS) {
    const current = input[path];
    const access = Boolean(current?.access);

    base[path] = {
      access,
      actions: normalizeActions(access, current?.actions),
    };
  }

  return base;
};

export const hasPageAccess = (
  permissions: UserPermissionsMap | undefined,
  path: string,
  isSuperAdmin: boolean,
): boolean => {
  if (isSuperAdmin) {
    return true;
  }

  return Boolean(permissions?.[path]?.access);
};

export const hasPageAction = (
  permissions: UserPermissionsMap | undefined,
  path: string,
  action: keyof PagePermissionActions,
  isSuperAdmin: boolean,
): boolean => {
  if (isSuperAdmin) {
    return true;
  }

  const page = permissions?.[path];
  return Boolean(page?.access && page.actions?.[action]);
};
