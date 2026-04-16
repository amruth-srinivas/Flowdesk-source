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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.detail ?? 'Request failed');
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
