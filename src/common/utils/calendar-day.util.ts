export const APP_CALENDAR_TIME_ZONE = 'Asia/Tashkent';

export const getCalendarDayKey = (
  value: Date | string,
  timeZone = APP_CALENDAR_TIME_ZONE,
) => {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

export const isCalendarDayOnOrBeforeToday = (
  value: Date | string,
  now = new Date(),
  timeZone = APP_CALENDAR_TIME_ZONE,
) => {
  const dueKey = getCalendarDayKey(value, timeZone);
  const todayKey = getCalendarDayKey(now, timeZone);

  if (!dueKey || !todayKey) {
    return false;
  }

  return dueKey <= todayKey;
};
