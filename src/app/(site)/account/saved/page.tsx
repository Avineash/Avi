import type { Metadata } from "next";
import Link from "next/link";
import { ListingCard } from "@/components/listing-card";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { searchListings } from "@/lib/domain/search";
import { isFull } from "@/lib/phase";
import { searchResale } from "@/lib/domain/resale";
import { ResaleCard } from "@/components/resale-card";

export const metadata: Metadata = { title: "Saved experiences" };

async function FullSaved() {
  const u = await requirePermission("customer:account", "/account/saved");
  const ids = (await (await getDb()).query<any>("select listing_id from favourites where user_id = $1 order by created_at desc", [u.id])).rows.map((r) => r.listing_id);
  const items = ids.length ? await searchListings({ ids, userId: u.id, sort: "soonest" }) : [];
  return (<><PageHeader title="Saved experiences" eyebrow="Favourites" />{items.length === 0 ? <EmptyState title="Nothing saved yet">Tap the heart on any listing to keep it here. <Link className="underline" href="/search">Browse</Link></EmptyState> : <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{items.map((l) => <ListingCard key={l.id} l={l} signedIn />)}</div>}</>);
}

async function MarketSaved() {
  const u = await requirePermission("customer:account", "/account/saved");
  const ids = (await (await getDb()).query<any>("select listing_id from resale_saved where user_id = $1 order by created_at desc", [u.id])).rows.map((r) => r.listing_id);
  const items = ids.length ? await searchResale({ ids, userId: u.id, sort: "soonest" }) : [];
  return (<><PageHeader title="Saved listings" eyebrow="Favourites" />{items.length === 0 ? <EmptyState title="Nothing saved yet">Tap the heart on any listing to keep it here. <Link className="underline" href="/search">Browse</Link></EmptyState> : <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{items.map((l) => <ResaleCard key={l.id} l={l} signedIn />)}</div>}</>);
}

export default async function Saved() { return isFull() ? <FullSaved /> : <MarketSaved />; }
