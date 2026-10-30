// Drops and recreates the database schema. Development/test only.
import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).hostname;
  if (process.env.NODE_ENV === "production" || /prod/i.test(new URL(url).pathname) || !["localhost", "127.0.0.1", "::1", "postgres"].includes(host)) {
    throw new Error(`Refusing to reset ${host}: only local development/test databases can be reset.`);
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
