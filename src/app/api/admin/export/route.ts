import { getUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/domain/audit";

export const dynamic = "force-dynamic";
const esc = (v: unknown) => { const s = v instanceof Date ? v.toISOString() : String(v ?? ""); return /^[=+\-@]/.test(s) ? `'${s}` : s; }; // neutralise CSV formula injection
const csv = (rows: any[]) => rows.length ? [Object.keys(rows[0]).join(","), ...rows.map((r) => Object.values(r).map((v) => `"${esc(v).replace(/"/g, '""')}"`).join(","))].join("\n") : "no data";

export async function GET(req: Request) {
  const u = await getUser();
  if (!u || !can(u.role, "admin:finance")) return new Response("Forbidden", { status: 403 });
  const type = new URL(req.url).searchParams.get("type");
  const db = await getDb();
  const sql = type === "fees"
    ? "select created_at, kind, reservation_id, partner_id, basis_cents, amount_cents, gst_cents, is_reversal from platform_fees order by created_at"
    : type === "reservations"
    ? "select r.reference, r.status, r.created_at, l.title, r.price_cents, r.customer_fee_cents, r.total_cents, r.gst_cents from reservations r join listings l on l.id = r.listing_id order by r.created_at"
    : null;
  if (!sql) return new Response("Unknown export", { status: 400 });
  await audit(db, { id: u.id, role: u.role }, "export.downloaded", "report", type);
  return new Response(csv((await db.query(sql)).rows), { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${type}.csv"` } });
}
