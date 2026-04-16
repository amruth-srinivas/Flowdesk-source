export type BackendRole = 'ADMIN' | 'LEAD' | 'MEMBER';

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
