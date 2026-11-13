import { getDb } from "../src/lib/db";
import { seedDemo } from "../src/lib/db/seed";

(async () => {
  if (process.env.NODE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }
  const db = await getDb();
  await seedDemo();
  console.log("Demo data seeded.");
  await db.close();
})();
