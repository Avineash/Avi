import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/primitives";

/** Plain GET form — works without JavaScript and is shareable via URL. */
export function SearchBar({ category, defaults = {}, hideCity }: { category?: string; defaults?: Record<string, string | undefined>; hideCity?: boolean }) {
  return (
    <form action="/search" className={`grid gap-2 rounded-[2rem] bg-white/95 p-2.5 shadow-float ring-1 ring-white/40 backdrop-blur sm:grid-cols-2 ${hideCity ? "lg:grid-cols-[1.5fr_1fr_1fr_auto]" : "lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto]"}`} role="search" aria-label="Search experiences">
      <div><label htmlFor="sb-q" className="sr-only">What are you looking for</label><Input id="sb-q" name="q" defaultValue={defaults.q} placeholder="Suburb, venue or cuisine" className="border-transparent bg-ivory-100" /></div>
      <div><label htmlFor="sb-cat" className="sr-only">Category</label>
        <Select id="sb-cat" name="category" defaultValue={category ?? defaults.category ?? ""} className="border-transparent bg-ivory-100"><option value="">Everything</option><option value="hotel">Hotels</option><option value="restaurant">Dining</option><option value="event">Events</option></Select></div>
      {hideCity ? <input type="hidden" name="city" value="Melbourne" /> : (<div><label htmlFor="sb-city" className="sr-only">City</label>
        <Select id="sb-city" name="city" defaultValue={defaults.city ?? "Melbourne"} className="border-transparent bg-ivory-100"><option>Melbourne</option></Select></div>)}
      <div><label htmlFor="sb-date" className="sr-only">Date</label><Input id="sb-date" type="date" name="date" defaultValue={defaults.date} className="border-transparent bg-ivory-100" /></div>
      <Button type="submit" variant="gold" size="lg" className="sm:col-span-2 lg:col-span-1"><Search /> Search</Button>
    </form>
  );
}
