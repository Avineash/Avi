import { getUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Delivery attachments are visible only to the buyer and the seller of that order. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Bad id", { status: 400 });
  const r = (await (await getDb()).query<any>("select buyer_id, seller_id, delivery_file_name, delivery_mime, delivery_content from resale_orders where id = $1", [id])).rows[0];
  if (!r || (r.buyer_id !== u.id && r.seller_id !== u.id) || !r.delivery_content) return new Response("Not found", { status: 404 });
  return new Response(r.delivery_content, { headers: { "Content-Type": r.delivery_mime, "Content-Disposition": `attachment; filename="${String(r.delivery_file_name).replace(/[^\w.\- ]/g, "_")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
