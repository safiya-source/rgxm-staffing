import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  // "log" stores outgoing mail in notification_deliveries and never sends it.
  MAIL_TRANSPORT: z.enum(["log", "resend"]).default("log"),
  MAIL_FROM: z.string().default("RGXM Staffing <staffing@example.com>"),
  RESEND_API_KEY: z.string().optional(),
  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  // Auth endpoint rate limiting. May only be turned off outside production (e.g. for E2E runs).
  AUTH_RATE_LIMIT: z.enum(["on", "off"]).default("on"),
});

function load() {
  // Treat empty values (e.g. `SUPABASE_URL=` in .env) as unset.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const value = parsed.data;
  if (value.MAIL_TRANSPORT === "resend" && !value.RESEND_API_KEY) {
    throw new Error("MAIL_TRANSPORT=resend requires RESEND_API_KEY");
  }
  if (value.STORAGE_DRIVER === "supabase" && (!value.SUPABASE_URL || !value.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  if (value.NODE_ENV === "production" && value.AUTH_RATE_LIMIT === "off") {
    throw new Error("AUTH_RATE_LIMIT=off is not allowed in production");
  }
  return value;
}

export const env = load();
export const isProduction = env.NODE_ENV === "production";
