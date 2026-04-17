import { motion } from 'framer-motion';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dropdown } from 'primereact/dropdown';
import { FloatLabel } from 'primereact/floatlabel';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { SelectButton } from 'primereact/selectbutton';
import { Tag } from 'primereact/tag';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TicketDetailTabs } from './TicketDetailTabs';
import type {
  CustomerRecord,
  ProjectRecord,
  TicketConfigurationRecord,
  TicketCreatePayload,
  TicketRecord,
  TicketStatus,
  TicketType,
  TicketUpdatePayload,
  TicketPriority,
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

function humanize(s: string): string {
  return s.replace(/_/g, ' ');
}

export function displayTicketRef(row: TicketRecord): string {
  return row.public_reference?.trim() || `#${row.ticket_number}`;
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

function filterByModule(
  tickets: TicketRecord[],
  module: string,
  currentUserId: string | undefined,
  role: 'lead' | 'member',
): TicketRecord[] {
  if (role === 'member') {
    switch (module) {
      case 'My Tickets':
        return tickets;
      case 'Updates':
        return tickets.filter((t) => ['open', 'in_progress', 'in_review'].includes(t.status));
      case 'History':
        return tickets.filter((t) => ['resolved', 'closed'].includes(t.status));
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
      return tickets.filter((t) => Boolean(currentUserId && t.assignee_id === currentUserId));
    case 'Resolved':
      return tickets.filter((t) => ['resolved', 'closed'].includes(t.status));
    default:
      return tickets;
  }
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
    const an = t.assignee_name ?? (t.assignee_id ? userLookup.get(t.assignee_id) ?? '' : '');
    const ref = displayTicketRef(t).toLowerCase();
    return (
      t.title.toLowerCase().includes(s) ||
      String(t.ticket_number).includes(s) ||
      ref.includes(s) ||
      pn.toLowerCase().includes(s) ||
      an.toLowerCase().includes(s) ||
      humanize(t.type).toLowerCase().includes(s) ||
      humanize(t.status).toLowerCase().includes(s)
    );
  });
}

type TicketManagementSectionProps = {
  viewKey: string;
  ticketModule: string;
  search: string;
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
  onPatchStatus: (id: string, status: TicketStatus) => Promise<TicketRecord>;
  /** Lead: full ticket CRUD. Member: assigned tickets, conversation & resolution. */
  ticketRole: 'lead' | 'member';
  canCreateTickets: boolean;
  canEditTickets: boolean;
};

export function TicketManagementSection({
  viewKey,
  ticketModule,
  search,
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
  ticketRole,
  canCreateTickets,
  canEditTickets,
}: TicketManagementSectionProps) {
  type Panel = 'none' | 'create' | 'edit';
  const [panel, setPanel] = useState<Panel>('none');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [kanbanBusy, setKanbanBusy] = useState<string | null>(null);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ticketType, setTicketType] = useState<TicketType>('service_request');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<Date | null>(null);

  const projectLookup = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const userLookup = useMemo(() => new Map(assignableUsers.map((u) => [u.id, u.name])), [assignableUsers]);

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

  const scoped = useMemo(
    () => filterByModule(tickets, ticketModule, currentUserId, ticketRole),
    [tickets, ticketModule, currentUserId, ticketRole],
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
  const isListOnlyView = panel === 'none' && !isLeadCreateModule;
  const filtered = useMemo(
    () => applySearch(scoped, search, projectLookup, userLookup),
    [scoped, search, projectLookup, userLookup],
  );

  const editingTicket = useMemo(
    () => (editingId ? tickets.find((t) => t.id === editingId) ?? null : null),
    [tickets, editingId],
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
  const assigneeOptions = useMemo(
    () => [{ label: 'Unassigned', value: null }, ...assignableUsers.map((u) => ({ label: `${u.name} (${u.employee_id})`, value: u.id }))],
    [assignableUsers],
  );
  const customerOptions = useMemo(
    () => [{ label: 'None', value: null }, ...customers.map((c) => ({ label: c.name, value: c.id }))],
    [customers],
  );

  const hydrateFromTicket = useCallback((row: TicketRecord) => {
    setProjectId(row.project_id);
    setTitle(row.title);
    setDescription(row.description ?? '');
    setTicketType(row.type);
    setPriority(row.priority);
    setAssigneeId(row.assignee_id);
    setCustomerId(row.customer_id);
    setDueDate(parseDue(row.due_date));
    setFormError('');
  }, []);

  useEffect(() => {
    if (panel === 'edit' && editingTicket) {
      hydrateFromTicket(editingTicket);
    }
  }, [panel, editingTicket, hydrateFromTicket]);

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
      setAssigneeId(null);
      setCustomerId(null);
      setDueDate(null);
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
        assigned_to: assigneeId,
        customer_id: customerId,
        due_date: dueDate ? toYmd(dueDate) : null,
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
    if (ticketRole !== 'lead' || !canEditTickets || !editingTicket) {
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
        assigned_to: assigneeId,
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
    setStatusBusy(ticket.id);
    try {
      await onPatchStatus(ticket.id, next);
      onRefresh();
    } finally {
      setStatusBusy(null);
    }
  }

  async function handleKanbanDrop(status: TicketStatus, ticketId: string) {
    const t = filtered.find((x) => x.id === ticketId);
    if (!t || t.status === status) {
      return;
    }
    setKanbanBusy(ticketId);
    try {
      await onPatchStatus(ticketId, status);
      onRefresh();
    } finally {
      setKanbanBusy(null);
    }
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
              onChange={(e) => setProjectId(e.value as string)}
              placeholder="Select project"
              className="full-width"
              filter
            />
          </div>
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
            <label className="ticket-form-label">Assignee</label>
            <div className="p-inputgroup">
              <span className="p-inputgroup-addon">
                <i className="pi pi-user" />
              </span>
              <Dropdown
                value={assigneeId}
                options={assigneeOptions}
                onChange={(e) => setAssigneeId(e.value as string | null)}
                className="full-width"
                filter
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

  return (
    <motion.article
      key={viewKey}
      className="page-card tickets-module-page tickets-module-full"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className={`tickets-workspace ${panel === 'edit' ? 'tickets-workspace--focus' : ''} ${isListOnlyView ? 'tickets-workspace--list-only' : ''}`}>
        {isLeadCreateModule ? null : <div className="tickets-left-pane">
          <div className="tickets-left-head">
            <div>
              <h2 className="tickets-page-title">Tickets</h2>
              <p className="tickets-page-sub">{ticketModule} — list or board; details open on the right.</p>
            </div>
            <div className="tickets-toolbar-actions">
              {canCreateTickets ? (
                <Button type="button" label="Create ticket" icon="pi pi-plus" outlined onClick={openCreate} />
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

          {error ? <p className="error-text tickets-banner-error">{error}</p> : null}

          {viewMode === 'list' || isLeadCreateModule ? (
            <DataTable
              value={filtered}
              loading={isLoading}
              paginator
              rows={10}
              rowsPerPageOptions={[10, 20, 40]}
              className="user-table tickets-table tickets-table-compact"
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
              rowClassName={(row) => (row.id === editingId ? 'tickets-row-selected' : '')}
            >
              {isLeadCreateModule ? null : (
                <Column
                  header="Ref"
                  style={{ width: '108px' }}
                  body={(row: TicketRecord) => <span className="tickets-ref-cell">{displayTicketRef(row)}</span>}
                />
              )}
              <Column
                field="title"
                header="Title"
                sortable
                style={{ minWidth: '160px' }}
                body={(row: TicketRecord) => <span className="tickets-title-cell">{row.title}</span>}
              />
              {isLeadCreateModule ? null : (
                <Column header="Project" body={(row: TicketRecord) => projectLookup.get(row.project_id) ?? '—'} />
              )}
              {isLeadCreateModule ? null : (
                <Column
                  header="Assignee"
                  style={{ minWidth: '120px' }}
                  body={(row: TicketRecord) => (
                    <span className="tickets-assignee-cell">
                      {row.assignee_name ?? (row.assignee_id ? userLookup.get(row.assignee_id) : null) ?? '—'}
                    </span>
                  )}
                />
              )}
              <Column
                field="priority"
                header="Pri."
                style={{ width: '88px' }}
                body={(row: TicketRecord) => <Tag value={humanize(row.priority)} severity={prioritySeverity(row.priority)} rounded />}
              />
              <Column
                header="Status"
                style={{ minWidth: '140px' }}
                body={(row: TicketRecord) =>
                  (!canEditTickets || (ticketRole === 'member' && row.status === 'closed')) ? (
                    <Tag value={humanize(row.status)} severity={statusSeverity(row.status)} rounded />
                  ) : (
                    <Dropdown
                      value={row.status}
                      options={statusDropdownOptions}
                      onChange={(ev) => void handleInlineStatusChange(row, ev.value as TicketStatus)}
                      disabled={statusBusy === row.id}
                      className="tickets-status-dropdown"
                      onClick={(e) => e.stopPropagation()}
                    />
                  )
                }
              />
              <Column
                header={<span className="tickets-actions-header">Actions</span>}
                style={{ width: '132px' }}
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
                      disabled
                      title="Delete is not available yet"
                      aria-label="Delete ticket (unavailable)"
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
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData('text/plain');
                    if (id) {
                      void handleKanbanDrop(status, id);
                    }
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
                            e.dataTransfer.setData('text/plain', row.id);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onClick={() => openEdit(row)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              openEdit(row);
                            }
                          }}
                        >
                          <div className="kanban-card-top">
                            <strong className="tickets-ref-cell">{displayTicketRef(row)}</strong>
                            <Tag value={humanize(row.priority)} severity={prioritySeverity(row.priority)} rounded />
                          </div>
                          <p>{row.title}</p>
                          <div className="kanban-meta">
                            <small>{projectLookup.get(row.project_id) ?? '—'}</small>
                            {row.assignee_id ? (
                              <small>{row.assignee_name ?? userLookup.get(row.assignee_id)}</small>
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
        </div>}

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
                    <FloatLabel>
                      <InputText
                        id={`tf-title-edit-${viewKey}`}
                        className="full-width tickets-detail-title-input"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={300}
                      />
                      <label htmlFor={`tf-title-edit-${viewKey}`}>Title</label>
                    </FloatLabel>
                  ) : editingTicket ? (
                    <h2 className="tickets-detail-title">{editingTicket.title}</h2>
                  ) : (
                    <h2 className="tickets-detail-title">{detailTitle}</h2>
                  )}
                  {panel === 'edit' && editingTicket ? (
                    <div className="ticket-meta-strip ticket-meta-strip--header">
                      <span className="ticket-meta-chip">
                        <i className="pi pi-ticket" /> {displayTicketRef(editingTicket)}
                      </span>
                      <span className="ticket-meta-chip muted">Internal #{editingTicket.ticket_number}</span>
                      <span className="ticket-meta-chip">
                        <i className="pi pi-folder" /> {projectLookup.get(editingTicket.project_id) ?? '—'}
                      </span>
                    </div>
                  ) : null}
                </div>
                <Button type="button" icon="pi pi-times" rounded text severity="secondary" onClick={closePanel} aria-label="Close panel" />
              </header>
              {panel === 'create' ? (
                <div className="tickets-detail-scroll">{createFormBody}</div>
              ) : editingTicket ? (
                <div className="tickets-detail-scroll tickets-detail-scroll--edit">
                  <div className="tickets-detail-body">
                    <aside className="ticket-detail-sidebar">
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
                                  className="full-width"
                                />
                              ) : (
                                <Tag value={humanize(editingTicket.status)} severity={statusSeverity(editingTicket.status)} rounded />
                              )}
                              <p className="ticket-form-hint">Workflow moves one step at a time. Only leads can close.</p>
                            </div>
                            <div className="ticket-form-field ticket-form-field--full">
                              <label className="ticket-form-label" htmlFor={`ts-project-${viewKey}`}>
                                Project
                              </label>
                              <Dropdown
                                inputId={`ts-project-${viewKey}`}
                                value={projectId}
                                options={projectOptions}
                                onChange={(e) => setProjectId(e.value as string)}
                                className="full-width"
                                filter
                                disabled={!canEditTickets}
                              />
                            </div>
                            <div className="ticket-form-field ticket-form-field--full">
                              <label className="ticket-form-label" htmlFor={`ts-desc-${viewKey}`}>
                                Description
                              </label>
                              <InputTextarea
                                id={`ts-desc-${viewKey}`}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={4}
                                className="full-width ticket-form-textarea"
                                disabled={!canEditTickets}
                              />
                            </div>
                            <div className="ticket-form-row">
                              <div className="ticket-form-field">
                                <label className="ticket-form-label">Type</label>
                                <Dropdown
                                  value={ticketType}
                                  options={typeOptions}
                                  onChange={(e) => setTicketType(e.value as TicketType)}
                                  className="full-width"
                                  disabled={!canEditTickets}
                                />
                              </div>
                              <div className="ticket-form-field">
                                <label className="ticket-form-label">Priority</label>
                                <Dropdown
                                  value={priority}
                                  options={PRIORITIES}
                                  onChange={(e) => setPriority(e.value)}
                                  className="full-width"
                                  disabled={!canEditTickets}
                                />
                              </div>
                            </div>
                            <div className="ticket-form-row">
                              <div className="ticket-form-field">
                                <label className="ticket-form-label">Assignee</label>
                                <Dropdown
                                  value={assigneeId}
                                  options={assigneeOptions}
                                  onChange={(e) => setAssigneeId(e.value as string | null)}
                                  className="full-width"
                                  filter
                                  disabled={!canEditTickets}
                                />
                              </div>
                              <div className="ticket-form-field">
                                <label className="ticket-form-label">Customer</label>
                                <Dropdown
                                  value={customerId}
                                  options={customerOptions}
                                  onChange={(e) => setCustomerId(e.value as string | null)}
                                  className="full-width"
                                  filter
                                  disabled={!canEditTickets}
                                />
                              </div>
                            </div>
                            <div className="ticket-form-field ticket-form-field--full">
                              <label className="ticket-form-label">Due date</label>
                              <Calendar
                                value={dueDate}
                                onChange={(e) => setDueDate((e.value as Date) || null)}
                                showIcon
                                className="full-width ticket-due-cal"
                                disabled={!canEditTickets}
                              />
                            </div>
                            {formError ? <small className="error-text">{formError}</small> : null}
                            {canEditTickets ? (
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
                              {!canEditTickets || editingTicket.status === 'closed' ? (
                                <Tag value={humanize(editingTicket.status)} severity={statusSeverity(editingTicket.status)} rounded />
                              ) : (
                                <Dropdown
                                  value={editingTicket.status}
                                  options={statusDropdownOptions}
                                  onChange={(ev) => void handleInlineStatusChange(editingTicket, ev.value as TicketStatus)}
                                  disabled={statusBusy === editingTicket.id}
                                  className="full-width"
                                />
                              )}
                            </dd>
                            <dt>Assignee</dt>
                            <dd>{editingTicket.assignee_name ?? (editingTicket.assignee_id ? userLookup.get(editingTicket.assignee_id) : '—')}</dd>
                            <dt>Project</dt>
                            <dd>{projectLookup.get(editingTicket.project_id) ?? '—'}</dd>
                            <dt>Type</dt>
                            <dd>{humanize(editingTicket.type)}</dd>
                            <dt>Priority</dt>
                            <dd>{humanize(editingTicket.priority)}</dd>
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
                        canPostInternalNotes={ticketRole === 'lead'}
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
    </motion.article>
  );
}
