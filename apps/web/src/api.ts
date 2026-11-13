export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, any> = {}) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: { 'x-requested-with': 'staffhub', ...(body !== undefined && !(body instanceof Blob) ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data as any).error ?? {};
    const { code, message, ...extra } = e;
    throw new ApiError(res.status, code ?? 'error', message ?? 'Something went wrong.', extra);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, file: File) => request<T>('POST', path, file, { headers: { 'content-type': 'application/octet-stream' } }),
};

export const assetUrl = (id: string | null | undefined) => (id ? `/api/assets/${id}` : null);
