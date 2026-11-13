import { createApp } from '../app.ts';
import { openDb, all, type DB } from '../db.ts';
import { seedDemo } from '../seed.ts';

export function freshApp() {
  const db = openDb(':memory:');
  seedDemo(db);
  return { db, app: createApp({ db, demo: true }) };
}

export interface Client {
  email: string;
  get: (path: string, init?: RequestInit) => Promise<Response>;
  send: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>;
  json: <T = any>(res: Response) => Promise<T>;
}

export async function login(app: ReturnType<typeof createApp>, email: string, password = 'staffhub-demo'): Promise<Client> {
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'staffhub' }, body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  const send: Client['send'] = (method, path, body, headers = {}) =>
    app.request(path, {
      method,
      headers: { cookie, 'x-requested-with': 'staffhub', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? (body as BodyInit) : JSON.stringify(body),
    });
  return { email, send, get: (path, init) => app.request(path, { ...init, headers: { cookie, ...(init?.headers ?? {}) } }), json: async (r) => (await r.json()) as never };
}

export const ids = (db: DB, sql: string, ...p: unknown[]) => all<{ id: string }>(db, sql, ...p).map((r) => r.id);

// 1×1 transparent PNG
export const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
