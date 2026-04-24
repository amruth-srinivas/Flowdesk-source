import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputNumber } from 'primereact/inputnumber';
import { InputText } from 'primereact/inputtext';
import { MultiSelect } from 'primereact/multiselect';
import { Chart } from 'primereact/chart';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
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

function formatSprintRange(start: string, end: string): string {
  return `${formatSprintDay(start)} – ${formatSprintDay(end)}`;
}

function humanizeToken(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function memberInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'
  );
}

function sprintStatusTagSeverity(
  status: string,
): 'success' | 'info' | 'warning' | 'secondary' | 'danger' | undefined {
  const x = status.toLowerCase().trim();
  if (x === 'active') return 'success';
  if (x === 'planning') return 'warning';
  if (x === 'completed' || x === 'closed') return 'info';
  return 'secondary';
}

function ticketPrioritySeverity(
  p: string,
): 'success' | 'info' | 'warning' | 'danger' | undefined {
  const x = p.toLowerCase().replace(/\s+/g, '_');
  if (x === 'critical') return 'danger';
  if (x === 'high') return 'warning';
  if (x === 'medium') return 'info';
  if (x === 'low') return 'success';
  return undefined;
}

function ticketPaletteKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '_');
}

const SPRINT_CHART_PALETTE = [
  '#7c9ee6',
  '#9a8fe0',
  '#f2b880',
  '#7fc7b2',
  '#96a3b8',
  '#d39ac2',
  '#88c4d8',
  '#e59aa8',
];

const sprintDoughnutOptions = {
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: {
        font: { size: 11 },
        padding: 10,
        usePointStyle: true,
        boxWidth: 9,
        boxHeight: 9,
        color: '#54627a',
      },
    },
    tooltip: { displayColors: false },
  },
  cutout: '58%',
};

const sprintBarOptions = {
  indexAxis: 'y' as const,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { enabled: true, displayColors: false },
  },
  scales: {
    x: {
      beginAtZero: true,
      ticks: { stepSize: 1, precision: 0 },
      grid: { color: '#eef2f7' },
      border: { display: false },
    },
    y: {
      grid: { display: false },
      border: { display: false },
    },
  },
};

const sprintModalStagger = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.02 },
  },
};

const sprintModalItem = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24 } },
};

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

  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<SprintAnalyticsRecord | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<TicketRecord | null>(null);

  const formatDateTime = useCallback((value: string | null) => {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  }, []);

  const openMonitoringDashboard = useCallback(async () => {
    if (!shownSprint) return;
    setDashboardOpen(true);
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const data = await getSprintAnalyticsRequest(shownSprint.id);
      setAnalytics(data);
    } catch (e) {
      setDashboardError(e instanceof Error ? e.message : 'Could not load monitoring dashboard');
      setAnalytics(null);
    } finally {
      setDashboardLoading(false);
    }
  }, [shownSprint]);

  const statusEntries = analytics ? Object.entries(analytics.by_status).sort(([a], [b]) => a.localeCompare(b)) : [];

  const statusChartData = useMemo(() => {
    if (!analytics) return null;
    const entries = Object.entries(analytics.by_status).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) return null;
    return {
      labels: entries.map(([k]) => humanizeToken(k)),
      datasets: [
        {
          data: entries.map(([, v]) => v),
          backgroundColor: entries.map((_, i) => SPRINT_CHART_PALETTE[i % SPRINT_CHART_PALETTE.length]),
          borderWidth: 0,
        },
      ],
    };
  }, [analytics]);

  const completionChartData = useMemo(() => {
    if (!analytics) return null;
    const done = analytics.tickets_done;
    const rem = analytics.tickets_remaining;
    if (done === 0 && rem === 0) {
      return {
        labels: ['No tickets in sprint'],
        datasets: [{ data: [1], backgroundColor: ['#e2e8f0'], borderWidth: 0 }],
      };
    }
    return {
      labels: ['Done / resolved', 'Remaining'],
      datasets: [
        {
          data: [done, rem],
          backgroundColor: ['#22c55e', '#cbd5e1'],
          borderWidth: 0,
        },
      ],
    };
  }, [analytics]);

  const priorityChartData = useMemo(() => {
    if (!analytics?.tickets?.length) return null;
    const m: Record<string, number> = {};
    for (const t of analytics.tickets) {
      const p = (t.priority || 'unknown').toLowerCase();
      m[p] = (m[p] ?? 0) + 1;
    }
    const entries = Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
    const tone = (k: string): string => {
      if (k === 'critical') return '#e9a0a7';
      if (k === 'high') return '#f2c28c';
      if (k === 'medium') return '#8fb0ea';
      if (k === 'low') return '#8fcab3';
      return '#a7b2c6';
    };
    return {
      labels: entries.map(([k]) => humanizeToken(k)),
      datasets: [
        {
          label: '',
          data: entries.map(([, v]) => v),
          backgroundColor: entries.map(([k]) => tone(k)),
          borderRadius: 6,
          borderSkipped: false,
          barThickness: 22,
        },
      ],
    };
  }, [analytics]);

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
            <Button
              type="button"
              label="Open monitoring dashboard"
              icon="pi pi-chart-bar"
              className="sprints-member-dashboard-btn"
              onClick={() => void openMonitoringDashboard()}
            />
          </div>

          <div className="sprints-member-section-head">
            <h3>Work in this sprint</h3>
            <div className="sprints-member-head-actions">
              <span className="sprints-member-count">
                {ticketsInSprint.length} {ticketsInSprint.length === 1 ? 'item' : 'items'}
              </span>
              <button type="button" className="sprints-member-link-btn" onClick={() => void openMonitoringDashboard()}>
                View dashboard
              </button>
            </div>
          </div>

          <div className="sprints-member-ticket-list">
            {ticketsInSprint.map((t) => (
              <button
                key={t.id}
                type="button"
                className="sprints-member-ticket-row"
                onClick={() => setSelectedTicket(t)}
              >
                <div className="sprints-member-ticket-main">
                  <span className="sprints-member-ticket-ref">{t.public_reference ?? `#${t.ticket_number}`}</span>
                  <span className="sprints-member-ticket-title">{t.title}</span>
                </div>
                <Tag
                  value={t.status.replace(/_/g, ' ')}
                  severity={sprintTicketStatusSeverity(t.status)}
                  className={`sprints-ticket-status sprints-ticket-status--${ticketPaletteKey(t.status)}`}
                />
              </button>
            ))}
            {!ticketsInSprint.length ? (
              <p className="sprints-muted">No tickets linked to this sprint yet.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <Dialog
        header={selectedTicket ? `${selectedTicket.public_reference ?? `#${selectedTicket.ticket_number}`} · Ticket details` : 'Ticket details'}
        visible={Boolean(selectedTicket)}
        onHide={() => setSelectedTicket(null)}
        style={{ width: 'min(760px, 95vw)' }}
        className="sprints-member-ticket-dialog"
      >
        {selectedTicket ? (
          <div className="sprints-member-ticket-detail">
            <div className="sprints-member-ticket-detail-grid">
              <div className="sprints-member-ticket-detail-item">
                <span className="sprints-member-ticket-detail-label">Status</span>
                <Tag
                  value={selectedTicket.status.replace(/_/g, ' ')}
                  severity={sprintTicketStatusSeverity(selectedTicket.status)}
                  className={`sprints-ticket-status sprints-ticket-status--${ticketPaletteKey(selectedTicket.status)}`}
                />
              </div>
              <div className="sprints-member-ticket-detail-item">
                <span className="sprints-member-ticket-detail-label">Priority</span>
                <Tag value={humanizeToken(selectedTicket.priority)} severity={ticketPrioritySeverity(selectedTicket.priority)} rounded />
              </div>
              <div className="sprints-member-ticket-detail-item">
                <span className="sprints-member-ticket-detail-label">Type</span>
                <strong>{humanizeToken(selectedTicket.type)}</strong>
              </div>
              <div className="sprints-member-ticket-detail-item">
                <span className="sprints-member-ticket-detail-label">Project</span>
                <strong>{selectedTicket.project_id}</strong>
              </div>
              <div className="sprints-member-ticket-detail-item">
                <span className="sprints-member-ticket-detail-label">Assignees</span>
                <strong>{selectedTicket.assignee_names?.length ? selectedTicket.assignee_names.join(', ') : 'Unassigned'}</strong>
              </div>
              <div className="sprints-member-ticket-detail-item">
                <span className="sprints-member-ticket-detail-label">Due date</span>
                <strong>{formatDateTime(selectedTicket.due_date)}</strong>
              </div>
            </div>
            <div className="sprints-member-ticket-detail-item sprints-member-ticket-detail-item--full">
              <span className="sprints-member-ticket-detail-label">Description</span>
              <p>{selectedTicket.description?.trim() || 'No description provided.'}</p>
            </div>
            <div className="sprints-member-ticket-detail-grid">
              <div className="sprints-member-ticket-detail-item">
                <span className="sprints-member-ticket-detail-label">Created</span>
                <strong>{formatDateTime(selectedTicket.created_at)}</strong>
              </div>
              <div className="sprints-member-ticket-detail-item">
                <span className="sprints-member-ticket-detail-label">Last updated</span>
                <strong>{formatDateTime(selectedTicket.updated_at)}</strong>
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        header="Sprint monitoring dashboard"
        visible={dashboardOpen}
        onHide={() => {
          setDashboardOpen(false);
          setDashboardError(null);
        }}
        style={{ width: 'min(980px, 95vw)' }}
        className="sprints-member-dashboard-dialog"
      >
        {dashboardLoading ? <p className="sprints-muted sprints-monitoring-loading-inline">Loading dashboard data…</p> : null}
        {dashboardError ? (
          <p className="sprints-error" role="alert">
            {dashboardError}
          </p>
        ) : null}
        {!dashboardLoading && !dashboardError && analytics ? (
          <div className="sprints-member-dashboard-shell sprints-monitoring-dashboard">
            <div className="sprints-monitoring-dashboard-head">
              <div>
                <h2 className="sprints-monitoring-dashboard-title">Sprint overview</h2>
                <p className="sprints-monitoring-hero-meta">
                  <strong>{shownSprint?.title ?? 'Current sprint'}</strong>
                  {shownSprint ? (
                    <>
                      <span className="sprints-monitoring-hero-dot" aria-hidden>
                        ·
                      </span>
                      {formatSprintRange(shownSprint.start_date, shownSprint.end_date)}
                    </>
                  ) : null}
                </p>
              </div>
            </div>

            <div className="sprints-charts-grid">
              <div className="sprints-chart-card sprints-chart-card--status">
                <h3 className="sprints-chart-card-title">Tickets by status</h3>
                <div className="sprints-chart-canvas">
                  {statusChartData ? (
                    <Chart key="member-st" type="doughnut" data={statusChartData} options={sprintDoughnutOptions} className="sprints-chart" />
                  ) : (
                    <p className="sprints-muted sprints-chart-empty">No status data yet.</p>
                  )}
                </div>
              </div>
              <div className="sprints-chart-card sprints-chart-card--completion">
                <h3 className="sprints-chart-card-title">Completion mix</h3>
                <p className="sprints-chart-card-hint">Closed + resolved vs everything else</p>
                <div className="sprints-chart-canvas">
                  {completionChartData ? (
                    <Chart key="member-co" type="doughnut" data={completionChartData} options={sprintDoughnutOptions} className="sprints-chart" />
                  ) : null}
                </div>
              </div>
            </div>

            <div className="sprints-monitoring-focus-row">
              <div className="sprints-chart-card sprints-chart-card--priority">
                <h3 className="sprints-chart-card-title">Tickets by priority</h3>
                <div className="sprints-chart-canvas sprints-chart-canvas--bar">
                  {priorityChartData ? (
                    <Chart key="member-pr" type="bar" data={priorityChartData} options={sprintBarOptions} className="sprints-chart" />
                  ) : (
                    <p className="sprints-muted sprints-chart-empty">No tickets to chart.</p>
                  )}
                </div>
              </div>

              <div className="sprints-analytics sprints-analytics--panel">
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
                  <span className="sprints-progress-label">Progress</span>
                  <ProgressBar value={analytics.progress_percent} showValue={false} className="sprints-progress-bar" />
                </div>
                <h3 className="sprints-subheading">By status</h3>
                <div className="sprints-status-grid">
                  {statusEntries.map(([st, count]) => (
                    <div key={st} className="sprints-status-cell">
                      <span className="sprints-status-name">{humanizeToken(st)}</span>
                      <span className="sprints-status-count">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <section className="sprints-monitoring-members" aria-label="Active members">
              <h3 className="sprints-monitoring-section-title">People on this sprint</h3>
              <p className="sprints-monitoring-section-sub">Everyone assigned to at least one ticket in this sprint.</p>
              {(analytics.active_members ?? []).length ? (
                <ul className="sprints-monitoring-member-chips">
                  {(analytics.active_members ?? []).map((m) => (
                    <li key={m.id}>
                      <span className="sprints-monitoring-member-chip" title={m.name}>
                        {m.avatar_url ? (
                          <img src={m.avatar_url} alt="" className="sprints-monitoring-member-avatar" loading="lazy" />
                        ) : (
                          <span className="sprints-monitoring-member-initials" aria-hidden>
                            {memberInitials(m.name)}
                          </span>
                        )}
                        <span className="sprints-monitoring-member-name">{m.name}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sprints-muted">No assignees yet for this sprint.</p>
              )}
            </section>

            <section className="sprints-monitoring-tickets" aria-label="Sprint tickets">
              <h3 className="sprints-monitoring-section-title">Tickets in this sprint</h3>
              <div className="sprints-monitoring-table-shell">
                <DataTable value={analytics.tickets ?? []} dataKey="id" className="user-table sprints-monitoring-table" stripedRows size="small">
                  <Column field="public_reference" header="Ticket" style={{ width: '130px' }} />
                  <Column field="title" header="Title" />
                  <Column
                    field="status"
                    header="Status"
                    body={(row: { status: string }) => (
                      <Tag
                        value={row.status.replace(/_/g, ' ')}
                        severity={sprintTicketStatusSeverity(row.status)}
                        className={`sprints-ticket-status sprints-ticket-status--${ticketPaletteKey(row.status)}`}
                      />
                    )}
                    style={{ width: '140px' }}
                  />
                </DataTable>
              </div>
            </section>
          </div>
        ) : null}
      </Dialog>
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
                        <Tag
                          value={t.status}
                          severity="info"
                          className={`sprints-ticket-status sprints-ticket-status--${ticketPaletteKey(t.status)}`}
                        />
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
                        <Tag
                          value={t.status}
                          severity="success"
                          className={`sprints-ticket-status sprints-ticket-status--${ticketPaletteKey(t.status)}`}
                        />
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
                        <Tag
                          value={t.status}
                          severity="info"
                          className={`sprints-ticket-status sprints-ticket-status--${ticketPaletteKey(t.status)}`}
                        />
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
                      <Tag
                        value={t.status}
                        severity="info"
                        className={`sprints-ticket-status sprints-ticket-status--${ticketPaletteKey(t.status)}`}
                      />
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
                      <Tag
                        value={t.status}
                        severity="success"
                        className={`sprints-ticket-status sprints-ticket-status--${ticketPaletteKey(t.status)}`}
                      />
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
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [analytics, setAnalytics] = useState<SprintAnalyticsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displaySprints = useMemo(
    () => (isLead ? sprints : sprints.filter(isMemberVisibleSprint)),
    [sprints, isLead],
  );

  const selectedSprint = useMemo(
    () => displaySprints.find((s) => s.id === selectedId) ?? null,
    [displaySprints, selectedId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await getSprintsRequest();
        if (cancelled) return;
        setSprints(list);
        const visible = isLead ? list : list.filter(isMemberVisibleSprint);
        setSelectedId((cur) => (cur && visible.some((s) => s.id === cur) ? cur : null));
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
      setAnalyticsLoading(true);
      try {
        const a = await getSprintAnalyticsRequest(selectedId);
        if (!cancelled) setAnalytics(a);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Analytics failed');
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const statusEntries = analytics ? Object.entries(analytics.by_status).sort(([a], [b]) => a.localeCompare(b)) : [];

  const statusChartData = useMemo(() => {
    if (!analytics) return null;
    const entries = Object.entries(analytics.by_status).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) return null;
    return {
      labels: entries.map(([k]) => humanizeToken(k)),
      datasets: [
        {
          data: entries.map(([, v]) => v),
          backgroundColor: entries.map((_, i) => SPRINT_CHART_PALETTE[i % SPRINT_CHART_PALETTE.length]),
          borderWidth: 0,
        },
      ],
    };
  }, [analytics]);

  const completionChartData = useMemo(() => {
    if (!analytics) return null;
    const done = analytics.tickets_done;
    const rem = analytics.tickets_remaining;
    if (done === 0 && rem === 0) {
      return {
        labels: ['No tickets in sprint'],
        datasets: [{ data: [1], backgroundColor: ['#e2e8f0'], borderWidth: 0 }],
      };
    }
    return {
      labels: ['Done / resolved', 'Remaining'],
      datasets: [
        {
          data: [done, rem],
          backgroundColor: ['#22c55e', '#cbd5e1'],
          borderWidth: 0,
        },
      ],
    };
  }, [analytics]);

  const priorityChartData = useMemo(() => {
    if (!analytics?.tickets?.length) return null;
    const m: Record<string, number> = {};
    for (const t of analytics.tickets) {
      const p = (t.priority || 'unknown').toLowerCase();
      m[p] = (m[p] ?? 0) + 1;
    }
    const entries = Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
    const tone = (k: string): string => {
      if (k === 'critical') return '#e9a0a7';
      if (k === 'high') return '#f2c28c';
      if (k === 'medium') return '#8fb0ea';
      if (k === 'low') return '#8fcab3';
      return '#a7b2c6';
    };
    return {
      labels: entries.map(([k]) => humanizeToken(k)),
      datasets: [
        {
          label: '',
          data: entries.map(([, v]) => v),
          backgroundColor: entries.map(([k]) => tone(k)),
          borderRadius: 6,
          borderSkipped: false,
          barThickness: 22,
        },
      ],
    };
  }, [analytics]);

  return (
    <motion.article
      key={viewKey}
      className="page-card sprints-workspace-card sprints-monitoring-page"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <header className="sprints-workspace-header">
        <div>
          <h3 className="calendar-kicker">Sprints</h3>
        </div>
      </header>

      {error ? (
        <p className="sprints-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="sprints-muted">Loading sprints…</p> : null}

      {!isLead && !loading && displaySprints.length === 0 ? (
        <p className="sprints-muted">No active or planning sprint yet. Your team lead will create one when it is ready.</p>
      ) : null}

      {!loading && displaySprints.length > 0 ? (
        <>
          <section className="sprints-monitoring-sprints-table-section" aria-label="All sprints">
            <div className="sprints-monitoring-table-section-head">
              <h2 className="sprints-monitoring-section-title">All sprints</h2>
              <p className="sprints-monitoring-section-sub sprints-monitoring-section-sub--tight">
                Click a row to load the overview dashboard, charts, and ticket list for that sprint.
              </p>
            </div>
            <div className="sprints-monitoring-sprints-table-shell">
              <DataTable
                value={displaySprints}
                dataKey="id"
                selectionMode="single"
                selection={selectedSprint}
                onSelectionChange={(e) => {
                  const v = e.value as SprintRecord | null;
                  setSelectedId(v?.id ?? null);
                  setDashboardOpen(Boolean(v?.id));
                }}
                metaKeySelection={false}
                className="user-table sprints-monitoring-sprints-table"
                stripedRows
                rowHover
                emptyMessage="No sprints to display."
              >
                <Column
                  header="Sprint"
                  style={{ minWidth: '200px' }}
                  body={(row: SprintRecord) => (
                    <div className="sprints-sprint-table-name">
                      <span className="sprints-sprint-table-title">{row.title}</span>
                      {isSprintActive(row) ? (
                        <Tag value="Active" severity="success" rounded className="sprints-sprint-table-active" />
                      ) : null}
                    </div>
                  )}
                />
                <Column
                  header="Period"
                  style={{ width: '220px' }}
                  body={(row: SprintRecord) => (
                    <span className="sprints-sprint-table-dates">{formatSprintRange(row.start_date, row.end_date)}</span>
                  )}
                />
                <Column
                  header="Days"
                  style={{ width: '90px' }}
                  body={(row: SprintRecord) => <span>{row.duration_days}</span>}
                />
                <Column
                  header="Type"
                  style={{ width: '120px' }}
                  body={(row: SprintRecord) => (
                    <span className="sprints-sprint-table-muted">{humanizeToken(row.sprint_type)}</span>
                  )}
                />
                <Column
                  header="Status"
                  style={{ width: '130px' }}
                  body={(row: SprintRecord) => (
                    <Tag value={humanizeToken(row.status)} severity={sprintStatusTagSeverity(row.status)} rounded />
                  )}
                />
              </DataTable>
            </div>
          </section>

          <Dialog
            header={selectedSprint ? `${selectedSprint.title} · Sprint overview` : 'Sprint overview'}
            visible={dashboardOpen && Boolean(selectedId)}
            className="sprints-monitoring-dashboard-dialog"
            style={{ width: 'min(1300px, 98vw)' }}
            contentStyle={{ paddingTop: 8 }}
            modal
            dismissableMask
            draggable={false}
            onHide={() => setDashboardOpen(false)}
          >
            {selectedId && selectedSprint ? (
              <motion.section
                className="sprints-monitoring-dashboard"
                aria-label="Sprint overview"
                variants={sprintModalStagger}
                initial="hidden"
                animate="show"
              >
              <div className="sprints-monitoring-dashboard-head">
                <div>
                  <h2 className="sprints-monitoring-dashboard-title">Sprint overview</h2>
                  <p className="sprints-monitoring-hero-meta">
                    <strong>{selectedSprint.title}</strong>
                    <span className="sprints-monitoring-hero-dot" aria-hidden>
                      ·
                    </span>
                    {formatSprintRange(selectedSprint.start_date, selectedSprint.end_date)}
                    <span className="sprints-monitoring-hero-dot" aria-hidden>
                      ·
                    </span>
                    {selectedSprint.duration_days} days
                    {isSprintActive(selectedSprint) ? (
                      <>
                        <span className="sprints-monitoring-hero-dot" aria-hidden>
                          ·
                        </span>
                        <Tag value="Active sprint" severity="success" rounded />
                      </>
                    ) : null}
                  </p>
                </div>
                <Button
                  type="button"
                  label="Clear selection"
                  text
                  className="sprints-monitoring-clear"
                  onClick={() => {
                    setDashboardOpen(false);
                    setSelectedId(null);
                  }}
                />
              </div>

              {analyticsLoading ? (
                <p className="sprints-muted sprints-monitoring-loading-inline">Loading dashboard data…</p>
              ) : null}

              {analytics && selectedSprint ? (
                <>
                  <motion.div className="sprints-charts-grid" variants={sprintModalItem}>
                    <div className="sprints-chart-card sprints-chart-card--status">
                      <h3 className="sprints-chart-card-title">Tickets by status</h3>
                      <div className="sprints-chart-canvas">
                        {statusChartData ? (
                          <Chart
                            key={`${selectedId}-st`}
                            type="doughnut"
                            data={statusChartData}
                            options={sprintDoughnutOptions}
                            className="sprints-chart"
                          />
                        ) : (
                          <p className="sprints-muted sprints-chart-empty">No status data yet.</p>
                        )}
                      </div>
                    </div>
                    <div className="sprints-chart-card sprints-chart-card--completion">
                      <h3 className="sprints-chart-card-title">Completion mix</h3>
                      <p className="sprints-chart-card-hint">Closed + resolved vs everything else</p>
                      <div className="sprints-chart-canvas">
                        {completionChartData ? (
                          <Chart
                            key={`${selectedId}-co`}
                            type="doughnut"
                            data={completionChartData}
                            options={sprintDoughnutOptions}
                            className="sprints-chart"
                          />
                        ) : null}
                      </div>
                    </div>
                  </motion.div>

                  <motion.div className="sprints-monitoring-focus-row" variants={sprintModalItem}>
                    <div className="sprints-chart-card sprints-chart-card--priority">
                      <h3 className="sprints-chart-card-title">Tickets by priority</h3>
                      <div className="sprints-chart-canvas sprints-chart-canvas--bar">
                        {priorityChartData ? (
                          <Chart
                            key={`${selectedId}-pr`}
                            type="bar"
                            data={priorityChartData}
                            options={sprintBarOptions}
                            className="sprints-chart"
                          />
                        ) : (
                          <p className="sprints-muted sprints-chart-empty">No tickets to chart.</p>
                        )}
                      </div>
                    </div>

                    <div className="sprints-analytics sprints-analytics--panel">
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
                        <span className="sprints-progress-label">Progress</span>
                        <ProgressBar value={analytics.progress_percent} showValue={false} className="sprints-progress-bar" />
                      </div>
                      <h3 className="sprints-subheading">By status</h3>
                      <div className="sprints-status-grid">
                        {statusEntries.map(([st, count]) => (
                          <div key={st} className="sprints-status-cell">
                            <span className="sprints-status-name">{humanizeToken(st)}</span>
                            <span className="sprints-status-count">{count}</span>
                          </div>
                        ))}
                        {!statusEntries.length ? (
                          <p className="sprints-muted">No tickets linked to this sprint yet.</p>
                        ) : null}
                      </div>
                    </div>
                  </motion.div>

                  <motion.section className="sprints-monitoring-members" aria-label="Active members" variants={sprintModalItem}>
                    <h3 className="sprints-monitoring-section-title">People on this sprint</h3>
                    <p className="sprints-monitoring-section-sub">
                      Everyone assigned to at least one ticket in this sprint.
                    </p>
                    {(analytics.active_members ?? []).length ? (
                      <ul className="sprints-monitoring-member-chips">
                        {(analytics.active_members ?? []).map((m) => (
                          <li key={m.id}>
                            <span className="sprints-monitoring-member-chip" title={m.name}>
                              {m.avatar_url ? (
                                <img src={m.avatar_url} alt="" className="sprints-monitoring-member-avatar" loading="lazy" />
                              ) : (
                                <span className="sprints-monitoring-member-initials" aria-hidden>
                                  {memberInitials(m.name)}
                                </span>
                              )}
                              <span className="sprints-monitoring-member-name">{m.name}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="sprints-muted">No assignees on sprint tickets yet.</p>
                    )}
                  </motion.section>

                  <motion.section className="sprints-monitoring-tickets" aria-label="Sprint tickets" variants={sprintModalItem}>
                    <h3 className="sprints-monitoring-section-title">Tickets in this sprint</h3>
                    <div className="sprints-monitoring-table-shell">
                      <DataTable
                        value={analytics.tickets ?? []}
                        dataKey="id"
                        className="user-table sprints-monitoring-table"
                        stripedRows
                        rowClassName={(row) => {
                          const s = String(row.status ?? '').toLowerCase().replace(/\s+/g, '_');
                          return s === 'closed' || s === 'resolved' ? 'sprints-ticket-row--closed' : '';
                        }}
                        emptyMessage="No tickets linked to this sprint."
                      >
                        <Column
                          header="Reference"
                          style={{ width: '120px' }}
                          body={(row) => (
                            <span className="sprints-mon-ref">{row.public_reference ?? '—'}</span>
                          )}
                        />
                        <Column
                          header="Title"
                          body={(row) => <span className="sprints-mon-title">{row.title}</span>}
                        />
                        <Column
                          header="Status"
                          style={{ width: '140px' }}
                          body={(row) => {
                            const statusKey = ticketPaletteKey(String(row.status ?? ''));
                            return (
                              <Tag
                                value={humanizeToken(row.status)}
                                severity={sprintTicketStatusSeverity(row.status)}
                                rounded
                                className={`sprints-ticket-status sprints-ticket-status--${statusKey}`}
                              />
                            );
                          }}
                        />
                        <Column
                          header="Priority"
                          style={{ width: '110px' }}
                          body={(row) => {
                            const priorityKey = ticketPaletteKey(String(row.priority ?? ''));
                            return (
                              <Tag
                                value={humanizeToken(row.priority)}
                                severity={ticketPrioritySeverity(row.priority)}
                                rounded
                                className={`sprints-ticket-priority sprints-ticket-priority--${priorityKey}`}
                              />
                            );
                          }}
                        />
                        <Column
                          header="Assignees"
                          style={{ minWidth: '160px' }}
                          body={(row) =>
                            row.assignee_names.length ? (
                              <span className="sprints-mon-assignees">{row.assignee_names.join(', ')}</span>
                            ) : (
                              <span className="sprints-muted">—</span>
                            )
                          }
                        />
                      </DataTable>
                    </div>
                  </motion.section>
                </>
              ) : !analyticsLoading ? (
                <p className="sprints-muted">Could not load analytics for this sprint.</p>
              ) : null}
              </motion.section>
            ) : null}
          </Dialog>
        </>
      ) : null}
    </motion.article>
  );
}
