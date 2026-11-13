"use server";
import { z } from "zod";
import { actionUser, clientIp } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { setPartnerStatus } from "@/lib/domain/partners";
import { decideBuybackApproval } from "@/lib/domain/buyback";
import { decideRefundRequest, openDispute, resolveDispute, runPayout } from "@/lib/domain/finance";
import { issueManualRefund } from "@/lib/domain/booking";
import { runMaintenance } from "@/lib/domain/maintenance";
import { getSetting, setSetting } from "@/lib/domain/settings";
import { audit } from "@/lib/domain/audit";
import { DomainError } from "@/lib/errors";
import { checked, dollarsToCents, parse, run, type Result } from "./_util";

const id = z.string().uuid();
const actorOf = async (u: { id: string; role: string }) => ({ id: u.id, role: u.role, ip: await clientIp() });

export async function partnerStatusAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("admin:partners");
    const d = parse(z.object({ partnerId: id, status: z.enum(["approved", "suspended", "rejected"]), note: z.string().max(500).optional() }), fd);
    await setPartnerStatus({ partnerId: d.partnerId, status: d.status, actor: await actorOf(u), note: d.note });
    return `Partner ${d.status}.`;
  });
}

export async function userStatusAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("admin:portal");
    const d = parse(z.object({ userId: id, status: z.enum(["active", "suspended"]) }), fd);
    if (d.userId === u.id) throw new DomainError("INVALID", "You can't change your own status");
    const db = await getDb();
    await db.query("update users set status = $2, updated_at = now() where id = $1 and role <> 'admin'", [d.userId, d.status]);
    await audit(db, await actorOf(u), `user.${d.status}`, "user", d.userId);
    return `Account ${d.status}.`;
  });
}

export async function buybackDecisionAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("admin:buyback_approval");
    const d = parse(z.object({ offerId: id, approve: z.enum(["true", "false"]), note: z.string().max(400).optional() }), fd);
    await decideBuybackApproval({ offerId: d.offerId, approve: d.approve === "true", actor: await actorOf(u), note: d.note });
    return d.approve === "true" ? "Approved — the offer has been sent to the customer." : "Declined — the booking is unchanged.";
  });
}

export async function featureGateAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("admin:config");
    const d = parse(z.object({ key: z.enum(["features.buyback", "features.auto_reallocation", "features.event_resale"]), ref: z.string().max(200).optional(), capPct: z.coerce.number().min(100).max(200).optional() }), fd);
    const db = await getDb();
    const on = checked(fd, "enabled");
    if (on && (!d.ref || d.ref.trim().length < 4)) throw new DomainError("INVALID", "Enter the reference of the legal review that approved this feature (e.g. matter number or memo date) before enabling it.");
    const prev = await getSetting<any>(db, d.key, {});
    await setSetting(db, d.key, { ...prev, enabled: on, legal_review_ref: on ? d.ref!.trim() : null, approved_by: on ? u.id : null, approved_at: on ? new Date().toISOString() : null, ...(d.key === "features.event_resale" ? { cap_bps: Math.round((d.capPct ?? 110) * 100) } : {}) }, u.id);
    await audit(db, await actorOf(u), on ? "feature.enabled" : "feature.disabled", "setting", d.key, { legalReviewRef: d.ref ?? null });
    return on ? "Feature enabled. This is recorded in the audit log." : "Feature disabled.";
  });
}

export async function systemSettingsAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("admin:config");
    const d = parse(z.object({
      holdMinutes: z.coerce.number().int().min(2).max(60), procBps: z.coerce.number().min(0).max(1000), procFixed: z.string(),
      termsVersion: z.string().min(3).max(60), maxOffers: z.coerce.number().int().min(1).max(5), responseHours: z.coerce.number().int().min(1).max(168),
      minMult: z.coerce.number().min(0.1).max(1), maxMult: z.coerce.number().min(1).max(5),
    }), fd);
    const db = await getDb();
    await setSetting(db, "booking.hold_minutes", { minutes: d.holdMinutes }, u.id);
    await setSetting(db, "payments.processing", { bps: Math.round(d.procBps), fixed_cents: dollarsToCents(d.procFixed) ?? 30 }, u.id);
    await setSetting(db, "legal.terms_version", { version: d.termsVersion }, u.id);
    await setSetting(db, "buyback.limits", { max_offers_per_reservation: d.maxOffers, customer_response_hours: d.responseHours }, u.id);
    await setSetting(db, "pricing.bounds", { min_multiplier: d.minMult, max_multiplier: d.maxMult }, u.id);
    await audit(db, await actorOf(u), "settings.updated", "setting", "system");
    return "System configuration saved.";
  });
}

export async function saveFeeRuleAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("admin:config");
    const d = parse(z.object({
      payer: z.enum(["partner", "customer"]), appliesTo: z.enum(["booking", "buyback", "resale"]), scope: z.enum(["global", "category", "partner"]),
      category: z.enum(["hotel", "restaurant", "event", ""]).optional(), partnerId: z.string().optional(), kind: z.enum(["percentage", "fixed", "percent_plus_fixed"]),
      ratePct: z.coerce.number().min(0).max(100).default(0), note: z.string().max(200).optional(),
    }), fd);
    const fixed = dollarsToCents(fd.get("fixed")) ?? 0, min = dollarsToCents(fd.get("min")) ?? 0, max = dollarsToCents(fd.get("max"));
    if (d.scope === "category" && !d.category) throw new DomainError("INVALID", "Choose a category");
    if (d.scope === "partner" && !d.partnerId) throw new DomainError("INVALID", "Choose a partner");
    const db = await getDb();
    await db.tx(async (tx) => {
      const cat = d.scope === "category" ? d.category : null, pid = d.scope === "partner" ? d.partnerId : null;
      const old = await tx.query("update fee_rules set active = false where active and payer = $1 and applies_to = $2 and scope = $3 and coalesce(category,'') = coalesce($4,'') and coalesce(partner_id::text,'') = coalesce($5,'') returning id", [d.payer, d.appliesTo, d.scope, cat, pid]);
      const r = await tx.query<any>(
        `insert into fee_rules(payer, applies_to, scope, category, partner_id, kind, rate_bps, fixed_cents, min_cents, max_cents, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [d.payer, d.appliesTo, d.scope, cat, pid, d.kind, Math.round(d.ratePct * 100), fixed, min, max, d.note || null, u.id]);
      await audit(tx, await actorOf(u), "fee_rule.saved", "fee_rule", r.rows[0].id, { replaced: old.rows.map((x: any) => x.id), ...d, fixed, min, max });
    });
    return "Rule saved. It applies to bookings made from now on; existing bookings keep the fees they were charged.";
  });
}

export async function deactivateFeeRuleAction(fd: FormData) {
  const u = await actionUser("admin:config");
  const ruleId = id.parse(fd.get("ruleId"));
  const db = await getDb();
  const r = (await db.query<any>("select * from fee_rules where id = $1", [ruleId])).rows[0];
  if (!r) return;
  if (r.scope === "global") throw new DomainError("INVALID", "Global default rules can be edited but not switched off");
  await db.query("update fee_rules set active = false where id = $1", [ruleId]);
  await audit(db, await actorOf(u), "fee_rule.deactivated", "fee_rule", ruleId);
}

export async function runPayoutAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("admin:finance");
    const partnerId = id.parse(fd.get("partnerId"));
    const p = await runPayout(partnerId, await actorOf(u));
    return p ? `Payout of $${(Number(p.net_cents) / 100).toFixed(2)} ${p.status}.` : "Nothing payable yet (balance is zero, negative, or awaiting stay completion).";
  });
}

export async function runAllPayoutsAction(_: Result): Promise<Result> {
  return run(async () => {
    const u = await actionUser("admin:finance");
    const rows = (await (await getDb()).query<any>("select id from partners where status = 'approved'")).rows;
    let n = 0;
    for (const p of rows) if (await runPayout(p.id, await actorOf(u))) n++;
    return `${n} payout(s) created.`;
  });
}

export async function runMaintenanceAction(_: Result): Promise<Result> {
  return run(async () => {
    await actionUser("admin:config");
    const s = await runMaintenance();
    return `Maintenance ran: ${JSON.stringify(s)}`;
  });
}

export async function openDisputeAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("admin:finance");
    const d = parse(z.object({ reference: z.string().min(3), kind: z.enum(["dispute", "chargeback", "fraud"]), notes: z.string().min(3) }), fd);
    const r = (await (await getDb()).query<any>("select id, total_cents from reservations where upper(reference) = upper($1)", [d.reference.trim()])).rows[0];
    if (!r) throw new DomainError("NOT_FOUND", "No booking with that reference");
    await openDispute({ reservationId: r.id, kind: d.kind, amountCents: dollarsToCents(fd.get("amount")) ?? r.total_cents, notes: d.notes, actor: await actorOf(u) });
    return "Dispute opened.";
  });
}

export async function resolveDisputeAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("admin:finance");
    const d = parse(z.object({ disputeId: id, outcome: z.enum(["won", "lost", "closed"]), resolution: z.string().min(3) }), fd);
    await resolveDispute({ id: d.disputeId, outcome: d.outcome, resolution: d.resolution, actor: await actorOf(u) });
    return `Dispute marked ${d.outcome}.`;
  });
}

export async function refundRequestAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("admin:finance");
    const d = parse(z.object({ requestId: id, approve: z.enum(["true", "false"]), note: z.string().max(400).optional() }), fd);
    await decideRefundRequest({ id: d.requestId, approve: d.approve === "true", actor: await actorOf(u), note: d.note });
    return d.approve === "true" ? "Refund approved and issued." : "Request declined.";
  });
}

export async function adminRefundAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("admin:finance");
    const d = parse(z.object({ reference: z.string().min(3), reason: z.string().min(5), key: z.string().min(8) }), fd);
    const r = (await (await getDb()).query<any>("select id from reservations where upper(reference) = upper($1)", [d.reference.trim()])).rows[0];
    if (!r) throw new DomainError("NOT_FOUND", "No booking with that reference");
    const cents = dollarsToCents(fd.get("amount"));
    if (!cents) throw new DomainError("INVALID", "Enter an amount");
    await issueManualRefund({ reservationId: r.id, amountCents: cents, reason: d.reason, actor: await actorOf(u), idempotencyKey: d.key });
    return "Refund issued.";
  });
}

export async function listingAdminAction(fd: FormData) {
  const u = await actionUser("admin:portal");
  const d = parse(z.object({ listingId: id, op: z.enum(["pause", "publish", "feature", "unfeature"]) }), fd);
  const db = await getDb();
  const sql = { pause: "status = 'paused'", publish: "status = 'published'", feature: "featured = true", unfeature: "featured = false" }[d.op];
  await db.query(`update listings set ${sql}, updated_at = now() where id = $1`, [d.listingId]);
  await audit(db, await actorOf(u), `listing.${d.op}`, "listing", d.listingId);
}

export async function promotionAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("admin:portal");
    const d = parse(z.object({ listingId: id, label: z.string().min(2).max(40), days: z.coerce.number().int().min(1).max(60) }), fd);
    const db = await getDb();
    await db.query("insert into promotions(listing_id, label, ends_at, created_by) values ($1,$2, now() + ($3 || ' days')::interval, $4)", [d.listingId, d.label, String(d.days), u.id]);
    await audit(db, await actorOf(u), "promotion.created", "listing", d.listingId, { label: d.label });
    return "Promotion added.";
  });
}
