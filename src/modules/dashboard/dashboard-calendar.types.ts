export enum DashboardCalendarEventType {
  PURCHASE_DEADLINE = 'PURCHASE_DEADLINE',
  PURCHASE_ARRIVAL = 'PURCHASE_ARRIVAL',
  TRANSFER_ARRIVAL = 'TRANSFER_ARRIVAL',
}

export const DASHBOARD_CALENDAR_EVENT_LABELS: Record<
  DashboardCalendarEventType,
  string
> = {
  [DashboardCalendarEventType.PURCHASE_DEADLINE]: 'Ariza muddati',
  [DashboardCalendarEventType.PURCHASE_ARRIVAL]: 'Xarid tovarlari kelishi',
  [DashboardCalendarEventType.TRANSFER_ARRIVAL]: 'Transfer kelishi',
};

export interface DashboardCalendarEvent {
  id: string;
  type: DashboardCalendarEventType;
  date: string;
  title: string;
  subtitle: string;
  navigatePath: string;
  mandatory?: boolean;
  overdue?: boolean;
}
