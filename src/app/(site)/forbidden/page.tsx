import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Forbidden() {
  return (<div className="container-page py-24 text-center"><p className="eyebrow">403</p><h1 className="mt-2 text-4xl font-semibold">You don&apos;t have access to that</h1><p className="mt-3 text-navy-900/70">Your account type can&apos;t open this area.</p><Button asChild className="mt-6"><Link href="/">Go home</Link></Button></div>);
}
