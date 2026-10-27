// Rebuilds the test database from migrations before the suite runs.
import { execSync } from "node:child_process";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://rgxm:rgxm@localhost:5432/rgxm_test";
  if (!/test/.test(new URL(url).pathname)) throw new Error(`Refusing to reset non-test database ${url}`);
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url, NODE_ENV: "development" };
  execSync("npx tsx scripts/reset.ts && npx tsx scripts/migrate.ts", { env, stdio: "inherit" });
}
