import { AnimatePresence, motion } from 'framer-motion';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Checkbox } from 'primereact/checkbox';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createPersonalTaskRequest,
  deleteAllPersonalTasksForDayRequest,
  deletePersonalTaskRequest,
  getPersonalTasksForDayRequest,
  getPersonalTasksMonthSummaryRequest,
  updatePersonalTaskRequest,
  type PersonalTaskRecord,
} from '../../lib/api';
import { PersonalTasksMonthGrid } from './PersonalTasksMonthGrid';

type PersonalTasksWorkspaceProps = {
  viewKey: string;
};

const ptEase = [0.22, 1, 0.36, 1] as const;

const ptListContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.055, delayChildren: 0.02 },
  },
};

const ptListItem = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: ptEase },
  },
};

const ptHero = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: ptEase } },
};

const ptBlock = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: ptEase } },
};

export function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmdLocal(ymd: string): Date {
  const [yy, mm, dd] = ymd.split('-').map((x) => Number.parseInt(x, 10));
  return new Date(yy, mm - 1, dd);
}

function formatHumanDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function wrapSelection(text: string, start: number, end: number, open: string, close: string) {
  const sel = text.slice(start, end);
  const inner = sel.length ? sel : '';
  const next = text.slice(0, start) + open + inner + close + text.slice(end);
  const caret = start + open.length + inner.length + close.length;
  return { next, caret };
}

function insertLinePrefix(text: string, start: number, prefix: string) {
  const before = text.slice(0, start);
  const lineStart = before.lastIndexOf('\n') + 1;
  const next = text.slice(0, lineStart) + prefix + text.slice(lineStart);
  const caret = start + prefix.length;
  return { next, caret };
}

type ToolbarProps = {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
};

function BodyFormatToolbar({ textareaRef, value, onChange }: ToolbarProps) {
  const apply = useCallback(
    (fn: (t: string, s: number, e: number) => { next: string; caret: number }) => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const { next, caret } = fn(value, start, end);
      onChange(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    },
    [onChange, textareaRef, value],
  );

  return (
    <div className="personal-tasks-format-bar" role="toolbar" aria-label="Text formatting">
      <Button
        type="button"
        className="personal-tasks-format-btn"
        icon="pi pi-bold"
        rounded
        text
        title="Bold (**)"
        onClick={() => apply((t, s, e) => wrapSelection(t, s, e, '**', '**'))}
      />
      <Button
        type="button"
        className="personal-tasks-format-btn"
        icon="pi pi-italic"
        rounded
        text
        title="Italic (*)"
        onClick={() => apply((t, s, e) => wrapSelection(t, s, e, '*', '*'))}
      />
      <Button
        type="button"
        className="personal-tasks-format-btn"
        icon="pi pi-list"
        rounded
        text
        title="Bullet line"
        onClick={() => apply((t, s, e) => insertLinePrefix(t, s, '- '))}
      />
      <Button
        type="button"
        className="personal-tasks-format-btn personal-tasks-format-num-btn"
        label="1."
        rounded
        text
        title="Numbered line"
        onClick={() => apply((t, s, e) => insertLinePrefix(t, s, '1. '))}
      />
      <Button
        type="button"
        className="personal-tasks-format-btn"
        icon="pi pi-minus"
        rounded
        text
        title="Divider"
        onClick={() =>
          apply((t, s, e) => {
            const insert = (s > 0 && t[s - 1] !== '\n' ? '\n' : '') + '---\n';
            const next = t.slice(0, s) + insert + t.slice(e);
            const caret = s + insert.length;
            return { next, caret };
          })
        }
      />
    </div>
  );
}

function TaskRow({
  task,
  dateLabel,
  expanded,
  onToggleExpand,
  onToggleDone,
  onSaveEdit,
  onDelete,
  draftTitle,
  draftBody,
  onDraftTitle,
  onDraftBody,
  bodyRef,
  busy,
}: {
  task: PersonalTaskRecord;
  dateLabel?: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleDone: (done: boolean) => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  draftTitle: string;
  draftBody: string;
  onDraftTitle: (v: string) => void;
  onDraftBody: (v: string) => void;
  bodyRef: React.RefObject<HTMLTextAreaElement | null>;
  busy: boolean;
}) {
  const [showFormatting, setShowFormatting] = useState(false);
  useEffect(() => {
    if (!expanded) setShowFormatting(false);
  }, [expanded]);

  return (
    <motion.div
      className={`personal-tasks-row ${task.is_completed ? 'personal-tasks-row--done' : ''}`}
      whileHover={{ y: -1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
    >
      <div className="personal-tasks-row-main">
        <Checkbox
          inputId={`pt-${task.id}`}
          checked={task.is_completed}
          onChange={(e) => onToggleDone(!!e.checked)}
          disabled={busy}
        />
        <button
          type="button"
          className="personal-tasks-row-title-btn"
          onClick={onToggleExpand}
          disabled={busy}
        >
          <span className="personal-tasks-row-title">
            {(expanded ? draftTitle : task.title).trim() || 'Untitled'}
          </span>
          {dateLabel ? <span className="personal-tasks-date-pill">{dateLabel}</span> : null}
        </button>
        <div className="personal-tasks-row-actions">
          <Button
            type="button"
            icon="pi pi-pencil"
            rounded
            text
            className="personal-tasks-icon-btn"
            title={expanded ? 'Close' : 'Edit'}
            onClick={onToggleExpand}
          />
          <Button
            type="button"
            icon="pi pi-trash"
            rounded
            text
            severity="danger"
            className="personal-tasks-icon-btn"
            title="Delete"
            onClick={onDelete}
            disabled={busy}
          />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="edit"
            className="personal-tasks-row-edit"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: ptEase }}
          >
            <label className="personal-tasks-label" htmlFor={`pt-title-${task.id}`}>
              Title
            </label>
            <InputText
              id={`pt-title-${task.id}`}
              value={draftTitle}
              onChange={(e) => onDraftTitle(e.target.value)}
              className="personal-tasks-input"
            />
            <label className="personal-tasks-label" htmlFor={`pt-body-${task.id}`}>
              Notes <span className="personal-tasks-optional">(optional)</span>
            </label>
            {showFormatting ? <BodyFormatToolbar textareaRef={bodyRef} value={draftBody} onChange={onDraftBody} /> : null}
            <InputTextarea
              id={`pt-body-${task.id}`}
              ref={bodyRef}
              value={draftBody}
              onChange={(e) => onDraftBody(e.target.value)}
              rows={5}
              className="personal-tasks-body"
              autoResize
              placeholder="Optional details…"
            />
            <button
              type="button"
              className="personal-tasks-link-btn"
              onClick={() => setShowFormatting((v) => !v)}
            >
              {showFormatting ? 'Hide' : 'Show'} markdown formatting
            </button>
            <div className="personal-tasks-edit-actions">
              <Button type="button" label="Save" size="small" onClick={onSaveEdit} loading={busy} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function PersonalTasksWorkspace({ viewKey }: PersonalTasksWorkspaceProps) {
  const [viewMode, setViewMode] = useState<'day' | 'month'>('day');
  const [selectedDate, setSelectedDate] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  });
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [summaryByDay, setSummaryByDay] = useState<Record<string, { total: number; open: number } | undefined>>({});
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [pendingEarlier, setPendingEarlier] = useState<PersonalTaskRecord[]>([]);
  const [forDay, setForDay] = useState<PersonalTaskRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [createBody, setCreateBody] = useState('');
  const [createNotesOpen, setCreateNotesOpen] = useState(false);
  const [createFormatting, setCreateFormatting] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const createBodyRef = useRef<HTMLTextAreaElement>(null);
  const editBodyRef = useRef<HTMLTextAreaElement>(null);

  const dateStr = useMemo(() => formatDateLocal(selectedDate), [selectedDate]);

  const refreshMonthSummary = useCallback(async () => {
    const y = monthCursor.getFullYear();
    const m = monthCursor.getMonth();
    const from = formatDateLocal(new Date(y, m, 1));
    const to = formatDateLocal(new Date(y, m + 1, 0));
    setSummaryLoading(true);
    try {
      const rows = await getPersonalTasksMonthSummaryRequest(from, to);
      const next: Record<string, { total: number; open: number }> = {};
      for (const r of rows) {
        next[r.task_date] = { total: r.total, open: r.open };
      }
      setSummaryByDay(next);
    } catch {
      setSummaryByDay({});
    } finally {
      setSummaryLoading(false);
    }
  }, [monthCursor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPersonalTasksForDayRequest(dateStr);
      setPendingEarlier(data.pending_earlier);
      setForDay(data.for_day);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load personal tasks');
      setPendingEarlier([]);
      setForDay([]);
    } finally {
      setLoading(false);
    }
  }, [dateStr]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void refreshMonthSummary();
  }, [refreshMonthSummary]);

  const openEdit = useCallback((task: PersonalTaskRecord) => {
    setExpandedId(task.id);
    setDraftTitle(task.title);
    setDraftBody(task.body ?? '');
  }, []);

  const handleToggleDone = useCallback(
    async (task: PersonalTaskRecord, done: boolean) => {
      setSavingId(task.id);
      try {
        await updatePersonalTaskRequest(task.id, { is_completed: done });
        await load();
        await refreshMonthSummary();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Update failed');
      } finally {
        setSavingId(null);
      }
    },
    [load, refreshMonthSummary],
  );

  const handleSaveEdit = useCallback(
    async (taskId: string) => {
      setSavingId(taskId);
      try {
        await updatePersonalTaskRequest(taskId, { title: draftTitle.trim() || 'Untitled', body: draftBody });
        setExpandedId(null);
        await load();
        await refreshMonthSummary();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setSavingId(null);
      }
    },
    [draftBody, draftTitle, load, refreshMonthSummary],
  );

  const handleDelete = useCallback(
    async (taskId: string) => {
      if (!window.confirm('Delete this personal task?')) return;
      setSavingId(taskId);
      try {
        await deletePersonalTaskRequest(taskId);
        setExpandedId(null);
        await load();
        await refreshMonthSummary();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Delete failed');
      } finally {
        setSavingId(null);
      }
    },
    [load, refreshMonthSummary],
  );

  const handleDeleteAllForDay = useCallback(async () => {
    if (forDay.length === 0) return;
    const n = forDay.length;
    const ok = window.confirm(
      `Delete all ${n} task${n === 1 ? '' : 's'} for ${formatHumanDate(selectedDate)}? This cannot be undone.`,
    );
    if (!ok) return;
    setSavingId('__delete_all__');
    setExpandedId(null);
    try {
      await deleteAllPersonalTasksForDayRequest(dateStr);
      await load();
      await refreshMonthSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete tasks');
    } finally {
      setSavingId(null);
    }
  }, [dateStr, forDay.length, load, refreshMonthSummary, selectedDate]);

  const handleCreate = useCallback(async () => {
    const title = createTitle.trim();
    if (!title) {
      setError('Enter a task title.');
      return;
    }
    if (pendingEarlier.length > 0) {
      const ok = window.confirm(
        `You still have ${pendingEarlier.length} incomplete task(s) from earlier days. Add this task for ${formatHumanDate(selectedDate)} anyway?`,
      );
      if (!ok) return;
    }
    setSavingId('__create__');
    try {
      await createPersonalTaskRequest({
        task_date: dateStr,
        title,
        body: createBody.trim() || null,
      });
      setCreateTitle('');
      setCreateBody('');
      setCreateNotesOpen(false);
      setCreateFormatting(false);
      await load();
      await refreshMonthSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create task');
    } finally {
      setSavingId(null);
    }
  }, [createBody, createTitle, dateStr, load, pendingEarlier.length, refreshMonthSummary, selectedDate]);

  function shiftDay(delta: number) {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + delta);
    setSelectedDate(next);
    setExpandedId(null);
  }

  function handleGridSelectDay(d: Date) {
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    setSelectedDate(next);
    setExpandedId(null);
    if (next.getMonth() !== monthCursor.getMonth() || next.getFullYear() !== monthCursor.getFullYear()) {
      setMonthCursor(startOfMonth(next));
    }
  }

  const pendingCount = pendingEarlier.length;

  const dayPanel = (
    <>
      {viewMode === 'day' ? (
        <motion.div
          className="personal-tasks-date-bar"
          variants={ptBlock}
          initial="hidden"
          animate="show"
        >
          <div className="personal-tasks-date-row">
            <div className="personal-tasks-date-controls">
              <Button
                type="button"
                icon="pi pi-chevron-left"
                rounded
                text
                className="personal-tasks-nav-btn"
                onClick={() => shiftDay(-1)}
                aria-label="Previous day"
              />
              <Calendar
                value={selectedDate}
                onChange={(e) => {
                  const v = e.value as Date | Date[] | null;
                  const d = Array.isArray(v) ? v[0] : v;
                  if (d) {
                    setSelectedDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
                    setExpandedId(null);
                  }
                }}
                dateFormat="M dd, yy"
                showIcon
                className="personal-tasks-calendar"
              />
              <Button
                type="button"
                icon="pi pi-chevron-right"
                rounded
                text
                className="personal-tasks-nav-btn"
                onClick={() => shiftDay(1)}
                aria-label="Next day"
              />
              <Button
                type="button"
                label="Today"
                size="small"
                className="personal-tasks-today-btn"
                onClick={() => {
                  const t = new Date();
                  setSelectedDate(new Date(t.getFullYear(), t.getMonth(), t.getDate()));
                  setExpandedId(null);
                }}
              />
            </div>
            <p className="personal-tasks-date-long">{formatHumanDate(selectedDate)}</p>
          </div>
          {loading ? <span className="personal-tasks-loading">Loading…</span> : null}
        </motion.div>
      ) : (
        <motion.div
          className="personal-tasks-month-panel-head"
          variants={ptBlock}
          initial="hidden"
          animate="show"
        >
          <p className="personal-tasks-month-panel-date">{formatHumanDate(selectedDate)}</p>
          {loading ? <span className="personal-tasks-loading">Loading…</span> : null}
        </motion.div>
      )}

      {error ? (
        <p className="personal-tasks-error" role="alert">
          {error}
        </p>
      ) : null}

      {pendingCount > 0 ? (
        <motion.section
          className="personal-tasks-pending"
          aria-label="Incomplete tasks from earlier days"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: ptEase }}
        >
          <div className="personal-tasks-pending-head">
            <span className="personal-tasks-pending-title">Carried over</span>
            <span className="personal-tasks-pending-badge">{pendingCount}</span>
          </div>
          <p className="personal-tasks-pending-hint">Incomplete tasks from before this day stay visible until you complete them.</p>
          <motion.ul
            className="personal-tasks-list"
            variants={ptListContainer}
            initial="hidden"
            animate="show"
          >
            {pendingEarlier.map((task) => (
              <motion.li key={task.id} variants={ptListItem}>
                <TaskRow
                  task={task}
                  dateLabel={formatHumanDate(parseYmdLocal(task.task_date))}
                  expanded={expandedId === task.id}
                  onToggleExpand={() => {
                    if (expandedId === task.id) {
                      setExpandedId(null);
                    } else {
                      openEdit(task);
                    }
                  }}
                  onToggleDone={(done) => void handleToggleDone(task, done)}
                  onSaveEdit={() => void handleSaveEdit(task.id)}
                  onDelete={() => void handleDelete(task.id)}
                  draftTitle={expandedId === task.id ? draftTitle : task.title}
                  draftBody={expandedId === task.id ? draftBody : task.body ?? ''}
                  onDraftTitle={setDraftTitle}
                  onDraftBody={setDraftBody}
                  bodyRef={editBodyRef}
                  busy={savingId === task.id}
                />
              </motion.li>
            ))}
          </motion.ul>
        </motion.section>
      ) : null}

      <section className="personal-tasks-day-section" aria-label={`Tasks for ${dateStr}`}>
        {forDay.length > 0 ? (
          <motion.div
            className="personal-tasks-day-toolbar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22 }}
          >
            <span className="personal-tasks-day-count">
              {forDay.length} for this day
            </span>
            <Button
              type="button"
              label="Delete all"
              icon="pi pi-trash"
              severity="danger"
              outlined
              size="small"
              className="personal-tasks-delete-all-btn"
              onClick={() => void handleDeleteAllForDay()}
              loading={savingId === '__delete_all__'}
              disabled={savingId !== null && savingId !== '__delete_all__'}
            />
          </motion.div>
        ) : null}
        <motion.ul
          key={dateStr}
          className="personal-tasks-list"
          variants={ptListContainer}
          initial="hidden"
          animate="show"
        >
          {forDay.map((task) => (
            <motion.li key={task.id} variants={ptListItem}>
              <TaskRow
                task={task}
                expanded={expandedId === task.id}
                onToggleExpand={() => {
                  if (expandedId === task.id) {
                    setExpandedId(null);
                  } else {
                    openEdit(task);
                  }
                }}
                onToggleDone={(done) => void handleToggleDone(task, done)}
                onSaveEdit={() => void handleSaveEdit(task.id)}
                onDelete={() => void handleDelete(task.id)}
                draftTitle={expandedId === task.id ? draftTitle : task.title}
                draftBody={expandedId === task.id ? draftBody : task.body ?? ''}
                onDraftTitle={setDraftTitle}
                onDraftBody={setDraftBody}
                bodyRef={editBodyRef}
                busy={savingId === task.id}
              />
            </motion.li>
          ))}
        </motion.ul>

        <motion.div
          className="personal-tasks-create"
          variants={ptBlock}
          initial="hidden"
          animate="show"
        >
          <h3 className="personal-tasks-create-title">Add task</h3>
          <div className="personal-tasks-quick-add">
            <InputText
              id="pt-new-title"
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              placeholder="Task title"
              className="personal-tasks-input personal-tasks-quick-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
            />
            <Button
              type="button"
              label="Add"
              icon="pi pi-plus"
              className="personal-tasks-add-btn"
              onClick={() => void handleCreate()}
              loading={savingId === '__create__'}
              disabled={!createTitle.trim()}
            />
          </div>
          {createNotesOpen ? (
            <>
              <label className="personal-tasks-label" htmlFor="pt-new-body">
                Notes <span className="personal-tasks-optional">(optional)</span>
              </label>
              {createFormatting ? (
                <BodyFormatToolbar textareaRef={createBodyRef} value={createBody} onChange={setCreateBody} />
              ) : null}
              <InputTextarea
                id="pt-new-body"
                ref={createBodyRef}
                value={createBody}
                onChange={(e) => setCreateBody(e.target.value)}
                rows={4}
                className="personal-tasks-body"
                autoResize
                placeholder="Optional — only if you need more than a title"
              />
              <button
                type="button"
                className="personal-tasks-link-btn"
                onClick={() => setCreateFormatting((v) => !v)}
              >
                {createFormatting ? 'Hide' : 'Show'} markdown formatting
              </button>
            </>
          ) : (
            <button type="button" className="personal-tasks-link-btn" onClick={() => setCreateNotesOpen(true)}>
              + Add notes (optional)
            </button>
          )}
        </motion.div>
      </section>
    </>
  );

  return (
    <motion.article
      key={viewKey}
      className="page-card calendar-workspace-card personal-tasks-card"
      initial={{ opacity: 0, y: 18, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: ptEase }}
    >
      <div className="calendar-workspace-top personal-tasks-top">
        <motion.div
          className="personal-tasks-intro"
          variants={ptHero}
          initial="hidden"
          animate="show"
        >
          <h3 className="calendar-kicker">Personal</h3>
          <div className="personal-tasks-view-toggle-wrap">
            <div className="personal-tasks-view-toggle" role="group" aria-label="View mode">
              <Button
                type="button"
                label="Day"
                icon="pi pi-list"
                className={
                  viewMode === 'day' ? 'personal-tasks-view-btn personal-tasks-view-btn--on' : 'personal-tasks-view-btn'
                }
                onClick={() => setViewMode('day')}
              />
              <Button
                type="button"
                label="Month"
                icon="pi pi-calendar"
                className={
                  viewMode === 'month' ? 'personal-tasks-view-btn personal-tasks-view-btn--on' : 'personal-tasks-view-btn'
                }
                onClick={() => {
                  setMonthCursor(startOfMonth(selectedDate));
                  setViewMode('month');
                }}
              />
            </div>
          </div>
        </motion.div>
      </div>

      <AnimatePresence mode="wait">
        {viewMode === 'month' ? (
          <motion.div
            key="pt-month"
            className="personal-tasks-split"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.28, ease: ptEase }}
          >
          <div className="personal-tasks-split-left">
            <PersonalTasksMonthGrid
              viewDate={monthCursor}
              selectedDate={selectedDate}
              summaryByDay={summaryByDay}
              isLoading={summaryLoading}
              onSelectDay={handleGridSelectDay}
              onPrevMonth={() =>
                setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
              }
              onNextMonth={() =>
                setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
              }
              onThisMonth={() => {
                const t = new Date();
                const m = startOfMonth(t);
                setMonthCursor(m);
                setSelectedDate(new Date(t.getFullYear(), t.getMonth(), t.getDate()));
                setExpandedId(null);
              }}
            />
          </div>
          <div className="personal-tasks-split-right">{dayPanel}</div>
        </motion.div>
        ) : (
          <motion.div
            key="pt-day"
            className="personal-tasks-day-only"
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.28, ease: ptEase }}
          >
            {dayPanel}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
