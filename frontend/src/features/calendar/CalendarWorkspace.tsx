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
  /** Team members (and leads/admins) can create activities for projects they belong to. */
  canCreateEvents: boolean;
  /** Admins and team leads can edit activities, toggle milestones, and manage attachments. */
  canManageEvents: boolean;
  projects: ProjectRecord[];
  onToggleMilestone: (eventId: string, milestoneId: string, completed: boolean) => Promise<void>;
  onMonthRangeChange: (fromIso: string, toIso: string) => void;
  onCreated: () => void;
};

export function CalendarWorkspace({
  viewKey,
  events,
  isLoading,
  canCreateEvents,
  canManageEvents,
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
  const [addFormInitialStart, setAddFormInitialStart] = useState<Date | null>(null);

  function openAddDialog(presetDay?: Date | null) {
    setAddFormInitialStart(presetDay ?? null);
    setAddOpen(true);
  }

  function closeAddDialog() {
    setAddOpen(false);
    setAddFormInitialStart(null);
  }

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
        </div>
        {canCreateEvents ? (
          <Button
            type="button"
            label="Add activity"
            icon="pi pi-plus"
            className="calendar-add-activity-btn"
            onClick={() => openAddDialog()}
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
            canCreateEvents={canCreateEvents}
            canManageEvents={canManageEvents}
            focusedEventId={focusedEventId}
            milestoneBusy={milestoneBusy}
            onClose={clearSelection}
            onToggleMilestone={handleMilestoneToggle}
            onAddActivity={canCreateEvents ? () => openAddDialog(selectedDate) : undefined}
            onAttachmentsChanged={onCreated}
          />
        </aside>
      </div>

      {canCreateEvents ? (
        <Dialog
          header="Add activity"
          visible={addOpen}
          onHide={closeAddDialog}
          className="project-dialog calendar-add-dialog"
          style={{ width: 'min(94vw, 640px)' }}
          modal
          dismissableMask
          draggable={false}
        >
          <CalendarEventForm
            key={`${viewKey}-add-${addFormInitialStart?.getTime() ?? 'default'}`}
            viewKey={`${viewKey}-add`}
            projects={projects}
            variant="dialog"
            initialStartAt={addFormInitialStart ?? undefined}
            onCreated={() => {
              onCreated();
              closeAddDialog();
            }}
          />
        </Dialog>
      ) : null}
    </motion.article>
  );
}
