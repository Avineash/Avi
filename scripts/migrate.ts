import { getDb, migrate } from "../src/lib/db";

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL to migrate a real Postgres/Supabase database. (The embedded dev DB migrates itself on boot.)");
    process.exit(1);
  }
  const db = await getDb();
  const applied = await migrate(db);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
  await db.close();
})();
