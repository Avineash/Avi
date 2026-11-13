import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { PORTAL_PREFIX, type Role } from "@/lib/auth/rbac";

/** First line of defence only: unauthenticated / wrong-role users are bounced before rendering. Server code re-checks everything. */
export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const prefix = Object.keys(PORTAL_PREFIX).find((p) => path === p || path.startsWith(p + "/"));
  if (!prefix) return NextResponse.next();
  const token = req.cookies.get("eh_session")?.value;
  const login = () => NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(path)}`, req.url));
  if (!token) return login();
  try {
    const raw = process.env.SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? null : "dev-only-insecure-secret-change-me-0123456789");
    if (!raw) return login(); // never fall back to a default secret in production
    const secret = new TextEncoder().encode(raw);
    const { payload } = await jwtVerify(token, secret);
    if (!PORTAL_PREFIX[prefix].includes(payload.role as Role)) return NextResponse.redirect(new URL("/forbidden", req.url));
    return NextResponse.next();
  } catch { return login(); }
}
export const config = { matcher: ["/account/:path*", "/partner/:path*", "/admin/:path*", "/checkout/:path*"] };
