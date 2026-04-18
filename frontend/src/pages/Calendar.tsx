import type { ReactNode } from 'react';

type CalendarPageProps = {
  activeModule: string;
  /** Month grid, chips, right-hand day details, Add activity. */
  calendarContent: ReactNode;
  /** Sortable table of all events. */
  tableContent: ReactNode;
  /** Per-user daily checklists — separate from calendar events (team lead / member). */
  personalTasksContent: ReactNode;
  fallbackContent: ReactNode;
};

export function CalendarPage({
  activeModule,
  calendarContent,
  tableContent,
  personalTasksContent,
  fallbackContent,
}: CalendarPageProps) {
  if (activeModule === 'Calendar') {
    return <>{calendarContent}</>;
  }
  if (activeModule === 'View') {
    return <>{tableContent}</>;
  }
  if (activeModule === 'Personal Tasks') {
    return <>{personalTasksContent}</>;
  }
  return <>{fallbackContent}</>;
}
