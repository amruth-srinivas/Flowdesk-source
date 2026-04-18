import { Button } from 'primereact/button';
import { useMemo } from 'react';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getCalendarCells(viewDate: Date): { date: Date; inMonth: boolean }[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: { date: Date; inMonth: boolean }[] = [];

  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = 0; i < startPad; i++) {
    const day = prevMonthDays - startPad + i + 1;
    cells.push({ date: new Date(year, month - 1, day), inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
  let n = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ date: new Date(year, month + 1, n), inMonth: false });
    n += 1;
  }
  return cells;
}

export function keyForPersonalTaskDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type DaySummary = { total: number; open: number };

type PersonalTasksMonthGridProps = {
  viewDate: Date;
  selectedDate: Date;
  summaryByDay: Record<string, DaySummary | undefined>;
  isLoading: boolean;
  onSelectDay: (date: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onThisMonth: () => void;
};

export function PersonalTasksMonthGrid({
  viewDate,
  selectedDate,
  summaryByDay,
  isLoading,
  onSelectDay,
  onPrevMonth,
  onNextMonth,
  onThisMonth,
}: PersonalTasksMonthGridProps) {
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const cells = useMemo(() => getCalendarCells(viewDate), [viewDate]);
  const monthLabel = useMemo(
    () => viewDate.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    [viewDate],
  );

  return (
    <div className="personal-tasks-month-wrap">
      <header className="personal-tasks-month-header">
        <div className="personal-tasks-month-toolbar">
          <Button
            type="button"
            icon="pi pi-chevron-left"
            rounded
            text
            className="personal-tasks-month-nav"
            aria-label="Previous month"
            onClick={onPrevMonth}
          />
          <span className="personal-tasks-month-label">{monthLabel}</span>
          <Button
            type="button"
            icon="pi pi-chevron-right"
            rounded
            text
            className="personal-tasks-month-nav"
            aria-label="Next month"
            onClick={onNextMonth}
          />
          <Button type="button" label="This month" size="small" className="personal-tasks-month-today" onClick={onThisMonth} />
        </div>
        {isLoading ? <p className="personal-tasks-month-loading">Updating…</p> : null}
      </header>
      <div className="personal-tasks-month-shell">
        <div className="personal-tasks-weekdays">
          {WEEKDAYS.map((w) => (
            <div key={w} className="personal-tasks-weekday">
              {w}
            </div>
          ))}
        </div>
        <div className="personal-tasks-month-grid">
          {cells.map(({ date, inMonth }) => {
            const k = keyForPersonalTaskDate(date);
            const sum = summaryByDay[k];
            const isToday = isSameDay(date, today);
            const isSel = isSameDay(date, selectedDate);
            return (
              <button
                key={`${k}-${inMonth}`}
                type="button"
                className={[
                  'personal-tasks-day-cell',
                  !inMonth ? 'personal-tasks-day-cell--muted' : '',
                  isToday ? 'personal-tasks-day-cell--today' : '',
                  isSel ? 'personal-tasks-day-cell--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelectDay(date)}
              >
                <span className="personal-tasks-day-num">{date.getDate()}</span>
                {sum && sum.total > 0 ? (
                  <span className="personal-tasks-day-dots" aria-hidden>
                    <span
                      className={
                        sum.open > 0
                          ? 'personal-tasks-dot personal-tasks-dot--open'
                          : 'personal-tasks-dot personal-tasks-dot--done'
                      }
                      title={`${sum.open} open, ${sum.total - sum.open} done`}
                    />
                    {sum.total > 1 ? <span className="personal-tasks-dot-count">{sum.total}</span> : null}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <p className="personal-tasks-month-legend">
        <span className="personal-tasks-legend-item">
          <span className="personal-tasks-dot personal-tasks-dot--open" /> Open
        </span>
        <span className="personal-tasks-legend-item">
          <span className="personal-tasks-dot personal-tasks-dot--done" /> All done
        </span>
      </p>
    </div>
  );
}
