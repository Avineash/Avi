import { randomBytes, scrypt, scryptSync, createCipheriv, createDecipheriv, createHmac, timingSafeEqual, createHash } from 'node:crypto';

export const token = (bytes = 16) => randomBytes(bytes).toString('base64url');

const scryptAsync = (pw: string, salt: Buffer, len: number, opts: object) =>
  new Promise<Buffer>((res, rej) => scrypt(pw, salt, len, opts, (e, k) => (e ? rej(e) : res(k))));

const N = 16384, R = 8, P = 1;
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 32, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(pw, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return timingSafeEqual(key, expected);
}
/** Burn the same CPU as a real verify so login timing doesn't reveal which emails exist. */
export function fakeVerify() { scryptSync('x', 'tableflow-dummy-salt', 32, { N, r: R, p: P }); }

/** AES-256-GCM envelope for provider credentials. Format: v1:iv:tag:ciphertext (base64). */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}
export function decryptSecret(enc: string, key: Buffer): string {
  const [v, iv, tag, ct] = enc.split(':');
  if (v !== 'v1') throw new Error('unknown secret format');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

export const hmacHex = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');
export const md5Upper = (s: string) => createHash('md5').update(s).digest('hex').toUpperCase();
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
