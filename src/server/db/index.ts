import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/server/env";
import { poolOptions } from "./connection";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pgPool?: Pool };

// Reuse the pool across hot reloads in development.
const pool = globalForDb.pgPool ?? new Pool(poolOptions(env.DATABASE_URL, env.DATABASE_CA_CERT, 10));
if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
