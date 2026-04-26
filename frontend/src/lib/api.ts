export type BackendRole = 'ADMIN' | 'LEAD' | 'MEMBER';
export type ThemePreference = 'light' | 'dark' | 'midnight';

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  role: BackendRole;
};

export type UserRecord = {
  id: string;
  employee_id: string;
  name: string;
  email: string;
  role: BackendRole;
  is_active: boolean;
  avatar_url?: string | null;
  theme_preference?: ThemePreference;
  created_at: string;
};

export type UserCreatePayload = {
  employee_id: string;
  name: string;
  email: string;
  password: string;
  role?: BackendRole;
};

export type UserUpdatePayload = {
  employee_id: string;
  name: string;
  email: string;
  role?: BackendRole;
  is_active: boolean;
  avatar_url?: string | null;
  theme_preference?: ThemePreference;
};

export type UserSelfUpdatePayload = {
  name: string;
  email: string;
  avatar_url?: string | null;
  theme_preference?: ThemePreference;
};

export type ProjectStatus = 'active' | 'on-hold' | 'completed' | 'archived';

export type ProjectRecord = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  lead_id: string | null;
  member_ids: string[];
  tech_tags: string[];
  created_at: string;
};

export type ProjectCreatePayload = {
  name: string;
  description?: string;
  status: ProjectStatus;
  lead_id?: string;
  member_ids: string[];
  tech_tags: string[];
};

export type CustomerContact = {
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type CustomerRecord = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  timezone: string | null;
  tags: string[];
  notes: string | null;
  contacts: CustomerContact[];
  project_ids: string[];
  created_at: string;
};

export type CustomerPayload = {
  name: string;
  email: string;
  company?: string;
  phone?: string;
  timezone?: string;
  tags: string[];
  notes?: string;
  contacts: CustomerContact[];
  project_ids: string[];
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const detail = errorBody?.detail;
    if (Array.isArray(detail)) {
      const message = detail
        .map((issue) => {
          if (issue && typeof issue === 'object') {
            const path = Array.isArray(issue.loc) ? issue.loc.join('.') : 'request';
            return `${path}: ${issue.msg ?? 'invalid value'}`;
          }
          return String(issue);
        })
        .join(' | ');
      throw new Error(message || 'Request failed');
    }
    if (typeof detail === 'string') {
      throw new Error(detail);
    }
    throw new Error('Request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function getAuthHeaders() {
  const token = localStorage.getItem('accessToken');

  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function loginRequest(employeeId: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      employee_id: employeeId,
      password,
    }),
  });

  return parseResponse<LoginResponse>(response);
}

export async function getUsersRequest(): Promise<UserRecord[]> {
  const response = await fetch(`${API_BASE_URL}/users`, {
    headers: getAuthHeaders(),
  });

  return parseResponse<UserRecord[]>(response);
}

/** Current user profile (includes id for assignment filters). */
export async function getCurrentUserRequest(): Promise<UserRecord> {
  const response = await fetch(`${API_BASE_URL}/users/me`, {
    headers: getAuthHeaders(),
  });
  return parseResponse<UserRecord>(response);
}

/** Active users for ticket assignment (admin + team lead). */
export async function getAssignableUsersRequest(): Promise<UserRecord[]> {
  const response = await fetch(`${API_BASE_URL}/users/assignable`, {
    headers: getAuthHeaders(),
  });

  return parseResponse<UserRecord[]>(response);
}

export async function createUserRequest(payload: UserCreatePayload): Promise<UserRecord> {
  const response = await fetch(`${API_BASE_URL}/users`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  return parseResponse<UserRecord>(response);
}

export async function updateUserRequest(userId: string, payload: UserUpdatePayload): Promise<UserRecord> {
  const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  return parseResponse<UserRecord>(response);
}

export async function updateUserPasswordRequest(userId: string, password: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/users/${userId}/password`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ password }),
  });

  return parseResponse<void>(response);
}

export async function updateCurrentUserRequest(payload: UserSelfUpdatePayload): Promise<UserRecord> {
  const response = await fetch(`${API_BASE_URL}/users/me`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse<UserRecord>(response);
}

export async function updateCurrentUserPasswordRequest(password: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/users/me/password`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ password }),
  });
  return parseResponse<void>(response);
}

export async function getProjectsRequest(): Promise<ProjectRecord[]> {
  const response = await fetch(`${API_BASE_URL}/projects`, {
    headers: getAuthHeaders(),
  });

  return parseResponse<ProjectRecord[]>(response);
}

export async function createProjectRequest(payload: ProjectCreatePayload): Promise<ProjectRecord> {
  const response = await fetch(`${API_BASE_URL}/projects`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  return parseResponse<ProjectRecord>(response);
}

export async function updateProjectRequest(projectId: string, payload: ProjectCreatePayload): Promise<ProjectRecord> {
  const response = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  return parseResponse<ProjectRecord>(response);
}

export async function getCustomersRequest(): Promise<CustomerRecord[]> {
  const response = await fetch(`${API_BASE_URL}/customers`, {
    headers: getAuthHeaders(),
  });

  return parseResponse<CustomerRecord[]>(response);
}

export async function createCustomerRequest(payload: CustomerPayload): Promise<CustomerRecord> {
  const response = await fetch(`${API_BASE_URL}/customers`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  return parseResponse<CustomerRecord>(response);
}

export async function updateCustomerRequest(customerId: string, payload: CustomerPayload): Promise<CustomerRecord> {
  const response = await fetch(`${API_BASE_URL}/customers/${customerId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  return parseResponse<CustomerRecord>(response);
}

export type TicketTypeValue =
  | 'bug_fix'
  | 'feature_request'
  | 'service_request'
  | 'design_rework'
  | 'performance_issue'
  | 'security_vulnerability'
  | 'documentation';

export type TicketConfigurationRecord = {
  id: string;
  ticket_type: string;
  display_name: string | null;
  code: string;
  created_at: string;
  updated_at: string;
};

export type TicketConfigurationCreatePayload = {
  ticket_type: string;
  code: string;
  display_name?: string | null;
};

export type TicketConfigurationUpdatePayload = {
  code: string;
  display_name?: string | null;
};

export async function getTicketConfigurationRequest(): Promise<TicketConfigurationRecord[]> {
  const response = await fetch(`${API_BASE_URL}/ticket-configuration`, {
    headers: getAuthHeaders(),
  });

  return parseResponse<TicketConfigurationRecord[]>(response);
}

export async function createTicketConfigurationRequest(payload: TicketConfigurationCreatePayload): Promise<TicketConfigurationRecord> {
  const response = await fetch(`${API_BASE_URL}/ticket-configuration`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  return parseResponse<TicketConfigurationRecord>(response);
}

export async function updateTicketConfigurationRequest(
  configId: string,
  payload: TicketConfigurationUpdatePayload,
): Promise<TicketConfigurationRecord> {
  const response = await fetch(`${API_BASE_URL}/ticket-configuration/${configId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  return parseResponse<TicketConfigurationRecord>(response);
}

export async function deleteTicketConfigurationRequest(configId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/ticket-configuration/${configId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  return parseResponse<void>(response);
}

export type EventMilestoneRecord = {
  id: string;
  title: string;
  target_date: string | null;
  completed_at: string | null;
  sort_order: number;
};

export type EventAttachmentRecord = {
  id: string;
  event_id: string;
  filename: string;
  file_size_bytes: number;
  mime_type: string;
  uploaded_by: string;
  uploader_name: string;
  created_at: string;
};

export type CalendarEventRecord = {
  id: string;
  project_id: string | null;
  project_name: string | null;
  created_by: string;
  title: string;
  description: string | null;
  event_type: string;
  start_at: string;
  end_at: string | null;
  status: string;
  progress_percent: number | null;
  created_at: string;
  updated_at: string;
  milestones: EventMilestoneRecord[];
  attachments: EventAttachmentRecord[];
};

export type CalendarEventCreatePayload = {
  project_id: string;
  title: string;
  description?: string | null;
  event_type: string;
  start_at: string;
  end_at?: string | null;
  status: string;
  progress_percent?: number | null;
  milestones: { title: string; target_date?: string | null; sort_order: number }[];
};

/** Full update body; backend treats fields as optional but we send a complete snapshot from the form. */
export type CalendarEventUpdatePayload = {
  project_id: string | null;
  title: string;
  description: string | null;
  event_type: string;
  start_at: string;
  end_at: string | null;
  status: string;
  progress_percent: number | null;
  milestones: { title: string; target_date?: string | null; sort_order: number }[];
};

export async function getEventsRequest(range?: { from: string; to: string }): Promise<CalendarEventRecord[]> {
  const search = new URLSearchParams();
  if (range?.from) {
    search.set('from', range.from);
  }
  if (range?.to) {
    search.set('to', range.to);
  }
  const query = search.toString();
  const response = await fetch(`${API_BASE_URL}/work/events${query ? `?${query}` : ''}`, {
    headers: getAuthHeaders(),
  });
  return parseResponse<CalendarEventRecord[]>(response);
}

export async function createCalendarEventRequest(payload: CalendarEventCreatePayload): Promise<CalendarEventRecord> {
  const response = await fetch(`${API_BASE_URL}/work/events`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse<CalendarEventRecord>(response);
}

export async function updateCalendarEventRequest(
  eventId: string,
  payload: CalendarEventUpdatePayload,
): Promise<CalendarEventRecord> {
  const response = await fetch(`${API_BASE_URL}/work/events/${eventId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse<CalendarEventRecord>(response);
}

export async function patchEventMilestoneRequest(
  eventId: string,
  milestoneId: string,
  completed: boolean,
): Promise<CalendarEventRecord> {
  const response = await fetch(`${API_BASE_URL}/work/events/${eventId}/milestones/${milestoneId}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ completed }),
  });
  return parseResponse<CalendarEventRecord>(response);
}

export function eventAttachmentFileUrl(eventId: string, attachmentId: string): string {
  return `${API_BASE_URL}/work/events/${eventId}/attachments/${attachmentId}/file`;
}

export async function uploadEventAttachmentRequest(eventId: string, file: File): Promise<CalendarEventRecord> {
  const token = localStorage.getItem('accessToken');
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`${API_BASE_URL}/work/events/${eventId}/attachments`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
  return parseResponse<CalendarEventRecord>(response);
}

export async function deleteEventAttachmentRequest(eventId: string, attachmentId: string): Promise<CalendarEventRecord> {
  const response = await fetch(`${API_BASE_URL}/work/events/${eventId}/attachments/${attachmentId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return parseResponse<CalendarEventRecord>(response);
}

export async function getEventAttachmentBlobRequest(eventId: string, attachmentId: string): Promise<Blob> {
  const token = localStorage.getItem('accessToken');
  const response = await fetch(eventAttachmentFileUrl(eventId, attachmentId), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const detail = errorBody?.detail;
    throw new Error(typeof detail === 'string' ? detail : 'Could not load file');
  }
  return response.blob();
}

export async function downloadEventAttachmentFile(
  eventId: string,
  attachmentId: string,
  filename: string,
): Promise<void> {
  const token = localStorage.getItem('accessToken');
  const response = await fetch(eventAttachmentFileUrl(eventId, attachmentId), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const detail = errorBody?.detail;
    throw new Error(typeof detail === 'string' ? detail : 'Download failed');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Team Lead KB — project-scoped folders and files */
export type ProjectDocumentFolderRecord = {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  created_by: string;
  created_at: string;
};

export type ProjectDocumentFileRecord = {
  id: string;
  project_id: string;
  folder_id: string | null;
  filename: string;
  file_size_bytes: number;
  mime_type: string;
  uploaded_by: string;
  uploader_name: string;
  created_at: string;
};

export async function listProjectDocumentFoldersRequest(
  projectId: string,
  parentId?: string | null,
): Promise<ProjectDocumentFolderRecord[]> {
  const q = new URLSearchParams();
  if (parentId) {
    q.set('parent_id', parentId);
  }
  const query = q.toString();
  const response = await fetch(
    `${API_BASE_URL}/work/projects/${projectId}/document-folders${query ? `?${query}` : ''}`,
    { headers: getAuthHeaders() },
  );
  return parseResponse<ProjectDocumentFolderRecord[]>(response);
}

export async function createProjectDocumentFolderRequest(
  projectId: string,
  payload: { name: string; parent_id?: string | null },
): Promise<ProjectDocumentFolderRecord> {
  const response = await fetch(`${API_BASE_URL}/work/projects/${projectId}/document-folders`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse<ProjectDocumentFolderRecord>(response);
}

export async function deleteProjectDocumentFolderRequest(projectId: string, folderId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/work/projects/${projectId}/document-folders/${folderId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return parseResponse<void>(response);
}

export async function listProjectDocumentFilesRequest(
  projectId: string,
  folderId?: string | null,
): Promise<ProjectDocumentFileRecord[]> {
  const q = new URLSearchParams();
  if (folderId) {
    q.set('folder_id', folderId);
  }
  const query = q.toString();
  const response = await fetch(
    `${API_BASE_URL}/work/projects/${projectId}/document-files${query ? `?${query}` : ''}`,
    { headers: getAuthHeaders() },
  );
  return parseResponse<ProjectDocumentFileRecord[]>(response);
}

export function projectDocumentFileDownloadUrl(projectId: string, fileId: string): string {
  return `${API_BASE_URL}/work/projects/${projectId}/document-files/${fileId}/file`;
}

export async function getProjectDocumentBlobRequest(projectId: string, fileId: string): Promise<Blob> {
  const token = localStorage.getItem('accessToken');
  const response = await fetch(projectDocumentFileDownloadUrl(projectId, fileId), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const detail = errorBody?.detail;
    throw new Error(typeof detail === 'string' ? detail : 'Could not load file');
  }
  return response.blob();
}

export async function downloadProjectDocumentFile(
  projectId: string,
  fileId: string,
  filename: string,
): Promise<void> {
  const token = localStorage.getItem('accessToken');
  const response = await fetch(projectDocumentFileDownloadUrl(projectId, fileId), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const detail = errorBody?.detail;
    throw new Error(typeof detail === 'string' ? detail : 'Download failed');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function uploadProjectDocumentFileRequest(
  projectId: string,
  file: File,
  folderId?: string | null,
): Promise<ProjectDocumentFileRecord> {
  const token = localStorage.getItem('accessToken');
  const q = new URLSearchParams();
  if (folderId) {
    q.set('folder_id', folderId);
  }
  const query = q.toString();
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(
    `${API_BASE_URL}/work/projects/${projectId}/document-files${query ? `?${query}` : ''}`,
    {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    },
  );
  return parseResponse<ProjectDocumentFileRecord>(response);
}

export async function deleteProjectDocumentFileRequest(projectId: string, fileId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/work/projects/${projectId}/document-files/${fileId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return parseResponse<void>(response);
}

/** Per-user day tasks — not calendar events or ticket tasks. */
export type PersonalTaskRecord = {
  id: string;
  user_id: string;
  task_date: string;
  title: string;
  body: string | null;
  is_completed: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type PersonalTasksForDayResponse = {
  pending_earlier: PersonalTaskRecord[];
  for_day: PersonalTaskRecord[];
};

export type PersonalTaskCreatePayload = {
  task_date: string;
  title: string;
  body?: string | null;
  sort_order?: number;
};

export type PersonalTaskUpdatePayload = {
  title?: string;
  body?: string | null;
  is_completed?: boolean;
  task_date?: string;
  sort_order?: number;
};

export async function getPersonalTasksForDayRequest(date: string): Promise<PersonalTasksForDayResponse> {
  const response = await fetch(
    `${API_BASE_URL}/work/personal-tasks/for-day?${new URLSearchParams({ date })}`,
    { headers: getAuthHeaders() },
  );
  return parseResponse<PersonalTasksForDayResponse>(response);
}

export async function createPersonalTaskRequest(payload: PersonalTaskCreatePayload): Promise<PersonalTaskRecord> {
  const response = await fetch(`${API_BASE_URL}/work/personal-tasks`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse<PersonalTaskRecord>(response);
}

export async function updatePersonalTaskRequest(
  taskId: string,
  payload: PersonalTaskUpdatePayload,
): Promise<PersonalTaskRecord> {
  const response = await fetch(`${API_BASE_URL}/work/personal-tasks/${taskId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse<PersonalTaskRecord>(response);
}

export async function deletePersonalTaskRequest(taskId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/work/personal-tasks/${taskId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return parseResponse<void>(response);
}

/** Deletes all personal tasks for the given calendar day (current user only). */
export async function deleteAllPersonalTasksForDayRequest(date: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/work/personal-tasks/for-day?${new URLSearchParams({ date })}`,
    {
      method: 'DELETE',
      headers: getAuthHeaders(),
    },
  );
  return parseResponse<void>(response);
}

export type PersonalTaskDaySummary = {
  task_date: string;
  total: number;
  open: number;
};

export async function getPersonalTasksMonthSummaryRequest(from: string, to: string): Promise<PersonalTaskDaySummary[]> {
  const params = new URLSearchParams({ from, to });
  const response = await fetch(`${API_BASE_URL}/work/personal-tasks/month-summary?${params}`, {
    headers: getAuthHeaders(),
  });
  return parseResponse<PersonalTaskDaySummary[]>(response);
}

export type TicketType =
  | 'bug_fix'
  | 'feature_request'
  | 'service_request'
  | 'design_rework'
  | 'performance_issue'
  | 'security_vulnerability'
  | 'documentation';

export type TicketPriority = 'critical' | 'high' | 'medium' | 'low';

export type TicketStatus = 'open' | 'in_progress' | 'in_review' | 'resolved' | 'closed';

export type TicketRecord = {
  id: string;
  ticket_number: number;
  /** Per-project + type reference from configuration, e.g. SR0001 */
  public_reference: string | null;
  title: string;
  description: string | null;
  type: TicketType;
  priority: TicketPriority;
  status: TicketStatus;
  project_id: string;
  created_by: string;
  created_by_name?: string | null;
  created_by_avatar_url?: string | null;
  assignee_ids: string[];
  assignee_names?: string[];
  customer_id: string | null;
  due_date: string | null;
  is_overdue: boolean;
  closed_at: string | null;
  resolved_by: string | null;
  resolved_by_name?: string | null;
  closed_by: string | null;
  closed_by_name?: string | null;
  sprint_id: string | null;
  carried_from_sprint_id?: string | null;
  carried_over_at?: string | null;
  carryover_count?: number;
  current_cycle_id?: string | null;
  current_cycle_version?: number | null;
  created_at: string;
  updated_at: string;
};

export type TicketCycleRecord = {
  id: string;
  ticket_id: string;
  version_no: number;
  sprint_id: string | null;
  status: TicketStatus;
  reopen_reason: string | null;
  reopened_by: string | null;
  reopened_by_name?: string | null;
  reopened_at: string | null;
  previous_cycle_id: string | null;
  closed_at: string | null;
  closed_by: string | null;
  closed_by_name?: string | null;
  created_at: string;
  updated_at: string;
};

export type TicketCreatePayload = {
  title: string;
  description?: string | null;
  type: TicketType;
  priority: TicketPriority;
  project_id: string;
  assigned_to?: string[];
  customer_id?: string | null;
  due_date?: string | null;
  sprint_id?: string | null;
};

export type TicketUpdatePayload = {
  title?: string;
  description?: string | null;
  type?: TicketType;
  priority?: TicketPriority;
  project_id?: string;
  assigned_to?: string[];
  customer_id?: string | null;
  due_date?: string | null;
  sprint_id?: string | null;
};

export async function getTicketsRequest(options?: { assignee_me?: boolean }): Promise<TicketRecord[]> {
  const search = new URLSearchParams();
  if (options?.assignee_me) {
    search.set('assignee_me', 'true');
  }
  const q = search.toString();
  const response = await fetch(`${API_BASE_URL}/tickets${q ? `?${q}` : ''}`, {
    headers: getAuthHeaders(),
  });
  return parseResponse<TicketRecord[]>(response);
}

export async function getTicketRequest(ticketId: string): Promise<TicketRecord> {
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}`, {
    headers: getAuthHeaders(),
  });
  return parseResponse<TicketRecord>(response);
}

export type TicketCommentRecord = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_name: string;
  author_avatar_url?: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
  updated_at: string;
};

export type TicketCommentCreatePayload = {
  body: string;
  is_internal?: boolean;
};

export async function getTicketCommentsRequest(ticketId: string, cycleId?: string): Promise<TicketCommentRecord[]> {
  const params = new URLSearchParams();
  if (cycleId) {
    params.set('cycle_id', cycleId);
  }
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/comments${params.size ? `?${params}` : ''}`, {
    headers: getAuthHeaders(),
  });
  return parseResponse<TicketCommentRecord[]>(response);
}

export async function postTicketCommentRequest(
  ticketId: string,
  payload: TicketCommentCreatePayload,
  options?: { cycle_id?: string },
): Promise<TicketCommentRecord> {
  const params = new URLSearchParams();
  if (options?.cycle_id) {
    params.set('cycle_id', options.cycle_id);
  }
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/comments${params.size ? `?${params}` : ''}`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse<TicketCommentRecord>(response);
}

export type TicketHistoryRecord = {
  id: string;
  changed_by: string;
  changer_name: string;
  changer_avatar_url?: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  change_note?: string | null;
  created_at: string;
};

export async function getTicketHistoryRequest(ticketId: string): Promise<TicketHistoryRecord[]> {
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/history`, {
    headers: getAuthHeaders(),
  });
  return parseResponse<TicketHistoryRecord[]>(response);
}

export type ResolutionRecord = {
  id: string;
  ticket_id: string;
  ticket_cycle_id?: string | null;
  resolved_by: string;
  resolver_name: string;
  resolver_avatar_url?: string | null;
  summary: string;
  root_cause: string | null;
  steps_taken: string | null;
  kb_article_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ResolutionUpsertPayload = {
  summary: string;
  root_cause?: string | null;
  steps_taken?: string | null;
  kb_article_id?: string | null;
};

export async function getTicketResolutionRequest(ticketId: string, cycleId?: string): Promise<ResolutionRecord | null> {
  const params = new URLSearchParams();
  if (cycleId) {
    params.set('cycle_id', cycleId);
  }
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/resolution${params.size ? `?${params}` : ''}`, {
    headers: getAuthHeaders(),
  });
  if (response.status === 404) {
    return null;
  }
  return parseResponse<ResolutionRecord>(response);
}

export async function putTicketResolutionRequest(
  ticketId: string,
  payload: ResolutionUpsertPayload,
  options?: { cycle_id?: string },
): Promise<ResolutionRecord> {
  const params = new URLSearchParams();
  if (options?.cycle_id) {
    params.set('cycle_id', options.cycle_id);
  }
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/resolution${params.size ? `?${params}` : ''}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse<ResolutionRecord>(response);
}

export type TicketAttachmentRecord = {
  id: string;
  comment_id?: string | null;
  ticket_cycle_id?: string | null;
  filename: string;
  file_size_bytes: number;
  mime_type: string;
  uploaded_by: string;
  uploader_name: string;
  uploader_avatar_url?: string | null;
  created_at: string;
};

export async function getTicketAttachmentsRequest(ticketId: string, cycleId?: string): Promise<TicketAttachmentRecord[]> {
  const params = new URLSearchParams();
  if (cycleId) {
    params.set('cycle_id', cycleId);
  }
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/attachments${params.size ? `?${params}` : ''}`, {
    headers: getAuthHeaders(),
  });
  return parseResponse<TicketAttachmentRecord[]>(response);
}

export async function uploadTicketAttachmentRequest(
  ticketId: string,
  file: File,
  commentId?: string,
  options?: { cycle_id?: string },
): Promise<TicketAttachmentRecord> {
  const token = localStorage.getItem('accessToken');
  const body = new FormData();
  body.append('file', file);
  if (commentId) {
    body.append('comment_id', commentId);
  }
  const params = new URLSearchParams();
  if (options?.cycle_id) {
    params.set('cycle_id', options.cycle_id);
  }
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/attachments${params.size ? `?${params}` : ''}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
  return parseResponse<TicketAttachmentRecord>(response);
}

export function ticketAttachmentFileUrl(ticketId: string, attachmentId: string): string {
  return `${API_BASE_URL}/tickets/${ticketId}/attachments/${attachmentId}/file`;
}

export async function downloadTicketAttachmentFile(
  ticketId: string,
  attachmentId: string,
  filename: string,
): Promise<void> {
  const token = localStorage.getItem('accessToken');
  const response = await fetch(ticketAttachmentFileUrl(ticketId, attachmentId), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const detail = errorBody?.detail;
    throw new Error(typeof detail === 'string' ? detail : 'Download failed');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function getTicketAttachmentBlobRequest(ticketId: string, attachmentId: string): Promise<Blob> {
  const token = localStorage.getItem('accessToken');
  const response = await fetch(ticketAttachmentFileUrl(ticketId, attachmentId), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const detail = errorBody?.detail;
    throw new Error(typeof detail === 'string' ? detail : 'Preview failed');
  }
  return response.blob();
}

export async function createTicketRequest(payload: TicketCreatePayload): Promise<TicketRecord> {
  const response = await fetch(`${API_BASE_URL}/tickets`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse<TicketRecord>(response);
}

export async function updateTicketRequest(ticketId: string, payload: TicketUpdatePayload): Promise<TicketRecord> {
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse<TicketRecord>(response);
}

export async function patchTicketStatusRequest(
  ticketId: string,
  status: TicketStatus,
  comment?: string | null,
): Promise<TicketRecord> {
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/status`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ status, comment: comment?.trim() || null }),
  });
  return parseResponse<TicketRecord>(response);
}

export type TicketReopenPayload = {
  reason: string;
  sprint_id?: string | null;
};

export async function getTicketCyclesRequest(ticketId: string): Promise<TicketCycleRecord[]> {
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/cycles`, {
    headers: getAuthHeaders(),
  });
  return parseResponse<TicketCycleRecord[]>(response);
}

export async function reopenTicketRequest(ticketId: string, payload: TicketReopenPayload): Promise<TicketRecord> {
  const body: { reason: string; sprint_id?: string } = { reason: payload.reason };
  const sprintId = typeof payload.sprint_id === 'string' ? payload.sprint_id.trim() : '';
  if (sprintId) {
    body.sprint_id = sprintId;
  }
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/reopen`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  return parseResponse<TicketRecord>(response);
}

export async function deleteTicketRequest(ticketId: string, password: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/delete`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const detail = errorBody?.detail;
    if (typeof detail === 'string') {
      throw new Error(detail);
    }
    throw new Error('Request failed');
  }
}

export type TicketApprovalRequestRecord = {
  id: string;
  ticket_id: string;
  ticket_reference: string | null;
  ticket_title: string;
  ticket_status: TicketStatus;
  requested_by: string;
  requested_by_name: string;
  requested_at: string;
  status: string;
};

export type TicketApprovalNotificationRecord = {
  notification_id: string;
  request_id: string | null;
  ticket_id: string;
  ticket_reference: string | null;
  ticket_title: string;
  ticket_status: TicketStatus;
  approval_request_status: string | null;
  requested_by_name: string | null;
  requested_at: string;
  is_read: boolean;
};

export async function createTicketApprovalRequest(ticketId: string): Promise<TicketApprovalRequestRecord> {
  const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/approval-request`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return parseResponse<TicketApprovalRequestRecord>(response);
}

export async function getPendingTicketApprovalRequests(): Promise<TicketApprovalRequestRecord[]> {
  const response = await fetch(`${API_BASE_URL}/tickets/approval-requests/pending`, {
    headers: getAuthHeaders(),
  });
  return parseResponse<TicketApprovalRequestRecord[]>(response);
}

export async function acknowledgeTicketApprovalRequest(requestId: string): Promise<TicketRecord> {
  const response = await fetch(`${API_BASE_URL}/tickets/approval-requests/${requestId}/acknowledge`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return parseResponse<TicketRecord>(response);
}

export async function getApprovalNotificationsRequest(): Promise<TicketApprovalNotificationRecord[]> {
  const response = await fetch(`${API_BASE_URL}/tickets/notifications/approval`, {
    headers: getAuthHeaders(),
  });
  return parseResponse<TicketApprovalNotificationRecord[]>(response);
}

export async function markApprovalNotificationReadRequest(notificationId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/tickets/notifications/${notificationId}/read`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
  });
  return parseResponse<void>(response);
}

export async function deleteApprovalNotificationRequest(notificationId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/tickets/notifications/${notificationId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return parseResponse<void>(response);
}

export async function deleteAllApprovalNotificationsRequest(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/tickets/notifications/approval/all`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return parseResponse<void>(response);
}

export type SprintRecord = {
  id: string;
  title: string;
  sprint_type: string;
  duration_days: number;
  start_date: string;
  end_date: string;
  project_ids: string[];
  created_by: string;
  created_by_name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type SprintCreatePayload = {
  title: string;
  sprint_type?: string;
  duration_days: number;
  start_date: string;
  project_ids: string[];
  status?: string;
};

export type SprintUpdatePayload = {
  title?: string;
  sprint_type?: string;
  duration_days?: number;
  start_date?: string;
  end_date?: string;
  project_ids?: string[];
  status?: string;
};

export type SprintTicketBrief = {
  id: string;
  public_reference: string | null;
  title: string;
  status: string;
  priority: string;
  assignee_names: string[];
  carried_from_sprint_id: string | null;
  carried_from_sprint_title: string | null;
  carryover_count: number;
};

export type SprintActiveMember = {
  id: string;
  name: string;
  avatar_url?: string | null;
};

export type SprintAnalyticsRecord = {
  sprint_id: string;
  title: string;
  total_tickets: number;
  by_status: Record<string, number>;
  tickets_done: number;
  tickets_remaining: number;
  progress_percent: number;
  tickets: SprintTicketBrief[];
  active_members: SprintActiveMember[];
};

export async function getSprintsRequest(): Promise<SprintRecord[]> {
  const response = await fetch(`${API_BASE_URL}/sprints`, { headers: getAuthHeaders() });
  return parseResponse<SprintRecord[]>(response);
}

export async function createSprintRequest(payload: SprintCreatePayload): Promise<SprintRecord> {
  const response = await fetch(`${API_BASE_URL}/sprints`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse<SprintRecord>(response);
}

export async function updateSprintRequest(sprintId: string, payload: SprintUpdatePayload): Promise<SprintRecord> {
  const response = await fetch(`${API_BASE_URL}/sprints/${sprintId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse<SprintRecord>(response);
}

export async function deleteSprintRequest(sprintId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/sprints/${sprintId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return parseResponse<void>(response);
}

export async function getSprintAnalyticsRequest(sprintId: string): Promise<SprintAnalyticsRecord> {
  const response = await fetch(`${API_BASE_URL}/sprints/${sprintId}/analytics`, { headers: getAuthHeaders() });
  return parseResponse<SprintAnalyticsRecord>(response);
}
