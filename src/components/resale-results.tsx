import Link from "next/link";
import { BellPlus, LayoutGrid, Map as MapIcon } from "lucide-react";
import { MapView, type Pin } from "@/components/map-view";
import { ResaleCard } from "@/components/resale-card";
import { Button } from "@/components/ui/button";
import { EmptyState, Input, Select } from "@/components/ui/primitives";
import { getUser } from "@/lib/auth/session";
import { searchResale, type ResaleSearch } from "@/lib/domain/resale";

type Sp = Record<string, string | string[] | undefined>;
const s = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : undefined);

export async function ResaleResults({ sp, category, basePath, title }: { sp: Sp; category?: ResaleSearch["category"]; basePath: string; title: string }) {
  const user = await getUser();
  const cat = category ?? (["hotel", "restaurant", "event"].includes(s(sp.category) ?? "") ? (s(sp.category) as ResaleSearch["category"]) : undefined);
  const p: ResaleSearch = {
    q: s(sp.q), category: cat, date: s(sp.date), minPrice: num(s(sp.min)), maxPrice: num(s(sp.max)), minRating: s(sp.rating) ? Number(s(sp.rating)) : undefined,
    availability: (s(sp.avail) as ResaleSearch["availability"]) ?? "available", sort: (s(sp.sort) as ResaleSearch["sort"]) ?? "recommended", userId: user?.id,
  };
  const items = await searchResale(p);
  const view = s(sp.view) === "map" ? "map" : "grid";
  const qs = (patch: Record<string, string>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(sp)) if (s(v)) u.set(k, s(v)!); for (const [k, v] of Object.entries(patch)) u.set(k, v); return `${basePath}?${u}`; };
  const pins = new Map<string, Pin>();
  for (const l of items) {
    const sold = l.quantity_available === 0, cur = pins.get(l.venue_id);
    if (!cur) pins.set(l.venue_id, { venueId: l.venue_id, name: l.venue_name, suburb: l.suburb, lat: l.lat, lng: l.lng, fromCents: l.ask_unit_cents, category: l.category, listingId: l.id, count: 1, soldOut: sold });
    else { cur.count++; if (!sold && (cur.soldOut || l.ask_unit_cents < cur.fromCents)) { cur.fromCents = l.ask_unit_cents; cur.listingId = l.id; cur.soldOut = false; } }
  }
  return (
    <div className="container-page py-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div><p className="eyebrow">{items.length} listing{items.length === 1 ? "" : "s"} from verified sellers</p><h1 className="h-section mt-2">{title}</h1></div>
        <div className="flex gap-2" role="group" aria-label="View">
          <Button asChild size="sm" variant={view === "grid" ? "default" : "outline"}><Link href={qs({ view: "grid" })}><LayoutGrid /> List</Link></Button>
          <Button asChild size="sm" variant={view === "map" ? "default" : "outline"}><Link href={qs({ view: "map" })}><MapIcon /> Map</Link></Button>
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-[17rem_1fr]">
        <form action={basePath} className="card h-fit space-y-4 p-5 text-sm" aria-label="Filters">
          <div><label htmlFor="f-q" className="mb-1 block font-medium">Search</label><Input id="f-q" name="q" defaultValue={s(sp.q)} placeholder="Venue, suburb, event" /></div>
          {!category && <div><label htmlFor="f-c" className="mb-1 block font-medium">Category</label><Select id="f-c" name="category" defaultValue={cat ?? ""}><option value="">All</option><option value="hotel">Hotels</option><option value="restaurant">Dining</option><option value="event">Events</option></Select></div>}
          <div><label htmlFor="f-d" className="mb-1 block font-medium">Date</label><Input id="f-d" type="date" name="date" defaultValue={s(sp.date)} /></div>
          <fieldset><legend className="mb-1 font-medium">Price each (AUD)</legend><div className="grid grid-cols-2 gap-2"><Input aria-label="Minimum price" name="min" inputMode="numeric" placeholder="Min" defaultValue={s(sp.min)} /><Input aria-label="Maximum price" name="max" inputMode="numeric" placeholder="Max" defaultValue={s(sp.max)} /></div></fieldset>
          <div><label htmlFor="f-r" className="mb-1 block font-medium">Seller rating</label><Select id="f-r" name="rating" defaultValue={s(sp.rating) ?? ""}><option value="">Any</option><option value="4">4+ stars</option><option value="4.5">4.5+ stars</option></Select></div>
          <div><label htmlFor="f-a" className="mb-1 block font-medium">Availability</label><Select id="f-a" name="avail" defaultValue={p.availability}><option value="available">Available now</option><option value="any">Include sold</option><option value="soldout">Sold (set alerts)</option></Select></div>
          <div><label htmlFor="f-s" className="mb-1 block font-medium">Sort by</label><Select id="f-s" name="sort" defaultValue={p.sort}><option value="recommended">Recommended</option><option value="soonest">Starting soonest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="savings">Biggest saving</option><option value="rating">Top-rated sellers</option></Select></div>
          <input type="hidden" name="view" value={view} />
          <div className="flex gap-2"><Button type="submit" className="flex-1">Apply</Button><Button asChild variant="ghost"><Link href={basePath}>Reset</Link></Button></div>
        </form>
        <div>
          {items.length === 0 ? (
            <EmptyState title="Nothing listed right now">Sellers list throughout the day. <Link href="/account/wanted" className="inline-flex items-center gap-1 font-semibold underline"><BellPlus className="size-4" />Set an alert</Link> and we&apos;ll tell you the moment something matches.</EmptyState>
          ) : view === "map" ? (
            <div className="grid gap-5 xl:grid-cols-2">
              <MapView basePath="/resale" pins={[...pins.values()]} className="h-[28rem] xl:sticky xl:top-28 xl:h-[36rem]" />
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">{items.map((l) => <ResaleCard key={l.id} l={l} signedIn={!!user} />)}</div>
            </div>
          ) : <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">{items.map((l) => <ResaleCard key={l.id} l={l} signedIn={!!user} />)}</div>}
        </div>
      </div>
    </div>
  );
}
