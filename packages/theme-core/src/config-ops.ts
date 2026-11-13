import type { ThemeConfig, ConfigGroup } from './schema.ts';
import { CONFIG_GROUPS, GROUP_LABELS } from './schema.ts';

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-merges theme layers left → right. Later layers win; `null` is a real value, `undefined` is skipped. */
export function mergeConfigs(...layers: Array<ThemeConfig | null | undefined>): ThemeConfig {
  const merge = (base: Plain, over: Plain): Plain => {
    const out: Plain = { ...base };
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) continue;
      const cur = out[k];
      out[k] = isPlain(v) && isPlain(cur) ? merge(cur, v) : isPlain(v) ? merge({}, v) : v;
    }
    return out;
  };
  let acc: Plain = {};
  for (const l of layers) if (l) acc = merge(acc, l as Plain);
  return acc as ThemeConfig;
}

export type Path = readonly string[];

export function getPath(config: ThemeConfig | undefined, path: Path): unknown {
  let cur: unknown = config;
  for (const k of path) {
    if (!isPlain(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

export const hasPath = (config: ThemeConfig | undefined, path: Path): boolean => getPath(config, path) !== undefined;

/** Immutable set. Creates intermediate objects as needed. */
export function setPath(config: ThemeConfig, path: Path, value: unknown): ThemeConfig {
  if (path.length === 0) return config;
  const [head, ...rest] = path as [string, ...string[]];
  const cur = (config as Plain)[head];
  const next = rest.length === 0 ? value : setPath((isPlain(cur) ? cur : {}) as ThemeConfig, rest, value);
  return { ...config, [head]: next } as ThemeConfig;
}

/** Immutable delete that also prunes objects left empty, so "reset to inherited" leaves no residue. */
export function deletePath(config: ThemeConfig, path: Path): ThemeConfig {
  if (path.length === 0) return config;
  const [head, ...rest] = path as [string, ...string[]];
  const cur = (config as Plain)[head];
  if (cur === undefined) return config;
  const copy: Plain = { ...(config as Plain) };
  if (rest.length === 0) delete copy[head];
  else if (isPlain(cur)) {
    const child = deletePath(cur as ThemeConfig, rest) as Plain;
    if (Object.keys(child).length === 0) delete copy[head];
    else copy[head] = child;
  }
  return copy as ThemeConfig;
}

/** Flattens a layer to `"colors.light.primary" → "#123456"` entries (leaves only). */
export function flattenConfig(config: ThemeConfig | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (node: unknown, prefix: string) => {
    if (isPlain(node)) for (const [k, v] of Object.entries(node)) walk(v, prefix ? `${prefix}.${k}` : k);
    else if (node !== undefined) out[prefix] = node;
  };
  walk(config, '');
  return out;
}

export interface ConfigChange { path: string; group: ConfigGroup; before: unknown; after: unknown }

/** Leaf-level differences between two (merged) configs. */
export function diffConfigs(before: ThemeConfig | undefined, after: ThemeConfig | undefined): ConfigChange[] {
  const a = flattenConfig(before), b = flattenConfig(after);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes: ConfigChange[] = [];
  for (const path of [...keys].sort()) {
    if (JSON.stringify(a[path]) !== JSON.stringify(b[path])) {
      changes.push({ path, group: path.split('.')[0] as ConfigGroup, before: a[path], after: b[path] });
    }
  }
  return changes;
}

export interface ChangeSummary { group: ConfigGroup; label: string; count: number }

export function summarizeChanges(changes: ConfigChange[]): ChangeSummary[] {
  return CONFIG_GROUPS
    .map((group) => ({ group, label: GROUP_LABELS[group], count: changes.filter((c) => c.group === group).length }))
    .filter((s) => s.count > 0);
}

export const isEmptyConfig = (c: ThemeConfig | undefined): boolean => !c || Object.keys(flattenConfig(c)).length === 0;

// ───────────── override policy (company → property delegation) ─────────────

/** Which groups a property-level administrator may override. Company administrators are never restricted. */
export type OverridePolicy = Record<ConfigGroup, boolean>;

export const DEFAULT_OVERRIDE_POLICY: OverridePolicy = {
  identity: true, colors: false, status: false, typography: false, shape: false, mode: false,
};

export function normalizePolicy(input: unknown): OverridePolicy {
  const out = { ...DEFAULT_OVERRIDE_POLICY };
  if (isPlain(input)) for (const g of CONFIG_GROUPS) if (typeof input[g] === 'boolean') out[g] = input[g] as boolean;
  return out;
}

export function groupsTouched(config: ThemeConfig | undefined): ConfigGroup[] {
  const flat = flattenConfig(config);
  return CONFIG_GROUPS.filter((g) => Object.keys(flat).some((p) => p.split('.')[0] === g));
}

/** Groups present in `config` that `policy` does not allow. */
export function policyViolations(config: ThemeConfig | undefined, policy: OverridePolicy): ConfigGroup[] {
  return groupsTouched(config).filter((g) => !policy[g]);
}
