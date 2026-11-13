import { HttpError } from '../http.ts';

export type AssetKind = 'logo' | 'logoDark' | 'favicon';
export const ASSET_KINDS: readonly AssetKind[] = ['logo', 'logoDark', 'favicon'];
export const MAX_BYTES: Record<AssetKind, number> = { logo: 512 * 1024, logoDark: 512 * 1024, favicon: 256 * 1024 };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** SVG is XML, and XML can carry script. We accept only plain, static graphics. */
const SVG_FORBIDDEN: Array<[RegExp, string]> = [
  [/<\s*script/i, 'scripts'],
  [/<\s*foreignObject/i, 'foreignObject'],
  [/<\s*(iframe|embed|object|audio|video|link|meta)\b/i, 'embedded content'],
  [/\son[a-z]+\s*=/i, 'event handlers'],
  [/javascript\s*:/i, 'javascript: URLs'],
  [/<!ENTITY|<!DOCTYPE[^>]*\[/i, 'XML entities'],
  [/(?:xlink:)?href\s*=\s*["']\s*(?!#)[^"']/i, 'external references'],
  [/url\(\s*["']?\s*(?!#)(?:https?:|\/\/|data:)/i, 'external references'],
  [/@import/i, 'CSS imports'],
];

/** Identifies the real content type from the bytes (never trusting the client's header) and rejects anything unsafe. */
export function inspectImage(bytes: Uint8Array, kind: AssetKind): { mime: string } {
  const max = MAX_BYTES[kind];
  if (bytes.length === 0) throw new HttpError(400, 'empty_file', 'The uploaded file is empty.');
  if (bytes.length > max) throw new HttpError(413, 'file_too_large', `Maximum size for this image is ${Math.round(max / 1024)} KB.`);

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png' };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg' };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: 'image/webp' };
  if (kind === 'favicon' && startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return { mime: 'image/x-icon' };

  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 512)).replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) {
    const text = new TextDecoder().decode(bytes);
    for (const [re, what] of SVG_FORBIDDEN) {
      if (re.test(text)) throw new HttpError(422, 'unsafe_svg', `This SVG contains ${what}, which is not allowed. Export a plain SVG without scripts or external links.`);
    }
    return { mime: 'image/svg+xml' };
  }
  throw new HttpError(415, 'unsupported_image', 'Upload a PNG, JPEG, WebP or SVG file' + (kind === 'favicon' ? ' (or ICO).' : '.'));
}
