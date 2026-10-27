import { describe, expect, it } from "vitest";
import { poolOptions } from "@/server/db/connection";

describe("database connection options", () => {
  it("leaves local connections alone", () => {
    expect(poolOptions("postgres://u:p@localhost:5432/db", undefined, 3)).toEqual({ connectionString: "postgres://u:p@localhost:5432/db", max: 3 });
  });
  it("verifies hosted Postgres against the provided CA, overriding the URL's sslmode", () => {
    const o = poolOptions("postgres://u:p@db.example.supabase.com:6543/postgres?sslmode=require&pgbouncer=true", "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----", 10);
    expect(o.connectionString).toBe("postgres://u:p@db.example.supabase.com:6543/postgres?pgbouncer=true");
    expect(o.ssl).toEqual({ ca: "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----", rejectUnauthorized: true });
  });
});
