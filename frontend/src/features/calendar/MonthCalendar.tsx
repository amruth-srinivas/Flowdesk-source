import { motion } from 'framer-motion';
import { Button } from 'primereact/button';
import { useEffect, useMemo, useState } from 'react';
import type { CalendarEventRecord } from '../../lib/api';

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

export function keyForDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthDateRange(cursor: Date): { start: Date; end: Date } {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const start = new Date(y, m, 1, 0, 0, 0, 0);
  const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/** Events appear on every day they span (inclusive), intersecting the visible month. */
export function eventsByDayKey(events: CalendarEventRecord[], cursor: Date): Map<string, CalendarEventRecord[]> {
  const { start: ms, end: me } = monthDateRange(cursor);
  const map = new Map<string, CalendarEventRecord[]>();

  for (const ev of events) {
    const start = new Date(ev.start_at);
    const end = ev.end_at ? new Date(ev.end_at) : new Date(ev.start_at);
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const cur = new Date(day);
    while (cur <= last) {
      if (cur >= ms && cur <= me) {
        const k = keyForDate(cur);
        const list = map.get(k) ?? [];
        if (!list.some((e) => e.id === ev.id)) {
          list.push(ev);
        }
        map.set(k, list);
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  return map;
}

export type MonthCalendarProps = {
  viewKey: string;
  events: CalendarEventRecord[];
  isLoading: boolean;
  selectedDate: Date | null;
  onSelectDay: (date: Date, dayEvents: CalendarEventRecord[], focusEventId?: string) => void;
  onMonthRangeChange: (fromIso: string, toIso: string) => void;
  embedded?: boolean;
};

export function MonthCalendar({
  viewKey,
  events,
  isLoading,
  selectedDate,
  onSelectDay,
  onMonthRangeChange,
  embedded = false,
}: MonthCalendarProps) {
  const [cursor, setCursor] = useState(() => startOfLocalDay(new Date()));

  useEffect(() => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const from = new Date(y, m, 1, 0, 0, 0, 0);
    const to = new Date(y, m + 1, 0, 23, 59, 59, 999);
    onMonthRangeChange(from.toISOString(), to.toISOString());
  }, [cursor, onMonthRangeChange]);

  const today = useMemo(() => startOfLocalDay(new Date()), []);

  const cells = useMemo(() => getCalendarCells(cursor), [cursor]);

  const monthLabel = useMemo(
    () => cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    [cursor],
  );

  const byDay = useMemo(() => eventsByDayKey(events, cursor), [events, cursor]);

  function goToToday() {
    const t = startOfLocalDay(new Date());
    setCursor(t);
    const map = eventsByDayKey(events, t);
    const k = keyForDate(t);
    onSelectDay(t, map.get(k) ?? []);
  }

  const headerBlock = (
    <header className={embedded ? 'calendar-header calendar-header--embedded' : 'calendar-header'}>
      {!embedded ? (
        <div>
          <h3 className="calendar-kicker">Calendar</h3>
          <h1 className="calendar-title">Schedule</h1>
          <p className="calendar-sub">
            Click a day to open details in the side panel. Activities spanning multiple days appear on each day.
          </p>
        </div>
      ) : (
        <div className="calendar-header-spacer" aria-hidden />
      )}
      <div className="calendar-toolbar">
        <Button
          type="button"
          icon="pi pi-chevron-left"
          rounded
          text
          aria-label="Previous month"
          onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
        />
        <span className="calendar-month-label">{monthLabel}</span>
        <Button
          type="button"
          icon="pi pi-chevron-right"
          rounded
          text
          aria-label="Next month"
          onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
        />
        <Button type="button" label="Today" className="calendar-today-btn" onClick={goToToday} />
      </div>
    </header>
  );

  const gridBlock = (
    <>
      {isLoading ? <p className="calendar-loading-inline">Updating events…</p> : null}
      <div className="calendar-month-shell">
        <div className="calendar-weekdays">
          {WEEKDAYS.map((w) => (
            <div key={w} className="calendar-weekday">
              {w}
            </div>
          ))}
        </div>
        <div className="calendar-grid">
          {cells.map(({ date, inMonth }) => {
            const k = keyForDate(date);
            const isToday = isSameDay(date, today);
            const isSel = selectedDate !== null && isSameDay(date, selectedDate);
            const evs = byDay.get(k) ?? [];
            return (
              <div
                key={`${k}-${inMonth}`}
                role="button"
                tabIndex={0}
                className={[
                  'calendar-day',
                  !inMonth ? 'calendar-day-muted' : '',
                  isToday ? 'calendar-day-today' : '',
                  isSel ? 'calendar-day-selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelectDay(date, evs)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectDay(date, evs);
                  }
                }}
              >
                <span className="calendar-day-num">{date.getDate()}</span>
                {evs.length > 0 ? (
                  <span className="calendar-day-chips">
                    {evs.slice(0, 2).map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        className="calendar-day-chip"
                        title={ev.title}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectDay(date, evs, ev.id);
                        }}
                      >
                        {ev.title.length > 14 ? `${ev.title.slice(0, 12)}…` : ev.title}
                      </button>
                    ))}
                    {evs.length > 2 ? <span className="calendar-day-more">+{evs.length - 2}</span> : null}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );

  const inner = (
    <>
      {headerBlock}
      {gridBlock}
    </>
  );

  if (embedded) {
    return (
      <div className="calendar-month-embedded" key={viewKey}>
        {inner}
      </div>
    );
  }

  return (
    <motion.article
      key={viewKey}
      className="page-card calendar-page-card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {inner}
    </motion.article>
  );
}
