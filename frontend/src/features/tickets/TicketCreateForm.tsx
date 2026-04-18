import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Dropdown } from 'primereact/dropdown';
import { FloatLabel } from 'primereact/floatlabel';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { useEffect, useMemo, useState } from 'react';
import type {
  CustomerRecord,
  ProjectRecord,
  TicketConfigurationRecord,
  TicketCreatePayload,
  TicketPriority,
  TicketRecord,
  TicketType,
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

function humanize(s: string): string {
  return s.replace(/_/g, ' ');
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

export type TicketCreateFormProps = {
  viewKey: string;
  projects: ProjectRecord[];
  customers: CustomerRecord[];
  assignableUsers: UserRecord[];
  ticketConfigurations: TicketConfigurationRecord[];
  existingTickets: TicketRecord[];
  initialProjectId: string | null;
  submitLabel?: string;
  saving?: boolean;
  onSubmit: (payload: TicketCreatePayload) => Promise<void>;
  onCancel: () => void;
};

export function TicketCreateForm({
  viewKey,
  projects,
  customers,
  assignableUsers,
  ticketConfigurations,
  existingTickets,
  initialProjectId,
  submitLabel = 'Create ticket',
  saving = false,
  onSubmit,
  onCancel,
}: TicketCreateFormProps) {
  const [formError, setFormError] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ticketType, setTicketType] = useState<TicketType>('service_request');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<Date | null>(null);

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

  const projectOptions = useMemo(() => projects.map((p) => ({ label: p.name, value: p.id })), [projects]);

  const assigneeOptions = useMemo(
    () => [{ label: 'Unassigned', value: null }, ...assignableUsers.map((u) => ({ label: `${u.name} (${u.employee_id})`, value: u.id }))],
    [assignableUsers],
  );

  const customerOptions = useMemo(
    () => [{ label: 'None', value: null }, ...customers.map((c) => ({ label: c.name, value: c.id }))],
    [customers],
  );

  const nextRefPreview = useMemo(() => {
    if (!projectId) {
      return null;
    }
    return previewNextReference(projectId, ticketType, existingTickets, ticketConfigurations);
  }, [projectId, ticketType, existingTickets, ticketConfigurations]);

  useEffect(() => {
    const first = initialProjectId && projects.some((p) => p.id === initialProjectId) ? initialProjectId : projects[0]?.id ?? null;
    setProjectId(first);
    setTitle('');
    setDescription('');
    setTicketType('service_request');
    setPriority('medium');
    setAssigneeId(null);
    setCustomerId(null);
    setDueDate(null);
    setFormError('');
  }, [initialProjectId, projects]);

  async function handleSubmit() {
    if (!projectId) {
      setFormError('Select a project.');
      return;
    }
    if (!title.trim()) {
      setFormError('Enter a title.');
      return;
    }
    setFormError('');
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || null,
        type: ticketType,
        priority,
        project_id: projectId,
        assigned_to: assigneeId,
        customer_id: customerId,
        due_date: dueDate ? toYmd(dueDate) : null,
      });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create ticket');
    }
  }

  return (
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
          <Button type="button" label="Close" severity="secondary" outlined onClick={onCancel} disabled={saving} />
          <Button
            type="button"
            label={saving ? 'Saving…' : submitLabel}
            icon="pi pi-check"
            onClick={() => void handleSubmit()}
            disabled={saving}
          />
        </div>
      </div>
    </div>
  );
}
