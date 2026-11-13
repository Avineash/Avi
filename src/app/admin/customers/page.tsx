import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Badge, PageHeader, StatusBadge, Table, TD, TH } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDate } from "@/lib/util";
import { userStatusAction } from "@/app/actions/admin";

export const metadata: Metadata = { title: "Customers" };

export default async function Customers() {
  await requirePermission("admin:portal", "/admin/customers");
  const rows = (await (await getDb()).query<any>(
    `select u.*, (select count(*)::int from reservations r where r.customer_id = u.id and r.status in ('confirmed','completed')) as bookings,
            (select coalesce(sum(total_cents),0)::bigint from reservations r where r.customer_id = u.id and r.status in ('confirmed','completed')) as spend,
            (select count(*)::int from waitlist_entries w where w.customer_id = u.id and w.status in ('active','offered')) as waitlists
       from users u where u.role = 'customer' order by u.created_at desc limit 200`)).rows;
  return (
    <>
      <PageHeader title="Customers" eyebrow={`${rows.length} accounts`} />
      <div className="card p-2"><Table><thead><tr><TH>Customer</TH><TH>Joined</TH><TH>Bookings</TH><TH>Spend</TH><TH>Waitlists</TH><TH>Status</TH><TH><span className="sr-only">Actions</span></TH></tr></thead><tbody>
        {rows.map((u) => <tr key={u.id}><TD><p className="font-medium">{u.name} {u.is_demo && <Badge tone="gold">demo</Badge>}</p><p className="text-xs text-navy-900/60">{u.email}</p></TD><TD>{fmtDate(u.created_at)}</TD><TD>{u.bookings}</TD><TD>{aud(u.spend)}</TD><TD>{u.waitlists}</TD><TD><StatusBadge status={u.status} /></TD>
          <TD><ActionForm action={userStatusAction} hideSubmit><input type="hidden" name="userId" value={u.id} />{u.status === "active" ? <Button name="status" value="suspended" size="sm" variant="outline">Suspend</Button> : <Button name="status" value="active" size="sm" variant="gold">Reactivate</Button>}</ActionForm></TD></tr>)}
      </tbody></Table></div>
    </>
  );
}
