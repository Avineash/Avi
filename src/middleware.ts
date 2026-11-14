import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { PORTAL_PREFIX, type Role } from "@/lib/auth/rbac";
import { FULL_ONLY_PREFIXES, isFull } from "@/lib/phase";

/** First line of defence only: unauthenticated / wrong-role users are bounced before rendering. Server code re-checks everything. */
export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // Buyer/seller phase: the venue-side platform (partner & admin portals, primary inventory) does not exist publicly.
  if (!isFull() && FULL_ONLY_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) {
    // Prefetches / RSC fetches get a plain 404 (a rewrite can stall them); document requests get the friendly 404 page.
    const rsc = req.headers.get("rsc") || req.headers.get("next-router-prefetch") || req.nextUrl.searchParams.has("_rsc");
    return rsc ? new NextResponse("Not found", { status: 404 }) : NextResponse.rewrite(new URL("/404", req.url));
  }
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
export const config = { matcher: ["/account/:path*", "/partner/:path*", "/admin/:path*", "/checkout/:path*", "/pay/:path*", "/sell/:path*", "/listings/:path*", "/waitlist/:path*", "/partners/:path*", "/api/admin/:path*"] };
