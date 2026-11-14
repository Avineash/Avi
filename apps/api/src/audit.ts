import type { Q } from './db.js';
export interface Actor { id?: string | null; role?: string | null; ip?: string }
export async function audit(q: Q, restaurantId: string | null, actor: Actor, action: string,
  entity?: string, entityId?: string, meta: object = {}) {
  await q.query(
    `insert into audit_log (restaurant_id, actor_id, actor_role, action, entity, entity_id, meta, ip)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [restaurantId, actor.id ?? null, actor.role ?? null, action, entity ?? null, entityId ?? null, JSON.stringify(meta), actor.ip ?? null]);
}
