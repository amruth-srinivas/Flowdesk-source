import { motion } from 'framer-motion';
import { Boxes, Mail } from 'lucide-react';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { FloatLabel } from 'primereact/floatlabel';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { MultiSelect } from 'primereact/multiselect';
import { Tag } from 'primereact/tag';
import type { CustomerContact, CustomerRecord, ProjectRecord } from '../../lib/api';

type CustomerManagementSectionProps = {
  viewKey: string;
  isCustomerDialogOpen: boolean;
  customerSearch: string;
  onCustomerSearchChange: (value: string) => void;
  onOpenCreateCustomerDialog: () => void;
  customerError: string;
  filteredCustomers: CustomerRecord[];
  isCustomersLoading: boolean;
  projects: ProjectRecord[];
  onOpenCustomerDetailDialog: (customer: CustomerRecord) => void;
  customerForm: any;
  setCustomerForm: any;
  onCloseCreateCustomerDialog: () => void;
  addCustomerContactRow: (mode: 'create' | 'detail') => void;
  updateCustomerContactRow: (index: number, field: keyof CustomerContact, value: string, mode: 'create' | 'detail') => void;
  removeCustomerContactRow: (index: number, mode: 'create' | 'detail') => void;
  customerFormError: string;
  isSavingCustomer: boolean;
  handleCreateCustomer: () => Promise<void>;
  isCustomerDetailOpen: boolean;
  selectedCustomer: any;
  isCustomerDetailEditing: boolean;
  setIsCustomerDetailEditing: (value: boolean) => void;
  setSelectedCustomer: any;
  cancelCustomerDetailEditing: () => void;
  handleUpdateCustomer: () => Promise<void>;
  setIsCustomerDetailOpen: (value: boolean) => void;
};

export function CustomerManagementSection(props: CustomerManagementSectionProps) {
  const {
    viewKey,
    isCustomerDialogOpen,
    customerSearch,
    onCustomerSearchChange,
    onOpenCreateCustomerDialog,
    customerError,
    filteredCustomers,
    isCustomersLoading,
    projects,
    onOpenCustomerDetailDialog,
    customerForm,
    setCustomerForm,
    onCloseCreateCustomerDialog,
    addCustomerContactRow,
    updateCustomerContactRow,
    removeCustomerContactRow,
    customerFormError,
    isSavingCustomer,
    handleCreateCustomer,
    isCustomerDetailOpen,
    selectedCustomer,
    isCustomerDetailEditing,
    setIsCustomerDetailEditing,
    setSelectedCustomer,
    cancelCustomerDetailEditing,
    handleUpdateCustomer,
    setIsCustomerDetailOpen,
  } = props;

  return (
    <motion.article key={viewKey} className="page-card user-management-page" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      {!isCustomerDialogOpen ? (
        <div className="user-table-shell">
          <div className="user-table-toolbar">
            <div />
            <div className="project-page-actions">
              <div className="table-search">
                <input placeholder="Search customers..." value={customerSearch} onChange={(event) => onCustomerSearchChange(event.target.value)} />
              </div>
              <Button label="Add Customer" icon="pi pi-plus" onClick={onOpenCreateCustomerDialog} />
            </div>
          </div>
          {customerError ? <small className="error-text">{customerError}</small> : null}
          <DataTable value={filteredCustomers} loading={isCustomersLoading} paginator rows={6} rowsPerPageOptions={[6, 10, 20]} className="user-table" emptyMessage="No customers found." onRowClick={(event) => onOpenCustomerDetailDialog(event.data as CustomerRecord)} rowClassName={() => 'clickable-row'}>
            <Column field="name" header="Customer" body={(customer: CustomerRecord) => <div className="user-name-cell"><strong>{customer.name}</strong><span>{customer.company || customer.email}</span></div>} />
            <Column field="email" header="Primary Email" body={(customer: CustomerRecord) => <span className="muted-cell">{customer.email}</span>} />
            <Column field="contacts" header="Contacts" body={(customer: CustomerRecord) => <span className="muted-cell">{customer.contacts.length || 0}</span>} />
            <Column field="project_ids" header="Projects" body={(customer: CustomerRecord) => <span className="muted-cell">{customer.project_ids.length ? customer.project_ids.slice(0, 2).map((projectId) => projects.find((project) => project.id === projectId)?.name ?? 'Linked Project').join(', ') : 'Not linked'}</span>} />
            <Column field="tags" header="Tags" body={(customer: CustomerRecord) => <div className="project-tag-list">{customer.tags.length ? customer.tags.slice(0, 3).map((tag) => <Tag key={tag} value={tag} severity="info" rounded />) : <span className="muted-cell">None</span>}</div>} />
          </DataTable>
        </div>
      ) : null}

      {isCustomerDialogOpen ? (
        <section className="customer-create-page">
          <div className="customer-create-header">
            <h2>Create Customer</h2>
            <button type="button" className="customer-create-close-btn" onClick={onCloseCreateCustomerDialog} aria-label="Close create customer form"><i className="pi pi-times" /></button>
          </div>
          <div className="user-form customer-create-form">
            <div className="form-grid customer-create-grid">
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-building" /></span><FloatLabel className="user-float-field"><InputText id="customer-name" value={customerForm.name} onChange={(event) => setCustomerForm((current: any) => ({ ...current, name: event.target.value }))} /><label htmlFor="customer-name">Customer name</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><Mail size={16} /></span><FloatLabel className="user-float-field"><InputText id="customer-email" value={customerForm.email} onChange={(event) => setCustomerForm((current: any) => ({ ...current, email: event.target.value }))} /><label htmlFor="customer-email">Primary email</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-briefcase" /></span><FloatLabel className="user-float-field"><InputText id="customer-company" value={customerForm.company} onChange={(event) => setCustomerForm((current: any) => ({ ...current, company: event.target.value }))} /><label htmlFor="customer-company">Company</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-phone" /></span><FloatLabel className="user-float-field"><InputText id="customer-phone" value={customerForm.phone} onChange={(event) => setCustomerForm((current: any) => ({ ...current, phone: event.target.value }))} /><label htmlFor="customer-phone">Phone</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-globe" /></span><FloatLabel className="user-float-field"><InputText id="customer-timezone" value={customerForm.timezone} onChange={(event) => setCustomerForm((current: any) => ({ ...current, timezone: event.target.value }))} /><label htmlFor="customer-timezone">Timezone</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-hashtag" /></span><FloatLabel className="user-float-field"><MultiSelect id="customer-tags" value={customerForm.tags} options={['Enterprise', 'Priority', 'Renewal', 'Support', 'Implementation', 'Finance'].map((tag) => ({ label: tag, value: tag }))} onChange={(event) => setCustomerForm((current: any) => ({ ...current, tags: event.value as string[] }))} display="chip" className="full-width" /><label htmlFor="customer-tags">Tags</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><Boxes size={16} /></span><FloatLabel className="user-float-field"><MultiSelect id="customer-projects" value={customerForm.projectIds} options={projects.map((project) => ({ label: project.name, value: project.id }))} onChange={(event) => setCustomerForm((current: any) => ({ ...current, projectIds: event.value as string[] }))} display="chip" className="full-width" /><label htmlFor="customer-projects">Linked projects</label></FloatLabel></div>
              <div className="p-inputgroup project-textarea-row customer-create-notes"><span className="p-inputgroup-addon"><i className="pi pi-align-left" /></span><FloatLabel className="user-float-field"><InputTextarea id="customer-notes" value={customerForm.notes} onChange={(event) => setCustomerForm((current: any) => ({ ...current, notes: event.target.value }))} rows={4} autoResize /><label htmlFor="customer-notes">Notes</label></FloatLabel></div>
            </div>
            <div className="customer-contacts-block">
              <div className="customer-contacts-header"><h4>Contact Members</h4><Button type="button" label="Add Contact" text onClick={() => addCustomerContactRow('create')} /></div>
              {customerForm.contacts.map((contact: CustomerContact, index: number) => <div key={`create-contact-${index}`} className="customer-contact-row"><InputText value={contact.name} placeholder="Name" onChange={(event) => updateCustomerContactRow(index, 'name', event.target.value, 'create')} /><InputText value={contact.role ?? ''} placeholder="Role" onChange={(event) => updateCustomerContactRow(index, 'role', event.target.value, 'create')} /><InputText value={contact.email ?? ''} placeholder="Email" onChange={(event) => updateCustomerContactRow(index, 'email', event.target.value, 'create')} /><InputText value={contact.phone ?? ''} placeholder="Phone" onChange={(event) => updateCustomerContactRow(index, 'phone', event.target.value, 'create')} /><Button type="button" icon="pi pi-trash" text onClick={() => removeCustomerContactRow(index, 'create')} /></div>)}
            </div>
            {customerFormError ? <small className="error-text">{customerFormError}</small> : null}
            <div className="dialog-actions"><Button type="button" label="Cancel" text onClick={onCloseCreateCustomerDialog} /><Button type="button" label={isSavingCustomer ? 'Creating...' : 'Create Customer'} loading={isSavingCustomer} onClick={() => void handleCreateCustomer()} /></div>
          </div>
        </section>
      ) : null}

      <Dialog header={selectedCustomer ? `Customer Details: ${selectedCustomer.name}` : 'Customer Details'} visible={isCustomerDetailOpen} onHide={() => { cancelCustomerDetailEditing(); setIsCustomerDetailOpen(false); }} className="customer-detail-dialog" modal draggable={false} resizable={false}>
        {selectedCustomer ? (
          <div className="user-form project-detail-form">
            <div className="form-grid project-detail-grid">
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-building" /></span><FloatLabel className="user-float-field"><InputText id="detail-customer-name" value={selectedCustomer.name} disabled={!isCustomerDetailEditing} onChange={(event) => setSelectedCustomer((current: any) => (current ? { ...current, name: event.target.value } : current))} /><label htmlFor="detail-customer-name">Customer name</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><Mail size={16} /></span><FloatLabel className="user-float-field"><InputText id="detail-customer-email" value={selectedCustomer.email} disabled={!isCustomerDetailEditing} onChange={(event) => setSelectedCustomer((current: any) => (current ? { ...current, email: event.target.value } : current))} /><label htmlFor="detail-customer-email">Primary email</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-briefcase" /></span><FloatLabel className="user-float-field"><InputText id="detail-customer-company" value={selectedCustomer.company ?? ''} disabled={!isCustomerDetailEditing} onChange={(event) => setSelectedCustomer((current: any) => (current ? { ...current, company: event.target.value } : current))} /><label htmlFor="detail-customer-company">Company</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-phone" /></span><FloatLabel className="user-float-field"><InputText id="detail-customer-phone" value={selectedCustomer.phone ?? ''} disabled={!isCustomerDetailEditing} onChange={(event) => setSelectedCustomer((current: any) => (current ? { ...current, phone: event.target.value } : current))} /><label htmlFor="detail-customer-phone">Phone</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-globe" /></span><FloatLabel className="user-float-field"><InputText id="detail-customer-timezone" value={selectedCustomer.timezone ?? ''} disabled={!isCustomerDetailEditing} onChange={(event) => setSelectedCustomer((current: any) => (current ? { ...current, timezone: event.target.value } : current))} /><label htmlFor="detail-customer-timezone">Timezone</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-hashtag" /></span><FloatLabel className="user-float-field"><MultiSelect id="detail-customer-tags" value={selectedCustomer.tags} disabled={!isCustomerDetailEditing} options={['Enterprise', 'Priority', 'Renewal', 'Support', 'Implementation', 'Finance'].map((tag) => ({ label: tag, value: tag }))} onChange={(event) => setSelectedCustomer((current: any) => (current ? { ...current, tags: event.value as string[] } : current))} display="chip" className="full-width" /><label htmlFor="detail-customer-tags">Tags</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><Boxes size={16} /></span><FloatLabel className="user-float-field"><MultiSelect id="detail-customer-projects" value={selectedCustomer.project_ids} disabled={!isCustomerDetailEditing} options={projects.map((project) => ({ label: project.name, value: project.id }))} onChange={(event) => setSelectedCustomer((current: any) => (current ? { ...current, project_ids: event.value as string[] } : current))} display="chip" className="full-width" /><label htmlFor="detail-customer-projects">Linked projects</label></FloatLabel></div>
              <div className="p-inputgroup project-textarea-row"><span className="p-inputgroup-addon"><i className="pi pi-align-left" /></span><FloatLabel className="user-float-field"><InputTextarea id="detail-customer-notes" value={selectedCustomer.notes ?? ''} disabled={!isCustomerDetailEditing} onChange={(event) => setSelectedCustomer((current: any) => (current ? { ...current, notes: event.target.value } : current))} rows={4} autoResize /><label htmlFor="detail-customer-notes">Notes</label></FloatLabel></div>
            </div>
            <div className="customer-contacts-block">
              <div className="customer-contacts-header"><h4>Contact Members</h4>{isCustomerDetailEditing ? <Button type="button" label="Add Contact" text onClick={() => addCustomerContactRow('detail')} /> : null}</div>
              {selectedCustomer.contacts.map((contact: CustomerContact, index: number) => <div key={`detail-contact-${index}`} className="customer-contact-row"><InputText value={contact.name} placeholder="Name" disabled={!isCustomerDetailEditing} onChange={(event) => updateCustomerContactRow(index, 'name', event.target.value, 'detail')} /><InputText value={contact.role ?? ''} placeholder="Role" disabled={!isCustomerDetailEditing} onChange={(event) => updateCustomerContactRow(index, 'role', event.target.value, 'detail')} /><InputText value={contact.email ?? ''} placeholder="Email" disabled={!isCustomerDetailEditing} onChange={(event) => updateCustomerContactRow(index, 'email', event.target.value, 'detail')} /><InputText value={contact.phone ?? ''} placeholder="Phone" disabled={!isCustomerDetailEditing} onChange={(event) => updateCustomerContactRow(index, 'phone', event.target.value, 'detail')} />{isCustomerDetailEditing ? <Button type="button" icon="pi pi-trash" text onClick={() => removeCustomerContactRow(index, 'detail')} /> : null}</div>)}
            </div>
            {customerFormError ? <small className="error-text">{customerFormError}</small> : null}
            <div className="dialog-actions project-detail-actions">
              {!isCustomerDetailEditing ? <Button type="button" icon="pi pi-pencil" label="Edit" text onClick={() => setIsCustomerDetailEditing(true)} /> : <Button type="button" icon="pi pi-times" label="Cancel Edit" text onClick={cancelCustomerDetailEditing} />}
              <Button type="button" label="Close" text onClick={() => { cancelCustomerDetailEditing(); setIsCustomerDetailOpen(false); }} />
              {isCustomerDetailEditing ? <Button type="button" label={isSavingCustomer ? 'Saving...' : 'Save Customer'} loading={isSavingCustomer} onClick={() => void handleUpdateCustomer()} /> : null}
            </div>
          </div>
        ) : null}
      </Dialog>
    </motion.article>
  );
}
