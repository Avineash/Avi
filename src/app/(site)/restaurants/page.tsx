import type { Metadata } from "next";
import { Results } from "@/components/results";

export const metadata: Metadata = { title: "Restaurants & dining experiences" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Results sp={await searchParams} category="restaurant" basePath="/restaurants" title="Restaurants & dining experiences" />;
}
