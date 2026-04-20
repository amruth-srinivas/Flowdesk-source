import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputNumber } from 'primereact/inputnumber';
import { InputText } from 'primereact/inputtext';
import { MultiSelect } from 'primereact/multiselect';
import { ProgressBar } from 'primereact/progressbar';
import { Tag } from 'primereact/tag';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { TicketCreateForm } from '../tickets/TicketCreateForm';
import {
  createSprintRequest,
  createTicketRequest,
  deleteSprintRequest,
  getAssignableUsersRequest,
  getCustomersRequest,
  getProjectsRequest,
  getSprintAnalyticsRequest,
  getSprintsRequest,
  getTicketConfigurationRequest,
  getTicketsRequest,
  updateSprintRequest,
  updateTicketRequest,
  type CustomerRecord,
  type ProjectRecord,
  type SprintAnalyticsRecord,
  type SprintRecord,
  type TicketConfigurationRecord,
  type TicketCreatePayload,
  type TicketRecord,
  type UserRecord,
} from '../../lib/api';

type Role = 'admin' | 'teamLead' | 'teamMember';

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromYmd(s: string): Date {
  const p = s.split('-').map((x) => Number.parseInt(x, 10));
  return new Date(p[0], p[1] - 1, p[2]);
}

const SPRINT_TYPES = [
  { label: 'Development', value: 'development' },
  { label: 'Release', value: 'release' },
  { label: 'Hardening', value: 'hardening' },
  { label: 'Support', value: 'support' },
  { label: 'General', value: 'general' },
];

const SPRINT_TYPE_CUSTOM = '__custom__';

const WIZARD_STEP_LABELS = ['Sprint details', 'Projects', 'Tickets', 'Preview & confirm'];

function slugifySprintType(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  return s.slice(0, 80) || 'custom';
}

function isSprintActive(s: SprintRecord): boolean {
  return (s.status || '').toLowerCase().trim() === 'active';
}

/** API lists active first, then planning sprints; members see both. */
function isMemberVisibleSprint(s: SprintRecord): boolean {
  const x = (s.status || '').toLowerCase().trim();
  return x === 'active' || x === 'planning';
}

function formatSprintDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function sprintTicketStatusSeverity(status: string): 'success' | 'info' | 'warning' | 'secondary' | undefined {
  const s = status.toLowerCase().replace(/\s+/g, '_');
  if (s === 'resolved' || s === 'closed') return 'success';
  if (s === 'in_review') return 'warning';
  if (s === 'in_progress') return 'info';
  if (s === 'open') return 'secondary';
  return 'secondary';
}

type SprintsWorkspaceProps = {
  viewKey: string;
  activeModule: string;
  role: Role;
};

export function SprintsWorkspace({ viewKey, activeModule, role }: SprintsWorkspaceProps) {
  const isLead = role === 'teamLead';

  if (role === 'teamMember') {
    return <SprintsMemberView viewKey={viewKey} />;
  }
  if (activeModule === 'Configuration') {
    return <SprintsConfiguration viewKey={viewKey} isLead={isLead} />;
  }
  if (activeModule === 'Monitoring') {
    return <SprintsMonitoring viewKey={viewKey} isLead={isLead} />;
  }
  return null;
}

function SprintsMemberView({ viewKey }: { viewKey: string }) {
  const reduceMotion = useReducedMotion();
  const [sprints, setSprints] = useState<SprintRecord[]>([]);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sp, tk] = await Promise.all([getSprintsRequest(), getTicketsRequest()]);
      setSprints(sp);
      setTickets(tk);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, viewKey]);

  const shownSprint = useMemo(() => {
    const visible = sprints.filter(isMemberVisibleSprint);
    return visible[0] ?? null;
  }, [sprints]);

  const ticketsInSprint = useMemo(() => {
    if (!shownSprint) return [];
    return tickets.filter((t) => t.sprint_id === shownSprint.id);
  }, [tickets, shownSprint]);

  return (
    <motion.article
      key={viewKey}
      className="page-card sprints-workspace-card sprints-member-view"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.25 }}
    >
      <header className="sprints-workspace-header">
        <div>
          <h3 className="calendar-kicker">Sprints</h3>
          <h1 className="calendar-title">Active sprint</h1>
          <p className="calendar-sub sprints-workspace-sub">
            Your team&apos;s current sprint and the work linked to it. Use Tickets to search or update items.
          </p>
        </div>
      </header>

      {error ? (
        <p className="sprints-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="sprints-muted">Loading…</p> : null}

      {!loading && !shownSprint ? (
        <p className="sprints-muted">
          No sprint in planning or active status for your projects. Ask your team lead to set the sprint (or confirm you are
          added to the project as a member).
        </p>
      ) : null}

      {shownSprint ? (
        <section className="sprints-member-sprint" aria-label="Active sprint">
          <div className="sprints-member-hero">
            <div className="sprints-member-hero-top">
              <h2 className="sprints-member-sprint-title">{shownSprint.title}</h2>
              <p className="sprints-member-sprint-dates">
                <span>{formatSprintDay(shownSprint.start_date)}</span>
                <span aria-hidden="true"> · </span>
                <span>{formatSprintDay(shownSprint.end_date)}</span>
              </p>
            </div>
          </div>

          <div className="sprints-member-section-head">
            <h3>Work in this sprint</h3>
            <span className="sprints-member-count">
              {ticketsInSprint.length} {ticketsInSprint.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          <div className="sprints-member-ticket-list">
            {ticketsInSprint.map((t) => (
              <div key={t.id} className="sprints-member-ticket-row">
                <div className="sprints-member-ticket-main">
                  <span className="sprints-member-ticket-ref">{t.public_reference ?? `#${t.ticket_number}`}</span>
                  <span className="sprints-member-ticket-title">{t.title}</span>
                </div>
                <Tag
                  value={t.status.replace(/_/g, ' ')}
                  severity={sprintTicketStatusSeverity(t.status)}
                />
              </div>
            ))}
            {!ticketsInSprint.length ? (
              <p className="sprints-muted">No tickets linked to this sprint yet.</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </motion.article>
  );
}

function SprintsConfiguration({ viewKey, isLead }: { viewKey: string; isLead: boolean }) {
  const reduceMotion = useReducedMotion();
  const [sprints, setSprints] = useState<SprintRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardSprintId, setWizardSprintId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [sprintTypeChoice, setSprintTypeChoice] = useState('general');
  const [customTypeLabel, setCustomTypeLabel] = useState('');
  const [durationDays, setDurationDays] = useState(14);
  const [startDate, setStartDate] = useState<Date | null>(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  });
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [ticketBusy, setTicketBusy] = useState<string | null>(null);

  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [createTicketNonce, setCreateTicketNonce] = useState(0);
  const [createTicketSaving, setCreateTicketSaving] = useState(false);
  const [ticketConfigurations, setTicketConfigurations] = useState<TicketConfigurationRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [assignableUsers, setAssignableUsers] = useState<UserRecord[]>([]);

  const resolveSprintType = useCallback(() => {
    if (sprintTypeChoice === SPRINT_TYPE_CUSTOM) {
      return slugifySprintType(customTypeLabel);
    }
    return sprintTypeChoice;
  }, [sprintTypeChoice, customTypeLabel]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sp, pr, tk] = await Promise.all([getSprintsRequest(), getProjectsRequest(), getTicketsRequest()]);
      setSprints(sp);
      setProjects(pr);
      setTickets(tk);
      const visible = isLead ? sp : sp.filter(isSprintActive);
      setSelectedSprintId((cur) => (cur && visible.some((s) => s.id === cur) ? cur : visible[0]?.id ?? null));
      if (isLead) {
        const [cfg, cu, au] = await Promise.all([
          getTicketConfigurationRequest(),
          getCustomersRequest(),
          getAssignableUsersRequest(),
        ]);
        setTicketConfigurations(cfg);
        setCustomers(cu);
        setAssignableUsers(au);
      } else {
        setTicketConfigurations([]);
        setCustomers([]);
        setAssignableUsers([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [isLead]);

  useEffect(() => {
    void load();
  }, [load, viewKey]);

  function resetWizardForm() {
    setTitle('');
    setSprintTypeChoice('general');
    setCustomTypeLabel('');
    setDurationDays(14);
    const t = new Date();
    setStartDate(new Date(t.getFullYear(), t.getMonth(), t.getDate()));
    setProjectIds([]);
    setWizardStep(1);
    setWizardSprintId(null);
  }

  function openWizard() {
    resetWizardForm();
    setWizardOpen(true);
    setError(null);
  }

  async function cancelWizard() {
    if (wizardSprintId) {
      const ok = window.confirm(
        'This sprint was already created as a draft. Discard it? It will be deleted and tickets will stay unassigned from this sprint.',
      );
      if (!ok) return;
      setSaving(true);
      try {
        await deleteSprintRequest(wizardSprintId);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not delete draft sprint');
        setSaving(false);
        return;
      } finally {
        setSaving(false);
      }
    }
    setWizardOpen(false);
    resetWizardForm();
  }

  function handleWizardStep1Next() {
    setError(null);
    if (!title.trim()) {
      setError('Enter a sprint title.');
      return;
    }
    if (!startDate) {
      setError('Choose a start date.');
      return;
    }
    if (!durationDays || durationDays < 1) {
      setError('Set the sprint length to at least one day.');
      return;
    }
    if (sprintTypeChoice === SPRINT_TYPE_CUSTOM && !customTypeLabel.trim()) {
      setError('Enter a name for your custom sprint type, or pick a preset.');
      return;
    }
    setWizardStep(2);
  }

  async function handleWizardStep2Next() {
    if (!isLead) return;
    setError(null);
    if (!projectIds.length) {
      setError('Select at least one project for this sprint.');
      return;
    }
    setSaving(true);
    try {
      if (!wizardSprintId) {
        const created = await createSprintRequest({
          title: title.trim(),
          sprint_type: resolveSprintType(),
          duration_days: durationDays || 14,
          start_date: toYmd(startDate!),
          project_ids: projectIds,
          status: 'planning',
        });
        setSprints((cur) => [created, ...cur]);
        setWizardSprintId(created.id);
        setSelectedSprintId(created.id);
      } else {
        const updated = await updateSprintRequest(wizardSprintId, { project_ids: projectIds });
        setSprints((cur) => cur.map((s) => (s.id === updated.id ? updated : s)));
      }
      setWizardStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save sprint');
    } finally {
      setSaving(false);
    }
  }

  async function handleWizardConfirm() {
    if (!isLead || !wizardSprintId) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSprintRequest(wizardSprintId, { status: 'active' });
      setSprints((cur) => cur.map((s) => (s.id === updated.id ? updated : s)));
      setWizardOpen(false);
      resetWizardForm();
      setSelectedSprintId(updated.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm sprint');
    } finally {
      setSaving(false);
    }
  }

  const displaySprints = useMemo(
    () => (isLead ? sprints : sprints.filter(isSprintActive)),
    [sprints, isLead],
  );

  const selectedSprint = useMemo(
    () => displaySprints.find((s) => s.id === selectedSprintId) ?? null,
    [displaySprints, selectedSprintId],
  );

  const projectName = useCallback(
    (id: string) => projects.find((p) => p.id === id)?.name ?? id.slice(0, 8),
    [projects],
  );

  const ticketContextSprintId = wizardOpen && wizardStep >= 3 && wizardSprintId ? wizardSprintId : selectedSprintId;
  const ticketContextSprint = useMemo(
    () => (ticketContextSprintId ? sprints.find((s) => s.id === ticketContextSprintId) ?? null : null),
    [sprints, ticketContextSprintId],
  );

  const inScopeTickets = useMemo(() => {
    if (!ticketContextSprint?.project_ids?.length) return [];
    const set = new Set(ticketContextSprint.project_ids);
    return tickets.filter((t) => set.has(t.project_id));
  }, [tickets, ticketContextSprint]);

  const ticketsInSprint = useMemo(
    () => inScopeTickets.filter((t) => t.sprint_id === ticketContextSprintId),
    [inScopeTickets, ticketContextSprintId],
  );

  const ticketsAvailable = useMemo(
    () => inScopeTickets.filter((t) => t.sprint_id !== ticketContextSprintId),
    [inScopeTickets, ticketContextSprintId],
  );

  const previewTicketsInSprint = useMemo(() => {
    if (!wizardSprintId) return [];
    return tickets.filter((t) => t.sprint_id === wizardSprintId);
  }, [tickets, wizardSprintId]);

  const sprintForNewTicket = useMemo((): SprintRecord | null => {
    if (wizardOpen && wizardStep === 3 && ticketContextSprint) {
      return ticketContextSprint;
    }
    if (!wizardOpen && selectedSprint) {
      return selectedSprint;
    }
    return null;
  }, [wizardOpen, wizardStep, ticketContextSprint, selectedSprint]);

  const projectsForCreateTicket = useMemo(() => {
    const sp = sprintForNewTicket;
    if (!sp?.project_ids?.length) return [];
    const allowed = new Set(sp.project_ids);
    return projects.filter((p) => allowed.has(p.id));
  }, [sprintForNewTicket, projects]);

  function openCreateTicketDialog() {
    const sp = sprintForNewTicket;
    if (!isLead || !sp?.project_ids?.length) return;
    setCreateTicketNonce((n) => n + 1);
    setCreateTicketOpen(true);
  }

  async function handleSprintCreateTicketSubmit(payload: TicketCreatePayload) {
    const sp = sprintForNewTicket;
    if (!sp?.id) {
      throw new Error('No sprint selected.');
    }
    if (!sp.project_ids.includes(payload.project_id)) {
      throw new Error('Project must belong to this sprint.');
    }
    setCreateTicketSaving(true);
    try {
      const created = await createTicketRequest(payload);
      const withSprint = await updateTicketRequest(created.id, { sprint_id: sp.id });
      setTickets((cur) => [withSprint, ...cur]);
      setCreateTicketOpen(false);
    } finally {
      setCreateTicketSaving(false);
    }
  }

  async function handleAssignTicket(ticketId: string, sprintId: string | null) {
    if (!isLead) return;
    setTicketBusy(ticketId);
    setError(null);
    try {
      const updated = await updateTicketRequest(ticketId, { sprint_id: sprintId });
      setTickets((cur) => cur.map((t) => (t.id === updated.id ? updated : t)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update ticket');
    } finally {
      setTicketBusy(null);
    }
  }

  function onDragStart(e: React.DragEvent, ticketId: string) {
    e.dataTransfer.setData('ticketId', ticketId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  async function onDropToSprint(e: React.DragEvent) {
    e.preventDefault();
    const sid = ticketContextSprintId;
    if (!sid || !isLead) return;
    const ticketId = e.dataTransfer.getData('ticketId');
    if (!ticketId) return;
    await handleAssignTicket(ticketId, sid);
  }

  async function handleDeleteSprint(id: string) {
    if (!isLead) return;
    if (!window.confirm('Delete this sprint? Tickets will be unlinked.')) return;
    setSaving(true);
    try {
      await deleteSprintRequest(id);
      setSprints((c) => c.filter((s) => s.id !== id));
      setSelectedSprintId((cur) => (cur === id ? null : cur));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  const projectOptions = projects.map((p) => ({ label: p.name, value: p.id }));

  const sprintTypeDropdownOptions = useMemo(
    () => [...SPRINT_TYPES, { label: 'Custom type…', value: SPRINT_TYPE_CUSTOM }],
    [],
  );

  const wizardSprintRow = wizardSprintId ? sprints.find((s) => s.id === wizardSprintId) : null;

  const syncFormFromSprint = useCallback((row: SprintRecord) => {
    setTitle(row.title);
    setDurationDays(row.duration_days);
    setStartDate(fromYmd(row.start_date));
    setProjectIds([...row.project_ids]);
    const match = SPRINT_TYPES.find((o) => o.value === row.sprint_type);
    if (match) {
      setSprintTypeChoice(match.value);
      setCustomTypeLabel('');
    } else {
      setSprintTypeChoice(SPRINT_TYPE_CUSTOM);
      setCustomTypeLabel(row.sprint_type.replace(/_/g, ' '));
    }
  }, []);

  return (
    <motion.article
      key={viewKey}
      className="page-card sprints-workspace-card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <header className="sprints-workspace-header">
        <div>
          <h3 className="calendar-kicker">Sprints</h3>
          <h1 className="calendar-title">Configuration</h1>
          <p className="calendar-sub sprints-workspace-sub">
            Team leads run a short wizard: schedule and name the sprint, choose projects, assign tickets, then preview and
            confirm. Everyone else follows the sprint and updates work from Tickets.
          </p>
        </div>
      </header>

      {error ? (
        <p className="sprints-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="sprints-muted">Loading…</p> : null}

      {isLead && !wizardOpen ? (
        <div className="sprints-wizard-launch">
          <Button type="button" label="Start new sprint" icon="pi pi-plus" onClick={openWizard} />
          <p className="sprints-wizard-launch-hint">
            Four steps: schedule &amp; type → projects → tickets → preview &amp; confirm.
          </p>
        </div>
      ) : null}

      {!isLead ? (
        <p className="sprints-muted sprints-member-hint">
          Only team leads can create and edit sprints. You can review the <strong>active</strong> sprint below (planning and
          draft sprints are hidden for team members).
        </p>
      ) : null}

      {isLead && wizardOpen ? (
        <section className="sprints-wizard" aria-label="New sprint wizard">
          <nav className="sprints-wizard-nav" aria-label="Sprint setup steps">
            <ol className="sprints-wizard-stepper">
              {WIZARD_STEP_LABELS.map((label, i) => {
                const stepNum = i + 1;
                const isDone = wizardStep > stepNum;
                const isCurrent = wizardStep === stepNum;
                const nodeState = isDone ? 'done' : isCurrent ? 'current' : 'upcoming';
                return (
                  <Fragment key={label}>
                    {i > 0 ? (
                      <li className="sprints-wizard-stepper-connector" aria-hidden>
                        <div
                          className={`sprints-wizard-connector-line ${wizardStep > i ? 'sprints-wizard-connector-line--complete' : ''}`}
                        />
                      </li>
                    ) : null}
                    <li className="sprints-wizard-stepper-milestone" aria-current={isCurrent ? 'step' : undefined}>
                      <div className={`sprints-wizard-node sprints-wizard-node--${nodeState}`}>
                      <motion.div
                        className="sprints-wizard-node-circle-wrap"
                        animate={{ scale: isCurrent && !reduceMotion ? 1.08 : 1 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 24 }}
                      >
                          <span className="sprints-wizard-node-circle">
                            {isDone ? (
                              <Check className="sprints-wizard-check" size={18} strokeWidth={2.75} aria-hidden />
                            ) : (
                              <span className="sprints-wizard-node-num">{stepNum}</span>
                            )}
                          </span>
                        </motion.div>
                        <span className="sprints-wizard-node-caption">{label}</span>
                      </div>
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          </nav>

          <div className="sprints-wizard-body">
            <AnimatePresence mode="wait" initial={false}>
          {wizardStep === 1 ? (
            <motion.div
              key="wizard-step-1"
              className="sprints-wizard-panel"
              role="tabpanel"
              initial={reduceMotion ? false : { opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: -24 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <h2 className="sprints-section-title">Step 1 — Schedule, title &amp; type</h2>
              <p className="sprints-wizard-lead">
                Set when the sprint starts, how long it runs, what it is called, and whether it follows a standard type or
                a custom one.
              </p>
              <div className="sprints-form-grid">
                <div className="sprints-field">
                  <label htmlFor="sprint-title">Sprint title</label>
                  <InputText
                    id="sprint-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. April delivery"
                    className="sprints-input"
                  />
                </div>
                <div className="sprints-field">
                  <label htmlFor="sprint-start">Start date</label>
                  <Calendar
                    id="sprint-start"
                    value={startDate}
                    onChange={(ev) => {
                      const v = ev.value as Date | Date[] | null;
                      const d = Array.isArray(v) ? v[0] : v;
                      if (d) setStartDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
                    }}
                    dateFormat="yy-mm-dd"
                    showIcon
                    className="sprints-calendar"
                  />
                </div>
                <div className="sprints-field">
                  <label htmlFor="sprint-days">Days per sprint</label>
                  <InputNumber
                    inputId="sprint-days"
                    value={durationDays}
                    onValueChange={(e) => setDurationDays(e.value ?? 14)}
                    min={1}
                    max={120}
                    showButtons
                    className="sprints-input"
                  />
                </div>
                <div className="sprints-field">
                  <label htmlFor="sprint-type">Sprint type</label>
                  <Dropdown
                    inputId="sprint-type"
                    value={sprintTypeChoice}
                    options={sprintTypeDropdownOptions}
                    onChange={(e) => setSprintTypeChoice(e.value as string)}
                    className="sprints-input"
                  />
                </div>
                {sprintTypeChoice === SPRINT_TYPE_CUSTOM ? (
                  <div className="sprints-field sprints-field-span">
                    <label htmlFor="sprint-custom-type">Custom type name</label>
                    <InputText
                      id="sprint-custom-type"
                      value={customTypeLabel}
                      onChange={(e) => setCustomTypeLabel(e.target.value)}
                      placeholder="e.g. Compliance push"
                      className="sprints-input"
                    />
                    <span className="sprints-field-hint">Stored as: {resolveSprintType()}</span>
                  </div>
                ) : null}
              </div>
              <div className="sprints-wizard-footer">
                <Button type="button" label="Cancel" severity="secondary" text onClick={() => void cancelWizard()} disabled={saving} />
                <span className="sprints-wizard-footer-spacer" aria-hidden="true" />
                <Button type="button" label="Next: projects" icon="pi pi-angle-right" iconPos="right" onClick={handleWizardStep1Next} />
              </div>
            </motion.div>
          ) : null}

          {wizardStep === 2 ? (
            <motion.div
              key="wizard-step-2"
              className="sprints-wizard-panel"
              role="tabpanel"
              initial={reduceMotion ? false : { opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: -24 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <h2 className="sprints-section-title">Step 2 — Projects in this sprint</h2>
              <p className="sprints-wizard-lead">Choose which projects are in scope. Ticket backlogs will be drawn from these projects in the next step.</p>
              <div className="sprints-form-grid">
                <div className="sprints-field sprints-field-span">
                  <label htmlFor="sprint-projects">Projects</label>
                  <MultiSelect
                    id="sprint-projects"
                    value={projectIds}
                    options={projectOptions}
                    onChange={(e) => setProjectIds((e.value as string[]) ?? [])}
                    display="chip"
                    placeholder="Select one or more projects"
                    className="sprints-input"
                  />
                </div>
              </div>
              <div className="sprints-wizard-footer">
                <Button type="button" label="Cancel wizard" severity="secondary" text onClick={() => void cancelWizard()} disabled={saving} />
                <span className="sprints-wizard-footer-spacer" aria-hidden="true" />
                <Button
                  type="button"
                  label="Back"
                  severity="secondary"
                  text
                  onClick={() => {
                    if (wizardSprintRow) syncFormFromSprint(wizardSprintRow);
                    setWizardStep(1);
                  }}
                />
                <Button
                  type="button"
                  label={wizardSprintId ? 'Save & continue' : 'Create draft & continue'}
                  icon="pi pi-angle-right"
                  iconPos="right"
                  onClick={() => void handleWizardStep2Next()}
                  loading={saving}
                />
              </div>
            </motion.div>
          ) : null}

          {wizardStep === 3 && wizardSprintId ? (
            <motion.div
              key="wizard-step-3"
              className="sprints-wizard-panel"
              role="tabpanel"
              initial={reduceMotion ? false : { opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: -24 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <h2 className="sprints-section-title">Step 3 — Tag tickets to this sprint</h2>
              <p className="sprints-wizard-lead">
                Drag tickets from the backlog into the sprint, create new tickets for sprint projects, or remove items. The
                sprint stays <strong>planning</strong> until you confirm in the last step.
              </p>
              {!ticketContextSprint ? (
                <p className="sprints-muted">Loading sprint…</p>
              ) : (
                <>
              <div className="sprints-meta-bar">
                <span>
                  <strong>Type:</strong> {ticketContextSprint.sprint_type}
                </span>
                <span>
                  <strong>Duration:</strong> {ticketContextSprint.duration_days} days
                </span>
                <span>
                  <strong>Window:</strong> {ticketContextSprint.start_date} → {ticketContextSprint.end_date}
                </span>
                <span>
                  <strong>Projects:</strong> {ticketContextSprint.project_ids.map((id) => projectName(id)).join(', ') || '—'}
                </span>
              </div>
              {isLead ? (
                <div className="sprints-ticket-actions">
                  <p className="sprints-ticket-actions-hint">
                    Need something new? Create a ticket and it will be added to this sprint.
                  </p>
                  <Button
                    type="button"
                    label="Add ticket"
                    icon="pi pi-plus"
                    size="small"
                    onClick={openCreateTicketDialog}
                    disabled={!ticketContextSprint.project_ids.length}
                  />
                </div>
              ) : null}
              <div className="sprints-dnd-layout">
                <div className="sprints-dnd-column">
                  <h3 className="sprints-dnd-title">Backlog (same projects, not in this sprint)</h3>
                  <div
                    className="sprints-ticket-list"
                    onDragOver={onDragOver}
                    onDrop={async (e) => {
                      e.preventDefault();
                      const ticketId = e.dataTransfer.getData('ticketId');
                      if (ticketId && isLead) await handleAssignTicket(ticketId, null);
                    }}
                  >
                    {ticketsAvailable.map((t) => (
                      <div
                        key={t.id}
                        className="sprints-ticket-chip"
                        draggable={isLead}
                        onDragStart={(e) => onDragStart(e, t.id)}
                      >
                        <span className="sprints-ticket-ref">{t.public_reference ?? `#${t.ticket_number}`}</span>
                        <span className="sprints-ticket-title">{t.title}</span>
                        <Tag value={t.status} severity="info" className="sprints-ticket-status" />
                      </div>
                    ))}
                    {!ticketsAvailable.length ? <p className="sprints-muted">No unassigned tickets in these projects.</p> : null}
                  </div>
                </div>
                <div className="sprints-dnd-column">
                  <h3 className="sprints-dnd-title">In this sprint {isLead ? '(drop here)' : ''}</h3>
                  <div
                    className="sprints-ticket-list sprints-ticket-list--drop"
                    onDragOver={onDragOver}
                    onDrop={(e) => void onDropToSprint(e)}
                  >
                    {ticketsInSprint.map((t) => (
                      <div key={t.id} className="sprints-ticket-chip sprints-ticket-chip--in">
                        <span className="sprints-ticket-ref">{t.public_reference ?? `#${t.ticket_number}`}</span>
                        <span className="sprints-ticket-title">{t.title}</span>
                        <Tag value={t.status} severity="success" className="sprints-ticket-status" />
                        {isLead ? (
                          <Button
                            type="button"
                            icon="pi pi-times"
                            text
                            rounded
                            className="sprints-ticket-remove"
                            aria-label="Remove from sprint"
                            disabled={ticketBusy === t.id}
                            onClick={() => void handleAssignTicket(t.id, null)}
                          />
                        ) : null}
                      </div>
                    ))}
                    {!ticketsInSprint.length ? (
                      <p className="sprints-muted">No tickets yet. Drag from the left or add scope in step 2.</p>
                    ) : null}
                  </div>
                </div>
              </div>
                </>
              )}
              <div className="sprints-wizard-footer">
                <Button type="button" label="Cancel wizard" severity="secondary" text onClick={() => void cancelWizard()} disabled={saving} />
                <span className="sprints-wizard-footer-spacer" aria-hidden="true" />
                <Button
                  type="button"
                  label="Back"
                  severity="secondary"
                  text
                  onClick={() => {
                    if (wizardSprintRow) setProjectIds([...wizardSprintRow.project_ids]);
                    setWizardStep(2);
                  }}
                />
                <Button
                  type="button"
                  label="Next: preview"
                  icon="pi pi-angle-right"
                  iconPos="right"
                  onClick={() => setWizardStep(4)}
                  disabled={!ticketContextSprint}
                />
              </div>
            </motion.div>
          ) : null}

          {wizardStep === 4 && wizardSprintRow ? (
            <motion.div
              key="wizard-step-4"
              className="sprints-wizard-panel"
              role="tabpanel"
              initial={reduceMotion ? false : { opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: -24 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <h2 className="sprints-section-title">Step 4 — Preview &amp; confirm</h2>
              <p className="sprints-wizard-lead">
                Review the sprint. When you confirm, its status becomes <strong>active</strong> so the team can execute against it.
              </p>
              <div className="sprints-preview-card">
                <dl className="sprints-preview-dl">
                  <dt>Title</dt>
                  <dd>{wizardSprintRow.title}</dd>
                  <dt>Type</dt>
                  <dd>{wizardSprintRow.sprint_type}</dd>
                  <dt>Schedule</dt>
                  <dd>
                    {wizardSprintRow.start_date} → {wizardSprintRow.end_date} ({wizardSprintRow.duration_days} days)
                  </dd>
                  <dt>Projects</dt>
                  <dd>{wizardSprintRow.project_ids.map((id) => projectName(id)).join(', ') || '—'}</dd>
                  <dt>Tickets in sprint</dt>
                  <dd>{previewTicketsInSprint.length}</dd>
                </dl>
                {previewTicketsInSprint.length ? (
                  <ul className="sprints-preview-ticket-list">
                    {previewTicketsInSprint.map((t) => (
                      <li key={t.id}>
                        <span className="sprints-ticket-ref">{t.public_reference ?? `#${t.ticket_number}`}</span>
                        <span className="sprints-ticket-title">{t.title}</span>
                        <Tag value={t.status} severity="info" className="sprints-ticket-status" />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="sprints-muted">No tickets linked yet — you can still confirm and add tickets later.</p>
                )}
              </div>
              <div className="sprints-wizard-footer">
                <Button type="button" label="Cancel wizard" severity="secondary" text onClick={() => void cancelWizard()} disabled={saving} />
                <span className="sprints-wizard-footer-spacer" aria-hidden="true" />
                <Button type="button" label="Back" severity="secondary" text onClick={() => setWizardStep(3)} />
                <Button
                  type="button"
                  label="Confirm sprint"
                  icon="pi pi-check"
                  onClick={() => void handleWizardConfirm()}
                  loading={saving}
                />
              </div>
            </motion.div>
          ) : null}
            </AnimatePresence>
          </div>
          <footer className="sprints-wizard-foot">
            <p className="sprints-wizard-meta" aria-live="polite">
              Step <strong>{wizardStep}</strong> of {WIZARD_STEP_LABELS.length}
            </p>
          </footer>
        </section>
      ) : null}

      {!wizardOpen ? (
        <section className="sprints-manage-section" aria-label="Sprints and tickets">
          <h2 className="sprints-section-title">Sprints &amp; tickets</h2>
          <div className="sprints-picker-row">
            <label htmlFor="sprint-pick">Active sprint</label>
            <Dropdown
              inputId="sprint-pick"
              value={selectedSprintId}
            options={displaySprints.map((s) => ({
              label: `${s.title} (${s.start_date} → ${s.end_date})`,
              value: s.id,
            }))}
              onChange={(e) => setSelectedSprintId(e.value as string)}
              placeholder="Select a sprint"
              className="sprints-input sprints-dropdown-wide"
            />
            {isLead && selectedSprintId ? (
              <Button
                type="button"
                icon="pi pi-trash"
                severity="danger"
                text
                rounded
                aria-label="Delete sprint"
                onClick={() => void handleDeleteSprint(selectedSprintId)}
                disabled={saving}
              />
            ) : null}
          </div>

          {selectedSprint ? (
            <div className="sprints-meta-bar">
              <span>
                <strong>Type:</strong> {selectedSprint.sprint_type}
              </span>
              <span>
                <strong>Duration:</strong> {selectedSprint.duration_days} days
              </span>
              <span>
                <strong>Status:</strong> {selectedSprint.status}
              </span>
              <span>
                <strong>Projects:</strong> {selectedSprint.project_ids.map((id) => projectName(id)).join(', ') || '—'}
              </span>
            </div>
          ) : null}

          {selectedSprintId && selectedSprint ? (
            <>
              {isLead ? (
                <div className="sprints-ticket-actions">
                  <p className="sprints-ticket-actions-hint">Create a new ticket and attach it to this sprint.</p>
                  <Button
                    type="button"
                    label="Add ticket"
                    icon="pi pi-plus"
                    size="small"
                    onClick={openCreateTicketDialog}
                    disabled={!selectedSprint.project_ids.length}
                  />
                </div>
              ) : null}
              <div className="sprints-dnd-layout">
              <div className="sprints-dnd-column">
                <h3 className="sprints-dnd-title">Backlog (same projects, not in this sprint)</h3>
                <div
                  className="sprints-ticket-list"
                  onDragOver={onDragOver}
                  onDrop={async (e) => {
                    e.preventDefault();
                    const ticketId = e.dataTransfer.getData('ticketId');
                    if (ticketId && isLead) await handleAssignTicket(ticketId, null);
                  }}
                >
                  {ticketsAvailable.map((t) => (
                    <div
                      key={t.id}
                      className="sprints-ticket-chip"
                      draggable={isLead}
                      onDragStart={(e) => onDragStart(e, t.id)}
                    >
                      <span className="sprints-ticket-ref">{t.public_reference ?? `#${t.ticket_number}`}</span>
                      <span className="sprints-ticket-title">{t.title}</span>
                      <Tag value={t.status} severity="info" className="sprints-ticket-status" />
                    </div>
                  ))}
                  {!ticketsAvailable.length ? <p className="sprints-muted">No unassigned tickets in these projects.</p> : null}
                </div>
              </div>
              <div className="sprints-dnd-column">
                <h3 className="sprints-dnd-title">In this sprint {isLead ? '(drop here)' : ''}</h3>
                <div
                  className="sprints-ticket-list sprints-ticket-list--drop"
                  onDragOver={onDragOver}
                  onDrop={(e) => void onDropToSprint(e)}
                >
                  {ticketsInSprint.map((t) => (
                    <div key={t.id} className="sprints-ticket-chip sprints-ticket-chip--in">
                      <span className="sprints-ticket-ref">{t.public_reference ?? `#${t.ticket_number}`}</span>
                      <span className="sprints-ticket-title">{t.title}</span>
                      <Tag value={t.status} severity="success" className="sprints-ticket-status" />
                      {isLead ? (
                        <Button
                          type="button"
                          icon="pi pi-times"
                          text
                          rounded
                          className="sprints-ticket-remove"
                          aria-label="Remove from sprint"
                          disabled={ticketBusy === t.id}
                          onClick={() => void handleAssignTicket(t.id, null)}
                        />
                      ) : null}
                    </div>
                  ))}
                  {!ticketsInSprint.length ? <p className="sprints-muted">No tickets yet. Drag from the left or add scope projects.</p> : null}
                </div>
              </div>
            </div>
            </>
          ) : (
            <p className="sprints-muted">Create or select a sprint to assign tickets.</p>
          )}
        </section>
      ) : null}

      <Dialog
        header="New ticket"
        visible={createTicketOpen}
        className="sprints-ticket-create-dialog"
        style={{ width: 'min(1100px, 98vw)' }}
        onHide={() => {
          if (!createTicketSaving) setCreateTicketOpen(false);
        }}
        dismissableMask={!createTicketSaving}
        closable={!createTicketSaving}
      >
        {createTicketOpen && sprintForNewTicket ? (
          <TicketCreateForm
            key={createTicketNonce}
            viewKey={`${viewKey}-sprint-ticket`}
            projects={projectsForCreateTicket}
            customers={customers}
            assignableUsers={assignableUsers}
            ticketConfigurations={ticketConfigurations}
            existingTickets={tickets}
            initialProjectId={sprintForNewTicket.project_ids[0] ?? null}
            submitLabel="Create & add to sprint"
            saving={createTicketSaving}
            onSubmit={(payload) => handleSprintCreateTicketSubmit(payload)}
            onCancel={() => {
              if (!createTicketSaving) setCreateTicketOpen(false);
            }}
          />
        ) : null}
      </Dialog>
    </motion.article>
  );
}

function SprintsMonitoring({ viewKey, isLead }: { viewKey: string; isLead: boolean }) {
  const [sprints, setSprints] = useState<SprintRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<SprintAnalyticsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const displaySprints = useMemo(
    () => (isLead ? sprints : sprints.filter(isSprintActive)),
    [sprints, isLead],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await getSprintsRequest();
        if (cancelled) return;
        setSprints(list);
        const visible = isLead ? list : list.filter(isSprintActive);
        setSelectedId((cur) => (cur && visible.some((s) => s.id === cur) ? cur : visible[0]?.id ?? null));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewKey, isLead]);

  useEffect(() => {
    if (!selectedId) {
      setAnalytics(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const a = await getSprintAnalyticsRequest(selectedId);
        if (!cancelled) setAnalytics(a);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Analytics failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const statusEntries = analytics ? Object.entries(analytics.by_status).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <motion.article
      key={viewKey}
      className="page-card sprints-workspace-card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <header className="sprints-workspace-header">
        <div>
          <h3 className="calendar-kicker">Sprints</h3>
          <h1 className="calendar-title">Monitoring</h1>
          <p className="calendar-sub sprints-workspace-sub">
            {isLead
              ? 'Track sprint progress: completion rate and ticket distribution by status. Updates come from ticket workflow across the team.'
              : 'Track the active sprint only: completion rate and ticket distribution by status. Planning sprints are visible to team leads.'}
          </p>
        </div>
      </header>

      {error ? (
        <p className="sprints-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="sprints-muted">Loading…</p> : null}

      <div className="sprints-picker-row">
        <label htmlFor="mon-sprint">Sprint</label>
        <Dropdown
          inputId="mon-sprint"
          value={selectedId}
          options={displaySprints.map((s) => ({ label: s.title, value: s.id }))}
          onChange={(e) => setSelectedId(e.value as string)}
          placeholder="Select sprint"
          className="sprints-input sprints-dropdown-wide"
        />
      </div>

      {!isLead && !loading && displaySprints.length === 0 ? (
        <p className="sprints-muted">No active sprint yet. Your team lead will activate a sprint when it is ready.</p>
      ) : null}

      {analytics && selectedId ? (
        <div className="sprints-analytics">
          <div className="sprints-analytics-kpis">
            <div className="sprints-kpi">
              <span className="sprints-kpi-label">Tickets</span>
              <span className="sprints-kpi-value">{analytics.total_tickets}</span>
            </div>
            <div className="sprints-kpi">
              <span className="sprints-kpi-label">Done / resolved</span>
              <span className="sprints-kpi-value">
                {analytics.tickets_done} / {analytics.total_tickets}
              </span>
            </div>
            <div className="sprints-kpi">
              <span className="sprints-kpi-label">Remaining</span>
              <span className="sprints-kpi-value">{analytics.tickets_remaining}</span>
            </div>
          </div>
          <div className="sprints-progress-wrap">
            <span className="sprints-progress-label">Progress toward closed/resolved</span>
            <ProgressBar value={analytics.progress_percent} className="sprints-progress-bar" />
            <span className="sprints-progress-pct">{analytics.progress_percent}%</span>
          </div>
          <h3 className="sprints-subheading">By status</h3>
          <div className="sprints-status-grid">
            {statusEntries.map(([status, count]) => (
              <div key={status} className="sprints-status-cell">
                <span className="sprints-status-name">{status.replace(/_/g, ' ')}</span>
                <span className="sprints-status-count">{count}</span>
              </div>
            ))}
            {!statusEntries.length ? <p className="sprints-muted">No tickets linked to this sprint yet.</p> : null}
          </div>
        </div>
      ) : !loading ? (
        <p className="sprints-muted">Select a sprint with linked tickets to see analytics.</p>
      ) : null}
    </motion.article>
  );
}
