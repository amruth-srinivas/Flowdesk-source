import type { ReactNode } from 'react';

type CalendarPageProps = {
  activeModule: string;
  /** Month grid, chips, right-hand day details, Add activity. */
  calendarContent: ReactNode;
  /** Sortable table of all events. */
  tableContent: ReactNode;
  fallbackContent: ReactNode;
};

export function CalendarPage({ activeModule, calendarContent, tableContent, fallbackContent }: CalendarPageProps) {
  if (activeModule === 'Calendar') {
    return <>{calendarContent}</>;
  }
  if (activeModule === 'View') {
    return <>{tableContent}</>;
  }
  return <>{fallbackContent}</>;
}
