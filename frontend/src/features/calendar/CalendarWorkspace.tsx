import { motion } from 'framer-motion';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { useState } from 'react';
import type { CalendarEventRecord, ProjectRecord } from '../../lib/api';
import { CalendarDayDetailPanel } from './CalendarDayDetailPanel';
import { CalendarEventForm } from './CalendarEventForm';
import { MonthCalendar } from './MonthCalendar';

type CalendarWorkspaceProps = {
  viewKey: string;
  events: CalendarEventRecord[];
  isLoading: boolean;
  isAdmin: boolean;
  projects: ProjectRecord[];
  onToggleMilestone: (eventId: string, milestoneId: string, completed: boolean) => Promise<void>;
  onMonthRangeChange: (fromIso: string, toIso: string) => void;
  onCreated: () => void;
};

export function CalendarWorkspace({
  viewKey,
  events,
  isLoading,
  isAdmin,
  projects,
  onToggleMilestone,
  onMonthRangeChange,
  onCreated,
}: CalendarWorkspaceProps) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [dayEvents, setDayEvents] = useState<CalendarEventRecord[]>([]);
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null);
  const [milestoneBusy, setMilestoneBusy] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  function handleSelectDay(date: Date, evs: CalendarEventRecord[], focusEventId?: string) {
    setSelectedDate(date);
    setDayEvents(evs);
    setFocusedEventId(focusEventId ?? null);
  }

  async function handleMilestoneToggle(eventId: string, milestoneId: string, completed: boolean) {
    setMilestoneBusy(`${eventId}-${milestoneId}`);
    try {
      await onToggleMilestone(eventId, milestoneId, completed);
    } finally {
      setMilestoneBusy(null);
    }
  }

  function clearSelection() {
    setSelectedDate(null);
    setDayEvents([]);
    setFocusedEventId(null);
  }

  return (
    <motion.article
      key={viewKey}
      className="page-card calendar-workspace-card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="calendar-workspace-top">
        <div>
          <h3 className="calendar-kicker">Calendar</h3>
          <h1 className="calendar-title">Schedule</h1>
          <p className="calendar-sub">
            View activities on the calendar. Select a day to see details here — or click an activity chip to focus it.{' '}
            {isAdmin ? 'Admins can add activities with the button on the right.' : ''}
          </p>
        </div>
        {isAdmin ? (
          <Button
            type="button"
            label="Add activity"
            icon="pi pi-plus"
            className="calendar-add-activity-btn"
            onClick={() => setAddOpen(true)}
          />
        ) : null}
      </div>

      <div className="calendar-workspace-split">
        <div className="calendar-workspace-main">
          <MonthCalendar
            embedded
            viewKey={viewKey}
            events={events}
            isLoading={isLoading}
            selectedDate={selectedDate}
            onSelectDay={handleSelectDay}
            onMonthRangeChange={onMonthRangeChange}
          />
        </div>
        <aside className="calendar-detail-panel" aria-label="Event details">
          <CalendarDayDetailPanel
            selectedDate={selectedDate}
            dayEvents={dayEvents}
            isLoading={isLoading}
            isAdmin={isAdmin}
            focusedEventId={focusedEventId}
            milestoneBusy={milestoneBusy}
            onClose={clearSelection}
            onToggleMilestone={handleMilestoneToggle}
          />
        </aside>
      </div>

      {isAdmin ? (
        <Dialog
          header="Add activity"
          visible={addOpen}
          onHide={() => setAddOpen(false)}
          className="project-dialog calendar-add-dialog"
          style={{ width: 'min(94vw, 640px)' }}
          modal
          dismissableMask
          draggable={false}
        >
          <CalendarEventForm
            viewKey={`${viewKey}-add`}
            projects={projects}
            variant="dialog"
            onCreated={() => {
              onCreated();
              setAddOpen(false);
            }}
          />
        </Dialog>
      ) : null}
    </motion.article>
  );
}
