import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpenText,
  CalendarDays,
  FileText,
  FolderKanban,
  Layers,
  MessageCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Tag } from 'primereact/tag';
import {
  createCustomerRequest,
  createProjectRequest,
  createTicketConfigurationRequest,
  createUserRequest,
  deleteTicketConfigurationRequest,
  createTicketRequest,
  deleteTicketRequest,
  getAssignableUsersRequest,
  getCustomersRequest,
  getEventsRequest,
  getProjectsRequest,
  getTicketConfigurationRequest,
  getCurrentUserRequest,
  getApprovalNotificationsRequest,
  getTicketsRequest,
  getUsersRequest,
  patchTicketStatusRequest,
  reopenTicketRequest,
  acknowledgeTicketApprovalRequest,
  markApprovalNotificationReadRequest,
  deleteApprovalNotificationRequest,
  deleteAllApprovalNotificationsRequest,
  updateTicketRequest,
  loginRequest,
  type CustomerContact,
  type CustomerRecord,
  type ProjectRecord,
  type ProjectStatus,
  type TicketConfigurationCreatePayload,
  type TicketApprovalNotificationRecord,
  type TicketConfigurationRecord,
  type TicketCreatePayload,
  type TicketRecord,
  type TicketStatus,
  type TicketReopenPayload,
  type TicketUpdatePayload,
  updateCustomerRequest,
  updateCurrentUserPasswordRequest,
  updateCurrentUserRequest,
  updateProjectRequest,
  updateTicketConfigurationRequest,
  updateUserPasswordRequest,
  updateUserRequest,
  patchEventMilestoneRequest,
} from './lib/api';
import type { BackendRole, CalendarEventRecord, ThemePreference, UserRecord, UserSelfUpdatePayload } from './lib/api';
import { ModuleSidebar } from './components/layout/ModuleSidebar';
import { TopHeader } from './components/layout/TopHeader';
import { CustomerManagementSection } from './features/customer-management/CustomerManagementSection';
import { ProjectManagementSection } from './features/project-management/ProjectManagementSection';
import { CalendarEventsTable } from './features/calendar/CalendarEventsTable';
import { CalendarWorkspace } from './features/calendar/CalendarWorkspace';
import { PersonalTasksWorkspace } from './features/calendar/PersonalTasksWorkspace';
import { SprintsWorkspace } from './features/sprints/SprintsWorkspace';
import { TicketManagementSection } from './features/tickets/TicketManagementSection';
import { TicketConfigurationSection } from './features/ticket-configuration/TicketConfigurationSection';
import { UserManagementSection } from './features/user-management/UserManagementSection';
import { CalendarPage } from './pages/Calendar';
import { TicketsPage } from './pages/TicketsPage';
import { KnowledgeBasePage } from './pages/KnowledgeBase';
import { LoginPage } from './pages/LoginPage';
import { ProjectsPage } from './pages/Projects';
import { KbDocumentsWorkspace } from './features/kb/KbDocumentsWorkspace';
import { ChatWorkspace } from './features/chat/ChatWorkspace';

type Role = 'admin' | 'teamLead' | 'teamMember';
type TopPage = 'projects' | 'knowledgeBase' | 'calendar' | 'tickets' | 'kb' | 'sprints' | 'chat';
type UserDialogMode = 'create' | 'edit';
type ProjectFormStep = 0 | 1;
type ProjectViewMode = 'table' | 'kanban';

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
    { id: 'calendar', label: 'Calendar', icon: <CalendarDays size={17} />, modules: ['Calendar', 'View'] },
  ],
  teamLead: [
    { id: 'sprints', label: 'Sprints', icon: <Layers size={17} />, modules: ['Configuration', 'Monitoring'] },
    { id: 'tickets', label: 'Tickets', icon: <FileText size={17} />, modules: ['Create Ticket', 'Tickets'] },
    { id: 'chat', label: 'Chat', icon: <MessageCircle size={17} />, modules: ['Inbox'] },
    { id: 'kb', label: 'Knowledge Base', icon: <BookOpenText size={17} />, modules: ['Documents'] },
    { id: 'calendar', label: 'Calendar', icon: <CalendarDays size={17} />, modules: ['Calendar', 'View', 'Personal Tasks'] },
  ],
  teamMember: [
    { id: 'sprints', label: 'Sprints', icon: <Layers size={17} />, modules: ['Active Sprint', 'Sprints'] },
    { id: 'tickets', label: 'Tickets', icon: <FileText size={17} />, modules: ['My Tickets', 'History'] },
    { id: 'chat', label: 'Chat', icon: <MessageCircle size={17} />, modules: ['Inbox'] },
    { id: 'kb', label: 'Knowledge Base', icon: <BookOpenText size={17} />, modules: ['Documents'] },
    { id: 'calendar', label: 'Calendar', icon: <CalendarDays size={17} />, modules: ['Calendar', 'View', 'Personal Tasks'] },
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
  designation: '',
};

const initialEditForm = {
  id: '',
  employeeId: '',
  name: '',
  email: '',
  role: 'MEMBER' as BackendRole,
  isActive: true,
  designation: '',
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

const DEFAULT_THEME: ThemePreference = 'light';

const initialProjectForm = {
  name: '',
  description: '',
  status: 'active' as ProjectStatus,
  techTags: [] as string[],
  leadId: '',
  memberIds: [] as string[],
};

const emptyCustomerContact: CustomerContact = {
  name: '',
  role: '',
  email: '',
  phone: '',
};

const initialCustomerForm = {
  id: '',
  name: '',
  email: '',
  company: '',
  phone: '',
  timezone: '',
  tags: [] as string[],
  notes: '',
  contacts: [{ ...emptyCustomerContact }],
  projectIds: [] as string[],
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [isCustomersLoading, setIsCustomersLoading] = useState(false);
  const [customerError, setCustomerError] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [isCustomerDialogOpen, setIsCustomerDialogOpen] = useState(false);
  const [isCustomerDetailOpen, setIsCustomerDetailOpen] = useState(false);
  const [isCustomerDetailEditing, setIsCustomerDetailEditing] = useState(false);
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [customerFormError, setCustomerFormError] = useState('');
  const [customerForm, setCustomerForm] = useState(initialCustomerForm);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [projectViewMode, setProjectViewMode] = useState<ProjectViewMode>('table');
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [isProjectDetailOpen, setIsProjectDetailOpen] = useState(false);
  const [isProjectDetailEditing, setIsProjectDetailEditing] = useState(false);
  const [projectStep, setProjectStep] = useState<ProjectFormStep>(0);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isSavingProjectDetail, setIsSavingProjectDetail] = useState(false);
  const [projectFormError, setProjectFormError] = useState('');
  const [projectForm, setProjectForm] = useState(initialProjectForm);
  const [projectDetailError, setProjectDetailError] = useState('');
  const [selectedProject, setSelectedProject] = useState<ProjectRecord | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [userFormError, setUserFormError] = useState('');
  const [passwordFormError, setPasswordFormError] = useState('');
  const [createForm, setCreateForm] = useState(initialCreateForm);
  const [editForm, setEditForm] = useState(initialEditForm);
  const [passwordForm, setPasswordForm] = useState(initialPasswordForm);
  const [ticketConfigurations, setTicketConfigurations] = useState<TicketConfigurationRecord[]>([]);
  const [isTicketConfigLoading, setIsTicketConfigLoading] = useState(false);
  const [ticketConfigError, setTicketConfigError] = useState('');
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventRecord[]>([]);
  const [isCalendarEventsLoading, setIsCalendarEventsLoading] = useState(false);
  const [allCalendarEvents, setAllCalendarEvents] = useState<CalendarEventRecord[]>([]);
  const [isAllCalendarEventsLoading, setIsAllCalendarEventsLoading] = useState(false);
  const calendarRangeRef = useRef<{ from: string; to: string } | null>(null);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [isTicketsLoading, setIsTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState('');
  const [ticketSearch] = useState('');
  const [ticketViewMode, setTicketViewMode] = useState<'list' | 'kanban'>('list');
  const [assignableUsers, setAssignableUsers] = useState<UserRecord[]>([]);
  const [sessionProfile, setSessionProfile] = useState<UserRecord | null>(null);
  const [pendingApprovalNotifications, setPendingApprovalNotifications] = useState<TicketApprovalNotificationRecord[]>([]);
  const [notificationBusyId, setNotificationBusyId] = useState<string | null>(null); // request id
  const [notificationReadBusyId, setNotificationReadBusyId] = useState<string | null>(null); // notification id
  const [notificationDeleteBusyId, setNotificationDeleteBusyId] = useState<string | null>(null); // notification id
  const [notificationDeleteAllBusy, setNotificationDeleteAllBusy] = useState(false);
  const [focusedTicketIdFromNotification, setFocusedTicketIdFromNotification] = useState<string | null>(null);

  const topNav = roleTopNav[role];
  const selectedPage = useMemo(
    () => topNav.find((item) => item.id === activePage) ?? topNav[0],
    [activePage, topNav],
  );
  const currentModule = useMemo(() => {
    const modules = selectedPage.modules;
    if (!modules.length) {
      return '';
    }
    if (activeModule && modules.includes(activeModule)) {
      return activeModule;
    }
    return modules[0];
  }, [activeModule, selectedPage.modules]);
  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) {
      return users;
    }

    return users.filter((user) =>
      [user.name, user.email, user.employee_id, user.designation ?? '', backendRoleLabels[user.role]].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [userSearch, users]);

  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    if (!query) {
      return customers;
    }

    return customers.filter((customer) =>
      [customer.name, customer.email, customer.company ?? '', customer.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [customerSearch, customers]);

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
  const currentUserName =
    sessionProfile?.name ??
    currentUserRecord?.name ??
    (employeeId === '1111' ? 'System Admin' : employeeId || 'Current User');
  const currentUserIdentifier =
    sessionProfile?.employee_id ??
    currentUserRecord?.employee_id ??
    employeeId ??
    'Not available';
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

  const projectsByStatus = useMemo(
    () =>
      projectStatusOptions.map((statusOption) => ({
        ...statusOption,
        projects: filteredProjects.filter((project) => project.status === statusOption.value),
      })),
    [filteredProjects],
  );

  const leadCurrentUserId = useMemo(
    () => assignableUsers.find((u) => u.employee_id === employeeId)?.id,
    [assignableUsers, employeeId],
  );

  const ticketWorkspaceUserId = sessionProfile?.id ?? leadCurrentUserId;
  const activeTheme: ThemePreference = sessionProfile?.theme_preference ?? DEFAULT_THEME;

  const loadCalendarEventsForRange = useCallback(async (from: string, to: string) => {
    calendarRangeRef.current = { from, to };
    setIsCalendarEventsLoading(true);
    try {
      const data = await getEventsRequest({ from, to });
      setCalendarEvents(data);
    } catch {
      setCalendarEvents([]);
    } finally {
      setIsCalendarEventsLoading(false);
    }
  }, []);

  const loadAllCalendarEvents = useCallback(async () => {
    setIsAllCalendarEventsLoading(true);
    try {
      const data = await getEventsRequest();
      setAllCalendarEvents(
        [...data].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()),
      );
    } catch {
      setAllCalendarEvents([]);
    } finally {
      setIsAllCalendarEventsLoading(false);
    }
  }, []);

  const handleCalendarMonthRange = useCallback(
    (from: string, to: string) => {
      void loadCalendarEventsForRange(from, to);
    },
    [loadCalendarEventsForRange],
  );

  const refreshCalendarEvents = useCallback(() => {
    const r = calendarRangeRef.current;
    if (r) {
      void loadCalendarEventsForRange(r.from, r.to);
    } else {
      const n = new Date();
      const y = n.getFullYear();
      const m = n.getMonth();
      const from = new Date(y, m, 1, 0, 0, 0, 0).toISOString();
      const to = new Date(y, m + 1, 0, 23, 59, 59, 999).toISOString();
      void loadCalendarEventsForRange(from, to);
    }
    void loadAllCalendarEvents();
  }, [loadCalendarEventsForRange, loadAllCalendarEvents]);

  const handleCalendarMilestoneToggle = useCallback(
    async (eventId: string, milestoneId: string, completed: boolean) => {
      await patchEventMilestoneRequest(eventId, milestoneId, completed);
      refreshCalendarEvents();
    },
    [refreshCalendarEvents],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    if (role === 'admin') {
      void loadUsers();
      void loadProjects();
      void loadCustomers();
    }
    if (role === 'teamLead' || role === 'teamMember') {
      void loadProjects();
    }
    if (role === 'teamLead') {
      void loadCustomers();
    }
    void getCurrentUserRequest()
      .then(setSessionProfile)
      .catch(() => setSessionProfile(null));
    void loadTicketsForSummary();
    void loadAllCalendarEvents();
  }, [isAuthenticated, role]);

  useEffect(() => {
    document.documentElement.setAttribute('data-app-theme', activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    if (!isAuthenticated || role !== 'admin') {
      return;
    }
    if (selectedPage.id !== 'knowledgeBase' || currentModule !== 'Configuration') {
      return;
    }
    void loadTicketConfigurations();
  }, [isAuthenticated, role, selectedPage.id, currentModule]);

  useEffect(() => {
    if (!isAuthenticated || selectedPage.id !== 'calendar' || currentModule !== 'View') {
      return;
    }
    void loadAllCalendarEvents();
  }, [isAuthenticated, selectedPage.id, currentModule, loadAllCalendarEvents]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    if (selectedPage.id !== 'tickets') {
      return;
    }
    if (role === 'teamLead') {
      void loadTicketsForLead();
      void loadAssignableUsersForTickets();
      void loadTicketConfigurationsForLead();
    }
    if (role === 'teamMember') {
      void loadTicketsForMember();
    }
  }, [isAuthenticated, role, selectedPage.id]);

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

  async function loadCustomers() {
    setIsCustomersLoading(true);
    setCustomerError('');
    try {
      const data = await getCustomersRequest();
      setCustomers(
        [...data].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
      );
    } catch (error) {
      setCustomerError(error instanceof Error ? error.message : 'Unable to load customers');
    } finally {
      setIsCustomersLoading(false);
    }
  }

  async function loadTicketsForLead() {
    setIsTicketsLoading(true);
    setTicketsError('');
    try {
      const data = await getTicketsRequest();
      setTickets([...data].sort((a, b) => b.ticket_number - a.ticket_number));
    } catch (error) {
      setTickets([]);
      setTicketsError(error instanceof Error ? error.message : 'Unable to load tickets');
    } finally {
      setIsTicketsLoading(false);
    }
  }

  async function loadTicketsForMember() {
    setIsTicketsLoading(true);
    setTicketsError('');
    try {
      const data = await getTicketsRequest({ assignee_me: true });
      setTickets([...data].sort((a, b) => b.ticket_number - a.ticket_number));
    } catch (error) {
      setTickets([]);
      setTicketsError(error instanceof Error ? error.message : 'Unable to load tickets');
    } finally {
      setIsTicketsLoading(false);
    }
  }

  async function loadTicketsForSummary() {
    try {
      const data = await getTicketsRequest(role === 'teamMember' ? { assignee_me: true } : undefined);
      setTickets([...data].sort((a, b) => b.ticket_number - a.ticket_number));
    } catch {
      setTickets([]);
    }
  }

  async function loadAssignableUsersForTickets() {
    try {
      const data = await getAssignableUsersRequest();
      setAssignableUsers([...data].sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      setAssignableUsers([]);
    }
  }

  async function loadTicketConfigurationsForLead() {
    try {
      const data = await getTicketConfigurationRequest();
      setTicketConfigurations([...data].sort((a, b) => a.ticket_type.localeCompare(b.ticket_type)));
    } catch {
      setTicketConfigurations([]);
    }
  }

  const loadPendingApprovalNotifications = useCallback(async () => {
    if (!isAuthenticated) {
      setPendingApprovalNotifications([]);
      return;
    }
    try {
      const rows = await getApprovalNotificationsRequest();
      setPendingApprovalNotifications(rows);
    } catch {
      setPendingApprovalNotifications([]);
    }
  }, [isAuthenticated]);

  const handleAcknowledgeApprovalFromHeader = useCallback(
    async (requestId: string, ticketId: string) => {
      setNotificationBusyId(requestId);
      try {
        await acknowledgeTicketApprovalRequest(requestId);
        setActivePage('tickets');
        setActiveModule('Tickets');
        setFocusedTicketIdFromNotification(ticketId);
        await loadPendingApprovalNotifications();
        await loadTicketsForLead();
        // Defer clearing so TicketManagementSection can open after paint. In React
        // StrictMode (dev), effects run twice; clearing synchronously in the child
        // would drop focusTicketId before the remount and the detail pane never opens.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setFocusedTicketIdFromNotification(null);
          });
        });
      } finally {
        setNotificationBusyId(null);
      }
    },
    [loadPendingApprovalNotifications],
  );

  const handleMarkNotificationRead = useCallback(
    async (notificationId: string) => {
      setNotificationReadBusyId(notificationId);
      try {
        await markApprovalNotificationReadRequest(notificationId);
        await loadPendingApprovalNotifications();
      } finally {
        setNotificationReadBusyId(null);
      }
    },
    [loadPendingApprovalNotifications],
  );

  const handleDeleteNotification = useCallback(
    async (notificationId: string) => {
      setNotificationDeleteBusyId(notificationId);
      try {
        await deleteApprovalNotificationRequest(notificationId);
        await loadPendingApprovalNotifications();
      } finally {
        setNotificationDeleteBusyId(null);
      }
    },
    [loadPendingApprovalNotifications],
  );

  const handleDeleteAllNotifications = useCallback(async () => {
    if (pendingApprovalNotifications.length === 0) {
      return;
    }
    if (!window.confirm('Remove every item from your approvals inbox?')) {
      return;
    }
    setNotificationDeleteAllBusy(true);
    try {
      await deleteAllApprovalNotificationsRequest();
      await loadPendingApprovalNotifications();
    } finally {
      setNotificationDeleteAllBusy(false);
    }
  }, [loadPendingApprovalNotifications, pendingApprovalNotifications.length]);

  useEffect(() => {
    if (!isAuthenticated) {
      setPendingApprovalNotifications([]);
      return;
    }
    void loadPendingApprovalNotifications();
    const timer = window.setInterval(() => {
      void loadPendingApprovalNotifications();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, loadPendingApprovalNotifications]);

  const handleLeadCreateTicket = useCallback(async (payload: TicketCreatePayload) => {
    return createTicketRequest(payload);
  }, []);

  const handleLeadUpdateTicket = useCallback(async (id: string, payload: TicketUpdatePayload) => {
    return updateTicketRequest(id, payload);
  }, []);

  const handleLeadPatchTicketStatus = useCallback(async (id: string, status: TicketStatus, comment?: string | null) => {
    return patchTicketStatusRequest(id, status, comment);
  }, []);

  const handleLeadReopenTicket = useCallback(async (id: string, payload: TicketReopenPayload) => {
    return reopenTicketRequest(id, payload);
  }, []);

  const handleLeadDeleteTicket = useCallback(async (id: string, password: string) => {
    await deleteTicketRequest(id, password);
  }, []);

  const handleUpdateCurrentUserProfile = useCallback(async (payload: UserSelfUpdatePayload) => {
    const updated = await updateCurrentUserRequest(payload);
    setSessionProfile(updated);
  }, []);

  const handleUpdateThemePreference = useCallback(
    async (theme: ThemePreference) => {
      const current = sessionProfile;
      if (!current) {
        throw new Error('Profile not available');
      }
      const updated = await updateCurrentUserRequest({
        name: current.name,
        email: current.email,
        avatar_url: current.avatar_url ?? null,
        theme_preference: theme,
        github_url: current.github_url ?? null,
        linkedin_url: current.linkedin_url ?? null,
      });
      setSessionProfile(updated);
    },
    [sessionProfile],
  );

  const handleUpdateCurrentUserPassword = useCallback(async (newPassword: string) => {
    await updateCurrentUserPasswordRequest(newPassword);
  }, []);

  async function loadTicketConfigurations() {
    setIsTicketConfigLoading(true);
    setTicketConfigError('');
    try {
      const data = await getTicketConfigurationRequest();
      setTicketConfigurations([...data].sort((left, right) => left.ticket_type.localeCompare(right.ticket_type)));
    } catch (error) {
      setTicketConfigurations([]);
      setTicketConfigError(error instanceof Error ? error.message : 'Unable to load ticket configuration');
    } finally {
      setIsTicketConfigLoading(false);
    }
  }

  async function handleCreateTicketConfiguration(payload: TicketConfigurationCreatePayload) {
    const created = await createTicketConfigurationRequest(payload);
    setTicketConfigurations((current) =>
      [...current, created].sort((left, right) => left.ticket_type.localeCompare(right.ticket_type)),
    );
  }

  async function handleUpdateTicketConfiguration(id: string, code: string, display_name?: string | null) {
    const updated = await updateTicketConfigurationRequest(id, {
      code,
      ...(display_name !== undefined ? { display_name } : {}),
    });
    setTicketConfigurations((current) =>
      current.map((row) => (row.id === updated.id ? updated : row)).sort((left, right) => left.ticket_type.localeCompare(right.ticket_type)),
    );
  }

  async function handleDeleteTicketConfiguration(id: string) {
    await deleteTicketConfigurationRequest(id);
    setTicketConfigurations((current) => current.filter((row) => row.id !== id));
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
      setActiveModule(defaultPage.modules[0] ?? '');
      setIsAuthenticated(true);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to login');
    } finally {
      setIsSubmitting(false);
    }
  }

  function selectPage(page: NavItem) {
    setActivePage(page.id);
    setActiveModule(page.modules[0] ?? '');
  }

  function logout() {
    setIsAuthenticated(false);
    setPassword('');
    setEmployeeId('');
    setActiveModule('');
    setLoginError('');
    setSessionProfile(null);
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
      designation: user.designation ?? '',
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

  function openCreateCustomerDialog() {
    setCustomerForm(initialCustomerForm);
    setCustomerFormError('');
    setIsCustomerDialogOpen(true);
  }

  function openCustomerDetailDialog(customer: CustomerRecord) {
    setSelectedCustomer(customer);
    setCustomerFormError('');
    setIsCustomerDetailEditing(false);
    setIsCustomerDetailOpen(true);
  }

  function cancelCustomerDetailEditing() {
    if (selectedCustomer) {
      const latestCustomer = customers.find((customer) => customer.id === selectedCustomer.id);
      if (latestCustomer) {
        setSelectedCustomer(latestCustomer);
      }
    }
    setCustomerFormError('');
    setIsCustomerDetailEditing(false);
  }

  function updateCustomerContactRow(
    index: number,
    field: keyof CustomerContact,
    value: string,
    mode: 'create' | 'detail',
  ) {
    if (mode === 'create') {
      setCustomerForm((current) => ({
        ...current,
        contacts: current.contacts.map((contact, contactIndex) =>
          contactIndex === index ? { ...contact, [field]: value } : contact,
        ),
      }));
      return;
    }

    setSelectedCustomer((current) =>
      current
        ? {
            ...current,
            contacts: current.contacts.map((contact, contactIndex) =>
              contactIndex === index ? { ...contact, [field]: value } : contact,
            ),
          }
        : current,
    );
  }

  function addCustomerContactRow(mode: 'create' | 'detail') {
    if (mode === 'create') {
      setCustomerForm((current) => ({ ...current, contacts: [...current.contacts, { ...emptyCustomerContact }] }));
      return;
    }

    setSelectedCustomer((current) =>
      current ? { ...current, contacts: [...current.contacts, { ...emptyCustomerContact }] } : current,
    );
  }

  function removeCustomerContactRow(index: number, mode: 'create' | 'detail') {
    if (mode === 'create') {
      setCustomerForm((current) => ({
        ...current,
        contacts: current.contacts.length > 1 ? current.contacts.filter((_, contactIndex) => contactIndex !== index) : current.contacts,
      }));
      return;
    }

    setSelectedCustomer((current) =>
      current && current.contacts.length > 1
        ? { ...current, contacts: current.contacts.filter((_, contactIndex) => contactIndex !== index) }
        : current,
    );
  }

  function openProjectDetailDialog(project: ProjectRecord) {
    setSelectedProject(project);
    setProjectDetailError('');
    setIsProjectDetailEditing(false);
    setIsProjectDetailOpen(true);
  }

  function cancelProjectDetailEditing() {
    if (selectedProject) {
      const latestProject = projects.find((project) => project.id === selectedProject.id);
      if (latestProject) {
        setSelectedProject(latestProject);
      }
    }
    setProjectDetailError('');
    setIsProjectDetailEditing(false);
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

  async function handleCreateCustomer() {
    if (!customerForm.name.trim() || !customerForm.email.trim()) {
      setCustomerFormError('Customer name and primary email are required.');
      return;
    }

    setIsSavingCustomer(true);
    setCustomerFormError('');
    try {
      const createdCustomer = await createCustomerRequest({
        name: customerForm.name.trim(),
        email: customerForm.email.trim(),
        company: customerForm.company.trim() || undefined,
        phone: customerForm.phone.trim() || undefined,
        timezone: customerForm.timezone.trim() || undefined,
        tags: customerForm.tags.filter(Boolean),
        notes: customerForm.notes.trim() || undefined,
        contacts: customerForm.contacts.filter((contact) => contact.name.trim()).map((contact) => ({
          name: contact.name.trim(),
          role: contact.role?.trim() || undefined,
          email: contact.email?.trim() || undefined,
          phone: contact.phone?.trim() || undefined,
        })),
        project_ids: customerForm.projectIds,
      });
      setCustomers((current) => [createdCustomer, ...current]);
      setIsCustomerDialogOpen(false);
      setCustomerForm(initialCustomerForm);
    } catch (error) {
      setCustomerFormError(error instanceof Error ? error.message : 'Unable to create customer');
    } finally {
      setIsSavingCustomer(false);
    }
  }

  async function handleUpdateCustomer() {
    if (!selectedCustomer || !selectedCustomer.name.trim() || !selectedCustomer.email.trim()) {
      setCustomerFormError('Customer name and primary email are required.');
      return;
    }

    setIsSavingCustomer(true);
    setCustomerFormError('');
    try {
      const updatedCustomer = await updateCustomerRequest(selectedCustomer.id, {
        name: selectedCustomer.name.trim(),
        email: selectedCustomer.email.trim(),
        company: selectedCustomer.company?.trim() || undefined,
        phone: selectedCustomer.phone?.trim() || undefined,
        timezone: selectedCustomer.timezone?.trim() || undefined,
        tags: selectedCustomer.tags.filter(Boolean),
        notes: selectedCustomer.notes?.trim() || undefined,
        contacts: selectedCustomer.contacts.filter((contact) => contact.name.trim()).map((contact) => ({
          name: contact.name.trim(),
          role: contact.role?.trim() || undefined,
          email: contact.email?.trim() || undefined,
          phone: contact.phone?.trim() || undefined,
        })),
        project_ids: selectedCustomer.project_ids,
      });
      setCustomers((current) => current.map((customer) => (customer.id === updatedCustomer.id ? updatedCustomer : customer)));
      setSelectedCustomer(updatedCustomer);
      setIsCustomerDetailEditing(false);
      setIsCustomerDetailOpen(false);
    } catch (error) {
      setCustomerFormError(error instanceof Error ? error.message : 'Unable to update customer');
    } finally {
      setIsSavingCustomer(false);
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
      setIsProjectDetailEditing(false);
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
        ...(createForm.designation.trim() ? { designation: createForm.designation.trim() } : {}),
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
        designation: editForm.designation.trim() || null,
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
      <UserManagementSection
        viewKey={`${selectedPage.id}-${currentModule}`}
        userSearch={userSearch}
        onUserSearchChange={setUserSearch}
        onOpenCreateUserDialog={openCreateUserDialog}
        userManagementError={userManagementError}
        filteredUsers={filteredUsers}
        isUsersLoading={isUsersLoading}
        renderRoleTag={renderRoleTag}
        onOpenEditUserDialog={openEditUserDialog}
        onOpenPasswordDialog={openPasswordDialog}
        dialogMode={dialogMode}
        isUserDialogOpen={isUserDialogOpen}
        onCloseUserDialog={() => setIsUserDialogOpen(false)}
        handleCreateUser={handleCreateUser}
        handleEditUser={handleEditUser}
        createForm={createForm}
        editForm={editForm}
        setCreateForm={setCreateForm}
        setEditForm={setEditForm}
        showCreatePassword={showCreatePassword}
        setShowCreatePassword={setShowCreatePassword}
        optionalRoleOptions={optionalRoleOptions}
        backendRoleOptions={backendRoleOptions}
        userFormError={userFormError}
        isSavingUser={isSavingUser}
        isPasswordDialogOpen={isPasswordDialogOpen}
        onClosePasswordDialog={() => setIsPasswordDialogOpen(false)}
        handlePasswordChange={handlePasswordChange}
        passwordForm={passwordForm}
        setPasswordForm={setPasswordForm}
        showNewPassword={showNewPassword}
        setShowNewPassword={setShowNewPassword}
        showConfirmPassword={showConfirmPassword}
        setShowConfirmPassword={setShowConfirmPassword}
        passwordFormError={passwordFormError}
        isSavingPassword={isSavingPassword}
      />
    );
  }

  function renderProjectManagement() {
    return (
      <ProjectManagementSection
        viewKey={`${selectedPage.id}-${currentModule}`}
        projectViewMode={projectViewMode}
        setProjectViewMode={setProjectViewMode}
        projectSearch={projectSearch}
        setProjectSearch={setProjectSearch}
        openCreateProjectDialog={openCreateProjectDialog}
        projectError={projectError}
        filteredProjects={filteredProjects}
        isProjectsLoading={isProjectsLoading}
        openProjectDetailDialog={openProjectDetailDialog}
        userLookup={userLookup}
        projectStatusSeverities={projectStatusSeverities}
        projectsByStatus={projectsByStatus}
        isProjectDialogOpen={isProjectDialogOpen}
        setIsProjectDialogOpen={setIsProjectDialogOpen}
        projectStep={projectStep}
        goToProjectStep={goToProjectStep}
        projectForm={projectForm}
        setProjectForm={setProjectForm}
        projectStatusOptions={projectStatusOptions}
        leadOptions={leadOptions}
        memberOptions={memberOptions}
        projectFormError={projectFormError}
        isSavingProject={isSavingProject}
        handleCreateProject={handleCreateProject}
        setProjectStep={setProjectStep}
        isProjectDetailOpen={isProjectDetailOpen}
        setIsProjectDetailOpen={setIsProjectDetailOpen}
        selectedProject={selectedProject}
        isProjectDetailEditing={isProjectDetailEditing}
        setIsProjectDetailEditing={setIsProjectDetailEditing}
        setSelectedProject={setSelectedProject}
        projectDetailMemberOptions={projectDetailMemberOptions}
        cancelProjectDetailEditing={cancelProjectDetailEditing}
        projectDetailError={projectDetailError}
        isSavingProjectDetail={isSavingProjectDetail}
        handleUpdateProject={handleUpdateProject}
      />
    );
  }

  function renderTicketConfiguration() {
    return (
      <TicketConfigurationSection
        viewKey={`${selectedPage.id}-${currentModule}`}
        rows={ticketConfigurations}
        isLoading={isTicketConfigLoading}
        error={ticketConfigError}
        onCreate={handleCreateTicketConfiguration}
        onUpdate={handleUpdateTicketConfiguration}
        onDelete={handleDeleteTicketConfiguration}
      />
    );
  }

  const canManageCalendarEvents = role === 'admin' || role === 'teamLead';
  const canCreateCalendarEvents =
    role === 'admin' || role === 'teamLead' || role === 'teamMember';

  function renderCalendarWorkspace() {
    return (
      <CalendarWorkspace
        viewKey={`${selectedPage.id}-${currentModule}`}
        events={calendarEvents}
        isLoading={isCalendarEventsLoading}
        canCreateEvents={canCreateCalendarEvents}
        canManageEvents={canManageCalendarEvents}
        projects={projects}
        onToggleMilestone={handleCalendarMilestoneToggle}
        onMonthRangeChange={handleCalendarMonthRange}
        onCreated={refreshCalendarEvents}
      />
    );
  }

  function renderCalendarEventsTable() {
    return (
      <CalendarEventsTable
        viewKey={`${selectedPage.id}-${currentModule}`}
        rows={allCalendarEvents}
        isLoading={isAllCalendarEventsLoading}
        canCreateEvents={canCreateCalendarEvents}
        canManageEvents={canManageCalendarEvents}
        projects={projects}
        onActivitySaved={refreshCalendarEvents}
      />
    );
  }

  function renderTicketManagement() {
    const isLead = role === 'teamLead';
    const isLeadCreateModule = isLead && currentModule === 'Create Ticket';
    return (
      <TicketManagementSection
        viewKey={`${selectedPage.id}-${currentModule}`}
        ticketModule={currentModule}
        search={ticketSearch}
        viewMode={ticketViewMode}
        onViewModeChange={setTicketViewMode}
        tickets={tickets}
        isLoading={isTicketsLoading}
        error={ticketsError}
        projects={projects}
        customers={customers}
        assignableUsers={assignableUsers}
        ticketConfigurations={ticketConfigurations}
        currentUserId={ticketWorkspaceUserId}
        onRefresh={() => void (isLead ? loadTicketsForLead() : loadTicketsForMember())}
        onCreateTicket={handleLeadCreateTicket}
        onUpdateTicket={handleLeadUpdateTicket}
        onPatchStatus={handleLeadPatchTicketStatus}
        onReopenTicket={handleLeadReopenTicket}
        ticketRole={isLead ? 'lead' : 'member'}
        canCreateTickets={isLeadCreateModule}
        canEditTickets={isLead || role === 'teamMember'}
        canDeleteTickets={isLead}
        onDeleteTicket={handleLeadDeleteTicket}
        focusTicketId={focusedTicketIdFromNotification}
      />
    );
  }

  function renderCustomerManagement() {
    return (
      <CustomerManagementSection
        viewKey={`${selectedPage.id}-${currentModule}`}
        isCustomerDialogOpen={isCustomerDialogOpen}
        customerSearch={customerSearch}
        onCustomerSearchChange={setCustomerSearch}
        onOpenCreateCustomerDialog={openCreateCustomerDialog}
        customerError={customerError}
        filteredCustomers={filteredCustomers}
        isCustomersLoading={isCustomersLoading}
        projects={projects}
        onOpenCustomerDetailDialog={openCustomerDetailDialog}
        customerForm={customerForm}
        setCustomerForm={setCustomerForm}
        onCloseCreateCustomerDialog={() => setIsCustomerDialogOpen(false)}
        addCustomerContactRow={addCustomerContactRow}
        updateCustomerContactRow={updateCustomerContactRow}
        removeCustomerContactRow={removeCustomerContactRow}
        customerFormError={customerFormError}
        isSavingCustomer={isSavingCustomer}
        handleCreateCustomer={handleCreateCustomer}
        isCustomerDetailOpen={isCustomerDetailOpen}
        selectedCustomer={selectedCustomer}
        isCustomerDetailEditing={isCustomerDetailEditing}
        setIsCustomerDetailEditing={setIsCustomerDetailEditing}
        setSelectedCustomer={setSelectedCustomer}
        cancelCustomerDetailEditing={cancelCustomerDetailEditing}
        handleUpdateCustomer={handleUpdateCustomer}
        setIsCustomerDetailOpen={setIsCustomerDetailOpen}
      />
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

  function renderActivePageContent() {
    if (selectedPage.id === 'projects') {
      return (
        <ProjectsPage
          activeModule={currentModule}
          viewContent={renderProjectManagement()}
          userManagementContent={renderUserManagement()}
          fallbackContent={renderDefaultContent()}
        />
      );
    }

    if (selectedPage.id === 'knowledgeBase') {
      return (
        <KnowledgeBasePage
          activeModule={currentModule}
          configurationContent={renderTicketConfiguration()}
          articlesContent={renderDefaultContent()}
          customersContent={renderCustomerManagement()}
          fallbackContent={renderDefaultContent()}
        />
      );
    }

    if (selectedPage.id === 'sprints') {
      if (role === 'teamLead' || role === 'teamMember') {
        return (
          <SprintsWorkspace
            viewKey={`${selectedPage.id}-${currentModule}`}
            activeModule={currentModule}
            role={role}
          />
        );
      }
      return renderDefaultContent();
    }

    if (selectedPage.id === 'calendar') {
      return (
        <CalendarPage
          activeModule={currentModule}
          calendarContent={renderCalendarWorkspace()}
          tableContent={renderCalendarEventsTable()}
          personalTasksContent={
            role === 'teamLead' || role === 'teamMember' ? (
              <PersonalTasksWorkspace viewKey={`personal-tasks-${currentModule}`} />
            ) : (
              renderDefaultContent()
            )
          }
          fallbackContent={renderDefaultContent()}
        />
      );
    }

    if (selectedPage.id === 'tickets') {
      if (role === 'teamLead' || role === 'teamMember') {
        return <TicketsPage content={renderTicketManagement()} />;
      }
      return renderDefaultContent();
    }

    if (selectedPage.id === 'chat') {
      if (role === 'teamLead' || role === 'teamMember') {
        return <ChatWorkspace currentUserId={sessionProfile?.id ?? null} />;
      }
      return renderDefaultContent();
    }

    if (selectedPage.id === 'kb' && (role === 'teamLead' || role === 'teamMember') && currentModule === 'Documents') {
      return (
        <KbDocumentsWorkspace viewKey={`${selectedPage.id}-${currentModule}`} projects={projects} />
      );
    }

    return renderDefaultContent();
  }

  return (
    <div className="app-root">
      <AnimatePresence mode="wait">
        {!isAuthenticated ? (
          <LoginPage
            employeeId={employeeId}
            password={password}
            loginError={loginError}
            isSubmitting={isSubmitting}
            onSubmit={handleLogin}
            onEmployeeIdChange={setEmployeeId}
            onPasswordChange={setPassword}
          />
        ) : (
          <motion.main
            key="dashboard"
            className="dashboard-shell"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            <TopHeader
              workspaceRole={role}
              topNav={topNav}
              selectedPageId={selectedPage.id}
              onSelectPage={(pageId) => {
                const page = topNav.find((item) => item.id === pageId);
                if (page) {
                  selectPage(page);
                }
              }}
              currentUserAvatar={currentUserAvatar}
              currentUserAvatarUrl={sessionProfile?.avatar_url ?? null}
              currentThemePreference={sessionProfile?.theme_preference ?? DEFAULT_THEME}
              currentUserName={currentUserName}
              currentUserRoleLabel={roleLabels[role]}
              currentUserIdentifier={currentUserIdentifier}
              currentUserId={sessionProfile?.id}
              currentUserEmail={sessionProfile?.email ?? ''}
              currentUserGithubUrl={sessionProfile?.github_url ?? null}
              currentUserLinkedinUrl={sessionProfile?.linkedin_url ?? null}
              currentUserCreatedAt={sessionProfile?.created_at ?? ''}
              tickets={tickets}
              events={allCalendarEvents}
              notifications={pendingApprovalNotifications}
              notificationBusyId={notificationBusyId}
              notificationReadBusyId={notificationReadBusyId}
              notificationDeleteBusyId={notificationDeleteBusyId}
              notificationDeleteAllBusy={notificationDeleteAllBusy}
              onDeleteAllNotifications={() => {
                void handleDeleteAllNotifications();
              }}
              onAcknowledgeNotification={(requestId, ticketId) => {
                void handleAcknowledgeApprovalFromHeader(requestId, ticketId);
              }}
              onMarkNotificationRead={(notificationId) => {
                void handleMarkNotificationRead(notificationId);
              }}
              onDeleteNotification={(notificationId) => {
                void handleDeleteNotification(notificationId);
              }}
              onUpdateProfile={handleUpdateCurrentUserProfile}
              onUpdateThemePreference={handleUpdateThemePreference}
              onUpdatePassword={handleUpdateCurrentUserPassword}
              onLogout={logout}
            />

            <section
              className={`dashboard-body ${selectedPage.modules.length > 0 && isSidebarCollapsed ? 'dashboard-body--sidebar-collapsed' : ''}`}
            >
              {selectedPage.modules.length > 0 ? (
                <ModuleSidebar
                  pageLabel={selectedPage.label}
                  modules={selectedPage.modules}
                  activeModule={activeModule}
                  onSelectModule={setActiveModule}
                  isCollapsed={isSidebarCollapsed}
                  onToggleCollapse={() => setIsSidebarCollapsed((previous) => !previous)}
                />
              ) : null}
              <section className="content-panel">
                {renderActivePageContent()}
              </section>
            </section>
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
