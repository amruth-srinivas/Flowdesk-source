import { motion } from 'framer-motion';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Checkbox } from 'primereact/checkbox';
import { Slider } from 'primereact/slider';
import { useEffect, useMemo, useState } from 'react';
import type { CalendarEventRecord, ProjectRecord } from '../../lib/api';
import { createCalendarEventRequest, updateCalendarEventRequest } from '../../lib/api';

const EVENT_TYPES = [
  { label: 'Meeting', value: 'meeting' },
  { label: 'Milestone review', value: 'milestone_review' },
  { label: 'Sprint', value: 'sprint' },
  { label: 'Release', value: 'release' },
  { label: 'Workshop', value: 'workshop' },
  { label: 'Other', value: 'other' },
];

const STATUS_OPTIONS = [
  { label: 'Planning', value: 'planning' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'On hold', value: 'on_hold' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
];

type MilestoneDraft = { id: string; title: string; targetDate: Date | null };

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmdLocal(ymd: string): Date {
  const [y, mo, d] = ymd.split('-').map((part) => Number(part));
  if (!y || !mo || !d) {
    return new Date(ymd);
  }
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

const MEETING_LINK_MARKER = 'Meeting link:';

function splitDescriptionAndMeetingLink(value: string | null | undefined): { description: string; meetingLink: string } {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return { description: '', meetingLink: '' };
  }
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const markerLine = lines.find((line) => line.toLowerCase().startsWith(MEETING_LINK_MARKER.toLowerCase()));
  if (!markerLine) {
    return { description: raw, meetingLink: '' };
  }
  const meetingLink = markerLine.slice(MEETING_LINK_MARKER.length).trim();
  const description = lines.filter((line) => line !== markerLine).join('\n').trim();
  return { description, meetingLink };
}

function mergeDescriptionWithMeetingLink(description: string, meetingLink: string): string | null {
  const cleanDescription = description.trim();
  const cleanLink = meetingLink.trim();
  if (!cleanDescription && !cleanLink) {
    return null;
  }
  if (!cleanLink) {
    return cleanDescription || null;
  }
  return cleanDescription
    ? `${cleanDescription}\n${MEETING_LINK_MARKER} ${cleanLink}`
    : `${MEETING_LINK_MARKER} ${cleanLink}`;
}

type CalendarEventFormProps = {
  viewKey: string;
  projects: ProjectRecord[];
  onCreated: () => void;
  /** Use inside Dialog: no outer card / title (dialog supplies header). */
  variant?: 'page' | 'dialog';
  mode?: 'create' | 'edit';
  /** Required when mode is edit (PUT /work/events/{id}). */
  eventId?: string;
  /** When mode is edit, used to populate fields. */
  initialEvent?: CalendarEventRecord | null;
  /** Create mode: pre-fill start date/time (e.g. day selected on the calendar). */
  initialStartAt?: Date | null;
};

export function CalendarEventForm({
  viewKey,
  projects,
  onCreated,
  variant = 'page',
  mode = 'create',
  eventId,
  initialEvent,
  initialStartAt,
}: CalendarEventFormProps) {
  const [projectId, setProjectId] = useState<string | null>(projects[0]?.id ?? null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [eventType, setEventType] = useState('meeting');
  const [status, setStatus] = useState('planning');
  const [startAt, setStartAt] = useState<Date | null>(() => {
    if (initialStartAt) {
      const d = new Date(initialStartAt);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d;
  });
  const [endAt, setEndAt] = useState<Date | null>(null);
  const [trackProgress, setTrackProgress] = useState(false);
  const [progress, setProgress] = useState(35);
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const projectOptions = useMemo(
    () => projects.map((p) => ({ label: p.name, value: p.id })),
    [projects],
  );

  useEffect(() => {
    if (mode !== 'edit' || !initialEvent) {
      return;
    }
    setProjectId(initialEvent.project_id ?? projects[0]?.id ?? null);
    setTitle(initialEvent.title);
    const extracted = splitDescriptionAndMeetingLink(initialEvent.description);
    setDescription(extracted.description);
    setMeetingLink(extracted.meetingLink);
    setEventType(initialEvent.event_type);
    setStatus(initialEvent.status);
    setStartAt(new Date(initialEvent.start_at));
    setEndAt(initialEvent.end_at ? new Date(initialEvent.end_at) : null);
    const p = initialEvent.progress_percent;
    const hasProgress = p !== null && p !== undefined;
    setTrackProgress(hasProgress);
    setProgress(hasProgress && typeof p === 'number' ? p : 35);
    setMilestones(
      initialEvent.milestones.map((m) => ({
        id: m.id,
        title: m.title,
        targetDate: m.target_date ? parseYmdLocal(m.target_date) : null,
      })),
    );
    setError('');
  }, [mode, initialEvent]);

  function addMilestone() {
    setMilestones((prev) => [...prev, { id: crypto.randomUUID(), title: '', targetDate: null }]);
  }

  function updateMilestone(id: string, patch: Partial<MilestoneDraft>) {
    setMilestones((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function removeMilestone(id: string) {
    setMilestones((prev) => prev.filter((m) => m.id !== id));
  }

  async function submit() {
    if (!projectId) {
      setError('Select a project.');
      return;
    }
    if (!title.trim()) {
      setError('Enter a title.');
      return;
    }
    if (!startAt) {
      setError('Set a start date and time.');
      return;
    }
    if (eventType === 'meeting' && meetingLink.trim()) {
      try {
        // Validate meeting links are well-formed URLs (http/https).
        const parsed = new URL(meetingLink.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          setError('Meeting link must start with http:// or https://');
          return;
        }
      } catch {
        setError('Enter a valid meeting link URL.');
        return;
      }
    }
    setSaving(true);
    setError('');
    const milestonePayload = milestones
      .filter((m) => m.title.trim())
      .map((m, i) => ({
        title: m.title.trim(),
        target_date: m.targetDate ? ymd(m.targetDate) : null,
        sort_order: i,
      }));
    try {
      if (mode === 'edit') {
        if (!eventId) {
          setError('Missing event id.');
          return;
        }
        await updateCalendarEventRequest(eventId, {
          project_id: projectId,
          title: title.trim(),
          description: mergeDescriptionWithMeetingLink(description, eventType === 'meeting' ? meetingLink : ''),
          event_type: eventType,
          start_at: startAt.toISOString(),
          end_at: endAt ? endAt.toISOString() : null,
          status,
          progress_percent: trackProgress ? Math.round(progress) : null,
          milestones: milestonePayload,
        });
      } else {
        await createCalendarEventRequest({
          project_id: projectId,
          title: title.trim(),
          description: mergeDescriptionWithMeetingLink(description, eventType === 'meeting' ? meetingLink : ''),
          event_type: eventType,
          start_at: startAt.toISOString(),
          end_at: endAt ? endAt.toISOString() : null,
          status,
          progress_percent: trackProgress ? Math.round(progress) : null,
          milestones: milestonePayload,
        });
        setTitle('');
        setDescription('');
        setMeetingLink('');
        setMilestones([]);
        setTrackProgress(false);
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : mode === 'edit' ? 'Could not update event' : 'Could not create event');
    } finally {
      setSaving(false);
    }
  }

  const formBody = (
    <div className={`calendar-event-form-grid ${variant === 'dialog' ? 'calendar-event-form-grid--dialog' : ''}`}>
        <div className="cef-field calendar-event-field-wide">
          <label className="cef-label" htmlFor="ce-project">
            Project
          </label>
          <div className="p-inputgroup cef-inputgroup">
            <span className="p-inputgroup-addon">
              <i className="pi pi-folder" aria-hidden />
            </span>
            <Dropdown
              inputId="ce-project"
              value={projectId}
              options={projectOptions}
              onChange={(e) => setProjectId(e.value as string)}
              className="full-width"
              placeholder="Select project"
              filter
            />
          </div>
        </div>

        <div className="cef-field calendar-event-field-wide">
          <label className="cef-label" htmlFor="ce-title">
            Title
          </label>
          <div className="p-inputgroup cef-inputgroup">
            <span className="p-inputgroup-addon">
              <i className="pi pi-pencil" aria-hidden />
            </span>
            <InputText id="ce-title" value={title} onChange={(e) => setTitle(e.target.value)} className="full-width" maxLength={200} />
          </div>
        </div>

        <div className="cef-field calendar-event-field-wide">
          <label className="cef-label" htmlFor="ce-desc">
            Description
          </label>
          <InputTextarea id="ce-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="full-width cef-textarea" />
        </div>
        {eventType === 'meeting' ? (
          <div className="cef-field calendar-event-field-wide">
            <label className="cef-label" htmlFor="ce-meeting-link">
              Meeting link
            </label>
            <div className="p-inputgroup cef-inputgroup">
              <span className="p-inputgroup-addon">
                <i className="pi pi-link" aria-hidden />
              </span>
              <InputText
                id="ce-meeting-link"
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                className="full-width"
                placeholder="https://meet.google.com/... or Teams/Zoom link"
              />
            </div>
          </div>
        ) : null}

        <div className="calendar-event-form-row">
          <div className="cef-field">
            <label className="cef-label" htmlFor="ce-type">
              Event type
            </label>
            <div className="p-inputgroup cef-inputgroup">
              <span className="p-inputgroup-addon">
                <i className="pi pi-tag" aria-hidden />
              </span>
              <Dropdown
                inputId="ce-type"
                value={eventType}
                options={EVENT_TYPES}
                onChange={(e) => setEventType(e.value)}
                className="full-width"
              />
            </div>
          </div>
          <div className="cef-field">
            <label className="cef-label" htmlFor="ce-status">
              Tracking status
            </label>
            <div className="p-inputgroup cef-inputgroup">
              <span className="p-inputgroup-addon">
                <i className="pi pi-flag" aria-hidden />
              </span>
              <Dropdown
                inputId="ce-status"
                value={status}
                options={STATUS_OPTIONS}
                onChange={(e) => setStatus(e.value)}
                className="full-width"
              />
            </div>
          </div>
        </div>

        <div className="calendar-event-form-row">
          <div className="cef-field calendar-datetime-field">
            <label className="cef-label" htmlFor="ce-start">
              Start
            </label>
            <Calendar
              inputId="ce-start"
              value={startAt}
              onChange={(e) => setStartAt(e.value as Date | null)}
              showTime
              hourFormat="12"
              className="full-width cef-calendar"
            />
          </div>
          <div className="cef-field calendar-datetime-field">
            <label className="cef-label" htmlFor="ce-end">
              End <span className="calendar-optional">(optional)</span>
            </label>
            <Calendar
              inputId="ce-end"
              value={endAt}
              onChange={(e) => setEndAt(e.value as Date | null)}
              showTime
              hourFormat="12"
              className="full-width cef-calendar"
            />
          </div>
        </div>

        <div className="calendar-progress-block">
          <div className="calendar-progress-toggle">
            <Checkbox
              inputId="ce-track-p"
              checked={trackProgress}
              onChange={(e) => setTrackProgress(Boolean(e.checked))}
            />
            <label htmlFor="ce-track-p" className="calendar-checkbox-label">
              Track progress (%)
            </label>
          </div>
          {trackProgress ? (
            <>
              <label className="calendar-inline-label" htmlFor="ce-progress">
                {Math.round(progress)}%
              </label>
              <Slider id="ce-progress" value={progress} onChange={(e) => setProgress(typeof e.value === 'number' ? e.value : 0)} max={100} />
            </>
          ) : null}
        </div>

        <section className="calendar-milestones-section">
          <div className="calendar-milestones-head">
            <h4>Milestones</h4>
            <Button type="button" label="Add milestone" icon="pi pi-plus" size="small" outlined onClick={addMilestone} />
          </div>
          <p className="calendar-milestones-hint">Optional checkpoints; mark them complete from the calendar day view.</p>
          {milestones.length === 0 ? (
            <p className="calendar-detail-empty">No milestones yet.</p>
          ) : (
            <ul className="calendar-milestone-drafts">
              {milestones.map((m) => (
                <li key={m.id}>
                  <InputText
                    value={m.title}
                    onChange={(e) => updateMilestone(m.id, { title: e.target.value })}
                    placeholder="Milestone title"
                    className="calendar-milestone-title-input"
                  />
                  <Calendar
                    value={m.targetDate}
                    onChange={(e) => updateMilestone(m.id, { targetDate: (e.value as Date) || null })}
                    placeholder="Target date"
                    showIcon
                    className="calendar-milestone-date"
                  />
                  <Button type="button" icon="pi pi-times" rounded text severity="danger" onClick={() => removeMilestone(m.id)} aria-label="Remove" />
                </li>
              ))}
            </ul>
          )}
        </section>

        {error ? <small className="error-text">{error}</small> : null}

        <div className="dialog-actions calendar-event-submit">
          <Button
            type="button"
            label={saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create event'}
            icon="pi pi-check"
            onClick={() => void submit()}
            disabled={saving}
          />
        </div>
    </div>
  );

  if (variant === 'dialog') {
    return (
      <div key={viewKey} className="calendar-event-form-dialog-body">
        {formBody}
      </div>
    );
  }

  return (
    <motion.article
      key={viewKey}
      className="page-card calendar-event-form-card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <header className="calendar-event-form-header">
        <div>
          <h3 className="calendar-kicker">Calendar</h3>
          <h1 className="calendar-title">{mode === 'edit' ? 'Edit activity' : 'Create event'}</h1>
          <p className="calendar-sub">
            {mode === 'edit'
              ? 'Update scheduling, status, progress, and milestones. Team leads and administrators can edit activities.'
              : 'Schedule a project event for a project you belong to, set tracking status and progress, and attach milestones. Team members can create events; team leads and administrators can edit any activity.'}
          </p>
        </div>
      </header>
      {formBody}
    </motion.article>
  );
}
