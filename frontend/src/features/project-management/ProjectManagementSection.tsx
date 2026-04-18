import { motion } from 'framer-motion';
import { Boxes, Users } from 'lucide-react';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { FloatLabel } from 'primereact/floatlabel';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { MultiSelect } from 'primereact/multiselect';
import { Steps } from 'primereact/steps';
import { Tag } from 'primereact/tag';
import type { ProjectRecord, ProjectStatus } from '../../lib/api';

type ProjectManagementSectionProps = {
  viewKey: string;
  projectViewMode: 'table' | 'kanban';
  setProjectViewMode: (mode: 'table' | 'kanban') => void;
  projectSearch: string;
  setProjectSearch: (value: string) => void;
  openCreateProjectDialog: () => void;
  projectError: string;
  filteredProjects: ProjectRecord[];
  isProjectsLoading: boolean;
  openProjectDetailDialog: (project: ProjectRecord) => void;
  userLookup: Map<string, any>;
  projectStatusSeverities: Record<ProjectStatus, 'success' | 'warning' | 'info' | 'contrast'>;
  projectsByStatus: Array<{ label: string; value: ProjectStatus; projects: ProjectRecord[] }>;
  isProjectDialogOpen: boolean;
  setIsProjectDialogOpen: (open: boolean) => void;
  projectStep: 0 | 1;
  goToProjectStep: (step: 0 | 1) => void;
  projectForm: any;
  setProjectForm: any;
  projectStatusOptions: Array<{ label: string; value: ProjectStatus }>;
  leadOptions: Array<{ label: string; value: string }>;
  memberOptions: Array<{ label: string; value: string }>;
  projectFormError: string;
  isSavingProject: boolean;
  handleCreateProject: () => Promise<void>;
  setProjectStep: (step: 0 | 1) => void;
  isProjectDetailOpen: boolean;
  setIsProjectDetailOpen: (open: boolean) => void;
  selectedProject: any;
  isProjectDetailEditing: boolean;
  setIsProjectDetailEditing: (editing: boolean) => void;
  setSelectedProject: any;
  projectDetailMemberOptions: Array<{ label: string; value: string }>;
  cancelProjectDetailEditing: () => void;
  projectDetailError: string;
  isSavingProjectDetail: boolean;
  handleUpdateProject: () => Promise<void>;
};

export function ProjectManagementSection(props: ProjectManagementSectionProps) {
  const {
    viewKey, projectViewMode, setProjectViewMode, projectSearch, setProjectSearch, openCreateProjectDialog, projectError, filteredProjects, isProjectsLoading,
    openProjectDetailDialog, userLookup, projectStatusSeverities, projectsByStatus, isProjectDialogOpen, setIsProjectDialogOpen, projectStep, goToProjectStep,
    projectForm, setProjectForm, projectStatusOptions, leadOptions, memberOptions, projectFormError, isSavingProject, handleCreateProject, setProjectStep,
    isProjectDetailOpen, setIsProjectDetailOpen, selectedProject, isProjectDetailEditing, setIsProjectDetailEditing, setSelectedProject,
    projectDetailMemberOptions, cancelProjectDetailEditing, projectDetailError, isSavingProjectDetail, handleUpdateProject,
  } = props;

  return (
    <motion.article key={viewKey} className="page-card user-management-page" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <section className="project-workspace">
        <div className="project-toolbar-card">
          <div />
          <div className="project-page-actions">
            <div className="project-view-toggle" role="tablist" aria-label="Project view selector">
              <button type="button" className={projectViewMode === 'table' ? 'active' : ''} onClick={() => setProjectViewMode('table')}>Table</button>
              <button type="button" className={projectViewMode === 'kanban' ? 'active' : ''} onClick={() => setProjectViewMode('kanban')}>Kanban</button>
            </div>
            <div className="table-search"><input placeholder="Search projects..." value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} /></div>
            <Button label="Add Project" icon="pi pi-plus" onClick={openCreateProjectDialog} />
          </div>
        </div>
        {projectError ? <small className="error-text">{projectError}</small> : null}

        {projectViewMode === 'table' ? (
          <div className="user-table-shell project-shell">
            <DataTable
              value={filteredProjects}
              loading={isProjectsLoading}
              paginator
              paginatorDropdownAppendTo="self"
              rows={6}
              rowsPerPageOptions={[6, 10, 20]}
              className="user-table"
              emptyMessage="No projects found."
              onRowClick={(event) => openProjectDetailDialog(event.data as ProjectRecord)}
              rowClassName={() => 'clickable-row'}
            >
              <Column field="name" header="Project" body={(project: ProjectRecord) => <div className="user-name-cell"><strong>{project.name}</strong><span>{project.description || 'No description added yet.'}</span></div>} />
              <Column field="status" header="Status" body={(project: ProjectRecord) => <Tag value={project.status.replace('-', ' ')} severity={projectStatusSeverities[project.status]} rounded />} />
              <Column field="lead_id" header="Team Lead" body={(project: ProjectRecord) => <span className="muted-cell">{project.lead_id ? userLookup.get(project.lead_id)?.name ?? 'Assigned user' : 'Not assigned'}</span>} />
              <Column field="tech_tags" header="Tech Tags" body={(project: ProjectRecord) => <div className="project-tag-list">{project.tech_tags.length ? project.tech_tags.slice(0, 3).map((tag) => <Tag key={tag} value={tag} severity="info" rounded />) : <span className="muted-cell">None</span>}</div>} />
              <Column field="created_at" header="Created" body={(project: ProjectRecord) => <span className="muted-cell">{new Date(project.created_at).toLocaleDateString()}</span>} />
            </DataTable>
          </div>
        ) : (
          <div className="kanban-board">
            {projectsByStatus.map((statusGroup) => (
              <section key={statusGroup.value} className="kanban-column">
                <div className="kanban-column-header"><div><h4>{statusGroup.label}</h4><small>{statusGroup.projects.length} projects</small></div><Tag value={statusGroup.label} severity={projectStatusSeverities[statusGroup.value]} rounded /></div>
                <div className="kanban-column-body">
                  {statusGroup.projects.length ? statusGroup.projects.map((project) => (
                    <button key={project.id} type="button" className="kanban-card" onClick={() => openProjectDetailDialog(project)}>
                      <div className="kanban-card-top"><strong>{project.name}</strong><span>{new Date(project.created_at).toLocaleDateString()}</span></div>
                      <p>{project.description || 'No description added yet.'}</p>
                      <div className="kanban-meta"><small>Lead: {project.lead_id ? userLookup.get(project.lead_id)?.name ?? 'Assigned user' : 'Not assigned'}</small></div>
                      <div className="project-tag-list">{project.tech_tags.length ? project.tech_tags.slice(0, 3).map((tag) => <Tag key={tag} value={tag} severity="info" rounded />) : <span className="muted-cell">No tags</span>}</div>
                    </button>
                  )) : <div className="kanban-empty">No projects in this lane.</div>}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      <Dialog header="Create Project" visible={isProjectDialogOpen} onHide={() => setIsProjectDialogOpen(false)} className="project-dialog" modal>
        <div className="user-form">
          <Steps model={[{ label: 'Project Details' }, { label: 'Team Assignment' }]} activeIndex={projectStep} readOnly={false} onSelect={(event) => { event.originalEvent.preventDefault(); event.originalEvent.stopPropagation(); goToProjectStep(event.index as 0 | 1); }} className="project-steps" />
          {projectStep === 0 ? (
            <div className="form-grid">
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><Boxes size={16} /></span><FloatLabel className="user-float-field"><InputText id="project-name" value={projectForm.name} onChange={(event) => setProjectForm((current: any) => ({ ...current, name: event.target.value }))} /><label htmlFor="project-name">Project name</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-flag" /></span><FloatLabel className="user-float-field"><Dropdown id="project-status" value={projectForm.status} options={projectStatusOptions} onChange={(event) => setProjectForm((current: any) => ({ ...current, status: event.value as ProjectStatus }))} className="full-width" /><label htmlFor="project-status">Project status</label></FloatLabel></div>
              <div className="p-inputgroup project-textarea-row"><span className="p-inputgroup-addon"><i className="pi pi-align-left" /></span><FloatLabel className="user-float-field"><InputTextarea id="project-description" value={projectForm.description} onChange={(event) => setProjectForm((current: any) => ({ ...current, description: event.target.value }))} rows={4} autoResize /><label htmlFor="project-description">Project description</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-hashtag" /></span><FloatLabel className="user-float-field"><MultiSelect id="project-tags" value={projectForm.techTags} options={['React', 'TypeScript', 'FastAPI', 'PostgreSQL', 'Docker', 'Node.js', 'Python', 'UI/UX', 'DevOps'].map((tag) => ({ label: tag, value: tag }))} onChange={(event) => setProjectForm((current: any) => ({ ...current, techTags: event.value as string[] }))} display="chip" placeholder="Choose tech tags" className="full-width" /><label htmlFor="project-tags">Tech tags</label></FloatLabel></div>
            </div>
          ) : (
            <div className="form-grid">
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-user" /></span><FloatLabel className="user-float-field"><Dropdown id="project-lead" value={projectForm.leadId} options={[{ label: 'Assign later', value: '' }, ...leadOptions]} onChange={(event) => setProjectForm((current: any) => ({ ...current, leadId: event.value as string, memberIds: current.memberIds.filter((memberId: string) => memberId !== event.value) }))} className="full-width" /><label htmlFor="project-lead">Team lead</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><Users size={16} /></span><FloatLabel className="user-float-field"><MultiSelect id="project-members" value={projectForm.memberIds} options={memberOptions} onChange={(event) => setProjectForm((current: any) => ({ ...current, memberIds: event.value as string[] }))} display="chip" placeholder="Select project members" className="full-width" /><label htmlFor="project-members">Team members</label></FloatLabel></div>
              <div className="project-summary-card"><h4>Project summary</h4><p>{projectForm.name || 'Untitled project'}</p><small>Status: {projectForm.status.replace('-', ' ')}</small><small>Lead: {projectForm.leadId ? userLookup.get(projectForm.leadId)?.name ?? 'Assigned user' : 'Not assigned'}</small><small>Members: {projectForm.memberIds.length}</small></div>
            </div>
          )}
          {projectFormError ? <small className="error-text">{projectFormError}</small> : null}
          <div className="dialog-actions">{projectStep === 1 ? <Button type="button" label="Back" text onClick={() => setProjectStep(0)} /> : null}{projectStep === 0 ? <Button type="button" label="Next" onClick={() => goToProjectStep(1)} /> : <Button type="button" label={isSavingProject ? 'Creating...' : 'Create Project'} loading={isSavingProject} onClick={() => void handleCreateProject()} />}</div>
        </div>
      </Dialog>

      <Dialog header={selectedProject ? `Project Details: ${selectedProject.name}` : 'Project Details'} visible={isProjectDetailOpen} onHide={() => { setIsProjectDetailEditing(false); setIsProjectDetailOpen(false); }} className="project-detail-dialog" position="right" modal draggable={false} resizable={false}>
        {selectedProject ? (
          <div className="user-form project-detail-form">
            <div className="form-grid project-detail-grid">
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><Boxes size={16} /></span><FloatLabel className="user-float-field"><InputText id="detail-project-name" value={selectedProject.name} disabled={!isProjectDetailEditing} onChange={(event) => setSelectedProject((current: any) => (current ? { ...current, name: event.target.value } : current))} /><label htmlFor="detail-project-name">Project name</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-flag" /></span><FloatLabel className="user-float-field"><Dropdown id="detail-project-status" value={selectedProject.status} options={projectStatusOptions} disabled={!isProjectDetailEditing} onChange={(event) => setSelectedProject((current: any) => current ? { ...current, status: event.value as ProjectStatus } : current)} className="full-width" /><label htmlFor="detail-project-status">Status</label></FloatLabel></div>
              <div className="p-inputgroup project-textarea-row project-detail-span-2"><span className="p-inputgroup-addon"><i className="pi pi-align-left" /></span><FloatLabel className="user-float-field"><InputTextarea id="detail-project-description" value={selectedProject.description ?? ''} disabled={!isProjectDetailEditing} onChange={(event) => setSelectedProject((current: any) => current ? { ...current, description: event.target.value } : current)} rows={5} autoResize /><label htmlFor="detail-project-description">Description</label></FloatLabel></div>
              <div className="p-inputgroup project-detail-span-2"><span className="p-inputgroup-addon"><i className="pi pi-hashtag" /></span><FloatLabel className="user-float-field"><MultiSelect id="detail-project-tags" value={selectedProject.tech_tags} disabled={!isProjectDetailEditing} options={['React', 'TypeScript', 'FastAPI', 'PostgreSQL', 'Docker', 'Node.js', 'Python', 'UI/UX', 'DevOps'].map((tag) => ({ label: tag, value: tag }))} onChange={(event) => setSelectedProject((current: any) => current ? { ...current, tech_tags: event.value as string[] } : current)} display="chip" className="full-width" /><label htmlFor="detail-project-tags">Tech tags</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-user" /></span><FloatLabel className="user-float-field"><Dropdown id="detail-project-lead" value={selectedProject.lead_id ?? ''} options={[{ label: 'Assign later', value: '' }, ...leadOptions]} disabled={!isProjectDetailEditing} onChange={(event) => setSelectedProject((current: any) => current ? { ...current, lead_id: (event.value as string) || null, member_ids: current.member_ids.filter((memberId: string) => memberId !== event.value) } : current)} className="full-width" /><label htmlFor="detail-project-lead">Team lead</label></FloatLabel></div>
              <div className="p-inputgroup"><span className="p-inputgroup-addon"><Users size={16} /></span><FloatLabel className="user-float-field"><MultiSelect id="detail-project-members" value={selectedProject.member_ids} options={projectDetailMemberOptions} disabled={!isProjectDetailEditing} onChange={(event) => setSelectedProject((current: any) => current ? { ...current, member_ids: event.value as string[] } : current)} display="chip" className="full-width" /><label htmlFor="detail-project-members">Team members</label></FloatLabel></div>
            </div>
            {projectDetailError ? <small className="error-text">{projectDetailError}</small> : null}
            <div className="dialog-actions project-detail-actions">
              {!isProjectDetailEditing ? <Button type="button" icon="pi pi-pencil" label="Edit" text onClick={() => setIsProjectDetailEditing(true)} /> : <Button type="button" icon="pi pi-times" label="Cancel Edit" text onClick={cancelProjectDetailEditing} />}
              <Button type="button" label="Close" text onClick={() => { cancelProjectDetailEditing(); setIsProjectDetailOpen(false); }} />
              {isProjectDetailEditing ? <Button type="button" label={isSavingProjectDetail ? 'Saving...' : 'Save Project'} loading={isSavingProjectDetail} onClick={() => void handleUpdateProject()} /> : null}
            </div>
          </div>
        ) : null}
      </Dialog>
    </motion.article>
  );
}
