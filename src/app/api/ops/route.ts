import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/domain/audit";
import { setPartnerStatus } from "@/lib/domain/partners";
import { registerPartner, registerVenue } from "@/lib/domain/registry";
import { resolveResaleDispute } from "@/lib/domain/resale";
import { getSetting, setSetting } from "@/lib/domain/settings";
import { isDomainError } from "@/lib/errors";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Operator endpoint — stands in for an admin portal in the buyer/seller phase.
 *   curl -X POST $APP_URL/api/ops -H "Authorization: Bearer $OPS_TOKEN" -H "Content-Type: application/json" -d '{"action":"list_disputes"}'
 * Every mutation is written to the append-only audit log.
 */
const ok = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const actor = { id: null, role: "ops" };

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_disputes") }),
  z.object({ action: z.literal("resolve_dispute"), id: z.string().uuid(), outcome: z.enum(["refund_buyer", "release_seller"]), note: z.string().min(3) }),
  z.object({ action: z.literal("register_partner"), businessName: z.string().min(2), abn: z.string(), category: z.enum(["hotel", "restaurant", "event"]), contactEmail: z.string().email() }),
  z.object({ action: z.literal("register_venue"), partnerId: z.string().uuid(), name: z.string().min(2), address: z.string(), suburb: z.string(), lat: z.number(), lng: z.number(), description: z.string().optional(), imageUrl: z.string().optional(), transferInstructions: z.string().optional(), maxMarkupBps: z.number().int().min(5000).max(20000).optional(), resaleAllowed: z.boolean().optional() }),
  z.object({ action: z.literal("set_partner_status"), partnerId: z.string().uuid(), status: z.enum(["approved", "suspended", "rejected"]), note: z.string().optional() }),
  z.object({ action: z.literal("set_venue_resale"), venueId: z.string().uuid(), resaleAllowed: z.boolean(), maxMarkupBps: z.number().int().min(5000).max(20000), transferInstructions: z.string().optional() }),
  z.object({ action: z.literal("set_gate"), enabled: z.boolean(), legalReviewRef: z.string().optional() }),
  z.object({ action: z.literal("set_seller_status"), userId: z.string().uuid(), status: z.enum(["active", "suspended"]) }),
]);

export async function POST(req: Request) {
  const token = process.env.OPS_TOKEN;
  if (!token) return Response.json({ error: "OPS_TOKEN is not configured" }, { status: 501 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!ok(given, token)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    rateLimit(`ops:${req.headers.get("x-forwarded-for") ?? "?"}`, 60, 60_000);
    const b = Body.parse(await req.json());
    const db = await getDb();
    switch (b.action) {
      case "list_disputes": return Response.json((await db.query(
        `select d.id, d.status, d.reason, d.details, d.created_at, r.reference, r.total_cents, r.status as order_status, r.delivery_notes, l.title, l.booking_reference, bu.email as buyer, se.email as seller
           from resale_disputes d join resale_orders r on r.id = d.resale_order_id join resale_listings l on l.id = r.listing_id join users bu on bu.id = r.buyer_id join users se on se.id = r.seller_id order by (d.status = 'open') desc, d.created_at desc limit 100`)).rows);
      case "resolve_dispute": await resolveResaleDispute({ disputeId: b.id, outcome: b.outcome, note: b.note, actor }); return Response.json({ ok: true });
      case "register_partner": return Response.json({ partnerId: await db.tx((tx) => registerPartner(tx, { businessName: b.businessName, abn: b.abn, category: b.category, contactEmail: b.contactEmail })) });
      case "register_venue": return Response.json({ venueId: await db.tx((tx) => registerVenue(tx, b)) });
      case "set_partner_status": await setPartnerStatus({ partnerId: b.partnerId, status: b.status, actor, note: b.note }); return Response.json({ ok: true });
      case "set_venue_resale":
        await db.query("update venues set resale_allowed = $2, max_markup_bps = $3, transfer_instructions = $4 where id = $1", [b.venueId, b.resaleAllowed, b.maxMarkupBps, b.transferInstructions ?? null]);
        await audit(db, actor, "venue.resale_terms", "venue", b.venueId, b); return Response.json({ ok: true });
      case "set_gate": {
        if (b.enabled && (!b.legalReviewRef || b.legalReviewRef.trim().length < 4)) return Response.json({ error: "legalReviewRef is required to enable resale" }, { status: 400 });
        const prev = await getSetting<any>(db, "features.peer_resale", {});
        await setSetting(db, "features.peer_resale", { ...prev, enabled: b.enabled, legal_review_ref: b.enabled ? b.legalReviewRef!.trim() : null }, null);
        await audit(db, actor, b.enabled ? "feature.enabled" : "feature.disabled", "setting", "features.peer_resale", { legalReviewRef: b.legalReviewRef ?? null });
        return Response.json({ ok: true });
      }
      case "set_seller_status":
        await db.query("update seller_profiles set status = $2 where user_id = $1", [b.userId, b.status]);
        if (b.status === "suspended") await db.query("update resale_listings set status = 'paused' where seller_id = $1 and status = 'active'", [b.userId]);
        await audit(db, actor, `seller.${b.status}`, "seller", b.userId); return Response.json({ ok: true });
    }
  } catch (e) {
    if (isDomainError(e)) return Response.json({ error: e.message, code: e.code }, { status: 400 });
    if (e instanceof z.ZodError) return Response.json({ error: e.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    console.error("[ops]", e);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
