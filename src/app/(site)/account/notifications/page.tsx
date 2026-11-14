import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { fmtDateTime } from "@/lib/util";
import { markNotificationsReadAction } from "@/app/actions/account";

export const metadata: Metadata = { title: "Notifications" };

export default async function Notifications() {
  const u = await requirePermission("customer:account", "/account/notifications");
  const notes = (await (await getDb()).query<any>("select * from notifications where user_id = $1 order by created_at desc limit 50", [u.id])).rows;
  return (
    <>
      <PageHeader title="Notifications" eyebrow="Activity"><form action={markNotificationsReadAction}><Button size="sm" variant="outline">Mark all read</Button></form></PageHeader>
      <ul className="divide-y divide-navy-900/10 overflow-hidden rounded-3xl bg-white shadow-card">{notes.length === 0 ? <li className="p-5 text-sm text-navy-900/60">Nothing yet.</li> : notes.map((n) => <li key={n.id} className="p-5 text-sm"><p className={n.read_at ? "" : "font-semibold"}>{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p><p className="text-navy-900/70">{n.body}</p><p className="mt-1 text-xs text-navy-900/50">{fmtDateTime(n.created_at)} · email: {n.email_status ?? "queued"}</p></li>)}</ul>
    </>
  );
}
