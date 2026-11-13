import bcrypt from "bcryptjs";
import { getDb, inTx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { audit } from "./audit";
import { isValidAbn } from "./partners";
import { rateLimit } from "@/lib/ratelimit";

export function checkPassword(p: string) {
  if (p.length < 10) throw new DomainError("INVALID", "Password must be at least 10 characters");
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw new DomainError("INVALID", "Password must include letters and numbers");
}

export async function registerCustomer(a: { email: string; password: string; name: string; phone?: string; marketing?: boolean; ip?: string | null }) {
  rateLimit(`reg:${a.ip ?? "?"}`, 10, 60_000);
  checkPassword(a.password);
  const hash = await bcrypt.hash(a.password, 10);
  return inTx(async (tx) => {
    try {
      const u = (await tx.query<any>("insert into users(email, name, phone, password_hash, marketing_opt_in) values ($1,$2,$3,$4,$5) returning id, role", [a.email.trim(), a.name.trim(), a.phone || null, hash, !!a.marketing])).rows[0];
      await audit(tx, { id: u.id, role: "customer", ip: a.ip }, "user.registered", "user", u.id);
      return u as { id: string; role: "customer" };
    } catch (e: any) {
      if (e?.code === "23505") throw new DomainError("CONFLICT", "An account with this email already exists. Try signing in.");
      throw e;
    }
  });
}

export async function verifyLogin(email: string, password: string, ip?: string | null) {
  rateLimit(`login:${ip ?? "?"}`, 20, 60_000);
  rateLimit(`login:${email.toLowerCase()}`, 8, 60_000);
  const db = await getDb();
  const u = (await db.query<any>("select id, role, status, password_hash from users where lower(email) = lower($1)", [email.trim()])).rows[0];
  // constant-ish time: always run a bcrypt compare
  const ok = await bcrypt.compare(password, u?.password_hash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali");
  if (!u || !ok || u.status !== "active") throw new DomainError("UNAUTHENTICATED", "Incorrect email or password");
  await audit(db, { id: u.id, role: u.role, ip }, "user.login", "user", u.id);
  return { id: u.id as string, role: u.role as "customer" | "partner" | "admin" };
}

export interface PartnerRegistration {
  email: string; password: string; name: string; businessName: string; abn: string; category: "hotel" | "restaurant" | "event";
  gstRegistered: boolean; contactPhone?: string; website?: string; description?: string;
  docs: Array<{ docType: string; fileName: string; mimeType: string; content: Buffer }>; ip?: string | null;
}
export async function registerPartner(a: PartnerRegistration) {
  rateLimit(`reg:${a.ip ?? "?"}`, 10, 60_000);
  checkPassword(a.password);
  if (!isValidAbn(a.abn)) throw new DomainError("INVALID", "That ABN doesn't pass the ABN checksum — please check it.");
  if (a.docs.length === 0) throw new DomainError("INVALID", "Please attach at least one verification document (e.g. ABN certificate or business licence)");
  for (const d of a.docs) {
    if (d.content.length > 5 * 1024 * 1024) throw new DomainError("INVALID", `${d.fileName} is larger than 5 MB`);
    if (!["application/pdf", "image/png", "image/jpeg"].includes(d.mimeType)) throw new DomainError("INVALID", `${d.fileName}: only PDF, PNG or JPEG files are accepted`);
  }
  const hash = await bcrypt.hash(a.password, 10);
  return inTx(async (tx) => {
    try {
      const u = (await tx.query<any>("insert into users(email, name, role, password_hash) values ($1,$2,'partner',$3) returning id", [a.email.trim(), a.name.trim(), hash])).rows[0];
      const p = (await tx.query<any>(
        `insert into partners(owner_user_id, business_name, abn, category, gst_registered, contact_email, contact_phone, website, description)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [u.id, a.businessName.trim(), a.abn.replace(/\s/g, ""), a.category, a.gstRegistered, a.email.trim(), a.contactPhone ?? null, a.website ?? null, a.description ?? null])).rows[0];
      for (const d of a.docs) {
        await tx.query("insert into partner_verifications(partner_id, doc_type, file_name, mime_type, size_bytes, content) values ($1,$2,$3,$4,$5,$6)", [p.id, d.docType, d.fileName, d.mimeType, d.content.length, d.content]);
      }
      await audit(tx, { id: u.id, role: "partner", ip: a.ip }, "partner.registered", "partner", p.id, { category: a.category });
      return { userId: u.id as string, partnerId: p.id as string };
    } catch (e: any) {
      if (e?.code === "23505") throw new DomainError("CONFLICT", "An account with this email already exists");
      throw e;
    }
  });
}
