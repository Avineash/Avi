import { getDb } from "../src/lib/db";
import { seedDemo } from "../src/lib/db/seed";
import { seedResaleDemo } from "../src/lib/db/seed-resale";

(async () => {
  if (process.env.NODE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }
  const db = await getDb();
  if (process.env.APP_PHASE === "full") await seedDemo(); else await seedResaleDemo();
  console.log("Demo data seeded.");
  await db.close();
})();
