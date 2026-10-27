// Drops and recreates the database schema. Development/test only.
import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (process.env.NODE_ENV === "production" || /prod/i.test(new URL(url).pathname)) {
    throw new Error("Refusing to reset what looks like a production database.");
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await pool.end();
  console.log(`Reset ${new URL(url).pathname.slice(1)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
