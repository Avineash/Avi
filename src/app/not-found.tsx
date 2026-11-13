import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (<div className="container-page py-32 text-center"><p className="eyebrow">404</p><h1 className="mt-2 text-4xl font-semibold">We couldn&apos;t find that page</h1><p className="mt-3 text-navy-900/70">It may have sold out, closed, or never existed.</p><Button asChild className="mt-6"><Link href="/search">Browse availability</Link></Button></div>);
}
