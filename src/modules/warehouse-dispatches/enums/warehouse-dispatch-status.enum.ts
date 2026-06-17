export enum WarehouseDispatchStatus {
  PENDING_RECEIPT = 'PENDING_RECEIPT',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export const WAREHOUSE_DISPATCH_STATUS_LABELS: Record<
  WarehouseDispatchStatus,
  string
> = {
  [WarehouseDispatchStatus.PENDING_RECEIPT]: 'Qabul kutilmoqda',
  [WarehouseDispatchStatus.PARTIALLY_RECEIVED]: 'Qisman qabul qilindi',
  [WarehouseDispatchStatus.COMPLETED]: 'Qabul qilindi',
  [WarehouseDispatchStatus.CANCELLED]: 'Bekor qilindi',
};
