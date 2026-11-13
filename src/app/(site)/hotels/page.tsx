import type { Metadata } from "next";
import { Results } from "@/components/results";

export const metadata: Metadata = { title: "Last-minute hotel stays" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Results sp={await searchParams} category="hotel" basePath="/hotels" title="Last-minute hotel stays" />;
}
