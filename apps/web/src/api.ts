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

type H = Record<string, string>;
export const api = {
  get: <T>(path: string, headers?: H) => request<T>('GET', path, undefined, { headers }),
  post: <T>(path: string, body?: unknown, headers?: H) => request<T>('POST', path, body ?? {}, { headers }),
  put: <T>(path: string, body: unknown, headers?: H) => request<T>('PUT', path, body, { headers }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string, headers?: H) => request<T>('DELETE', path, undefined, { headers }),
  upload: <T>(path: string, file: File, headers?: H) => request<T>('POST', path, file, { headers: { 'content-type': 'application/octet-stream', ...headers } }),
};

export const assetUrl = (id: string | null | undefined) => (id ? `/api/assets/${id}` : null);
