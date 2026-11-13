import { getUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/domain/audit";

export const dynamic = "force-dynamic";

/** Verification documents contain sensitive business/identity data: admin-only, every download is audit-logged. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u || !can(u.role, "admin:partners")) return new Response("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Bad id", { status: 400 });
  const db = await getDb();
  const d = (await db.query<any>("select * from partner_verifications where id = $1", [id])).rows[0];
  if (!d || !d.content) return new Response("No stored file (demo document)", { status: 404 });
  await audit(db, { id: u.id, role: u.role }, "verification_doc.viewed", "partner_verification", id);
  return new Response(d.content, { headers: { "Content-Type": d.mime_type, "Content-Disposition": `inline; filename="${String(d.file_name).replace(/[^\w.\- ]/g, "_")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
