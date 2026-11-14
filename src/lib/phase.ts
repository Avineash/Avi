/**
 * Product phase.
 *  - "buyer-seller" (default): people resell bookings / reservations / tickets to each other. No partner or admin portals.
 *  - "full": additionally exposes the venue-side platform (partner portals, admin portal, primary inventory, buyback).
 * The full platform is preserved in the repository — see docs/FUTURE_PLAN.md.
 */
export type Phase = "buyer-seller" | "full";
export const phase = (): Phase => (process.env.APP_PHASE === "full" ? "full" : "buyer-seller");
export const isFull = () => phase() === "full";

/** URL prefixes that only exist in the full platform. */
export const FULL_ONLY_PREFIXES = ["/partner", "/admin", "/partners", "/listings", "/waitlist", "/checkout", "/api/admin"];
