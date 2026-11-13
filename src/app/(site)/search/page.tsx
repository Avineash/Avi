import type { Metadata } from "next";
import { Results } from "@/components/results";

export const metadata: Metadata = { title: "Search results" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Results sp={await searchParams} basePath="/search" title="Search results" />;
}
