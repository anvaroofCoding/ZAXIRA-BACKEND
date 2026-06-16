export enum PurchaseRequestStatus {
  COMMISSION_REVIEW = 'COMMISSION_REVIEW',
  PARTIAL_REVISION = 'PARTIAL_REVISION',
  REJECTED = 'REJECTED',
  BOSS_DECISION_PENDING = 'BOSS_DECISION_PENDING',
  PURCHASING = 'PURCHASING',
  PURCHASED = 'PURCHASED',
  WAREHOUSE_IN_TRANSIT = 'WAREHOUSE_IN_TRANSIT',
  WAREHOUSE_COMPLETED = 'WAREHOUSE_COMPLETED',
}

export const PURCHASE_REQUEST_STATUS_LABELS: Record<
  PurchaseRequestStatus,
  string
> = {
  [PurchaseRequestStatus.COMMISSION_REVIEW]: 'Kelishilmoqda',
  [PurchaseRequestStatus.PARTIAL_REVISION]: 'Kelishilmoqda',
  [PurchaseRequestStatus.REJECTED]: 'Rad etilgan',
  [PurchaseRequestStatus.BOSS_DECISION_PENDING]: 'Boshliq kelishmoqda',
  [PurchaseRequestStatus.PURCHASING]: 'Sotib olinmoqda',
  [PurchaseRequestStatus.PURCHASED]: 'Xarid qilindi',
  [PurchaseRequestStatus.WAREHOUSE_IN_TRANSIT]: 'Omborga jo‘natilgan',
  [PurchaseRequestStatus.WAREHOUSE_COMPLETED]: 'Omborga qabul qilindi',
};
