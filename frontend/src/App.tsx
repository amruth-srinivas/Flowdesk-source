import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpenText,
  Boxes,
  CalendarDays,
  FileText,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { FloatLabel } from 'primereact/floatlabel';
import { InputTextarea } from 'primereact/inputtextarea';
import { InputSwitch } from 'primereact/inputswitch';
import { InputText } from 'primereact/inputtext';
import { MultiSelect } from 'primereact/multiselect';
import { Steps } from 'primereact/steps';
import { Tag } from 'primereact/tag';
import {
  createProjectRequest,
  createUserRequest,
  getProjectsRequest,
  getUsersRequest,
  loginRequest,
  type ProjectRecord,
  type ProjectStatus,
  updateProjectRequest,
  updateUserPasswordRequest,
  updateUserRequest,
} from './lib/api';
import type { BackendRole, UserRecord } from './lib/api';

type Role = 'admin' | 'teamLead' | 'teamMember';
type TopPage = 'projects' | 'knowledgeBase' | 'calendar' | 'tickets' | 'kb';
type UserDialogMode = 'create' | 'edit';
type ProjectFormStep = 0 | 1;

type NavItem = {
  id: TopPage;
  label: string;
  icon: ReactNode;
  modules: string[];
};

const roleTopNav: Record<Role, NavItem[]> = {
  admin: [
    { id: 'projects', label: 'Projects', icon: <FolderKanban size={17} />, modules: ['View', 'User Management'] },
    {
      id: 'knowledgeBase',
      label: 'Knowledge Base',
      icon: <BookOpenText size={17} />,
      modules: ['Configuration', 'Articles', 'Customers'],
    },
    { id: 'calendar', label: 'Calendar', icon: <CalendarDays size={17} />, modules: ['Add Event', 'View'] },
  ],
  teamLead: [
    { id: 'tickets', label: 'Tickets', icon: <FileText size={17} />, modules: ['Open Tickets', 'Assigned', 'Resolved'] },
    { id: 'kb', label: 'KB', icon: <BookOpenText size={17} />, modules: ['Search', 'Articles', 'Guidelines'] },
    { id: 'calendar', label: 'Calendar', icon: <CalendarDays size={17} />, modules: ['Add Event', 'View'] },
  ],
  teamMember: [
    { id: 'tickets', label: 'Tickets', icon: <FileText size={17} />, modules: ['My Tickets', 'Updates', 'History'] },
    { id: 'kb', label: 'KB', icon: <BookOpenText size={17} />, modules: ['Search', 'Articles', 'FAQs'] },
    { id: 'calendar', label: 'Calendar', icon: <CalendarDays size={17} />, modules: ['Add Event', 'View'] },
  ],
};

const roleLabels: Record<Role, string> = {
  admin: 'Administrator',
  teamLead: 'Team Lead',
  teamMember: 'Team Member',
};

const backendRoleOptions: Array<{ label: string; value: BackendRole }> = [
  { label: 'Administrator', value: 'ADMIN' },
  { label: 'Team Lead', value: 'LEAD' },
  { label: 'Team Member', value: 'MEMBER' },
];

const optionalRoleOptions = [{ label: 'Assign later', value: '' }, ...backendRoleOptions];

const backendRoleLabels: Record<BackendRole, string> = {
  ADMIN: 'Administrator',
  LEAD: 'Team Lead',
  MEMBER: 'Team Member',
};

const backendRoleSeverities: Record<BackendRole, 'danger' | 'warning' | 'info'> = {
  ADMIN: 'danger',
  LEAD: 'warning',
  MEMBER: 'info',
};

const initialCreateForm = {
  employeeId: '',
  name: '',
  email: '',
  password: '',
  role: '' as BackendRole | '',
};

const initialEditForm = {
  id: '',
  employeeId: '',
  name: '',
  email: '',
  role: 'MEMBER' as BackendRole,
  isActive: true,
};

const initialPasswordForm = {
  id: '',
  name: '',
  password: '',
  confirmPassword: '',
};

const projectStatusOptions: Array<{ label: string; value: ProjectStatus }> = [
  { label: 'Active', value: 'active' },
  { label: 'On Hold', value: 'on-hold' },
  { label: 'Completed', value: 'completed' },
  { label: 'Archived', value: 'archived' },
];

const projectStatusSeverities: Record<ProjectStatus, 'success' | 'warning' | 'info' | 'contrast'> = {
  active: 'success',
  'on-hold': 'warning',
  completed: 'info',
  archived: 'contrast',
};

const initialProjectForm = {
  name: '',
  description: '',
  status: 'active' as ProjectStatus,
  techTags: [] as string[],
  leadId: '',
  memberIds: [] as string[],
};

function App() {
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [role, setRole] = useState<Role>('admin');
  const [activePage, setActivePage] = useState<TopPage>('projects');
  const [activeModule, setActiveModule] = useState('');
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [userManagementError, setUserManagementError] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [dialogMode, setDialogMode] = useState<UserDialogMode>('create');
  const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [isProjectDetailOpen, setIsProjectDetailOpen] = useState(false);
  const [projectStep, setProjectStep] = useState<ProjectFormStep>(0);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isSavingProjectDetail, setIsSavingProjectDetail] = useState(false);
  const [projectFormError, setProjectFormError] = useState('');
  const [projectForm, setProjectForm] = useState(initialProjectForm);
  const [projectDetailError, setProjectDetailError] = useState('');
  const [selectedProject, setSelectedProject] = useState<ProjectRecord | null>(null);
  const [userFormError, setUserFormError] = useState('');
  const [passwordFormError, setPasswordFormError] = useState('');
  const [createForm, setCreateForm] = useState(initialCreateForm);
  const [editForm, setEditForm] = useState(initialEditForm);
  const [passwordForm, setPasswordForm] = useState(initialPasswordForm);

  const topNav = roleTopNav[role];
  const selectedPage = useMemo(
    () => topNav.find((item) => item.id === activePage) ?? topNav[0],
    [activePage, topNav],
  );
  const currentModule = activeModule || selectedPage.modules[0];
  const isUserManagementView = role === 'admin' && selectedPage.id === 'projects' && currentModule === 'User Management';
  const isProjectView = role === 'admin' && selectedPage.id === 'projects' && currentModule === 'View';

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) {
      return users;
    }

    return users.filter((user) =>
      [user.name, user.email, user.employee_id, backendRoleLabels[user.role]].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [userSearch, users]);

  const activeAssignableUsers = useMemo(() => users.filter((user) => user.is_active), [users]);

  const leadOptions = useMemo(
    () =>
      activeAssignableUsers.map((user) => ({
        label: `${user.name} (${user.employee_id})`,
        value: user.id,
      })),
    [activeAssignableUsers],
  );

  const memberOptions = useMemo(
    () =>
      activeAssignableUsers
        .filter((user) => user.id !== projectForm.leadId)
        .map((user) => ({
          label: `${user.name} (${user.employee_id})`,
          value: user.id,
        })),
    [activeAssignableUsers, projectForm.leadId],
  );

  const projectDetailMemberOptions = useMemo(
    () =>
      activeAssignableUsers
        .filter((user) => user.id !== selectedProject?.lead_id)
        .map((user) => ({
          label: `${user.name} (${user.employee_id})`,
          value: user.id,
        })),
    [activeAssignableUsers, selectedProject?.lead_id],
  );

  const userLookup = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const currentUserRecord = useMemo(
    () => users.find((user) => user.employee_id === employeeId) ?? null,
    [employeeId, users],
  );
  const currentUserName = currentUserRecord?.name ?? (employeeId === '1111' ? 'System Admin' : 'Current User');
  const currentUserIdentifier = currentUserRecord?.employee_id ?? employeeId ?? 'Not available';
  const currentUserAvatar = currentUserName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'FD';

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    if (!query) {
      return projects;
    }

    return projects.filter((project) => {
      const leadName = project.lead_id ? userLookup.get(project.lead_id)?.name ?? '' : '';
      return [project.name, project.description ?? '', project.status, leadName, project.tech_tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [projectSearch, projects, userLookup]);

  useEffect(() => {
    if (!isAuthenticated || role !== 'admin') {
      return;
    }

    void loadUsers();
    void loadProjects();
  }, [isAuthenticated, role]);

  async function loadUsers() {
    setIsUsersLoading(true);
    setUserManagementError('');
    try {
      const data = await getUsersRequest();
      setUsers(
        [...data].sort((left, right) => {
          if (left.is_active !== right.is_active) {
            return left.is_active ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        }),
      );
    } catch (error) {
      setUserManagementError(error instanceof Error ? error.message : 'Unable to load users');
    } finally {
      setIsUsersLoading(false);
    }
  }

  async function loadProjects() {
    setIsProjectsLoading(true);
    setProjectError('');
    try {
      const data = await getProjectsRequest();
      setProjects(
        [...data].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
      );
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Unable to load projects');
    } finally {
      setIsProjectsLoading(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeId.trim() || !password.trim()) {
      setLoginError('Please enter employee ID and password.');
      return;
    }
    setLoginError('');
    setIsSubmitting(true);
    try {
      const data = await loginRequest(employeeId.trim(), password);
      const nextRole: Role = data.role === 'ADMIN' ? 'admin' : data.role === 'LEAD' ? 'teamLead' : 'teamMember';
      localStorage.setItem('accessToken', data.access_token);
      localStorage.setItem('refreshToken', data.refresh_token);
      localStorage.setItem('role', data.role);
      setRole(nextRole);
      const defaultPage = roleTopNav[nextRole][0];
      setActivePage(defaultPage.id);
      setActiveModule(defaultPage.modules[0]);
      setIsAuthenticated(true);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to login');
    } finally {
      setIsSubmitting(false);
    }
  }

  function selectPage(page: NavItem) {
    setActivePage(page.id);
    setActiveModule(page.modules[0]);
  }

  function logout() {
    setIsAuthenticated(false);
    setPassword('');
    setEmployeeId('');
    setActiveModule('');
    setLoginError('');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('role');
  }

  function openCreateUserDialog() {
    setDialogMode('create');
    setCreateForm(initialCreateForm);
    setShowCreatePassword(false);
    setUserFormError('');
    setIsUserDialogOpen(true);
  }

  function openEditUserDialog(user: UserRecord) {
    setDialogMode('edit');
    setEditForm({
      id: user.id,
      employeeId: user.employee_id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.is_active,
    });
    setUserFormError('');
    setIsUserDialogOpen(true);
  }

  function openPasswordDialog(user: UserRecord) {
    setPasswordForm({
      id: user.id,
      name: user.name,
      password: '',
      confirmPassword: '',
    });
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setPasswordFormError('');
    setIsPasswordDialogOpen(true);
  }

  function openCreateProjectDialog() {
    setProjectForm(initialProjectForm);
    setProjectStep(0);
    setProjectFormError('');
    setIsProjectDialogOpen(true);
  }

  function openProjectDetailDialog(project: ProjectRecord) {
    setSelectedProject(project);
    setProjectDetailError('');
    setIsProjectDetailOpen(true);
  }

  function goToProjectStep(nextStep: ProjectFormStep) {
    if (nextStep === 1) {
      if (!projectForm.name.trim()) {
        setProjectFormError('Project name is required before moving to team assignment.');
        return;
      }
      if (!projectForm.status) {
        setProjectFormError('Select a project status to continue.');
        return;
      }
    }

    setProjectFormError('');
    setProjectStep(nextStep);
  }

  async function handleCreateProject() {
    if (!projectForm.name.trim()) {
      setProjectFormError('Project name is required.');
      setProjectStep(0);
      return;
    }

    setIsSavingProject(true);
    setProjectFormError('');
    try {
      const createdProject = await createProjectRequest({
        name: projectForm.name.trim(),
        description: projectForm.description.trim() || undefined,
        status: projectForm.status,
        tech_tags: projectForm.techTags.filter(Boolean),
        member_ids: projectForm.memberIds,
        ...(projectForm.leadId ? { lead_id: projectForm.leadId } : {}),
      });
      setProjects((current) => [createdProject, ...current]);
      setIsProjectDialogOpen(false);
      setProjectForm(initialProjectForm);
      setProjectStep(0);
    } catch (error) {
      setProjectFormError(error instanceof Error ? error.message : 'Unable to create project');
    } finally {
      setIsSavingProject(false);
    }
  }

  async function handleUpdateProject() {
    if (!selectedProject || !selectedProject.name.trim()) {
      setProjectDetailError('Project name is required.');
      return;
    }

    setIsSavingProjectDetail(true);
    setProjectDetailError('');
    try {
      const updatedProject = await updateProjectRequest(selectedProject.id, {
        name: selectedProject.name.trim(),
        description: selectedProject.description?.trim() || undefined,
        status: selectedProject.status,
        tech_tags: selectedProject.tech_tags.filter(Boolean),
        member_ids: selectedProject.member_ids,
        ...(selectedProject.lead_id ? { lead_id: selectedProject.lead_id } : {}),
      });
      setProjects((current) => current.map((project) => (project.id === updatedProject.id ? updatedProject : project)));
      setSelectedProject(updatedProject);
      setIsProjectDetailOpen(false);
    } catch (error) {
      setProjectDetailError(error instanceof Error ? error.message : 'Unable to update project');
    } finally {
      setIsSavingProjectDetail(false);
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createForm.employeeId.trim() || !createForm.name.trim() || !createForm.email.trim() || !createForm.password) {
      setUserFormError('Please fill in employee ID, name, email, and password.');
      return;
    }

    setIsSavingUser(true);
    setUserFormError('');
    try {
      const createdUser = await createUserRequest({
        employee_id: createForm.employeeId.trim(),
        name: createForm.name.trim(),
        email: createForm.email.trim(),
        password: createForm.password,
        ...(createForm.role ? { role: createForm.role } : {}),
      });
      setUsers((current) =>
        [...current, createdUser].sort((left, right) => {
          if (left.is_active !== right.is_active) {
            return left.is_active ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        }),
      );
      setIsUserDialogOpen(false);
      setCreateForm(initialCreateForm);
    } catch (error) {
      setUserFormError(error instanceof Error ? error.message : 'Unable to create user');
    } finally {
      setIsSavingUser(false);
    }
  }

  async function handleEditUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editForm.employeeId.trim() || !editForm.name.trim() || !editForm.email.trim()) {
      setUserFormError('Please fill in employee ID, name, and email.');
      return;
    }

    setIsSavingUser(true);
    setUserFormError('');
    try {
      const updatedUser = await updateUserRequest(editForm.id, {
        employee_id: editForm.employeeId.trim(),
        name: editForm.name.trim(),
        email: editForm.email.trim(),
        role: editForm.role,
        is_active: editForm.isActive,
      });
      setUsers((current) =>
        current
          .map((user) => (user.id === updatedUser.id ? updatedUser : user))
          .sort((left, right) => {
            if (left.is_active !== right.is_active) {
              return left.is_active ? -1 : 1;
            }
            return left.name.localeCompare(right.name);
          }),
      );
      setIsUserDialogOpen(false);
    } catch (error) {
      setUserFormError(error instanceof Error ? error.message : 'Unable to update user');
    } finally {
      setIsSavingUser(false);
    }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordForm.password || !passwordForm.confirmPassword) {
      setPasswordFormError('Enter and confirm the new password.');
      return;
    }
    if (passwordForm.password.length < 4) {
      setPasswordFormError('Password must be at least 4 characters.');
      return;
    }
    if (passwordForm.password !== passwordForm.confirmPassword) {
      setPasswordFormError('Passwords do not match.');
      return;
    }

    setIsSavingPassword(true);
    setPasswordFormError('');
    try {
      await updateUserPasswordRequest(passwordForm.id, passwordForm.password);
      setIsPasswordDialogOpen(false);
      setPasswordForm(initialPasswordForm);
    } catch (error) {
      setPasswordFormError(error instanceof Error ? error.message : 'Unable to change password');
    } finally {
      setIsSavingPassword(false);
    }
  }

  function renderRoleTag(value: BackendRole) {
    return <Tag value={backendRoleLabels[value]} severity={backendRoleSeverities[value]} rounded />;
  }

  function renderUserManagement() {
    return (
      <motion.article
        key={`${selectedPage.id}-${currentModule}`}
        className="page-card user-management-page"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="user-management-hero">
          <div>
            <h3>{selectedPage.label}</h3>
            {/* <h1>User Management</h1> */}
            {/* <p>Manage workspace users, onboard new members, update their profile details, and reset access when needed.</p> */}
          </div>
          <Button label="Add User" icon="pi pi-user-plus" onClick={openCreateUserDialog} />
        </div>

        <div className="user-table-shell">
          <div className="user-table-toolbar">
            <div>
              <h2>Directory</h2>
              <p>Search by name, employee ID, email, or role.</p>
            </div>
            <div className="table-search">
              <Search size={16} />
              <input
                placeholder="Search users..."
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
              />
            </div>
          </div>

          {userManagementError ? <small className="error-text">{userManagementError}</small> : null}

          <DataTable
            value={filteredUsers}
            loading={isUsersLoading}
            paginator
            rows={6}
            rowsPerPageOptions={[6, 10, 20]}
            className="user-table"
            emptyMessage="No users found."
          >
            <Column field="name" header="Name" body={(user: UserRecord) => <div className="user-name-cell"><strong>{user.name}</strong><span>{user.employee_id}</span></div>} />
            <Column field="email" header="Email" body={(user: UserRecord) => <span className="muted-cell">{user.email}</span>} />
            <Column field="role" header="Role" body={(user: UserRecord) => renderRoleTag(user.role)} />
            <Column
              field="is_active"
              header="Status"
              body={(user: UserRecord) => (
                <Tag value={user.is_active ? 'Active' : 'Inactive'} severity={user.is_active ? 'success' : 'secondary'} rounded />
              )}
            />
            <Column
              field="created_at"
              header="Created"
              body={(user: UserRecord) => (
                <span className="muted-cell">{new Date(user.created_at).toLocaleDateString()}</span>
              )}
            />
            <Column
              header="Actions"
              body={(user: UserRecord) => (
                <div className="user-actions-cell">
                  <Button
                    type="button"
                    label="Edit"
                    icon="pi pi-pencil"
                    severity="secondary"
                    text
                    onClick={() => openEditUserDialog(user)}
                  />
                  <Button
                    type="button"
                    label="Password"
                    icon="pi pi-key"
                    text
                    onClick={() => openPasswordDialog(user)}
                  />
                </div>
              )}
            />
          </DataTable>
        </div>

        <Dialog
          header={dialogMode === 'create' ? 'Create New User' : 'Edit User'}
          visible={isUserDialogOpen}
          onHide={() => setIsUserDialogOpen(false)}
          className="user-dialog"
          modal
        >
          <form onSubmit={dialogMode === 'create' ? handleCreateUser : handleEditUser} className="user-form">
            <div className="form-grid">
              <div className="p-inputgroup">
                <span className="p-inputgroup-addon">
                  <i className="pi pi-id-card" />
                </span>
                <FloatLabel className="user-float-field">
                  <InputText
                    id="user-employee-id"
                    value={dialogMode === 'create' ? createForm.employeeId : editForm.employeeId}
                    onChange={(event) =>
                      dialogMode === 'create'
                        ? setCreateForm((current) => ({ ...current, employeeId: event.target.value }))
                        : setEditForm((current) => ({ ...current, employeeId: event.target.value }))
                    }
                  />
                  <label htmlFor="user-employee-id">Employee ID</label>
                </FloatLabel>
              </div>

              <div className="p-inputgroup">
                <span className="p-inputgroup-addon">
                  <i className="pi pi-user" />
                </span>
                <FloatLabel className="user-float-field">
                  <InputText
                    id="user-name"
                    value={dialogMode === 'create' ? createForm.name : editForm.name}
                    onChange={(event) =>
                      dialogMode === 'create'
                        ? setCreateForm((current) => ({ ...current, name: event.target.value }))
                        : setEditForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                  <label htmlFor="user-name">Full name</label>
                </FloatLabel>
              </div>

              <div className="p-inputgroup">
                <span className="p-inputgroup-addon">
                  <Mail size={16} />
                </span>
                <FloatLabel className="user-float-field">
                  <InputText
                    id="user-email"
                    value={dialogMode === 'create' ? createForm.email : editForm.email}
                    onChange={(event) =>
                      dialogMode === 'create'
                        ? setCreateForm((current) => ({ ...current, email: event.target.value }))
                        : setEditForm((current) => ({ ...current, email: event.target.value }))
                    }
                  />
                  <label htmlFor="user-email">Email address</label>
                </FloatLabel>
              </div>

              {dialogMode === 'create' ? (
                <div className="p-inputgroup">
                  <span className="p-inputgroup-addon">
                    <KeyRound size={16} />
                  </span>
                  <FloatLabel className="user-float-field">
                    <InputText
                      id="user-password"
                      type={showCreatePassword ? 'text' : 'password'}
                      value={createForm.password}
                      onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))}
                    />
                    <label htmlFor="user-password">Temporary password</label>
                  </FloatLabel>
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowCreatePassword((current) => !current)}
                    aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                  >
                    <i className={showCreatePassword ? 'pi pi-eye-slash' : 'pi pi-eye'} />
                  </button>
                </div>
              ) : null}

              <div className="p-inputgroup">
                <span className="p-inputgroup-addon">
                  <i className="pi pi-briefcase" />
                </span>
                <FloatLabel className="user-float-field">
                  <Dropdown
                    id="user-role"
                    value={dialogMode === 'create' ? createForm.role : editForm.role}
                    options={dialogMode === 'create' ? optionalRoleOptions : backendRoleOptions}
                    onChange={(event) =>
                      dialogMode === 'create'
                        ? setCreateForm((current) => ({ ...current, role: event.value as BackendRole | '' }))
                        : setEditForm((current) => ({ ...current, role: event.value as BackendRole }))
                    }
                    className="full-width"
                  />
                  <label htmlFor="user-role">{dialogMode === 'create' ? 'Workspace role (optional)' : 'Workspace role'}</label>
                </FloatLabel>
              </div>
            </div>

            {dialogMode === 'create' ? (
              <small className="helper-text">
                Role selection can be skipped for now. The user will start as a team member until a project assignment is made.
              </small>
            ) : (
              <label className="status-toggle">
                <div>
                  <strong>Account status</strong>
                  <small>Disable sign-in without removing the user from records.</small>
                </div>
                <InputSwitch
                  checked={editForm.isActive}
                  onChange={(event) => setEditForm((current) => ({ ...current, isActive: Boolean(event.value) }))}
                />
              </label>
            )}

            {userFormError ? <small className="error-text">{userFormError}</small> : null}

            <div className="dialog-actions">
              <Button type="button" label="Cancel" text onClick={() => setIsUserDialogOpen(false)} />
              <Button
                type="submit"
                label={dialogMode === 'create' ? (isSavingUser ? 'Creating...' : 'Create User') : isSavingUser ? 'Saving...' : 'Save Changes'}
                loading={isSavingUser}
              />
            </div>
          </form>
        </Dialog>

        <Dialog
          header={`Change Password${passwordForm.name ? ` for ${passwordForm.name}` : ''}`}
          visible={isPasswordDialogOpen}
          onHide={() => setIsPasswordDialogOpen(false)}
          className="user-dialog"
          modal
        >
          <form onSubmit={handlePasswordChange} className="user-form">
            <div className="form-grid">
              <div className="p-inputgroup">
                <span className="p-inputgroup-addon">
                  <KeyRound size={16} />
                </span>
                <FloatLabel className="user-float-field">
                  <InputText
                    id="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    value={passwordForm.password}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, password: event.target.value }))}
                  />
                  <label htmlFor="new-password">New password</label>
                </FloatLabel>
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowNewPassword((current) => !current)}
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                >
                  <i className={showNewPassword ? 'pi pi-eye-slash' : 'pi pi-eye'} />
                </button>
              </div>

              <div className="p-inputgroup">
                <span className="p-inputgroup-addon">
                  <KeyRound size={16} />
                </span>
                <FloatLabel className="user-float-field">
                  <InputText
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={passwordForm.confirmPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                  />
                  <label htmlFor="confirm-password">Confirm password</label>
                </FloatLabel>
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  <i className={showConfirmPassword ? 'pi pi-eye-slash' : 'pi pi-eye'} />
                </button>
              </div>
            </div>

            {passwordFormError ? <small className="error-text">{passwordFormError}</small> : null}

            <div className="dialog-actions">
              <Button type="button" label="Cancel" text onClick={() => setIsPasswordDialogOpen(false)} />
              <Button type="submit" label={isSavingPassword ? 'Updating...' : 'Update Password'} loading={isSavingPassword} />
            </div>
          </form>
        </Dialog>
      </motion.article>
    );
  }

  function renderProjectManagement() {
    return (
      <motion.article
        key={`${selectedPage.id}-${currentModule}`}
        className="page-card user-management-page"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="user-management-hero">
          <div>
            <h3>{selectedPage.label}</h3>
            {/* <h1>Projects</h1> */}
            {/* <p>Create projects in two guided steps, define core details, and assign the right lead and members before launch.</p> */}
          </div>
          <Button label="Add Project" icon="pi pi-plus" onClick={openCreateProjectDialog} />
        </div>

        <div className="user-table-shell project-shell">
          <div className="user-table-toolbar">
            <div>
              <h2>Project Directory</h2>
              <p>Track project status, assigned lead, tags, and recent creations.</p>
            </div>
            <div className="table-search">
              <Search size={16} />
              <input
                placeholder="Search projects..."
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
              />
            </div>
          </div>

          {projectError ? <small className="error-text">{projectError}</small> : null}

          <DataTable
            value={filteredProjects}
            loading={isProjectsLoading}
            paginator
            rows={6}
            rowsPerPageOptions={[6, 10, 20]}
            className="user-table"
            emptyMessage="No projects found."
            onRowClick={(event) => openProjectDetailDialog(event.data as ProjectRecord)}
            rowClassName={() => 'clickable-row'}
          >
            <Column
              field="name"
              header="Project"
              body={(project: ProjectRecord) => (
                <div className="user-name-cell">
                  <strong>{project.name}</strong>
                  <span>{project.description || 'No description added yet.'}</span>
                </div>
              )}
            />
            <Column
              field="status"
              header="Status"
              body={(project: ProjectRecord) => (
                <Tag value={project.status.replace('-', ' ')} severity={projectStatusSeverities[project.status]} rounded />
              )}
            />
            <Column
              field="lead_id"
              header="Team Lead"
              body={(project: ProjectRecord) => (
                <span className="muted-cell">
                  {project.lead_id ? userLookup.get(project.lead_id)?.name ?? 'Assigned user' : 'Not assigned'}
                </span>
              )}
            />
            <Column
              field="tech_tags"
              header="Tech Tags"
              body={(project: ProjectRecord) => (
                <div className="project-tag-list">
                  {project.tech_tags.length ? (
                    project.tech_tags.slice(0, 3).map((tag) => <Tag key={tag} value={tag} severity="info" rounded />)
                  ) : (
                    <span className="muted-cell">None</span>
                  )}
                </div>
              )}
            />
            <Column
              field="created_at"
              header="Created"
              body={(project: ProjectRecord) => (
                <span className="muted-cell">{new Date(project.created_at).toLocaleDateString()}</span>
              )}
            />
          </DataTable>
        </div>

        <Dialog
          header="Create Project"
          visible={isProjectDialogOpen}
          onHide={() => setIsProjectDialogOpen(false)}
          className="project-dialog"
          modal
        >
          <div className="user-form">
            <Steps
              model={[{ label: 'Project Details' }, { label: 'Team Assignment' }]}
              activeIndex={projectStep}
              readOnly={false}
              onSelect={(event) => {
                event.originalEvent.preventDefault();
                event.originalEvent.stopPropagation();
                goToProjectStep(event.index as ProjectFormStep);
              }}
              className="project-steps"
            />

            {projectStep === 0 ? (
              <div className="form-grid">
                <div className="p-inputgroup">
                  <span className="p-inputgroup-addon">
                    <Boxes size={16} />
                  </span>
                  <FloatLabel className="user-float-field">
                    <InputText
                      id="project-name"
                      value={projectForm.name}
                      onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))}
                    />
                    <label htmlFor="project-name">Project name</label>
                  </FloatLabel>
                </div>

                <div className="p-inputgroup">
                  <span className="p-inputgroup-addon">
                    <i className="pi pi-flag" />
                  </span>
                  <FloatLabel className="user-float-field">
                    <Dropdown
                      id="project-status"
                      value={projectForm.status}
                      options={projectStatusOptions}
                      onChange={(event) =>
                        setProjectForm((current) => ({ ...current, status: event.value as ProjectStatus }))
                      }
                      className="full-width"
                    />
                    <label htmlFor="project-status">Project status</label>
                  </FloatLabel>
                </div>

                <div className="p-inputgroup project-textarea-row">
                  <span className="p-inputgroup-addon">
                    <i className="pi pi-align-left" />
                  </span>
                  <FloatLabel className="user-float-field">
                    <InputTextarea
                      id="project-description"
                      value={projectForm.description}
                      onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))}
                      rows={4}
                      autoResize
                    />
                    <label htmlFor="project-description">Project description</label>
                  </FloatLabel>
                </div>

                <div className="p-inputgroup">
                  <span className="p-inputgroup-addon">
                    <i className="pi pi-hashtag" />
                  </span>
                  <FloatLabel className="user-float-field">
                    <MultiSelect
                      id="project-tags"
                      value={projectForm.techTags}
                      options={[
                        'React',
                        'TypeScript',
                        'FastAPI',
                        'PostgreSQL',
                        'Docker',
                        'Node.js',
                        'Python',
                        'UI/UX',
                        'DevOps',
                      ].map((tag) => ({ label: tag, value: tag }))}
                      onChange={(event) =>
                        setProjectForm((current) => ({ ...current, techTags: event.value as string[] }))
                      }
                      display="chip"
                      placeholder="Choose tech tags"
                      className="full-width"
                    />
                    <label htmlFor="project-tags">Tech tags</label>
                  </FloatLabel>
                </div>
              </div>
            ) : (
              <div className="form-grid">
                <div className="p-inputgroup">
                  <span className="p-inputgroup-addon">
                    <i className="pi pi-user" />
                  </span>
                  <FloatLabel className="user-float-field">
                    <Dropdown
                      id="project-lead"
                      value={projectForm.leadId}
                      options={[{ label: 'Assign later', value: '' }, ...leadOptions]}
                      onChange={(event) =>
                        setProjectForm((current) => ({
                          ...current,
                          leadId: event.value as string,
                          memberIds: current.memberIds.filter((memberId) => memberId !== event.value),
                        }))
                      }
                      className="full-width"
                    />
                    <label htmlFor="project-lead">Team lead</label>
                  </FloatLabel>
                </div>

                <div className="p-inputgroup">
                  <span className="p-inputgroup-addon">
                    <Users size={16} />
                  </span>
                  <FloatLabel className="user-float-field">
                    <MultiSelect
                      id="project-members"
                      value={projectForm.memberIds}
                      options={memberOptions}
                      onChange={(event) =>
                        setProjectForm((current) => ({ ...current, memberIds: event.value as string[] }))
                      }
                      display="chip"
                      placeholder="Select project members"
                      className="full-width"
                    />
                    <label htmlFor="project-members">Team members</label>
                  </FloatLabel>
                </div>

                <div className="project-summary-card">
                  <h4>Project summary</h4>
                  <p>{projectForm.name || 'Untitled project'}</p>
                  <small>Status: {projectForm.status.replace('-', ' ')}</small>
                  <small>Lead: {projectForm.leadId ? userLookup.get(projectForm.leadId)?.name ?? 'Assigned user' : 'Not assigned'}</small>
                  <small>Members: {projectForm.memberIds.length}</small>
                </div>
              </div>
            )}

            {projectFormError ? <small className="error-text">{projectFormError}</small> : null}

            <div className="dialog-actions">
              {projectStep === 1 ? (
                <Button type="button" label="Back" text onClick={() => setProjectStep(0)} />
              ) : null}
              {projectStep === 0 ? (
                <Button type="button" label="Next" onClick={() => goToProjectStep(1)} />
              ) : (
                <Button
                  type="button"
                  label={isSavingProject ? 'Creating...' : 'Create Project'}
                  loading={isSavingProject}
                  onClick={() => void handleCreateProject()}
                />
              )}
            </div>
          </div>
        </Dialog>

        <Dialog
          header={selectedProject ? `Project Details: ${selectedProject.name}` : 'Project Details'}
          visible={isProjectDetailOpen}
          onHide={() => setIsProjectDetailOpen(false)}
          className="project-detail-dialog"
          position="right"
          modal
          draggable={false}
          resizable={false}
        >
          {selectedProject ? (
            <div className="user-form">
              <div className="form-grid">
                <div className="p-inputgroup">
                  <span className="p-inputgroup-addon">
                    <Boxes size={16} />
                  </span>
                  <FloatLabel className="user-float-field">
                    <InputText
                      id="detail-project-name"
                      value={selectedProject.name}
                      onChange={(event) =>
                        setSelectedProject((current) => (current ? { ...current, name: event.target.value } : current))
                      }
                    />
                    <label htmlFor="detail-project-name">Project name</label>
                  </FloatLabel>
                </div>

                <div className="p-inputgroup">
                  <span className="p-inputgroup-addon">
                    <i className="pi pi-flag" />
                  </span>
                  <FloatLabel className="user-float-field">
                    <Dropdown
                      id="detail-project-status"
                      value={selectedProject.status}
                      options={projectStatusOptions}
                      onChange={(event) =>
                        setSelectedProject((current) =>
                          current ? { ...current, status: event.value as ProjectStatus } : current,
                        )
                      }
                      className="full-width"
                    />
                    <label htmlFor="detail-project-status">Status</label>
                  </FloatLabel>
                </div>

                <div className="p-inputgroup project-textarea-row">
                  <span className="p-inputgroup-addon">
                    <i className="pi pi-align-left" />
                  </span>
                  <FloatLabel className="user-float-field">
                    <InputTextarea
                      id="detail-project-description"
                      value={selectedProject.description ?? ''}
                      onChange={(event) =>
                        setSelectedProject((current) =>
                          current ? { ...current, description: event.target.value } : current,
                        )
                      }
                      rows={5}
                      autoResize
                    />
                    <label htmlFor="detail-project-description">Description</label>
                  </FloatLabel>
                </div>

                <div className="p-inputgroup">
                  <span className="p-inputgroup-addon">
                    <i className="pi pi-hashtag" />
                  </span>
                  <FloatLabel className="user-float-field">
                    <MultiSelect
                      id="detail-project-tags"
                      value={selectedProject.tech_tags}
                      options={[
                        'React',
                        'TypeScript',
                        'FastAPI',
                        'PostgreSQL',
                        'Docker',
                        'Node.js',
                        'Python',
                        'UI/UX',
                        'DevOps',
                      ].map((tag) => ({ label: tag, value: tag }))}
                      onChange={(event) =>
                        setSelectedProject((current) =>
                          current ? { ...current, tech_tags: event.value as string[] } : current,
                        )
                      }
                      display="chip"
                      className="full-width"
                    />
                    <label htmlFor="detail-project-tags">Tech tags</label>
                  </FloatLabel>
                </div>

                <div className="p-inputgroup">
                  <span className="p-inputgroup-addon">
                    <i className="pi pi-user" />
                  </span>
                  <FloatLabel className="user-float-field">
                    <Dropdown
                      id="detail-project-lead"
                      value={selectedProject.lead_id ?? ''}
                      options={[{ label: 'Assign later', value: '' }, ...leadOptions]}
                      onChange={(event) =>
                        setSelectedProject((current) =>
                          current
                            ? {
                                ...current,
                                lead_id: (event.value as string) || null,
                                member_ids: current.member_ids.filter((memberId) => memberId !== event.value),
                              }
                            : current,
                        )
                      }
                      className="full-width"
                    />
                    <label htmlFor="detail-project-lead">Team lead</label>
                  </FloatLabel>
                </div>

                <div className="p-inputgroup">
                  <span className="p-inputgroup-addon">
                    <Users size={16} />
                  </span>
                  <FloatLabel className="user-float-field">
                    <MultiSelect
                      id="detail-project-members"
                      value={selectedProject.member_ids}
                      options={projectDetailMemberOptions}
                      onChange={(event) =>
                        setSelectedProject((current) =>
                          current ? { ...current, member_ids: event.value as string[] } : current,
                        )
                      }
                      display="chip"
                      className="full-width"
                    />
                    <label htmlFor="detail-project-members">Team members</label>
                  </FloatLabel>
                </div>
              </div>

              {projectDetailError ? <small className="error-text">{projectDetailError}</small> : null}

              <div className="dialog-actions">
                <Button type="button" label="Close" text onClick={() => setIsProjectDetailOpen(false)} />
                <Button
                  type="button"
                  label={isSavingProjectDetail ? 'Saving...' : 'Save Project'}
                  loading={isSavingProjectDetail}
                  onClick={() => void handleUpdateProject()}
                />
              </div>
            </div>
          ) : null}
        </Dialog>
      </motion.article>
    );
  }

  function renderDefaultContent() {
    return (
      <motion.article
        key={`${selectedPage.id}-${currentModule}`}
        className="page-card"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <h3>{selectedPage.label}</h3>
        <h1>{currentModule}</h1>
        <p>
          This area can hold analytics cards, actionable lists, and contextual tools for {currentModule.toLowerCase()}.
        </p>
      </motion.article>
    );
  }

  return (
    <div className="app-root">
      <AnimatePresence mode="wait">
        {!isAuthenticated ? (
          <motion.main
            key="login"
            className="login-layout"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4 }}
          >
            <section className="login-showcase">
              <div className="glow-orb orb-one" />
              <div className="glow-orb orb-two" />
              <div className="showcase-content">
                <span className="badge">FlowDesk Workspace</span>
                <h1>Collaborate, organize, and deliver with clarity.</h1>
                <p>
                  A modern dashboard experience for admins, team leads, and members to manage projects, knowledge, and
                  calendars in one place.
                </p>
                <div className="showcase-cards">
                  <article>
                    <LayoutDashboard size={18} />
                    <span>Role based layouts</span>
                  </article>
                  <article>
                    <ShieldCheck size={18} />
                    <span>Secure employee sign in</span>
                  </article>
                  <article>
                    <Users size={18} />
                    <span>Built for team workflows</span>
                  </article>
                </div>
              </div>
            </section>

            <section className="login-panel">
              <motion.form className="login-form" onSubmit={handleLogin} layout>
                <h2>Welcome back</h2>
                <p>Sign in with your employee credentials.</p>
                <label htmlFor="employeeId">Employee ID</label>
                <input
                  id="employeeId"
                  placeholder="Enter your employee ID"
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                />
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {loginError ? <small className="error-text">{loginError}</small> : null}
                <button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Signing in...' : 'Sign in'}
                </button>
              </motion.form>
            </section>
          </motion.main>
        ) : (
          <motion.main
            key="dashboard"
            className="dashboard-shell"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            <header className="top-header">
              <div className="header-left">
                <div className="header-brand">
                  <div className="brand-mark">FD</div>
                  <div className="title-wrap">
                    <h2>FlowDesk</h2>
                  </div>
                </div>
                <nav className="top-nav">
                  {topNav.map((page) => (
                    <button
                      key={page.id}
                      className={page.id === selectedPage.id ? 'active' : ''}
                      onClick={() => selectPage(page)}
                      type="button"
                    >
                      {page.icon}
                      {page.label}
                    </button>
                  ))}
                </nav>
              </div>
              <div className="header-actions">
                <div className="user-chip">
                  <span className="user-avatar">{currentUserAvatar}</span>
                  <span className="user-meta">
                    <strong>{currentUserName}</strong>
                    <small>{currentUserIdentifier}</small>
                  </span>
                  <span className="role-pill">{roleLabels[role]}</span>
                </div>
                <button className="logout-btn" onClick={logout} type="button">
                  <LogOut size={16} />
                  Logout
                </button>
              </div>
            </header>

            <section className="dashboard-body">
              <aside className="sidebar">
                <h4>{selectedPage.label} Modules</h4>
                {selectedPage.modules.map((module) => (
                  <button
                    key={module}
                    type="button"
                    className={module === activeModule ? 'active' : ''}
                    onClick={() => setActiveModule(module)}
                  >
                    {module}
                  </button>
                ))}
              </aside>
              <section className="content-panel">
                <div className="search-card">
                  <Search size={16} />
                  <input
                    placeholder={isUserManagementView ? 'Search users by name, email, ID, or role...' : 'Search projects, articles, events...'}
                    value={isUserManagementView ? userSearch : ''}
                    onChange={(event) => {
                      if (isUserManagementView) {
                        setUserSearch(event.target.value);
                      }
                    }}
                  />
                  <Settings size={16} />
                </div>
                {isUserManagementView ? renderUserManagement() : isProjectView ? renderProjectManagement() : renderDefaultContent()}
              </section>
            </section>
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
