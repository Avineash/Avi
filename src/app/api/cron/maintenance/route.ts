import { runMaintenance } from "@/lib/domain/maintenance";

export const dynamic = "force-dynamic";

/** Scheduler entry point (Vercel Cron / Supabase pg_cron / any HTTP scheduler). Requires `Authorization: Bearer $CRON_SECRET`. */
async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  return Response.json(await runMaintenance());
}
export const GET = handler;
export const POST = handler;
