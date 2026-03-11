type CalendarNavigationIntent = {
  date: string;
  mode?: 'focus' | 'editor';
};

let pendingCalendarIntent: CalendarNavigationIntent | null = null;

export function setPendingCalendarIntent(intent: CalendarNavigationIntent | null) {
  pendingCalendarIntent = intent;
}

export function consumePendingCalendarIntent() {
  const intent = pendingCalendarIntent;
  pendingCalendarIntent = null;
  return intent;
}
