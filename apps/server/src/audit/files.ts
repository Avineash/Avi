import { HttpError } from '../http.ts';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Saved report files are working papers, not an archive: they are deleted after a week. */
export const FILE_RETENTION_DAYS = 7;

const starts = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/** Identifies the real type from the bytes. Only report-style files are accepted; anything executable or scriptable is refused. */
export function sniffReport(bytes: Uint8Array, name: string): { mime: string; ext: string } {
  if (bytes.length === 0) throw new HttpError(400, 'empty_file', 'The file is empty.');
  if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, 'file_too_large', `Files are limited to ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const ext = (name.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1]) ?? '';
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46])) return { mime: 'application/pdf', ext: 'pdf' };
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47])) return { mime: 'image/png', ext: 'png' };
  if (starts(bytes, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04]) && ext === 'xlsx') return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
  if ((ext === 'csv' || ext === 'txt') && !bytes.includes(0)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return { mime: ext === 'csv' ? 'text/csv' : 'text/plain', ext }; } catch { /* not text */ }
  }
  throw new HttpError(415, 'unsupported_file', 'Attach a PDF, PNG, JPEG, XLSX, CSV or TXT file.');
}

/** A safe display/download name: no path, no control characters, bounded length, extension matches the real type. */
export function safeFileName(raw: string, ext: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'report';
  const stem = base.replace(/\.[^.]*$/, '').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim().slice(0, 80) || 'report';
  return `${stem}.${ext}`;
}
