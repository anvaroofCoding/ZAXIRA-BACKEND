export enum ApprovalDecision {
  APPROVED = 'APPROVED',
  PARTIAL = 'PARTIAL',
  REJECTED = 'REJECTED',
}

export const APPROVAL_DECISION_LABELS: Record<ApprovalDecision, string> = {
  [ApprovalDecision.APPROVED]: 'Kelishildi',
  [ApprovalDecision.PARTIAL]: 'Qisman kelishildi',
  [ApprovalDecision.REJECTED]: 'Rad etildi',
};

export const MEMBER_DECISION_PENDING_LABEL = 'Kelishilmoqda';
