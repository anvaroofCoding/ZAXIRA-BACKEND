import { HistoryStepType } from '../schemas/history-step.schema';

export const HISTORY_STEP_TYPE_LABELS: Record<HistoryStepType, string> = {
  [HistoryStepType.SUBMITTED]: 'Ariza yuborildi',
  [HistoryStepType.UPDATED]: 'Ariza tahrirlandi',
  [HistoryStepType.DECISION]: 'Komissiya qarori',
  [HistoryStepType.RESUBMITTED]: 'Qayta yuborildi',
  [HistoryStepType.BOSS_CONFIRMED]: 'Boshliq tasdiqladi',
  [HistoryStepType.BOSS_DECISION]: 'Boshliq qarori',
  [HistoryStepType.PARTIAL_PURCHASE]: 'Qisman xarid qilindi',
  [HistoryStepType.PURCHASED]: 'Xarid qilindi',
  [HistoryStepType.ITEMS_UNAVAILABLE]: 'Xarid qilib bo‘lmaydi deb belgilandi',
  [HistoryStepType.PURCHASE_REJECTED]: 'Xarid rad etildi',
};
