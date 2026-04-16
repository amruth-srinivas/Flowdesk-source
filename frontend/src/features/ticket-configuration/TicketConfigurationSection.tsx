import { motion } from 'framer-motion';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { FloatLabel } from 'primereact/floatlabel';
import { InputText } from 'primereact/inputtext';
import { Tag } from 'primereact/tag';
import { useMemo, useState } from 'react';
import type { TicketConfigurationRecord, TicketTypeValue } from '../../lib/api';

const ALL_TICKET_TYPES: TicketTypeValue[] = [
  'bug_fix',
  'feature_request',
  'service_request',
  'design_rework',
  'performance_issue',
  'security_vulnerability',
  'documentation',
];

export const TICKET_TYPE_LABELS: Record<TicketTypeValue, string> = {
  bug_fix: 'Bug Fix',
  feature_request: 'Feature Request',
  service_request: 'Service Request',
  design_rework: 'Design Rework',
  performance_issue: 'Performance Issue',
  security_vulnerability: 'Security Vulnerability',
  documentation: 'Documentation',
};

const SLUG_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;

function isBuiltinTicketType(t: string): t is TicketTypeValue {
  return (ALL_TICKET_TYPES as readonly string[]).includes(t);
}

function rowLabel(row: TicketConfigurationRecord): string {
  if (isBuiltinTicketType(row.ticket_type)) {
    return TICKET_TYPE_LABELS[row.ticket_type];
  }
  return row.display_name?.trim() || row.ticket_type;
}

type CreateMode = 'standard' | 'custom';

type TicketConfigurationSectionProps = {
  viewKey: string;
  rows: TicketConfigurationRecord[];
  isLoading: boolean;
  error: string;
  onCreate: (payload: { ticket_type: string; code: string; display_name?: string | null }) => Promise<void>;
  onUpdate: (id: string, code: string, display_name?: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function TicketConfigurationSection({
  viewKey,
  rows,
  isLoading,
  error,
  onCreate,
  onUpdate,
  onDelete,
}: TicketConfigurationSectionProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>('standard');
  const [editRow, setEditRow] = useState<TicketConfigurationRecord | null>(null);
  const [createType, setCreateType] = useState<TicketTypeValue | null>(null);
  const [customSlug, setCustomSlug] = useState('');
  const [customDisplayName, setCustomDisplayName] = useState('');
  const [createCode, setCreateCode] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const usedTypes = useMemo(() => new Set(rows.map((r) => r.ticket_type)), [rows]);

  const typeOptionsForCreate = useMemo(
    () =>
      ALL_TICKET_TYPES.filter((t) => !usedTypes.has(t)).map((value) => ({
        label: TICKET_TYPE_LABELS[value],
        value,
      })),
    [usedTypes],
  );

  function openCreate() {
    setFormError('');
    setCreateMode(typeOptionsForCreate.length ? 'standard' : 'custom');
    setCreateType(typeOptionsForCreate[0]?.value ?? null);
    setCustomSlug('');
    setCustomDisplayName('');
    setCreateCode('');
    setIsCreateOpen(true);
  }

  function normalizeSlugInput(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  }

  async function submitCreate() {
    const code = createCode.trim();
    if (!code) {
      setFormError('Enter a code (e.g. SR, FR).');
      return;
    }

    if (createMode === 'standard') {
      if (!createType) {
        setFormError('Select a built-in ticket type, or switch to Custom type.');
        return;
      }
      setIsSaving(true);
      setFormError('');
      try {
        await onCreate({ ticket_type: createType, code });
        setIsCreateOpen(false);
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Unable to save');
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const slug = normalizeSlugInput(customSlug);
    if (!SLUG_PATTERN.test(slug)) {
      setFormError(
        'Custom type key must start with a letter and use lowercase letters, numbers, or underscores only (e.g. client_escalation).',
      );
      return;
    }
    if (usedTypes.has(slug)) {
      setFormError('This type key is already configured.');
      return;
    }
    if ((ALL_TICKET_TYPES as readonly string[]).includes(slug)) {
      setFormError('For standard types, switch to Built-in type and pick from the list.');
      return;
    }

    setIsSaving(true);
    setFormError('');
    try {
      await onCreate({
        ticket_type: slug,
        code,
        display_name: customDisplayName.trim() || null,
      });
      setIsCreateOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save');
    } finally {
      setIsSaving(false);
    }
  }

  function openEdit(row: TicketConfigurationRecord) {
    setFormError('');
    setEditRow(row);
    setEditCode(row.code);
    setEditDisplayName(row.display_name ?? '');
  }

  async function submitEdit() {
    if (!editRow || !editCode.trim()) {
      setFormError('Enter a code.');
      return;
    }
    setIsSaving(true);
    setFormError('');
    try {
      if (isBuiltinTicketType(editRow.ticket_type)) {
        await onUpdate(editRow.id, editCode.trim());
      } else {
        await onUpdate(editRow.id, editCode.trim(), editDisplayName.trim() || null);
      }
      setEditRow(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(row: TicketConfigurationRecord) {
    if (!window.confirm(`Remove configuration for ${rowLabel(row)}?`)) {
      return;
    }
    try {
      await onDelete(row.id);
    } catch {
      // parent can surface toast
    }
  }

  return (
    <motion.article key={viewKey} className="page-card user-management-page" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <div className="user-table-shell">
        <div className="user-table-toolbar">
          <div>
            <h2 style={{ margin: 0, fontSize: '15px' }}>Ticket type codes</h2>
            <p style={{ margin: '4px 0 0', color: '#62749a', fontSize: '12px' }}>
              Map each ticket type to a short code (e.g. Service Request → SR). Use Custom type for org-specific categories. Used when generating ticket identifiers.
            </p>
          </div>
          <div className="project-page-actions">
            <Button label="Add mapping" icon="pi pi-plus" onClick={openCreate} />
          </div>
        </div>

        {error ? <small className="error-text">{error}</small> : null}

        <DataTable
          value={rows}
          loading={isLoading}
          paginator
          rows={10}
          className="user-table tc-type-codes-table"
          emptyMessage="No ticket type codes configured yet."
        >
          <Column
            header="Ticket type"
            body={(row: TicketConfigurationRecord) => (
              <div className="user-name-cell">
                <strong>{rowLabel(row)}</strong>
                <span className="muted-cell">{row.ticket_type}</span>
              </div>
            )}
          />
          <Column
            header="Code"
            align="center"
            alignHeader="center"
            body={(row: TicketConfigurationRecord) => <Tag value={row.code} severity="info" rounded />}
          />
          <Column
            header="Actions"
            align="center"
            alignHeader="center"
            body={(row: TicketConfigurationRecord) => (
              <div className="user-actions-cell">
                <Button type="button" label="Edit" icon="pi pi-pencil" severity="secondary" text onClick={() => openEdit(row)} />
                <Button type="button" label="Delete" icon="pi pi-trash" text severity="danger" onClick={() => void handleDelete(row)} />
              </div>
            )}
          />
        </DataTable>
      </div>

      <Dialog header="Add ticket type code" visible={isCreateOpen} onHide={() => setIsCreateOpen(false)} className="project-dialog" modal>
        <div className="user-form">
          <div className="project-view-toggle tc-type-mode-toggle" role="tablist" aria-label="Ticket type source">
            <button type="button" className={createMode === 'standard' ? 'active' : ''} onClick={() => setCreateMode('standard')}>
              Built-in type
            </button>
            <button type="button" className={createMode === 'custom' ? 'active' : ''} onClick={() => setCreateMode('custom')}>
              Custom type
            </button>
          </div>

          {createMode === 'standard' ? (
            <div className="form-grid">
              <div className="p-inputgroup">
                <span className="p-inputgroup-addon">
                  <i className="pi pi-tag" />
                </span>
                <FloatLabel className="user-float-field">
                  <Dropdown
                    id="tc-type"
                    value={createType}
                    options={typeOptionsForCreate}
                    onChange={(e) => setCreateType(e.value as TicketTypeValue)}
                    className="full-width"
                    placeholder="Select a type"
                  />
                  <label htmlFor="tc-type">Ticket type</label>
                </FloatLabel>
              </div>
              {typeOptionsForCreate.length === 0 ? (
                <small className="helper-text">All built-in types are already mapped. Use Custom type to add another.</small>
              ) : null}
            </div>
          ) : (
            <div className="form-grid">
              <div className="p-inputgroup">
                <span className="p-inputgroup-addon">
                  <i className="pi pi-sliders-h" />
                </span>
                <FloatLabel className="user-float-field">
                  <InputText
                    id="tc-custom-slug"
                    value={customSlug}
                    onChange={(e) => setCustomSlug(normalizeSlugInput(e.target.value))}
                    maxLength={80}
                  />
                  <label htmlFor="tc-custom-slug">Type key (slug)</label>
                </FloatLabel>
              </div>
              <small className="helper-text">Unique ID: lowercase, e.g. client_escalation, l2_support.</small>
              <div className="p-inputgroup">
                <span className="p-inputgroup-addon">
                  <i className="pi pi-bookmark" />
                </span>
                <FloatLabel className="user-float-field">
                  <InputText
                    id="tc-custom-label"
                    value={customDisplayName}
                    onChange={(e) => setCustomDisplayName(e.target.value)}
                    maxLength={150}
                  />
                  <label htmlFor="tc-custom-label">Display name (optional)</label>
                </FloatLabel>
              </div>
            </div>
          )}

          <div className="p-inputgroup">
            <span className="p-inputgroup-addon">
              <i className="pi pi-hashtag" />
            </span>
            <FloatLabel className="user-float-field">
              <InputText id="tc-code" value={createCode} onChange={(e) => setCreateCode(e.target.value)} maxLength={20} />
              <label htmlFor="tc-code">Code (e.g. SR, FR)</label>
            </FloatLabel>
          </div>

          {formError ? <small className="error-text">{formError}</small> : null}
          <div className="dialog-actions">
            <Button type="button" label="Cancel" text onClick={() => setIsCreateOpen(false)} />
            <Button type="button" label={isSaving ? 'Saving...' : 'Save'} loading={isSaving} onClick={() => void submitCreate()} />
          </div>
        </div>
      </Dialog>

      <Dialog
        header={editRow ? `Edit code: ${rowLabel(editRow)}` : 'Edit'}
        visible={Boolean(editRow)}
        onHide={() => setEditRow(null)}
        className="user-dialog"
        modal
      >
        <div className="user-form">
          <div className="form-grid">
            <div className="p-inputgroup">
              <span className="p-inputgroup-addon">
                <i className="pi pi-hashtag" />
              </span>
              <FloatLabel className="user-float-field">
                <InputText id="tc-edit-code" value={editCode} onChange={(e) => setEditCode(e.target.value)} maxLength={20} />
                <label htmlFor="tc-edit-code">Code</label>
              </FloatLabel>
            </div>
            {editRow && !isBuiltinTicketType(editRow.ticket_type) ? (
              <div className="p-inputgroup">
                <span className="p-inputgroup-addon">
                  <i className="pi pi-bookmark" />
                </span>
                <FloatLabel className="user-float-field">
                  <InputText
                    id="tc-edit-display"
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    maxLength={150}
                  />
                  <label htmlFor="tc-edit-display">Display name</label>
                </FloatLabel>
              </div>
            ) : null}
          </div>
          {formError ? <small className="error-text">{formError}</small> : null}
          <div className="dialog-actions">
            <Button type="button" label="Cancel" text onClick={() => setEditRow(null)} />
            <Button type="button" label={isSaving ? 'Saving...' : 'Save'} loading={isSaving} onClick={() => void submitEdit()} />
          </div>
        </div>
      </Dialog>
    </motion.article>
  );
}
