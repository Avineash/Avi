import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { can, type Role, type Permission } from "./rbac";

export const COOKIE = "eh_session";
const TTL_SECONDS = 60 * 60 * 24 * 7;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production");
  return new TextEncoder().encode(s ?? "dev-only-insecure-secret-change-me-0123456789");
}

export interface SessionUser { id: string; email: string; name: string; role: Role; partnerId: string | null; partnerStatus: string | null; partnerCategory: "hotel" | "restaurant" | "event" | null }

export async function createSession(userId: string, role: Role) {
  const token = await new SignJWT({ role }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(`${TTL_SECONDS}s`).sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL_SECONDS });
}
export async function destroySession() { (await cookies()).delete(COOKIE); }

/** Resolve the signed-in user from the cookie and re-load them from the DB (so suspensions take effect immediately). */
export async function getUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const db = await getDb();
    const u = (await db.query<any>(
      `select u.id, u.email, u.name, u.role, u.status, p.id as partner_id, p.status as partner_status, p.category as partner_category
         from users u left join partners p on p.owner_user_id = u.id where u.id = $1 order by p.created_at limit 1`, [payload.sub])).rows[0];
    if (!u || u.status !== "active") return null;
    return { id: u.id, email: u.email, name: u.name, role: u.role, partnerId: u.partner_id, partnerStatus: u.partner_status, partnerCategory: u.partner_category };
  } catch { return null; }
}

export async function requireUser(next?: string): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return u;
}

/** Server-side role gate. Every portal layout *and* every server action calls this — middleware alone is never trusted. */
export async function requirePermission(perm: Permission, next?: string): Promise<SessionUser> {
  const u = await requireUser(next);
  if (!can(u.role, perm)) redirect("/forbidden");
  return u;
}

/** For server actions: throws instead of redirecting. */
export async function actionUser(perm: Permission): Promise<SessionUser> {
  const u = await getUser();
  if (!u) throw new DomainError("UNAUTHENTICATED", "Please sign in to continue");
  if (!can(u.role, perm)) throw new DomainError("FORBIDDEN", "You don't have access to that");
  return u;
}

/** Approved partner profile for partner portal actions. */
export async function actionPartner(): Promise<SessionUser & { partnerId: string }> {
  const u = await actionUser("partner:portal");
  if (!u.partnerId) throw new DomainError("FORBIDDEN", "No partner profile");
  if (u.partnerStatus !== "approved") throw new DomainError("FORBIDDEN", "Your partner account is awaiting approval");
  return u as SessionUser & { partnerId: string };
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}
