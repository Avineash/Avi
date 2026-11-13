import type { Queryable } from "@/lib/db";

export interface Actor { id: string | null; role: string | null; ip?: string | null }
export const SYSTEM: Actor = { id: null, role: "system" };

export async function audit(c: Queryable, actor: Actor, action: string, entity: string, entityId: string | null, meta: Record<string, unknown> = {}) {
  await c.query(
    "insert into audit_logs(actor_id, actor_role, action, entity, entity_id, meta, ip) values ($1,$2,$3,$4,$5,$6::jsonb,$7)",
    [actor.id, actor.role, action, entity, entityId, JSON.stringify(meta), actor.ip ?? null],
  );
}
