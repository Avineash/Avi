import { Icon, type IconName } from '@staffhub/ui';

const MAP = {
  not_started: { status: 'cancelled', icon: 'ban', label: 'Not started' },
  open: { status: 'pending', icon: 'clock', label: 'In progress' },
  closed: { status: 'approved', icon: 'check-circle', label: 'Closed' },
  incomplete: { status: 'rejected', icon: 'alert', label: 'Closed with gaps' },
} as const satisfies Record<string, { status: string; icon: IconName; label: string }>;

/** Audit status. Reuses the status tokens (so it follows the tenant's palette) and always pairs an icon with text. */
export function AuditPill({ kind }: { kind: keyof typeof MAP }) {
  const m = MAP[kind];
  return <span className="ds-status" data-status={m.status}><Icon name={m.icon} size={15} /><span>{m.label}</span></span>;
}
export const longDate = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const shortDate = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
