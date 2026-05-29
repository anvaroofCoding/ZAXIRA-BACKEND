export enum ApprovalDecision {
  APPROVED = 'APPROVED',
  PARTIAL = 'PARTIAL',
  REJECTED = 'REJECTED',
}

export const APPROVAL_DECISION_LABELS: Record<ApprovalDecision, string> = {
  [ApprovalDecision.APPROVED]: 'Tasdiqlash',
  [ApprovalDecision.PARTIAL]: 'Qisman tasdiqlash',
  [ApprovalDecision.REJECTED]: 'Rad etish',
};
