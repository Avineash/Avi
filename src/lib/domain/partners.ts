import { inTx, type Queryable } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { audit, type Actor } from "./audit";
import { notify } from "./notifications";

/** Australian Business Number checksum (ATO algorithm). */
export function isValidAbn(abn: string): boolean {
  const d = abn.replace(/\s/g, "");
  if (!/^\d{11}$/.test(d)) return false;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const digits = d.split("").map(Number);
  digits[0] -= 1;
  return digits.reduce((s, x, i) => s + x * w[i], 0) % 89 === 0;
}

export async function setPartnerStatus(a: { partnerId: string; status: "approved" | "suspended" | "rejected"; actor: Actor; note?: string }) {
  await inTx(async (tx) => {
    const p = (await tx.query<any>("select * from partners where id = $1 for update", [a.partnerId])).rows[0];
    if (!p) throw new DomainError("NOT_FOUND", "Partner not found");
    if (a.status === "approved") {
      const docs = (await tx.query<any>("select count(*)::int n from partner_verifications where partner_id = $1 and status <> 'rejected'", [p.id])).rows[0].n;
      if (docs === 0) throw new DomainError("CONFLICT", "No verification documents have been submitted");
    }
    await tx.query("update partners set status = $2, approved_at = case when $2 = 'approved' then now() else approved_at end, approved_by = case when $2 = 'approved' then $3::uuid else approved_by end, updated_at = now() where id = $1", [p.id, a.status, a.actor.id]);
    if (a.status === "approved") await tx.query("update partner_verifications set status = 'approved', reviewer_id = $2, reviewed_at = now() where partner_id = $1 and status = 'submitted'", [p.id, a.actor.id]);
    if (a.status === "suspended") await tx.query("update listings set status = 'paused', updated_at = now() where partner_id = $1 and status = 'published'", [p.id]);
    await notify(tx, p.owner_user_id, {
      kind: "partner_status", title: `Your partner account is ${a.status}`,
      body: a.status === "approved" ? "You can now publish inventory." : (a.note ?? "Please contact support for details."), link: "/partner",
    });
    await audit(tx, a.actor, `partner.${a.status}`, "partner", p.id, { note: a.note ?? null });
  });
}

export async function partnerForUser(c: Queryable, userId: string) {
  return (await c.query<any>("select * from partners where owner_user_id = $1 order by created_at limit 1", [userId])).rows[0] ?? null;
}
