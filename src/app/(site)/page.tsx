import { HomeFull } from "@/components/home-full";
import { HomeMarket } from "@/components/home-market";
import { isFull } from "@/lib/phase";

export default async function Home() {
  return isFull() ? <HomeFull /> : <HomeMarket />;
}
