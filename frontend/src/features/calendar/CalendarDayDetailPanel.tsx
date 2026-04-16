import { Button } from 'primereact/button';
import { ProgressBar } from 'primereact/progressbar';
import { Tag } from 'primereact/tag';
import { useEffect, useRef } from 'react';
import type { CalendarEventRecord } from '../../lib/api';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function statusSeverity(s: string): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
  switch (s) {
    case 'completed':
      return 'success';
    case 'in_progress':
      return 'info';
    case 'on_hold':
      return 'warning';
    case 'cancelled':
      return 'danger';
    default:
      return 'secondary';
  }
}

type CalendarDayDetailPanelProps = {
  selectedDate: Date | null;
  dayEvents: CalendarEventRecord[];
  isLoading: boolean;
  isAdmin: boolean;
  focusedEventId: string | null;
  milestoneBusy: string | null;
  onClose: () => void;
  onToggleMilestone: (eventId: string, milestoneId: string, completed: boolean) => Promise<void>;
};

export function CalendarDayDetailPanel({
  selectedDate,
  dayEvents,
  isLoading,
  isAdmin,
  focusedEventId,
  milestoneBusy,
  onClose,
  onToggleMilestone,
}: CalendarDayDetailPanelProps) {
  const focusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!focusedEventId || !focusRef.current) {
      return;
    }
    const el = focusRef.current.querySelector(`[data-event-id="${focusedEventId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedEventId, selectedDate, dayEvents]);

  return (
    <div className="calendar-detail-panel-inner" ref={focusRef}>
      <div className="calendar-detail-panel-head">
        <div>
          <h2 className="calendar-detail-panel-title">Day details</h2>
          {selectedDate ? (
            <p className="calendar-detail-panel-date">
              {selectedDate.toLocaleString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          ) : (
            <p className="calendar-detail-panel-hint">Choose a date on the calendar</p>
          )}
        </div>
        {selectedDate ? (
          <Button type="button" icon="pi pi-times" rounded text aria-label="Clear selection" onClick={onClose} />
        ) : null}
      </div>

      <div className="calendar-detail-panel-body">
        {isLoading ? <p className="calendar-detail-empty">Loading events…</p> : null}
        {!isLoading && selectedDate && dayEvents.length > 0 ? (
          <div className="calendar-event-list calendar-event-list--panel">
            {dayEvents.map((ev) => (
              <div key={ev.id} className="calendar-event-card" data-event-id={ev.id}>
                <div className="calendar-event-card-top">
                  <div>
                    <span className="calendar-event-time">
                      {formatTime(ev.start_at)}
                      {ev.end_at ? ` – ${formatTime(ev.end_at)}` : ''}
                    </span>
                    <h4 className="calendar-event-title">{ev.title}</h4>
                    {ev.project_name ? (
                      <span className="calendar-event-project">
                        <i className="pi pi-folder" aria-hidden />
                        {ev.project_name}
                      </span>
                    ) : null}
                  </div>
                  <div className="calendar-event-tags">
                    <Tag value={ev.event_type.replace(/_/g, ' ')} severity="info" />
                    <Tag value={ev.status.replace(/_/g, ' ')} severity={statusSeverity(ev.status)} />
                  </div>
                </div>
                {ev.description ? <p className="calendar-event-desc">{ev.description}</p> : null}
                {ev.progress_percent !== null && ev.progress_percent !== undefined ? (
                  <div className="calendar-event-progress">
                    <span className="calendar-event-progress-label">Tracking</span>
                    <ProgressBar value={ev.progress_percent} showValue />
                  </div>
                ) : null}
                {ev.milestones.length > 0 ? (
                  <ul className="calendar-event-milestones">
                    {ev.milestones.map((m) => {
                      const done = Boolean(m.completed_at);
                      const busy = milestoneBusy === `${ev.id}-${m.id}`;
                      return (
                        <li key={m.id} className={done ? 'calendar-ms-done' : ''}>
                          <label className="calendar-ms-row">
                            {isAdmin ? (
                              <input
                                type="checkbox"
                                checked={done}
                                disabled={busy}
                                onChange={(e) => void onToggleMilestone(ev.id, m.id, e.target.checked)}
                              />
                            ) : (
                              <span className="calendar-ms-dot" aria-hidden />
                            )}
                            <span className="calendar-ms-title">{m.title}</span>
                            {m.target_date ? (
                              <span className="calendar-ms-date">
                                {new Date(m.target_date + 'T12:00:00').toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            ) : null}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {!isLoading && selectedDate && dayEvents.length === 0 ? (
          <div className="calendar-detail-panel-empty">
            <i className="pi pi-calendar-plus" aria-hidden />
            <p>No activities scheduled for this day.</p>
          </div>
        ) : null}
        {!isLoading && !selectedDate ? (
          <div className="calendar-detail-panel-empty">
            <i className="pi pi-arrow-left" aria-hidden />
            <p>Click a day to see activities, milestones, and tracking.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
