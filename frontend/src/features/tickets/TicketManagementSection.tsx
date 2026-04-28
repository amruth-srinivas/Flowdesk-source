import { LayoutGroup, motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { MultiSelect } from 'primereact/multiselect';
import { FloatLabel } from 'primereact/floatlabel';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { SelectButton } from 'primereact/selectbutton';
import { Tag } from 'primereact/tag';
import { Toast } from 'primereact/toast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TicketDetailTabs } from './TicketDetailTabs';
import { getSprintsRequest } from '../../lib/api';
import {
  createTicketApprovalRequest,
  getPendingTicketApprovalRequests,
  type TicketApprovalRequestRecord,
} from '../../lib/api';
import type {
  CustomerRecord,
  ProjectRecord,
  SprintRecord,
  TicketConfigurationRecord,
  TicketCreatePayload,
  TicketRecord,
  TicketStatus,
  TicketType,
  TicketUpdatePayload,
  TicketPriority,
  TicketReopenPayload,
  UserRecord,
} from '../../lib/api';

const TICKET_TYPES: { label: string; value: TicketType }[] = [
  { label: 'Bug fix', value: 'bug_fix' },
  { label: 'Feature request', value: 'feature_request' },
  { label: 'Service request', value: 'service_request' },
  { label: 'Design rework', value: 'design_rework' },
  { label: 'Performance', value: 'performance_issue' },
  { label: 'Security', value: 'security_vulnerability' },
  { label: 'Documentation', value: 'documentation' },
];

const PRIORITIES: { label: string; value: TicketPriority }[] = [
  { label: 'Critical', value: 'critical' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
];

const STATUSES: { label: string; value: TicketStatus }[] = [
  { label: 'Open', value: 'open' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'In review', value: 'in_review' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Closed', value: 'closed' },
];

const KANBAN_ORDER: TicketStatus[] = ['open', 'in_progress', 'in_review', 'resolved', 'closed'];

/** Matches server `STATUS_FLOW` — Kanban may only move one step per drop. */
const STATUS_FLOW_NEXT: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress'],
  in_progress: ['in_review'],
  in_review: ['resolved'],
  resolved: ['closed'],
  closed: [],
};

function isAllowedStatusTransition(from: TicketStatus, to: TicketStatus): boolean {
  return STATUS_FLOW_NEXT[from].includes(to);
}

/** Lead “Tickets” page uses these keys with `filterByModule` (same as former sidebar modules). */
const LEAD_LIST_SCOPE_KEYS = ['All Tickets', 'Open Tickets', 'Assigned', 'Resolved'] as const;
type LeadListScopeKey = (typeof LEAD_LIST_SCOPE_KEYS)[number];

function humanize(s: string): string {
  return s.replace(/_/g, ' ');
}

export function displayTicketRef(row: TicketRecord): string {
  const base = row.public_reference?.trim() || `#${row.ticket_number}`;
  const version = row.current_cycle_version ?? 1;
  return version > 1 ? `${base} · V${version}` : base;
}

function previewNextReference(
  projectId: string,
  type: TicketType,
  ticketList: TicketRecord[],
  configs: TicketConfigurationRecord[],
): string {
  const cfg = configs.find((c) => c.ticket_type === type);
  const code = cfg?.code ?? 'TK';
  const n = ticketList.filter((t) => t.project_id === projectId && t.type === type).length + 1;
  return `${code}${String(n).padStart(4, '0')}`;
}

function prioritySeverity(p: TicketPriority): 'danger' | 'warning' | 'info' | 'success' | 'secondary' {
  switch (p) {
    case 'critical':
      return 'danger';
    case 'high':
      return 'warning';
    case 'medium':
      return 'info';
    case 'low':
      return 'success';
    default:
      return 'secondary';
  }
}

function statusSeverity(s: TicketStatus): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
  switch (s) {
    case 'closed':
    case 'resolved':
      return 'success';
    case 'in_progress':
      return 'info';
    case 'in_review':
      return 'warning';
    case 'open':
      return 'secondary';
    default:
      return 'secondary';
  }
}

function ticketPaletteKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '_');
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDue(iso: string | null): Date | null {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Short date for ticket list (opened / closed). */
function formatTicketListDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatAssigneeLabels(t: TicketRecord, userLookup: Map<string, string>): string {
  if (t.assignee_names?.length) {
    return t.assignee_names.join(', ');
  }
  const ids = t.assignee_ids ?? [];
  return ids.map((id) => userLookup.get(id) ?? '').filter(Boolean).join(', ');
}

function getClosedByLabel(t: TicketRecord, userLookup: Map<string, string>): string {
  const audit = t as TicketRecord & {
    resolved_by_name?: string | null;
    resolved_by?: string | null;
    closed_by_name?: string | null;
    closed_by?: string | null;
    close_approval_requested_by_name?: string | null;
    close_approval_requested_by?: string | null;
  };
  const closedBy =
    audit.closed_by_name?.trim() ||
    (audit.closed_by ? userLookup.get(audit.closed_by) ?? '' : '');

  if (t.status !== 'closed') {
    if (closedBy) {
      return closedBy;
    }
    return 'Not closed';
  }

  const resolvedBy =
    audit.resolved_by_name?.trim() ||
    (audit.resolved_by ? userLookup.get(audit.resolved_by) ?? '' : '');
  const requester =
    audit.close_approval_requested_by_name?.trim() ||
    (audit.close_approval_requested_by
      ? userLookup.get(audit.close_approval_requested_by) ?? ''
      : '');

  const parts: string[] = [];
  for (const name of [resolvedBy, requester, closedBy]) {
    const x = name?.trim();
    if (x && !parts.includes(x)) {
      parts.push(x);
    }
  }
  if (parts.length) {
    return parts.join(' · ');
  }
  return '—';
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function sanitizeSprintTitle(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || looksLikeUuid(trimmed)) {
    return null;
  }
  return trimmed;
}

function filterByModule(
  tickets: TicketRecord[],
  module: string,
  currentUserId: string | undefined,
  role: 'lead' | 'member',
): TicketRecord[] {
  if (role === 'member') {
    switch (module) {
      case 'My Tickets':
        return tickets.filter((t) => ['open', 'in_progress', 'in_review', 'resolved'].includes(t.status));
      case 'History':
        return tickets.filter((t) => t.status === 'closed');
      default:
        return tickets;
    }
  }
  switch (module) {
    case 'Create Ticket':
      return tickets;
    case 'Open Tickets':
      return tickets.filter((t) => ['open', 'in_progress', 'in_review'].includes(t.status));
    case 'Assigned':
      return tickets.filter((t) => Boolean(currentUserId && (t.assignee_ids ?? []).includes(currentUserId)));
    case 'Resolved':
      return tickets.filter((t) => ['resolved', 'closed'].includes(t.status));
    default:
      return tickets;
  }
}

function ticketCanBeDeleted(row: TicketRecord): boolean {
  return row.status === 'open' || row.status === 'in_progress';
}

function applySearch(
  tickets: TicketRecord[],
  q: string,
  projectLookup: Map<string, string>,
  userLookup: Map<string, string>,
): TicketRecord[] {
  const s = q.trim().toLowerCase();
  if (!s) {
    return tickets;
  }
  return tickets.filter((t) => {
    const pn = projectLookup.get(t.project_id) ?? '';
    const an = formatAssigneeLabels(t, userLookup);
    const ref = displayTicketRef(t).toLowerCase();
    const pub = (t.public_reference ?? '').toLowerCase();
    return (
      t.title.toLowerCase().includes(s) ||
      String(t.ticket_number).includes(s) ||
      ref.includes(s) ||
      pub.includes(s) ||
      pn.toLowerCase().includes(s) ||
      an.toLowerCase().includes(s) ||
      humanize(t.type).toLowerCase().includes(s) ||
      humanize(t.status).toLowerCase().includes(s)
    );
  });
}

function applyListFilters(
  tickets: TicketRecord[],
  filters: {
    projectId: string | null;
    sprintId: string | null;
    status: TicketStatus | null;
    priority: TicketPriority | null;
    assigneeId: string | null;
  },
): TicketRecord[] {
  return tickets.filter((ticket) => {
    if (filters.projectId && ticket.project_id !== filters.projectId) {
      return false;
    }
    if (filters.sprintId) {
      const normalizedSprint = ticket.sprint_id ?? '__backlog__';
      if (normalizedSprint !== filters.sprintId) {
        return false;
      }
    }
    if (filters.status && ticket.status !== filters.status) {
      return false;
    }
    if (filters.priority && ticket.priority !== filters.priority) {
      return false;
    }
    if (filters.assigneeId && !(ticket.assignee_ids ?? []).includes(filters.assigneeId)) {
      return false;
    }
    return true;
  });
}

type TicketManagementSectionProps = {
  viewKey: string;
  ticketModule: string;
  search: string;
  onSearchChange: (value: string) => void;
  viewMode: 'list' | 'kanban';
  onViewModeChange: (mode: 'list' | 'kanban') => void;
  tickets: TicketRecord[];
  isLoading: boolean;
  error: string;
  projects: ProjectRecord[];
  customers: CustomerRecord[];
  assignableUsers: UserRecord[];
  ticketConfigurations: TicketConfigurationRecord[];
  currentUserId: string | undefined;
  onRefresh: () => void;
  onCreateTicket: (payload: TicketCreatePayload) => Promise<TicketRecord>;
  onUpdateTicket: (id: string, payload: TicketUpdatePayload) => Promise<TicketRecord>;
  onPatchStatus: (id: string, status: TicketStatus, comment?: string | null) => Promise<TicketRecord>;
  onReopenTicket: (id: string, payload: TicketReopenPayload) => Promise<TicketRecord>;
  onDeleteTicket: (id: string, password: string) => Promise<void>;
  /** Lead: full ticket CRUD. Member: assigned tickets, conversation & resolution. */
  ticketRole: 'lead' | 'member';
  canCreateTickets: boolean;
  canEditTickets: boolean;
  /** Only leads (and backend Admin) may delete; still limited to Open / In progress tickets. */
  canDeleteTickets: boolean;
  focusTicketId?: string | null;
};

export function TicketManagementSection({
  viewKey,
  ticketModule,
  search,
  onSearchChange,
  viewMode,
  onViewModeChange,
  tickets,
  isLoading,
  error,
  projects,
  customers,
  assignableUsers,
  ticketConfigurations,
  currentUserId,
  onRefresh,
  onCreateTicket,
  onUpdateTicket,
  onPatchStatus,
  onReopenTicket,
  onDeleteTicket,
  ticketRole,
  canCreateTickets,
  canEditTickets,
  canDeleteTickets,
  focusTicketId,
}: TicketManagementSectionProps) {
  type Panel = 'none' | 'create' | 'edit';
  type StatusChangeSource = 'list' | 'kanban';
  const [panel, setPanel] = useState<Panel>('none');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [kanbanBusy, setKanbanBusy] = useState<string | null>(null);
  const [kanbanDropError, setKanbanDropError] = useState('');
  const [draggingTicketId, setDraggingTicketId] = useState<string | null>(null);
  const [leadListScope, setLeadListScope] = useState<LeadListScopeKey>('All Tickets');
  const [listProjectFilter, setListProjectFilter] = useState<string | null>(null);
  const [listSprintFilter, setListSprintFilter] = useState<string | null>(null);
  const [listStatusFilter, setListStatusFilter] = useState<TicketStatus | null>(null);
  const [listPriorityFilter, setListPriorityFilter] = useState<TicketPriority | null>(null);
  const [listAssigneeFilter, setListAssigneeFilter] = useState<string | null>(null);
  const [statusCommentOpen, setStatusCommentOpen] = useState(false);
  const [statusCommentText, setStatusCommentText] = useState('');
  const [statusCommentSaving, setStatusCommentSaving] = useState(false);
  const [deleteConfirmTicket, setDeleteConfirmTicket] = useState<TicketRecord | null>(null);
  const [deleteConfirmPassword, setDeleteConfirmPassword] = useState('');
  const [deleteShowPassword, setDeleteShowPassword] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [reopenDialogOpen, setReopenDialogOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenSprintId, setReopenSprintId] = useState<string | null>(null);
  const [reopenBusy, setReopenBusy] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    ticketId: string;
    nextStatus: TicketStatus;
    source: StatusChangeSource;
  } | null>(null);
  const statusToastRef = useRef<Toast>(null);
  /** Avoid re-hydrating the edit form when `tickets` gets a new array reference but the row is unchanged (prevents update-depth loops with PrimeReact). */
  const lastEditHydrateKeyRef = useRef('');
  const lastFocusHydrateKeyRef = useRef<{ focusId: string; key: string } | null>(null);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ticketType, setTicketType] = useState<TicketType>('service_request');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [createSprintId, setCreateSprintId] = useState<string | null>(null);
  const [sprints, setSprints] = useState<SprintRecord[]>([]);
  const [approvalRequests, setApprovalRequests] = useState<TicketApprovalRequestRecord[]>([]);

  const projectLookup = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const userLookup = useMemo(() => new Map(assignableUsers.map((u) => [u.id, u.name])), [assignableUsers]);
  const approvalByTicket = useMemo(() => new Map(approvalRequests.map((r) => [r.ticket_id, r])), [approvalRequests]);
  const sprintLabelLookup = useMemo(
    () =>
      new Map(
        sprints.map((s) => {
          const rawTitle = String(s.title ?? '').trim();
          const display = rawTitle && !looksLikeUuid(rawTitle) ? rawTitle : 'Sprint';
          return [s.id, display];
        }),
      ),
    [sprints],
  );

  const configByType = useMemo(
    () => new Map(ticketConfigurations.map((c) => [c.ticket_type, c])),
    [ticketConfigurations],
  );

  const typeOptions = useMemo(() => {
    return TICKET_TYPES.map((t) => {
      const cfg = configByType.get(t.value);
      const label = cfg
        ? `${cfg.display_name?.trim() || humanize(t.value)} (${cfg.code})`
        : `${humanize(t.value)} — add code in KB → Configuration`;
      return { label, value: t.value };
    });
  }, [configByType]);

  const effectiveListModule =
    ticketRole === 'lead' && ticketModule === 'Tickets' ? leadListScope : ticketModule;

  const scoped = useMemo(
    () => filterByModule(tickets, effectiveListModule, currentUserId, ticketRole),
    [tickets, effectiveListModule, currentUserId, ticketRole],
  );

  const statusDropdownOptions = useMemo(() => {
    if (ticketRole === 'member') {
      return STATUSES.filter((o) => o.value !== 'closed');
    }
    return STATUSES;
  }, [ticketRole]);

  const kanbanColumns = useMemo(() => {
    if (ticketRole === 'member') {
      return KANBAN_ORDER.filter((s) => s !== 'closed');
    }
    return KANBAN_ORDER;
  }, [ticketRole]);
  const isLeadCreateModule = ticketRole === 'lead' && ticketModule === 'Create Ticket';
  const isLeadTicketsPage = ticketRole === 'lead' && ticketModule === 'Tickets';
  const isListOnlyView = panel === 'none' && !isLeadCreateModule;

  /** Sidebar module or lead list tab change must not keep another scope's ticket open in the detail pane. */
  useEffect(() => {
    if (isLeadCreateModule) {
      return;
    }
    setPanel('none');
    setEditingId(null);
    setFormError('');
  }, [ticketModule, isLeadCreateModule, leadListScope]);

  const filtered = useMemo(
    () =>
      applySearch(
        applyListFilters(scoped, {
          projectId: listProjectFilter,
          sprintId: listSprintFilter,
          status: listStatusFilter,
          priority: listPriorityFilter,
          assigneeId: listAssigneeFilter,
        }),
        search,
        projectLookup,
        userLookup,
      ),
    [
      scoped,
      search,
      projectLookup,
      userLookup,
      listProjectFilter,
      listSprintFilter,
      listStatusFilter,
      listPriorityFilter,
      listAssigneeFilter,
    ],
  );

  const editingTicket = useMemo(
    () => (editingId ? tickets.find((t) => t.id === editingId) ?? null : null),
    [tickets, editingId],
  );
  const canEditTicketFields = Boolean(
    canEditTickets && ticketRole === 'lead' && editingTicket && editingTicket.status === 'open',
  );

  const selectedTableRow = useMemo(() => {
    if (panel !== 'edit' || !editingId) {
      return null;
    }
    return filtered.find((t) => t.id === editingId) ?? null;
  }, [panel, editingId, filtered]);

  const nextRefPreview = useMemo(() => {
    if (panel !== 'create' || !projectId) {
      return null;
    }
    return previewNextReference(projectId, ticketType, tickets, ticketConfigurations);
  }, [panel, projectId, ticketType, tickets, ticketConfigurations]);

  const projectOptions = useMemo(() => projects.map((p) => ({ label: p.name, value: p.id })), [projects]);
  const assigneeMultiOptions = useMemo(
    () => assignableUsers.map((u) => ({ label: `${u.name} (${u.employee_id})`, value: u.id })),
    [assignableUsers],
  );
  const customerOptions = useMemo(
    () => [{ label: 'None', value: null }, ...customers.map((c) => ({ label: c.name, value: c.id }))],
    [customers],
  );
  const listProjectOptions = useMemo(
    () => [{ label: 'All projects', value: null }, ...projects.map((p) => ({ label: p.name, value: p.id }))],
    [projects],
  );
  const listSprintOptions = useMemo(() => {
    const rows = listProjectFilter
      ? sprints.filter((s) => (s.project_ids ?? []).includes(listProjectFilter))
      : sprints;
    return [
      { label: 'All sprints', value: null as string | null },
      { label: 'Backlog', value: '__backlog__' },
      ...rows.map((s) => ({
        label: sanitizeSprintTitle(s.title) ?? sprintLabelLookup.get(s.id) ?? 'Sprint',
        value: s.id,
      })),
    ];
  }, [listProjectFilter, sprints, sprintLabelLookup]);
  const listStatusOptions = useMemo(
    () => [{ label: 'All statuses', value: null as TicketStatus | null }, ...STATUSES],
    [],
  );
  const listPriorityOptions = useMemo(
    () => [{ label: 'All priorities', value: null as TicketPriority | null }, ...PRIORITIES],
    [],
  );
  const listAssigneeOptions = useMemo(
    () => [{ label: 'All assignees', value: null as string | null }, ...assignableUsers.map((u) => ({ label: u.name, value: u.id }))],
    [assignableUsers],
  );
  const hasActiveListFilters = Boolean(
    listProjectFilter || listSprintFilter || listStatusFilter || listPriorityFilter || listAssigneeFilter,
  );

  useEffect(() => {
    if (!listSprintFilter || listSprintFilter === '__backlog__') {
      return;
    }
    const valid = listSprintOptions.some((opt) => opt.value === listSprintFilter);
    if (!valid) {
      setListSprintFilter(null);
    }
  }, [listSprintFilter, listSprintOptions]);

  const sprintOptionsForCreate = useMemo(() => {
    const none = { label: 'None (backlog)', value: null as string | null };
    if (!projectId) {
      return [none];
    }
    const rows = sprints.filter((s) => (s.project_ids ?? []).includes(projectId));
    const opts = rows.map((s) => {
      const statusNote =
        s.status === 'active' ? ' — active' : s.status === 'planning' ? ' — planning' : s.status ? ` — ${s.status}` : '';
      return {
        label: `${s.title} (${s.start_date} → ${s.end_date})${statusNote}`,
        value: s.id,
      };
    });
    return [none, ...opts];
  }, [projectId, sprints]);

  const sprintOptionsForReopen = useMemo(() => {
    const none = { label: 'Backlog (no sprint)', value: null as string | null };
    if (!editingTicket) {
      return [none];
    }
    const rows = sprints.filter((s) => (s.project_ids ?? []).includes(editingTicket.project_id));
    return [
      none,
      ...rows.map((s) => ({
        label: `${s.title} (${s.start_date} → ${s.end_date})`,
        value: s.id,
      })),
    ];
  }, [editingTicket, sprints]);

  const hydrateFromTicket = useCallback((row: TicketRecord) => {
    setProjectId(row.project_id);
    setTitle(row.title);
    setDescription(row.description ?? '');
    setTicketType(row.type);
    setPriority(row.priority);
    setAssigneeIds(row.assignee_ids ?? []);
    setCustomerId(row.customer_id);
    setDueDate(parseDue(row.due_date));
    setFormError('');
  }, []);

  useEffect(() => {
    if (!focusTicketId) {
      lastFocusHydrateKeyRef.current = null;
      return;
    }
    const target = tickets.find((t) => t.id === focusTicketId);
    if (!target) {
      return;
    }
    const key = `${target.id}|${target.updated_at}|${target.status}|${(target.assignee_ids ?? []).slice().sort().join(',')}`;
    const prev = lastFocusHydrateKeyRef.current;
    if (prev && prev.focusId === focusTicketId && prev.key === key) {
      return;
    }
    lastFocusHydrateKeyRef.current = { focusId: focusTicketId, key };
    setEditingId(target.id);
    setPanel('edit');
    hydrateFromTicket(target);
    // Do not call onFocusTicketHandled here: parent clears focusTicketId after paint
    // (see App.handleAcknowledgeApprovalFromHeader) so StrictMode remount still works.
  }, [focusTicketId, tickets, hydrateFromTicket]);

  const loadApprovalRequests = useCallback(async () => {
    try {
      const rows = await getPendingTicketApprovalRequests();
      setApprovalRequests(rows);
    } catch {
      setApprovalRequests([]);
    }
  }, []);

  useEffect(() => {
    void loadApprovalRequests();
  }, [loadApprovalRequests, viewKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sprintList = await getSprintsRequest();
        if (!cancelled) {
          setSprints(sprintList);
        }
      } catch {
        if (!cancelled) {
          setSprints([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewKey]);

  useEffect(() => {
    if (panel !== 'edit' || !editingId) {
      lastEditHydrateKeyRef.current = '';
      return;
    }
    const row = tickets.find((t) => t.id === editingId);
    if (!row) {
      return;
    }
    const key = `${row.id}|${row.updated_at}|${row.status}|${(row.assignee_ids ?? []).slice().sort().join(',')}`;
    if (lastEditHydrateKeyRef.current === key) {
      return;
    }
    lastEditHydrateKeyRef.current = key;
    hydrateFromTicket(row);
  }, [panel, editingId, tickets, hydrateFromTicket]);

  useEffect(() => {
    if (isLeadCreateModule) {
      setPanel('create');
      setEditingId(null);
      return;
    }
    if (panel === 'create') {
      setPanel('none');
    }
  }, [isLeadCreateModule]);

  useEffect(() => {
    if (panel === 'create') {
      setProjectId(projects[0]?.id ?? null);
      setTitle('');
      setDescription('');
      setTicketType('service_request');
      setPriority('medium');
      setAssigneeIds([]);
      setCustomerId(null);
      setDueDate(null);
      setCreateSprintId(null);
      setFormError('');
    }
  }, [panel, projects]);

  function closePanel() {
    setPanel('none');
    setEditingId(null);
    setFormError('');
  }

  function openCreate() {
    setEditingId(null);
    setPanel('create');
  }

  function openEdit(row: TicketRecord) {
    setEditingId(row.id);
    setPanel('edit');
    hydrateFromTicket(row);
    lastEditHydrateKeyRef.current = `${row.id}|${row.updated_at}|${row.status}|${(row.assignee_ids ?? []).slice().sort().join(',')}`;
  }

  function openStatusCommentModal(ticketId: string, nextStatus: TicketStatus, source: StatusChangeSource) {
    setPendingStatusChange({ ticketId, nextStatus, source });
    setStatusCommentText('');
    setStatusCommentOpen(true);
  }

  function closeStatusCommentModal() {
    if (statusCommentSaving) {
      return;
    }
    setStatusCommentOpen(false);
    setStatusCommentText('');
    setPendingStatusChange(null);
  }

  function closeDeleteConfirmModal() {
    if (deleteBusy) {
      return;
    }
    setDeleteConfirmTicket(null);
    setDeleteConfirmPassword('');
    setDeleteShowPassword(false);
  }

  function openReopenDialog() {
    if (!editingTicket || editingTicket.status !== 'closed') {
      return;
    }
    setReopenReason('');
    setReopenSprintId(editingTicket.sprint_id ?? null);
    setReopenDialogOpen(true);
  }

  function closeReopenDialog() {
    if (reopenBusy) {
      return;
    }
    setReopenDialogOpen(false);
    setReopenReason('');
    setReopenSprintId(null);
  }

  async function confirmReopenTicket() {
    if (!editingTicket) {
      return;
    }
    const reason = reopenReason.trim();
    if (!reason) {
      statusToastRef.current?.show({
        severity: 'warn',
        summary: 'Reason required',
        detail: 'Please provide why this ticket is being reopened.',
        life: 4500,
      });
      return;
    }
    setReopenBusy(true);
    try {
      const normalizedSprintId = typeof reopenSprintId === 'string' ? reopenSprintId.trim() : '';
      const updated = await onReopenTicket(editingTicket.id, {
        reason,
        sprint_id: normalizedSprintId || undefined,
      });
      statusToastRef.current?.show({
        severity: 'success',
        summary: 'Ticket reopened',
        detail: `${displayTicketRef(updated)} moved to a new version.`,
        life: 4000,
      });
      setReopenDialogOpen(false);
      setReopenReason('');
      setReopenSprintId(null);
      setEditingId(updated.id);
      hydrateFromTicket(updated);
      onRefresh();
    } catch (e) {
      statusToastRef.current?.show({
        severity: 'error',
        summary: 'Reopen failed',
        detail: e instanceof Error ? e.message : 'Could not reopen ticket',
        life: 5500,
      });
    } finally {
      setReopenBusy(false);
    }
  }

  async function confirmDeleteTicket() {
    if (!deleteConfirmTicket) {
      return;
    }
    const pwd = deleteConfirmPassword.trim();
    if (!pwd) {
      statusToastRef.current?.show({
        severity: 'warn',
        summary: 'Password required',
        detail: 'Enter your account password to confirm deletion.',
        life: 5000,
      });
      return;
    }
    const row = deleteConfirmTicket;
    const id = row.id;
    setDeleteBusy(true);
    try {
      await onDeleteTicket(id, pwd);
      statusToastRef.current?.show({
        severity: 'success',
        summary: 'Ticket deleted',
        detail: `${displayTicketRef(row)} was removed.`,
        life: 4500,
      });
      setDeleteConfirmTicket(null);
      setDeleteConfirmPassword('');
      setDeleteShowPassword(false);
      if (editingId === id) {
        closePanel();
      }
      onRefresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not delete ticket';
      statusToastRef.current?.show({
        severity: 'error',
        summary: 'Delete failed',
        detail: msg,
        life: 6000,
      });
    } finally {
      setDeleteBusy(false);
    }
  }

  async function submitCreate() {
    if (!projectId) {
      setFormError('Select a project.');
      return;
    }
    if (!title.trim()) {
      setFormError('Enter a title.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const created = await onCreateTicket({
        title: title.trim(),
        description: description.trim() || null,
        type: ticketType,
        priority,
        project_id: projectId,
        assigned_to: assigneeIds,
        customer_id: customerId,
        due_date: dueDate ? toYmd(dueDate) : null,
        sprint_id: createSprintId,
      });
      onRefresh();
      setEditingId(created.id);
      setPanel('edit');
      hydrateFromTicket(created);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create ticket');
    } finally {
      setSaving(false);
    }
  }

  async function submitEdit() {
    if (ticketRole !== 'lead' || !canEditTicketFields || !editingTicket) {
      return;
    }
    if (!projectId) {
      setFormError('Select a project.');
      return;
    }
    if (!title.trim()) {
      setFormError('Enter a title.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const next = await onUpdateTicket(editingTicket.id, {
        title: title.trim(),
        description: description.trim() || null,
        type: ticketType,
        priority,
        project_id: projectId,
        assigned_to: assigneeIds,
        customer_id: customerId,
        due_date: dueDate ? toYmd(dueDate) : null,
      });
      onRefresh();
      setEditingId(next.id);
      hydrateFromTicket(next);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save ticket');
    } finally {
      setSaving(false);
    }
  }

  async function handleInlineStatusChange(ticket: TicketRecord, next: TicketStatus) {
    if (next === ticket.status) {
      return;
    }
    openStatusCommentModal(ticket.id, next, 'list');
  }

  async function handleKanbanDrop(status: TicketStatus, ticketId: string) {
    const t = filtered.find((x) => x.id === ticketId);
    if (!t || t.status === status) {
      return;
    }
    if (!isAllowedStatusTransition(t.status, status)) {
      const msg = `Move tickets one column at a time (${humanize(t.status)} → next stage only, not ${humanize(status)}).`;
      setKanbanDropError(msg);
      window.setTimeout(() => setKanbanDropError((cur) => (cur === msg ? '' : cur)), 7000);
      return;
    }
    setKanbanDropError('');
    openStatusCommentModal(ticketId, status, 'kanban');
  }

  async function confirmStatusChangeWithComment() {
    if (!pendingStatusChange) {
      return;
    }
    const { ticketId, nextStatus, source } = pendingStatusChange;
    if (source === 'kanban') {
      setKanbanBusy(ticketId);
    } else {
      setStatusBusy(ticketId);
    }
    setStatusCommentSaving(true);
    try {
      await onPatchStatus(ticketId, nextStatus, statusCommentText);
      statusToastRef.current?.show({
        severity: 'success',
        summary: 'Status updated',
        detail: `Ticket is now ${humanize(nextStatus)}.`,
        life: 4500,
      });
      onRefresh();
      setStatusCommentOpen(false);
      setStatusCommentText('');
      setPendingStatusChange(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not update status';
      setKanbanDropError(msg);
      statusToastRef.current?.show({
        severity: 'error',
        summary: nextStatus === 'closed' ? 'Unable to close ticket' : 'Unable to update status',
        detail: msg,
        life: 6500,
      });
      window.setTimeout(() => setKanbanDropError((cur) => (cur === msg ? '' : cur)), 8000);
    } finally {
      setStatusCommentSaving(false);
      if (source === 'kanban') {
        setKanbanBusy(null);
      } else {
        setStatusBusy(null);
      }
    }
  }

  async function requestLeadApproval(ticket: TicketRecord) {
    const existing = approvalRequests.find((r) => r.ticket_id === ticket.id);
    if (existing) {
      statusToastRef.current?.show({
        severity: 'warn',
        summary: 'Already requested',
        detail: 'Approval request has already been sent to lead for this ticket.',
        life: 3500,
      });
      return;
    }
    await createTicketApprovalRequest(ticket.id);
    statusToastRef.current?.show({
      severity: 'success',
      summary: 'Approval requested',
      detail: 'Lead has been notified to review and close this ticket.',
      life: 4500,
    });
    onRefresh();
    await loadApprovalRequests();
  }

  const detailTitle = panel === 'create' ? 'New ticket' : panel === 'edit' && editingTicket ? displayTicketRef(editingTicket) : 'Ticket';

  const createFormBody = (
    <div className="ticket-detail-form">
      <div className="ticket-form-grid">
        {nextRefPreview ? (
          <div className="ticket-ref-preview-banner">
            <span className="ticket-ref-preview-label">Next ticket number</span>
            <strong className="ticket-ref-preview-value">{nextRefPreview}</strong>
            <span className="ticket-ref-preview-hint">Assigned when you save (per project &amp; type prefix from configuration).</span>
          </div>
        ) : null}

        <div className="ticket-form-field ticket-form-field--full">
          <label className="ticket-form-label" htmlFor={`tf-project-${viewKey}`}>
            Project
          </label>
          <div className="p-inputgroup">
            <span className="p-inputgroup-addon">
              <i className="pi pi-folder" />
            </span>
            <Dropdown
              inputId={`tf-project-${viewKey}`}
              value={projectId}
              options={projectOptions}
              onChange={(e) => {
                const next = e.value as string;
                setProjectId(next);
                setCreateSprintId((prev) => {
                  if (!prev) {
                    return null;
                  }
                  const sp = sprints.find((s) => s.id === prev);
                  if (sp && (sp.project_ids ?? []).includes(next)) {
                    return prev;
                  }
                  return null;
                });
              }}
              placeholder="Select project"
              className="full-width"
              filter
            />
          </div>
        </div>

        <div className="ticket-form-field ticket-form-field--full">
          <label className="ticket-form-label" htmlFor={`tf-sprint-create-${viewKey}`}>
            Sprint
          </label>
          <div className="p-inputgroup">
            <span className="p-inputgroup-addon">
              <i className="pi pi-calendar" />
            </span>
            <Dropdown
              inputId={`tf-sprint-create-${viewKey}`}
              value={createSprintId}
              options={sprintOptionsForCreate}
              onChange={(e) => setCreateSprintId((e.value as string | null) ?? null)}
              placeholder={projectId ? 'Backlog or a sprint' : 'Select a project first'}
              className="full-width"
              filter
              disabled={!projectId}
            />
          </div>
          <small className="ticket-form-hint">Optional — only sprints that include this project are listed.</small>
        </div>

        <div className="ticket-form-field ticket-form-field--full">
          <FloatLabel>
            <InputText
              id={`tf-title-${viewKey}`}
              className="full-width"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
            />
            <label htmlFor={`tf-title-${viewKey}`}>Title</label>
          </FloatLabel>
        </div>

        <div className="ticket-form-field ticket-form-field--full">
          <label className="ticket-form-label" htmlFor={`tf-desc-${viewKey}`}>
            Description
          </label>
          <InputTextarea
            id={`tf-desc-${viewKey}`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="full-width ticket-form-textarea"
          />
        </div>

        <div className="ticket-form-row">
          <div className="ticket-form-field">
            <label className="ticket-form-label">Type</label>
            <div className="p-inputgroup">
              <span className="p-inputgroup-addon">
                <i className="pi pi-sliders-h" />
              </span>
              <Dropdown
                value={ticketType}
                options={typeOptions}
                onChange={(e) => setTicketType(e.value as TicketType)}
                className="full-width"
              />
            </div>
          </div>
          <div className="ticket-form-field">
            <label className="ticket-form-label">Priority</label>
            <div className="p-inputgroup">
              <span className="p-inputgroup-addon">
                <i className="pi pi-flag" />
              </span>
              <Dropdown value={priority} options={PRIORITIES} onChange={(e) => setPriority(e.value)} className="full-width" />
            </div>
          </div>
        </div>

        <div className="ticket-form-row">
          <div className="ticket-form-field">
            <label className="ticket-form-label">Assignees</label>
            <div className="p-inputgroup">
              <span className="p-inputgroup-addon">
                <i className="pi pi-users" />
              </span>
              <MultiSelect
                value={assigneeIds}
                options={assigneeMultiOptions}
                onChange={(e) => setAssigneeIds((e.value as string[]) ?? [])}
                display="chip"
                className="full-width"
                filter
                placeholder="Select users"
                maxSelectedLabels={3}
              />
            </div>
          </div>
          <div className="ticket-form-field">
            <label className="ticket-form-label">Customer</label>
            <div className="p-inputgroup">
              <span className="p-inputgroup-addon">
                <i className="pi pi-building" />
              </span>
              <Dropdown
                value={customerId}
                options={customerOptions}
                onChange={(e) => setCustomerId(e.value as string | null)}
                className="full-width"
                filter
              />
            </div>
          </div>
        </div>

        <div className="ticket-form-field ticket-form-field--full">
          <label className="ticket-form-label">Due date</label>
          <Calendar value={dueDate} onChange={(e) => setDueDate((e.value as Date) || null)} showIcon className="full-width ticket-due-cal" />
        </div>

        {formError ? <small className="error-text">{formError}</small> : null}

        <div className="ticket-detail-actions">
          <Button type="button" label="Close" severity="secondary" outlined onClick={closePanel} />
          <Button
            type="button"
            label={saving ? 'Saving…' : 'Create ticket'}
            icon="pi pi-check"
            onClick={() => void submitCreate()}
            disabled={saving}
          />
        </div>
      </div>
    </div>
  );

  const emptyRight = (
    <div className="tickets-detail-empty">
      <div className="tickets-detail-empty-inner">
        <i className="pi pi-ticket tickets-detail-empty-icon" />
        <h3>Ticket details</h3>
        <p>
          {canCreateTickets
            ? 'Select a ticket from the list or create a new one. Reference numbers (e.g. SR0001) use your configuration prefixes.'
            : 'Select a ticket assigned to you to view conversation, resolution, attachments, and history.'}
        </p>
        {canCreateTickets ? <Button type="button" label="Create ticket" icon="pi pi-plus" onClick={openCreate} /> : null}
      </div>
    </div>
  );

  const ticketsPageSubLine = isLeadTicketsPage
    ? `${leadListScope === 'Open Tickets' ? 'Open' : leadListScope === 'All Tickets' ? 'All' : leadListScope} — list or board; details on the right.`
    : `${ticketModule} — list or board; details open on the right.`;

  return (
    <motion.article
      key={viewKey}
      className="page-card tickets-module-page tickets-module-full"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Toast ref={statusToastRef} position="top-center" />
      <div className={`tickets-workspace ${panel === 'edit' ? 'tickets-workspace--focus' : ''} ${isListOnlyView ? 'tickets-workspace--list-only' : ''}`}>
        {isLeadCreateModule ? null : (
          <div className="tickets-left-pane">
          <div className="tickets-top-search-wrap">
            <div className="chat-top-search tickets-top-search" role="search">
              <Search size={16} aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search by ticket ref or number (e.g. FR0002, SR0001)…"
                aria-label="Search tickets by reference or number"
              />
            </div>
          </div>
          <div className="tickets-left-head">
            <div>
              <h2 className="tickets-page-title">Tickets</h2>
              <p className="tickets-page-sub">{ticketsPageSubLine}</p>
            </div>
            <div className="tickets-toolbar-actions">
              {canCreateTickets ? (
                <Button type="button" label="Create ticket" icon="pi pi-plus" outlined onClick={openCreate} />
              ) : null}
              {isLeadTicketsPage ? (
                <LayoutGroup id="tickets-lead-scope-tabs">
                  <div className="tickets-lead-tabs" role="tablist" aria-label="Tickets by scope">
                    {LEAD_LIST_SCOPE_KEYS.map((key) => {
                      const active = leadListScope === key;
                      const label = key === 'Open Tickets' ? 'Open' : key === 'All Tickets' ? 'All' : key;
                      return (
                        <button
                          key={key}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          className={`tickets-lead-tab${active ? ' tickets-lead-tab--active' : ''}`}
                          onClick={() => setLeadListScope(key)}
                        >
                          {active ? (
                            <motion.span
                              layoutId="tickets-lead-scope-pill"
                              className="tickets-lead-tab-pill"
                              transition={{ type: 'spring', stiffness: 440, damping: 34 }}
                            />
                          ) : null}
                          <span className="tickets-lead-tab-label">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </LayoutGroup>
              ) : null}
              {isLeadCreateModule ? null : (
                <SelectButton
                  value={viewMode}
                  onChange={(e) => e.value != null && onViewModeChange(e.value)}
                  options={[
                    { label: 'List', value: 'list' },
                    { label: 'Kanban', value: 'kanban' },
                  ]}
                  className="tickets-view-toggle"
                />
              )}
            </div>
          </div>
          <div className="tickets-list-filters">
            <Dropdown value={listProjectFilter} onChange={(e) => setListProjectFilter(e.value)} options={listProjectOptions} className="tickets-list-filter" placeholder="Project" showClear />
            <Dropdown value={listSprintFilter} onChange={(e) => setListSprintFilter(e.value)} options={listSprintOptions} className="tickets-list-filter" placeholder="Sprint" showClear />
            <Dropdown value={listStatusFilter} onChange={(e) => setListStatusFilter(e.value)} options={listStatusOptions} className="tickets-list-filter" placeholder="Status" showClear />
            <Dropdown value={listPriorityFilter} onChange={(e) => setListPriorityFilter(e.value)} options={listPriorityOptions} className="tickets-list-filter" placeholder="Priority" showClear />
            <Dropdown value={listAssigneeFilter} onChange={(e) => setListAssigneeFilter(e.value)} options={listAssigneeOptions} className="tickets-list-filter" placeholder="Assignee" showClear />
            <Button
              type="button"
              label="Clear filters"
              text
              className="tickets-clear-filters"
              disabled={!hasActiveListFilters}
              onClick={() => {
                setListProjectFilter(null);
                setListSprintFilter(null);
                setListStatusFilter(null);
                setListPriorityFilter(null);
                setListAssigneeFilter(null);
              }}
            />
          </div>

          {error ? <p className="error-text tickets-banner-error">{error}</p> : null}
          {kanbanDropError ? <p className="error-text tickets-banner-error">{kanbanDropError}</p> : null}

          {viewMode === 'list' || isLeadCreateModule ? (
            <DataTable
              value={filtered}
              loading={isLoading}
              paginator
              paginatorDropdownAppendTo="self"
              rows={10}
              rowsPerPageOptions={[10, 20, 40]}
              className="user-table tickets-table tickets-table-compact"
              tableClassName="tickets-datatable-table"
              tableStyle={{ width: '100%', tableLayout: 'fixed' }}
              emptyMessage="No tickets match this view."
              dataKey="id"
              selectionMode="single"
              selection={selectedTableRow}
              onSelectionChange={(e) => {
                const row = e.value as TicketRecord | null;
                if (row) {
                  openEdit(row);
                }
              }}
              onRowClick={(e) => {
                const row = e.data as TicketRecord;
                if (row) {
                  openEdit(row);
                }
              }}
              rowClassName={(row) => {
                const classes = [
                  row.id === editingId ? 'tickets-row-selected' : '',
                  `tickets-row-priority-${row.priority}`,
                  row.status === 'resolved' ? 'tickets-row-resolved' : '',
                  row.status === 'closed' ? 'tickets-row-closed' : '',
                ];
                return classes.filter(Boolean).join(' ');
              }}
            >
              {isLeadCreateModule ? null : (
                <Column
                  header="Ref"
                  headerClassName="tickets-col-ref"
                  bodyClassName="tickets-col-ref"
                  style={{ minWidth: '124px', width: '128px' }}
                  body={(row: TicketRecord) => (
                    <div className="tickets-ref-cell-wrap">
                      <span
                        className={`tickets-ref-chip tickets-ref-type-${row.type}`}
                        title={displayTicketRef(row)}
                      >
                        {displayTicketRef(row)}
                      </span>
                      {row.is_overdue ? (
                        <Tag value="Overdue" severity="danger" className="tickets-overdue-chip" />
                      ) : null}
                    </div>
                  )}
                />
              )}
              {isLeadCreateModule ? null : (
                <Column
                  header="Project"
                  headerClassName="tickets-col-project"
                  bodyClassName="tickets-col-project"
                  style={{ minWidth: '132px', width: '160px' }}
                  body={(row: TicketRecord) => (
                    <span className="tickets-project-cell">{projectLookup.get(row.project_id) ?? '—'}</span>
                  )}
                />
              )}
              <Column
                header="Title"
                headerClassName="tickets-col-description"
                bodyClassName="tickets-col-description"
                style={{ minWidth: '220px', width: '260px' }}
                body={(row: TicketRecord) => (
                  <span
                    className="tickets-description-cell"
                    title={row.title}
                  >
                    {row.title}
                  </span>
                )}
              />
              {isLeadCreateModule ? null : (
                <Column
                  header="Assignees"
                  headerClassName="tickets-col-assignee"
                  bodyClassName="tickets-col-assignee"
                  style={{ minWidth: '140px', width: '168px' }}
                  body={(row: TicketRecord) => (
                    <span className="tickets-assignee-cell">
                      {formatAssigneeLabels(row, userLookup) || '—'}
                    </span>
                  )}
                />
              )}
              <Column
                field="priority"
                header="Pri."
                headerClassName="tickets-col-pri"
                bodyClassName="tickets-col-pri"
                style={{ minWidth: '96px', width: '104px' }}
                body={(row: TicketRecord) => (
                  <Tag
                    className={`tickets-table-tag tickets-table-tag--priority tickets-priority-${row.priority} ticket-palette-priority ticket-palette-priority--${ticketPaletteKey(row.priority)}`}
                    value={humanize(row.priority)}
                    severity={prioritySeverity(row.priority)}
                    rounded
                  />
                )}
              />
              {isLeadCreateModule ? null : (
                <Column
                  header="Sprint"
                  headerClassName="tickets-col-sprint"
                  bodyClassName="tickets-col-sprint"
                  style={{ minWidth: '132px', width: '152px' }}
                  body={(row: TicketRecord) => (
                    <span className="tickets-project-cell">
                      {row.sprint_id
                        ? sanitizeSprintTitle(row.sprint_title) ?? sprintLabelLookup.get(row.sprint_id) ?? 'Sprint'
                        : 'Backlog'}
                    </span>
                  )}
                />
              )}
              {isLeadCreateModule ? null : (
                <Column
                  header="Opened"
                  headerClassName="tickets-col-opened"
                  bodyClassName="tickets-col-opened"
                  sortable
                  field="created_at"
                  style={{ minWidth: '112px', width: '120px' }}
                  body={(row: TicketRecord) => (
                    <span className="tickets-date-cell" title={row.created_at ?? undefined}>
                      {formatTicketListDate(row.created_at)}
                    </span>
                  )}
                />
              )}
              {isLeadCreateModule ? null : (
                <Column
                  header="Closed by"
                  headerClassName="tickets-col-closedby"
                  bodyClassName="tickets-col-closedby"
                  style={{ minWidth: '132px', width: '152px' }}
                  body={(row: TicketRecord) => (
                    <span className="tickets-assignee-cell">
                      {getClosedByLabel(row, userLookup)}
                    </span>
                  )}
                />
              )}
              {isLeadCreateModule ? null : (
                <Column
                  header="Closed"
                  headerClassName="tickets-col-closed"
                  bodyClassName="tickets-col-closed"
                  sortable
                  field="closed_at"
                  style={{ minWidth: '112px', width: '120px' }}
                  body={(row: TicketRecord) => (
                    <span className="tickets-date-cell" title={row.closed_at ?? undefined}>
                      {formatTicketListDate(row.closed_at)}
                    </span>
                  )}
                />
              )}
              <Column
                header="Status"
                headerClassName="tickets-col-status"
                bodyClassName="tickets-col-status"
                style={{ minWidth: '152px', width: '168px' }}
                body={(row: TicketRecord) =>
                  (!canEditTickets || (ticketRole === 'member' && row.status === 'closed')) ? (
                    <Tag
                      className={`tickets-table-tag tickets-table-tag--status tickets-status-${row.status} ticket-palette-status ticket-palette-status--${ticketPaletteKey(row.status)}`}
                      value={humanize(row.status)}
                      severity={statusSeverity(row.status)}
                      rounded
                    />
                  ) : (
                    <Dropdown
                      value={row.status}
                      options={statusDropdownOptions}
                      onChange={(ev) => void handleInlineStatusChange(row, ev.value as TicketStatus)}
                      disabled={statusBusy === row.id}
                      className={`tickets-status-dropdown tickets-status-dropdown--${ticketPaletteKey(row.status)}`}
                      panelClassName="tickets-status-dropdown-panel"
                      onClick={(e) => e.stopPropagation()}
                    />
                  )
                }
              />
              <Column
                header={<span className="tickets-actions-header">Actions</span>}
                headerClassName="tickets-col-actions"
                bodyClassName="tickets-col-actions"
                style={{ minWidth: '136px', width: '144px' }}
                body={(row: TicketRecord) => (
                  <div className="tickets-row-actions tickets-row-actions--icons" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="tickets-action-icon"
                      disabled={!canEditTickets}
                      title={canEditTickets ? 'Edit ticket' : 'Editing is only available from Create Ticket'}
                      aria-label="Edit ticket"
                      onClick={() => openEdit(row)}
                    >
                      <i className="pi pi-file-edit" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="tickets-action-icon tickets-action-icon--delete"
                      disabled={!canDeleteTickets || !ticketCanBeDeleted(row) || deleteBusy}
                      title={
                        !canDeleteTickets
                          ? 'Only team leads can delete tickets'
                          : !ticketCanBeDeleted(row)
                            ? 'Only Open or In progress tickets can be deleted'
                            : 'Delete ticket'
                      }
                      aria-label="Delete ticket"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canDeleteTickets && ticketCanBeDeleted(row) && !deleteBusy) {
                          setDeleteConfirmTicket(row);
                        }
                      }}
                    >
                      <i className="pi pi-trash" aria-hidden />
                    </button>
                    <span className="tickets-action-divider" aria-hidden />
                    <button
                      type="button"
                      className="tickets-action-nav"
                      title="Open ticket details"
                      aria-label="Open ticket details"
                      onClick={() => openEdit(row)}
                    >
                      <i className="pi pi-arrow-right" aria-hidden />
                    </button>
                  </div>
                )}
              />
            </DataTable>
          ) : (
            <div className="kanban-board tickets-kanban tickets-kanban-embedded">
              {kanbanColumns.map((status) => (
                <div
                  key={status}
                  className="kanban-column"
                  onDragOver={(e) => {
                    e.preventDefault();
                    const ticket = draggingTicketId ? filtered.find((x) => x.id === draggingTicketId) : null;
                    if (ticket && isAllowedStatusTransition(ticket.status, status)) {
                      e.dataTransfer.dropEffect = 'move';
                    } else {
                      e.dataTransfer.dropEffect = 'none';
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData('text/plain');
                    if (id) {
                      void handleKanbanDrop(status, id);
                    }
                    setDraggingTicketId(null);
                  }}
                >
                  <header className="kanban-column-header">
                    <h4>{humanize(status)}</h4>
                    <small>{filtered.filter((t) => t.status === status).length}</small>
                  </header>
                  <div className="kanban-column-body">
                    {filtered
                      .filter((t) => t.status === status)
                      .map((row) => (
                        <div
                          key={row.id}
                          role="button"
                          tabIndex={0}
                          className={`kanban-card ${row.id === editingId ? 'kanban-card-selected' : ''}`}
                          draggable
                          onDragStart={(e) => {
                            setDraggingTicketId(row.id);
                            setKanbanDropError('');
                            e.dataTransfer.setData('text/plain', row.id);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => setDraggingTicketId(null)}
                          onClick={() => openEdit(row)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              openEdit(row);
                            }
                          }}
                        >
                          <div className="kanban-card-top">
                            <strong className="tickets-ref-cell">{displayTicketRef(row)}</strong>
                            {row.is_overdue ? <Tag value="Overdue" severity="danger" className="tickets-overdue-chip" /> : null}
                            <Tag
                              value={humanize(row.priority)}
                              severity={prioritySeverity(row.priority)}
                              rounded
                              className={`ticket-palette-priority ticket-palette-priority--${ticketPaletteKey(row.priority)}`}
                            />
                          </div>
                          <p>{row.title}</p>
                          <div className="kanban-meta">
                            <small>{projectLookup.get(row.project_id) ?? '—'}</small>
                            {row.assignee_ids?.length ? (
                              <small>{formatAssigneeLabels(row, userLookup)}</small>
                            ) : (
                              <small className="muted">Unassigned</small>
                            )}
                          </div>
                          {kanbanBusy === row.id ? <small className="tickets-moving">Updating…</small> : null}
                        </div>
                      ))}
                    {filtered.filter((t) => t.status === status).length === 0 ? (
                      <p className="kanban-empty">Drop tickets here</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {isListOnlyView ? null : (
          <div className="tickets-right-pane">
            {panel === 'none' ? (
              emptyRight
            ) : (
              <div className="tickets-detail-panel">
              <header className="tickets-detail-header">
                <div className="tickets-detail-header-text">
                  <span className="tickets-detail-kicker">{panel === 'create' ? 'Create' : 'Ticket'}</span>
                  {panel === 'create' ? (
                    <h2 className="tickets-detail-title">{detailTitle}</h2>
                  ) : editingTicket && ticketRole === 'lead' ? (
                    <div className="tickets-detail-title-row">
                      <span className="tickets-detail-title-ref">{displayTicketRef(editingTicket)}</span>
                      <InputText
                        id={`tf-title-edit-${viewKey}`}
                        className="full-width tickets-detail-title-input"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={300}
                      />
                    </div>
                  ) : editingTicket ? (
                    <div className="tickets-detail-title-row">
                      <span className="tickets-detail-title-ref">{displayTicketRef(editingTicket)}</span>
                      <h2 className="tickets-detail-title">{editingTicket.title}</h2>
                    </div>
                  ) : (
                    <h2 className="tickets-detail-title">{detailTitle}</h2>
                  )}
                  {panel === 'edit' && editingTicket ? (
                    <div className="ticket-meta-strip ticket-meta-strip--header">
                      <span className="ticket-meta-chip">
                        <i className="pi pi-folder" /> {projectLookup.get(editingTicket.project_id) ?? '—'}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="tickets-detail-header-actions">
                  {panel === 'edit' && editingTicket && canDeleteTickets && ticketCanBeDeleted(editingTicket) ? (
                    <Button
                      type="button"
                      icon="pi pi-trash"
                      rounded
                      text
                      severity="danger"
                      aria-label="Delete ticket"
                      title="Delete ticket"
                      disabled={deleteBusy}
                      onClick={() => setDeleteConfirmTicket(editingTicket)}
                    />
                  ) : null}
                  <Button type="button" icon="pi pi-times" rounded text severity="secondary" onClick={closePanel} aria-label="Close panel" />
                </div>
              </header>
              {panel === 'create' ? (
                <div className="tickets-detail-scroll">{createFormBody}</div>
              ) : editingTicket ? (
                <div className="tickets-detail-scroll tickets-detail-scroll--edit">
                  <div className="tickets-detail-body">
                    <aside className={`ticket-detail-sidebar ${canEditTicketFields ? 'ticket-detail-sidebar--editable' : ''}`}>
                      {ticketRole === 'lead' ? (
                        <div className="ticket-detail-form">
                          <h3 className="ticket-sidebar-heading">Properties</h3>
                          <div className="ticket-form-grid">
                            <div className="ticket-form-field ticket-form-field--full">
                              <label className="ticket-form-label">Status</label>
                              {canEditTickets ? (
                                <Dropdown
                                  value={editingTicket.status}
                                  options={statusDropdownOptions}
                                  onChange={(ev) => void handleInlineStatusChange(editingTicket, ev.value as TicketStatus)}
                                  disabled={statusBusy === editingTicket.id}
                                  className={`full-width tickets-status-dropdown tickets-status-dropdown--${ticketPaletteKey(editingTicket.status)}`}
                                  panelClassName="tickets-status-dropdown-panel"
                                />
                              ) : (
                                <Tag
                                  value={humanize(editingTicket.status)}
                                  severity={statusSeverity(editingTicket.status)}
                                  rounded
                                  className={`ticket-palette-status ticket-palette-status--${ticketPaletteKey(editingTicket.status)}`}
                                />
                              )}
                              <p className="ticket-form-hint">Workflow moves one step at a time. Only leads can close.</p>
                              {canEditTickets && editingTicket.status === 'closed' ? (
                                <Button
                                  type="button"
                                  className="ticket-reopen-btn"
                                  icon="pi pi-refresh"
                                  label="Reopen ticket"
                                  onClick={openReopenDialog}
                                  disabled={reopenBusy}
                                  rounded
                                />
                              ) : null}
                            </div>
                            <div className="ticket-form-field ticket-form-field--full">
                              <label className="ticket-form-label" htmlFor={`ts-project-${viewKey}`}>
                                Project
                              </label>
                              {canEditTicketFields ? (
                                <Dropdown
                                  inputId={`ts-project-${viewKey}`}
                                  value={projectId}
                                  options={projectOptions}
                                  onChange={(e) => setProjectId(e.value as string)}
                                  className="full-width"
                                  filter
                                />
                              ) : (
                                <div className="ticket-locked-field">{projectLookup.get(projectId ?? '') ?? '—'}</div>
                              )}
                            </div>
                            <div className="ticket-form-field ticket-form-field--full">
                              <label className="ticket-form-label" htmlFor={`ts-desc-${viewKey}`}>
                                Description
                              </label>
                              {canEditTicketFields ? (
                                <InputTextarea
                                  id={`ts-desc-${viewKey}`}
                                  value={description}
                                  onChange={(e) => setDescription(e.target.value)}
                                  rows={4}
                                  className="full-width ticket-form-textarea"
                                />
                              ) : (
                                <div className="ticket-locked-field ticket-locked-field--multiline">{description?.trim() || '—'}</div>
                              )}
                            </div>
                            <div className="ticket-form-row">
                              <div className="ticket-form-field">
                                <label className="ticket-form-label">Type</label>
                                {canEditTicketFields ? (
                                  <Dropdown
                                    value={ticketType}
                                    options={typeOptions}
                                    onChange={(e) => setTicketType(e.value as TicketType)}
                                    className="full-width"
                                  />
                                ) : (
                                  <div className="ticket-locked-field">
                                    <span className={`ticket-palette-type ticket-palette-type--${ticketPaletteKey(ticketType)}`}>
                                      {humanize(ticketType)}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="ticket-form-field">
                                <label className="ticket-form-label">Priority</label>
                                {canEditTicketFields ? (
                                  <Dropdown
                                    value={priority}
                                    options={PRIORITIES}
                                    onChange={(e) => setPriority(e.value)}
                                    className="full-width"
                                  />
                                ) : (
                                  <div className="ticket-locked-field">
                                    <Tag
                                      value={humanize(priority)}
                                      severity={prioritySeverity(priority)}
                                      rounded
                                      className={`ticket-palette-priority ticket-palette-priority--${ticketPaletteKey(priority)}`}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="ticket-form-row">
                              <div className="ticket-form-field">
                                <label className="ticket-form-label">Assignees</label>
                                {canEditTicketFields ? (
                                  <div className="ticket-assignees-editable">
                                    <div className="p-inputgroup">
                                      <span className="p-inputgroup-addon">
                                        <i className="pi pi-users" />
                                      </span>
                                      <MultiSelect
                                        value={assigneeIds}
                                        options={assigneeMultiOptions}
                                        onChange={(e) => setAssigneeIds((e.value as string[]) ?? [])}
                                        className="full-width ticket-assignees-multiselect"
                                        filter
                                        placeholder="Select users"
                                      />
                                    </div>
                                    {assigneeIds.length ? (
                                      <div className="ticket-assignees-selected-list">
                                        {assigneeIds.map((id) => (
                                          <div key={id} className="ticket-assignees-selected-item">
                                            <i className="pi pi-user" />
                                            <span>{userLookup.get(id) ?? id}</span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div className="ticket-assignees-readonly">
                                    {assigneeIds.length ? (
                                      assigneeIds.map((id) => (
                                        <div key={id} className="ticket-assignees-readonly-item">
                                          <i className="pi pi-user" />
                                          <span>{userLookup.get(id) ?? id}</span>
                                        </div>
                                      ))
                                    ) : (
                                      <span className="ticket-assignees-readonly-empty">Unassigned</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="ticket-form-field">
                                <label className="ticket-form-label">Customer</label>
                                {canEditTicketFields ? (
                                  <Dropdown
                                    value={customerId}
                                    options={customerOptions}
                                    onChange={(e) => setCustomerId(e.value as string | null)}
                                    className="full-width"
                                    filter
                                  />
                                ) : (
                                  <div className="ticket-locked-field">
                                    {customers.find((c) => c.id === customerId)?.name ?? 'None'}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="ticket-form-field ticket-form-field--full">
                              <label className="ticket-form-label">Due date</label>
                              {canEditTicketFields ? (
                                <Calendar
                                  value={dueDate}
                                  onChange={(e) => setDueDate((e.value as Date) || null)}
                                  showIcon
                                  className="full-width ticket-due-cal"
                                />
                              ) : (
                                <div className="ticket-locked-field">{dueDate ? toYmd(dueDate) : '—'}</div>
                              )}
                            </div>
                            {!canEditTicketFields && editingTicket?.status !== 'open' ? (
                              <small className="ticket-form-hint">
                                Fields are locked after the ticket leaves Open. Only status can be changed.
                              </small>
                            ) : null}
                            {formError ? <small className="error-text">{formError}</small> : null}
                            {canEditTicketFields ? (
                              <div className="ticket-detail-actions ticket-sidebar-actions">
                                <Button
                                  type="button"
                                  label={saving ? 'Saving…' : 'Save changes'}
                                  icon="pi pi-check"
                                  onClick={() => void submitEdit()}
                                  disabled={saving}
                                />
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="ticket-detail-readonly">
                          <h3 className="ticket-sidebar-heading">Details</h3>
                          <dl className="ticket-readonly-dl">
                            <dt>Status</dt>
                            <dd>
                              <div className="ticket-status-readout">
                                {!canEditTickets || editingTicket.status === 'closed' ? (
                                  <Tag
                                    value={humanize(editingTicket.status)}
                                    severity={statusSeverity(editingTicket.status)}
                                    rounded
                                    className={`ticket-palette-status ticket-palette-status--${ticketPaletteKey(editingTicket.status)}`}
                                  />
                                ) : (
                                  <Dropdown
                                    value={editingTicket.status}
                                    options={statusDropdownOptions}
                                    onChange={(ev) => void handleInlineStatusChange(editingTicket, ev.value as TicketStatus)}
                                    disabled={statusBusy === editingTicket.id}
                                    className={`full-width tickets-status-dropdown tickets-status-dropdown--${ticketPaletteKey(editingTicket.status)}`}
                                    panelClassName="tickets-status-dropdown-panel"
                                  />
                                )}
                                {editingTicket.is_overdue ? (
                                  <Tag value="Overdue" severity="danger" className="tickets-overdue-chip" />
                                ) : null}
                              </div>
                            </dd>
                            <dt>Assignees</dt>
                            <dd>{formatAssigneeLabels(editingTicket, userLookup) || '—'}</dd>
                            <dt>Project</dt>
                            <dd>{projectLookup.get(editingTicket.project_id) ?? '—'}</dd>
                            <dt>Type</dt>
                            <dd>
                              <span className={`ticket-palette-type ticket-palette-type--${ticketPaletteKey(editingTicket.type)}`}>
                                {humanize(editingTicket.type)}
                              </span>
                            </dd>
                            <dt>Priority</dt>
                            <dd>
                              <Tag
                                value={humanize(editingTicket.priority)}
                                severity={prioritySeverity(editingTicket.priority)}
                                rounded
                                className={`ticket-palette-priority ticket-palette-priority--${ticketPaletteKey(editingTicket.priority)}`}
                              />
                            </dd>
                            <dt>Due</dt>
                            <dd>{editingTicket.due_date ?? '—'}</dd>
                          </dl>
                        </div>
                      )}
                    </aside>
                    <div className="ticket-detail-main">
                      <TicketDetailTabs
                        viewKey={`${viewKey}-tabs`}
                        ticket={editingTicket}
                        currentUserId={currentUserId}
                        canPostInternalNotes={ticketRole === 'lead'}
                        showApprovalAction={ticketRole === 'member' && editingTicket.status === 'resolved'}
                        approvalRequested={approvalByTicket.has(editingTicket.id)}
                        onRequestApproval={() => {
                          void requestLeadApproval(editingTicket);
                        }}
                        onThreadChanged={onRefresh}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="tickets-detail-scroll" />
              )}
              </div>
            )}
          </div>
        )}
      </div>
      <Dialog
        header="Status update comment"
        visible={statusCommentOpen}
        onHide={closeStatusCommentModal}
        className="ticket-status-comment-dialog"
        modal
        draggable={false}
        resizable={false}
        dismissableMask={!statusCommentSaving}
        closable={!statusCommentSaving}
      >
        <div className="ticket-status-comment-body">
          <p className="ticket-status-comment-help">
            Add a comment for this status change (optional).
          </p>
          <InputTextarea
            value={statusCommentText}
            onChange={(e) => setStatusCommentText(e.target.value)}
            rows={4}
            autoFocus
            className="full-width ticket-form-textarea"
            maxLength={2000}
            placeholder="Example: Waiting for testing sign-off from TPREL team."
            disabled={statusCommentSaving}
          />
          <div className="ticket-status-comment-actions">
            <Button
              type="button"
              label="Cancel"
              text
              onClick={closeStatusCommentModal}
              disabled={statusCommentSaving}
            />
            <Button
              type="button"
              label={statusCommentSaving ? 'Updating…' : 'Update status'}
              icon="pi pi-check"
              onClick={() => void confirmStatusChangeWithComment()}
              disabled={statusCommentSaving}
            />
          </div>
        </div>
      </Dialog>
      <Dialog
        header="Reopen ticket"
        visible={reopenDialogOpen}
        onHide={closeReopenDialog}
        className="ticket-reopen-dialog"
        modal
        draggable={false}
        resizable={false}
        dismissableMask={!reopenBusy}
        closable={!reopenBusy}
      >
        <div className="ticket-reopen-body">
          <p className="ticket-form-hint">
            Start a new ticket version. Previous conversation, attachments, and resolution remain available in older versions.
          </p>
          <label className="ticket-form-label" htmlFor={`ticket-reopen-reason-${viewKey}`}>
            Reopen reason
          </label>
          <InputTextarea
            id={`ticket-reopen-reason-${viewKey}`}
            value={reopenReason}
            onChange={(e) => setReopenReason(e.target.value)}
            rows={4}
            className="full-width ticket-form-textarea"
            maxLength={4000}
            disabled={reopenBusy}
          />
          <label className="ticket-form-label" htmlFor={`ticket-reopen-sprint-${viewKey}`}>
            Assign to sprint
          </label>
          <Dropdown
            inputId={`ticket-reopen-sprint-${viewKey}`}
            value={reopenSprintId}
            options={sprintOptionsForReopen}
            onChange={(e) => setReopenSprintId((e.value as string | null) ?? null)}
            className="full-width"
            filter
            disabled={reopenBusy}
          />
          <div className="ticket-status-comment-actions">
            <Button type="button" label="Cancel" text className="ticket-reopen-cancel-btn" onClick={closeReopenDialog} disabled={reopenBusy} />
            <Button
              type="button"
              label={reopenBusy ? 'Reopening…' : 'Reopen ticket'}
              icon="pi pi-refresh"
              className="ticket-reopen-confirm-btn"
              onClick={() => void confirmReopenTicket()}
              disabled={reopenBusy || !reopenReason.trim()}
            />
          </div>
        </div>
      </Dialog>
      <Dialog
        header="Delete ticket"
        visible={Boolean(deleteConfirmTicket)}
        onHide={closeDeleteConfirmModal}
        className="ticket-delete-confirm-dialog"
        modal
        draggable={false}
        resizable={false}
        dismissableMask={!deleteBusy}
        closable={!deleteBusy}
      >
        {deleteConfirmTicket ? (
          <div className="ticket-delete-confirm-body">
            <p>
              Permanently delete <strong>{displayTicketRef(deleteConfirmTicket)}</strong>
              {deleteConfirmTicket.title ? (
                <>
                  {' '}
                  — <span className="ticket-delete-confirm-title">{deleteConfirmTicket.title}</span>
                </>
              ) : null}
              ? This cannot be undone.
            </p>
            <div className="ticket-delete-password-field">
              <div className="p-inputgroup">
                <span className="p-inputgroup-addon">
                  <i className="pi pi-key" aria-hidden />
                </span>
                <FloatLabel className="user-float-field" style={{ flex: 1 }}>
                  <InputText
                    id={`ticket-delete-password-${viewKey}`}
                    type={deleteShowPassword ? 'text' : 'password'}
                    className="full-width"
                    value={deleteConfirmPassword}
                    onChange={(e) => setDeleteConfirmPassword(e.target.value)}
                    autoComplete="current-password"
                    disabled={deleteBusy}
                  />
                  <label htmlFor={`ticket-delete-password-${viewKey}`}>Your password</label>
                </FloatLabel>
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setDeleteShowPassword((c) => !c)}
                  disabled={deleteBusy}
                  aria-label={deleteShowPassword ? 'Hide password' : 'Show password'}
                >
                  <i className={deleteShowPassword ? 'pi pi-eye-slash' : 'pi pi-eye'} />
                </button>
              </div>
              <p className="ticket-delete-password-help">Enter the password you use to sign in.</p>
            </div>
            <div className="ticket-status-comment-actions">
              <Button type="button" label="Cancel" text onClick={closeDeleteConfirmModal} disabled={deleteBusy} />
              <Button
                type="button"
                label={deleteBusy ? 'Deleting…' : 'Delete'}
                icon="pi pi-trash"
                severity="danger"
                onClick={() => void confirmDeleteTicket()}
                disabled={deleteBusy || !deleteConfirmPassword.trim()}
              />
            </div>
          </div>
        ) : null}
      </Dialog>
    </motion.article>
  );
}
