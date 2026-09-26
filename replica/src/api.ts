export type Goal = 'sell' | 'fun';

export interface User {
  id: number;
  name: string;
  email: string;
  goal: Goal | null;
}

export interface SavedModel {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  volumeMm3: number;
  triangles: number;
  thumbnail: string | null;
  stlBytes: number;
  createdAt: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError('Can’t reach the server. Check your connection and try again.', 0);
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status}).`, res.status);
  return data as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  me: () => request<{ user: User | null }>('/auth/me').then((r) => r.user),
  signup: (name: string, email: string, password: string, goal: Goal | null) =>
    request<{ user: User }>('/auth/signup', json('POST', { name, email, password, goal })).then((r) => r.user),
  login: (email: string, password: string, goal: Goal | null) =>
    request<{ user: User }>('/auth/login', json('POST', { email, password, goal })).then((r) => r.user),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  setGoal: (goal: Goal) => request<{ user: User }>('/me', json('PATCH', { goal })).then((r) => r.user),
  listModels: () => request<{ models: SavedModel[] }>('/models').then((r) => r.models),
  async saveModel(meta: Omit<SavedModel, 'id' | 'stlBytes' | 'createdAt'>, stl: ArrayBuffer): Promise<SavedModel> {
    const { id } = await request<{ id: string }>('/models', json('POST', meta));
    const { model } = await request<{ model: SavedModel }>(`/models/${id}/stl`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: stl,
    });
    return model;
  },
  async modelStl(id: string): Promise<ArrayBuffer> {
    const res = await fetch(`/api/models/${encodeURIComponent(id)}/stl`, { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError('Couldn’t load that model.', res.status);
    return res.arrayBuffer();
  },
  stlUrl: (id: string) => `/api/models/${encodeURIComponent(id)}/stl`,
  deleteModel: (id: string) => request<{ ok: true }>(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
