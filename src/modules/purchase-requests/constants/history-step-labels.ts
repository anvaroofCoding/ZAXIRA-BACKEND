import { HistoryStepType } from '../schemas/history-step.schema';

export const HISTORY_STEP_TYPE_LABELS: Record<HistoryStepType, string> = {
  [HistoryStepType.SUBMITTED]: 'Ariza yuborildi',
  [HistoryStepType.DECISION]: 'Komissiya qarori',
  [HistoryStepType.RESUBMITTED]: 'Qayta yuborildi',
  [HistoryStepType.BOSS_CONFIRMED]: 'Boshliq tasdiqladi',
  [HistoryStepType.BOSS_DECISION]: 'Boshliq qarori',
  [HistoryStepType.PURCHASED]: 'Xarid qilindi',
};
