import { getDb } from "@/lib/db";
import { availability, subscribeListing } from "@/lib/domain/inventory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-sent events: pushes {available,total} whenever an inventory unit of this listing changes state. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Bad id", { status: 400 });
  const db = await getDb();
  const enc = new TextEncoder();
  let unsub = () => {}; let ping: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    async start(ctl) {
      const push = async () => { try { const a = await availability(db, id); ctl.enqueue(enc.encode(`data: ${JSON.stringify({ available: a.available_units, total: a.total_units })}\n\n`)); } catch {} };
      await push();
      unsub = subscribeListing(id, push);
      ping = setInterval(() => { try { ctl.enqueue(enc.encode(": ping\n\n")); } catch {} }, 25_000);
      req.signal.addEventListener("abort", () => { unsub(); clearInterval(ping); try { ctl.close(); } catch {} });
    },
    cancel() { unsub(); clearInterval(ping); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
