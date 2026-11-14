import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Star } from "lucide-react";
import { ResaleCard } from "@/components/resale-card";
import { EmptyState } from "@/components/ui/primitives";
import { getUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { searchResale, sellerPublic } from "@/lib/domain/resale";
import { fmtDate } from "@/lib/util";

export const metadata: Metadata = { title: "Seller profile" };

export default async function SellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const s = await sellerPublic(db, id);
  if (!s) notFound();
  const user = await getUser();
  const items = await searchResale({ sellerId: id, userId: user?.id, availability: "any" });
  const reviews = (await db.query<any>("select r.rating, r.comment, r.created_at, u.name from resale_reviews r join users u on u.id = r.buyer_id where r.seller_id = $1 order by r.created_at desc limit 12", [id])).rows;
  return (
    <div className="container-page max-w-6xl py-10">
      <div className="flex items-center gap-5"><span className="grid size-20 place-items-center rounded-full bg-navy-900 font-serif text-4xl text-gold-300">{s.display_name[0]}</span>
        <div><h1 className="h-section">{s.display_name}</h1><p className="mt-1 flex flex-wrap items-center gap-x-4 text-sm text-navy-900/70">{s.reviews > 0 ? <span className="inline-flex items-center gap-1"><Star className="size-4 fill-gold-500 text-gold-500" />{s.rating.toFixed(1)} · {s.reviews} reviews</span> : <span>New seller</span>}<span>{s.sales} completed sales</span><span>Joined {fmtDate(s.created_at)}</span></p></div></div>
      {s.bio && <p className="mt-5 max-w-2xl text-navy-900/80">{s.bio}</p>}
      <h2 className="mt-10 text-2xl">Listings</h2>
      {items.length === 0 ? <div className="mt-4"><EmptyState title="Nothing listed right now" /></div> : <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{items.map((l) => <ResaleCard key={l.id} l={l} signedIn={!!user} />)}</div>}
      {reviews.length > 0 && <><h2 className="mt-10 text-2xl">Reviews from buyers</h2><ul className="mt-4 grid gap-3 md:grid-cols-2">{reviews.map((r, i) => <li key={i} className="card p-4 text-sm"><p className="font-semibold">{"★".repeat(r.rating)}<span className="text-navy-900/20">{"★".repeat(5 - r.rating)}</span> <span className="font-normal text-navy-900/60">{r.name.split(" ")[0]} · {fmtDate(r.created_at)}</span></p>{r.comment && <p className="mt-1">{r.comment}</p>}</li>)}</ul></>}
    </div>
  );
}
