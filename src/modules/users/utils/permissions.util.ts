import {
  ALL_PERMISSION_PATHS,
  PERMISSION_ACTION_KEYS,
} from '../constants/permission-catalog';
import {
  isPageActionDisabled,
  TRANSFER_RECEIPT_PAGE_PATH,
  WAREHOUSE_RECEIPT_PAGE_PATH,
} from '../constants/disabled-page-actions';

const RECEIPT_PAGE_PATHS = new Set([
  WAREHOUSE_RECEIPT_PAGE_PATH,
  TRANSFER_RECEIPT_PAGE_PATH,
]);
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

const sanitizePageActions = (
  path: string,
  actions: PagePermissionActions,
): PagePermissionActions => {
  const next = { ...actions };
  for (const key of PERMISSION_ACTION_KEYS) {
    if (isPageActionDisabled(path, key)) {
      next[key] = false;
    }
  }
  return next;
};

const getEnabledActionKeys = (path: string) =>
  PERMISSION_ACTION_KEYS.filter((key) => !isPageActionDisabled(path, key));

const isLegacyStrippedActions = (
  path: string,
  actions?: Partial<PagePermissionActions>,
) => {
  const enabledActionKeys = getEnabledActionKeys(path);

  if (!enabledActionKeys.length) {
    return false;
  }

  return enabledActionKeys.every((key) => actions?.[key] === false);
};

const normalizeActions = (
  path: string,
  access: boolean,
  actions?: Partial<PagePermissionActions>,
): PagePermissionActions => {
  if (!access) {
    return createDefaultActions(false);
  }

  if (isLegacyStrippedActions(path, actions)) {
    return sanitizePageActions(path, createDefaultActions(true));
  }

  const normalized = sanitizePageActions(path, {
    create: actions?.create ?? true,
    update: actions?.update ?? true,
    delete: actions?.delete ?? true,
  });

  if (RECEIPT_PAGE_PATHS.has(path)) {
    return sanitizePageActions(path, {
      ...normalized,
      create: true,
    });
  }

  return normalized;
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
      actions: normalizeActions(path, access, current?.actions),
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

export const hasAnyPageAccess = (
  permissions: UserPermissionsMap | undefined,
  paths: readonly string[],
  isSuperAdmin: boolean,
): boolean => {
  if (isSuperAdmin) {
    return true;
  }

  return paths.some((path) => hasPageAccess(permissions, path, false));
};

export const isAccessOnlyPage = (path: string): boolean =>
  PERMISSION_ACTION_KEYS.every((key) => isPageActionDisabled(path, key));

export const hasPageAction = (
  permissions: UserPermissionsMap | undefined,
  path: string,
  action: keyof PagePermissionActions,
  isSuperAdmin: boolean,
): boolean => {
  if (isSuperAdmin) {
    return true;
  }

  if (isPageActionDisabled(path, action)) {
    return false;
  }

  const page = permissions?.[path];
  return Boolean(page?.access && page.actions?.[action]);
};
