// Postgres connection options shared by the app and the migrate/seed scripts.
//
// Hosted Postgres (e.g. Supabase) signs its server certificates with its own certificate
// authority. Set DATABASE_CA_CERT to that CA (PEM text) and connections are encrypted *and*
// verified against it. Without it, the connection string's own sslmode applies (local dev).
import type { PoolConfig } from "pg";

export function poolOptions(connectionString: string, caCert: string | undefined, max: number): PoolConfig {
  if (!caCert?.trim()) return { connectionString, max };
  // Env UIs often store PEM newlines as "\n"; restore them.
  const ca = caCert.includes("\\n") ? caCert.replace(/\\n/g, "\n") : caCert;
  // sslmode in the URL would replace this ssl object, so the CA decides instead.
  const url = new URL(connectionString);
  for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) url.searchParams.delete(k);
  return { connectionString: url.toString(), max, ssl: { ca, rejectUnauthorized: true } };
}
