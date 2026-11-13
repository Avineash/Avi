import { EventEmitter } from "node:events";
import type { Queryable, Tx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { getSetting } from "./settings";

export type UnitStatus = "available" | "held" | "booked" | "waitlisted" | "buyback_requested" | "buyback_pending" | "released" | "cancelled" | "completed";

/** Allowed transitions. Anything else is a bug and is rejected. */
export const TRANSITIONS: Record<UnitStatus, UnitStatus[]> = {
  available: ["held", "released", "cancelled"],
  held: ["booked", "available", "released"],
  booked: ["completed", "cancelled", "buyback_requested"],
  buyback_requested: ["buyback_pending", "booked"],
  buyback_pending: ["booked", "cancelled"],
  cancelled: ["released"],
  released: ["waitlisted", "available"],
  waitlisted: ["held", "released", "available"],
  completed: [],
};

// ── Realtime fan-out (in-process; production uses Supabase Realtime or LISTEN/NOTIFY) ──
type G = typeof globalThis & { __eh_bus?: EventEmitter };
const bus = ((globalThis as G).__eh_bus ??= new EventEmitter().setMaxListeners(0));
export function subscribeListing(listingId: string, fn: () => void): () => void {
  bus.on(listingId, fn);
  return () => { bus.off(listingId, fn); };
}
export const emitListing = (listingId: string) => bus.emit(listingId);

export async function transition(
  tx: Tx, unitId: string, to: UnitStatus,
  o: { actor?: string | null; reason?: string; refType?: string; refId?: string; expectFrom?: UnitStatus[]; heldBy?: string | null; reservedUntil?: Date | null } = {},
) {
  const cur = (await tx.query<any>("select id, listing_id, status from inventory_units where id = $1 for update", [unitId])).rows[0];
  if (!cur) throw new DomainError("NOT_FOUND", "Inventory unit not found");
  const from = cur.status as UnitStatus;
  if (!TRANSITIONS[from].includes(to)) throw new DomainError("CONFLICT", `Illegal inventory transition ${from} → ${to}`);
  if (o.expectFrom && !o.expectFrom.includes(from)) throw new DomainError("CONFLICT", `Unit is ${from}, expected ${o.expectFrom.join("/")}`);
  const held = to === "held";
  await tx.query(
    `update inventory_units set status = $2, version = version + 1, updated_at = now(),
            held_by = $3, reserved_until = $4 where id = $1`,
    [unitId, to, held ? o.heldBy ?? null : null, held ? o.reservedUntil ?? null : null]);
  await tx.query(
    "insert into inventory_events(unit_id, from_status, to_status, actor_user_id, reason, ref_type, ref_id) values ($1,$2,$3,$4,$5,$6,$7)",
    [unitId, from, to, o.actor ?? null, o.reason ?? null, o.refType ?? null, o.refId ?? null]);
  tx.after(() => { emitListing(cur.listing_id); });
  return from;
}

export async function holdMinutes(c: Queryable): Promise<number> {
  return (await getSetting<{ minutes: number }>(c, "booking.hold_minutes", { minutes: 10 })).minutes;
}

/**
 * Atomically reserve `quantity` available units for a customer.
 * `FOR UPDATE SKIP LOCKED` means two concurrent checkouts can never receive the same unit;
 * the partial unique index on reservations is the second line of defence.
 */
export async function holdUnits(tx: Tx, a: { listingId: string; quantity: number; userId: string; now?: Date }) {
  const now = a.now ?? new Date();
  const l = (await tx.query<any>("select * from listings where id = $1", [a.listingId])).rows[0];
  if (!l) throw new DomainError("NOT_FOUND", "Listing not found");
  if (l.status !== "published") throw new DomainError("EXPIRED", "This listing is no longer open for booking");
  if (new Date(l.booking_deadline) <= now) throw new DomainError("EXPIRED", "The booking deadline for this listing has passed");
  if (a.quantity < 1 || a.quantity > l.max_per_booking) throw new DomainError("INVALID", `You can book between 1 and ${l.max_per_booking} at a time`);

  const picked = await tx.query<{ id: string }>(
    `select id from inventory_units where listing_id = $1 and status = 'available'
      order by label limit $2 for update skip locked`, [a.listingId, a.quantity]);
  if (picked.rows.length < a.quantity) {
    throw new DomainError("SOLD_OUT", picked.rows.length === 0 ? "Sorry — this has just sold out. Join the waitlist to be offered a place if one frees up." : `Only ${picked.rows.length} left`);
  }
  const until = new Date(now.getTime() + (await holdMinutes(tx)) * 60_000);
  for (const u of picked.rows) await transition(tx, u.id, "held", { actor: a.userId, reason: "checkout hold", heldBy: a.userId, reservedUntil: until });
  return { unitIds: picked.rows.map((r) => r.id), listing: l, reservedUntil: until };
}

export async function availability(c: Queryable, listingId: string) {
  const r = await c.query<any>("select * from listing_availability where listing_id = $1", [listingId]);
  return r.rows[0] ?? { total_units: 0, available_units: 0, held_units: 0, booked_units: 0, offered_units: 0 };
}
