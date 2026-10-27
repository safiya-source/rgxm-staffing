// Applies SQL migrations in src/server/db/migrations to DATABASE_URL.
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { poolOptions } from "../src/server/db/connection";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool(poolOptions(url, process.env.DATABASE_CA_CERT, 1));
  await migrate(drizzle(pool), { migrationsFolder: "src/server/db/migrations" });
  await pool.end();
  console.log(`Migrations applied to ${new URL(url).pathname.slice(1)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
