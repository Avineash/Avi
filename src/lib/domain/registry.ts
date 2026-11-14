import type { Queryable } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { isValidAbn } from "./partners";
import { createVenue } from "./catalog";

/**
 * The partner registry. In the buyer/seller phase partners have no portal: an operator registers a hotel, restaurant or
 * event organiser (ABN-checked) together with its venues and resale terms. Resale is only possible for registered, approved partners.
 */
export const REGISTERED_ONLY_SELL = "Resale is only possible for venues registered with Eleventh Hour. This venue isn't registered (or is currently suspended).";

export interface RegisterPartnerInput { businessName: string; abn: string; category: "hotel" | "restaurant" | "event"; contactEmail: string; gstRegistered?: boolean; isDemo?: boolean }

export async function registerPartner(c: Queryable, i: RegisterPartnerInput): Promise<string> {
  if (!isValidAbn(i.abn)) throw new DomainError("INVALID", "ABN failed the checksum");
  const email = i.contactEmail.trim().toLowerCase();
  let owner = (await c.query<any>("select id from users where lower(email) = $1", [email])).rows[0];
  if (!owner) owner = (await c.query<any>("insert into users(email, name, role, password_hash, is_demo) values ($1,$2,'partner',null,$3) returning id", [email, i.businessName, !!i.isDemo])).rows[0];
  const p = (await c.query<any>(
    `insert into partners(owner_user_id, business_name, abn, category, status, gst_registered, contact_email, is_demo, approved_at, payouts_enabled)
     values ($1,$2,$3,$4,'approved',$5,$6,$7,now(),false) returning id`, [owner.id, i.businessName, i.abn.replace(/\s/g, ""), i.category, i.gstRegistered ?? true, email, !!i.isDemo])).rows[0];
  await c.query("insert into partner_verifications(partner_id, doc_type, file_name, mime_type, size_bytes, status, reviewed_at, notes) values ($1,'abn_certificate','registry-entry','text/plain',1,'approved',now(),'Registered by platform operator')", [p.id]);
  return p.id as string;
}

export interface RegisterVenueInput {
  partnerId: string; name: string; address: string; suburb: string; lat: number; lng: number; description?: string; imageUrl?: string;
  starRating?: number | null; cuisine?: string | null; amenities?: string[]; resaleAllowed?: boolean; transferInstructions?: string; maxMarkupBps?: number;
}
export async function registerVenue(c: Queryable, i: RegisterVenueInput): Promise<string> {
  const p = (await c.query<any>("select category, status from partners where id = $1", [i.partnerId])).rows[0];
  if (!p || p.status !== "approved") throw new DomainError("NOT_ELIGIBLE", REGISTERED_ONLY_SELL);
  const id = await createVenue(c, { partnerId: i.partnerId, name: i.name, category: p.category, address: i.address, suburb: i.suburb, lat: i.lat, lng: i.lng, description: i.description, imageUrl: i.imageUrl, starRating: i.starRating, cuisine: i.cuisine, amenities: i.amenities });
  // Default markup cap: events may go to 110% of face value (regulated ticket resale); everything else may not exceed face value.
  const cap = i.maxMarkupBps ?? (p.category === "event" ? 11000 : 10000);
  await c.query("update venues set resale_allowed = $2, transfer_instructions = $3, max_markup_bps = $4 where id = $1", [id, i.resaleAllowed ?? true, i.transferInstructions ?? null, cap]);
  return id;
}
