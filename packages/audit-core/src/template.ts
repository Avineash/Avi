import type { AuditItem, AuditPhase, AuditStep, AuditTemplate } from './types.ts';

export const isPhase = (i: AuditItem): i is AuditPhase => i.kind !== 'roll';

export type TemplateResult = { ok: true; template: AuditTemplate } | { ok: false; errors: string[] };

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const TOOL = /^[a-z][a-z0-9-]{0,30}$/;
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);

/**
 * Validates an untrusted checklist template. Unknown keys are rejected so a typo never silently
 * drops a step, and nothing but plain text and http(s) links can enter the stored template.
 */
export function validateTemplate(input: unknown): TemplateResult {
  const errors: string[] = [];
  if (!obj(input)) return { ok: false, errors: ['Template must be an object.'] };
  for (const k of Object.keys(input)) if (!['name', 'phases', 'links', 'folders'].includes(k)) errors.push(`Unknown field "${k}".`);
  if (!text(input.name, 80)) errors.push('name is required (max 80 characters, no markup).');
  if (!Array.isArray(input.phases) || input.phases.length === 0 || input.phases.length > 40) errors.push('phases must be a list of 1–40 items.');

  const phases: AuditItem[] = [];
  const ids = new Set<string>();
  let rolls = 0;
  const claim = (id: unknown, where: string): id is string => {
    if (typeof id !== 'string' || !ID.test(id)) { errors.push(`${where}: id must be 1–40 letters, digits, - or _.`); return false; }
    if (ids.has(id)) { errors.push(`${where}: duplicate id "${id}".`); return false; }
    ids.add(id); return true;
  };

  (Array.isArray(input.phases) ? input.phases : []).forEach((p: unknown, pi) => {
    const w = `phases[${pi}]`;
    if (!obj(p)) return void errors.push(`${w} must be an object.`);
    if (p.kind === 'roll') {
      for (const k of Object.keys(p)) if (!['id', 'kind', 'label'].includes(k)) errors.push(`${w}: unknown field "${k}".`);
      if (claim(p.id, w)) {
        if (p.label !== undefined && !text(p.label, 60)) errors.push(`${w}.label is invalid.`);
        phases.push({ id: p.id as string, kind: 'roll', ...(p.label ? { label: p.label as string } : {}) });
        rolls++;
      }
      return;
    }
    for (const k of Object.keys(p)) if (!['id', 'name', 'when', 'steps', 'kind'].includes(k)) errors.push(`${w}: unknown field "${k}".`);
    const okId = claim(p.id, w);
    if (!text(p.name, 80)) errors.push(`${w}.name is required.`);
    if (p.when !== 'pre' && p.when !== 'post') errors.push(`${w}.when must be "pre" or "post".`);
    if (!Array.isArray(p.steps) || p.steps.length === 0 || p.steps.length > 60) { errors.push(`${w}.steps must be a list of 1–60 steps.`); return; }
    const steps: AuditStep[] = [];
    p.steps.forEach((s: unknown, si: number) => {
      const sw = `${w}.steps[${si}]`;
      if (!obj(s)) return void errors.push(`${sw} must be an object.`);
      for (const k of Object.keys(s)) if (!['id', 'text', 'key', 'subs', 'warn', 'due', 'tool', 'roll'].includes(k)) errors.push(`${sw}: unknown field "${k}".`);
      const ok = claim(s.id, sw);
      if (!text(s.text, 300)) errors.push(`${sw}.text is required (max 300 characters).`);
      const step: AuditStep = { id: String(s.id), text: String(s.text ?? '') };
      if (s.key !== undefined) { if (typeof s.key !== 'boolean') errors.push(`${sw}.key must be true or false.`); else if (s.key) step.key = true; }
      if (s.roll !== undefined) { if (typeof s.roll !== 'boolean') errors.push(`${sw}.roll must be true or false.`); else if (s.roll) step.roll = true; }
      if (s.subs !== undefined) {
        if (!Array.isArray(s.subs) || s.subs.length > 30 || !s.subs.every((x: unknown) => text(x, 300))) errors.push(`${sw}.subs must be a list of up to 30 short texts.`);
        else if (s.subs.length) step.subs = s.subs as string[];
      }
      for (const f of ['warn', 'due'] as const) if (s[f] !== undefined) { if (!text(s[f], 200)) errors.push(`${sw}.${f} is invalid.`); else step[f] = s[f] as string; }
      if (s.tool !== undefined) { if (typeof s.tool !== 'string' || !TOOL.test(s.tool)) errors.push(`${sw}.tool must be a short lowercase id.`); else step.tool = s.tool; }
      if (ok) steps.push(step);
    });
    if (okId) phases.push({ id: p.id as string, name: String(p.name), when: p.when as 'pre' | 'post', steps });
  });
  if (rolls > 1) errors.push('Only one roll marker is allowed.');

  let links: AuditTemplate['links'];
  if (input.links !== undefined) {
    if (!obj(input.links)) errors.push('links must be an object.');
    else {
      links = {};
      for (const [k, v] of Object.entries(input.links)) {
        if (!TOOL.test(k) || !obj(v) || !text(v.label, 60) || typeof v.url !== 'string') { errors.push(`links.${k} needs a label and a url.`); continue; }
        let ok = false;
        try { const u = new URL(v.url); ok = (u.protocol === 'https:' || u.protocol === 'http:') && v.url.length <= 500; } catch { /* invalid */ }
        if (!ok) errors.push(`links.${k}.url must be a valid http(s) address.`); else links[k] = { label: v.label as string, url: v.url };
      }
    }
  }
  let folders: AuditTemplate['folders'];
  if (input.folders !== undefined) {
    if (!obj(input.folders)) errors.push('folders must be an object.');
    else {
      folders = {};
      for (const [k, v] of Object.entries(input.folders)) {
        if (!text(k, 60) || !Array.isArray(v) || v.length > 80 || !v.every((x) => text(x, 120))) errors.push(`folders.${k} must be a list of short names.`); else folders[k] = v as string[];
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, template: { name: String(input.name).trim(), phases, ...(links ? { links } : {}), ...(folders ? { folders } : {}) } };
}

/** All steps in checklist order. */
export function allSteps(t: AuditTemplate): Array<{ phase: AuditPhase; step: AuditStep }> {
  return t.phases.filter(isPhase).flatMap((phase) => phase.steps.map((step) => ({ phase, step })));
}
