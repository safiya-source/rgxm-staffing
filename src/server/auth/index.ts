// Authentication (Better Auth on our own Postgres).
//  - Field staff: passwordless magic link. First sign-in creates the account.
//  - Internal users: invited by an admin; email + password, optional TOTP MFA. Never magic link.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink, twoFactor } from "better-auth/plugins";
import { and, eq, isNull, sql } from "drizzle-orm";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { env } from "@/server/env";
import { sendEmail } from "@/server/notify/mailer";
import { actionEmail } from "@/server/notify/templates";

const MAGIC_LINK_TTL_SECONDS = 15 * 60;

async function findUserByEmail(email: string) {
  const [row] = await db
    .select({ id: schema.users.id, kind: schema.users.kind, status: schema.users.status })
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.email})`, email.toLowerCase()))
    .limit(1);
  return row ?? null;
}

async function hasCredentialAccount(userId: string) {
  const [row] = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "credential")))
    .limit(1);
  return Boolean(row);
}

export const auth = betterAuth({
  appName: "RGXM Staffing",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      twoFactor: schema.twoFactors,
      rateLimit: schema.rateLimits,
    },
  }),
  advanced: {
    database: { generateId: "uuid" },
    cookiePrefix: "rgxm",
    useSecureCookies: env.APP_URL.startsWith("https://"),
  },
  user: {
    additionalFields: {
      kind: { type: "string", required: false, defaultValue: "staff", input: false },
      status: { type: "string", required: false, defaultValue: "active", input: false },
      isDemo: { type: "boolean", required: false, defaultValue: false, input: false },
      lastSignInAt: { type: "date", required: false, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: env.AUTH_RATE_LIMIT === "on",
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-in/magic-link": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 5 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
    },
  },
  emailAndPassword: {
    enabled: true,
    // Internal accounts are created by an administrator only.
    disableSignUp: true,
    minPasswordLength: 12,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60 * 24,
    sendResetPassword: async ({ user, url }) => {
      const record = await findUserByEmail(user.email);
      // Field staff sign in with magic links and never get a password.
      if (!record || record.kind !== "internal" || record.status !== "active") return;
      const isInvite = !(await hasCredentialAccount(record.id));
      const content = isInvite
        ? actionEmail({
            heading: "You've been invited to RGXM Staffing",
            intro: "An administrator created an account for you. Choose a password to get started.",
            actionLabel: "Set your password",
            url,
            footer: "This link expires in 24 hours.",
          })
        : actionEmail({
            heading: "Reset your password",
            intro: "We received a request to reset your RGXM Staffing password.",
            actionLabel: "Choose a new password",
            url,
            footer: "If you didn't request this, you can ignore this email. The link expires in 24 hours.",
          });
      await sendEmail({
        to: user.email,
        subject: isInvite ? "Your RGXM Staffing invitation" : "Reset your RGXM Staffing password",
        containsSecretLink: true,
        ...content,
      });
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Link a pre-existing (e.g. imported) talent profile with the same email.
          await db
            .update(schema.staffProfiles)
            .set({ userId: user.id })
            .where(
              and(
                isNull(schema.staffProfiles.userId),
                eq(sql`lower(${schema.staffProfiles.email})`, user.email.toLowerCase()),
              ),
            );
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const [u] = await db
            .select({ status: schema.users.status })
            .from(schema.users)
            .where(eq(schema.users.id, session.userId));
          // Deactivated, suspended or archived accounts can't start a session.
          if (!u || u.status !== "active") return false;
        },
        after: async (session) => {
          await db.update(schema.users).set({ lastSignInAt: new Date() }).where(eq(schema.users.id, session.userId));
          await recordAudit({ actorId: session.userId, action: "auth.sign_in", entityType: "user", entityId: session.userId });
        },
      },
    },
  },
  plugins: [
    magicLink({
      expiresIn: MAGIC_LINK_TTL_SECONDS,
      sendMagicLink: async ({ email, url }) => {
        const existing = await findUserByEmail(email);
        // Internal users must use password (+ MFA). Silently skip so the endpoint doesn't reveal account types.
        if (existing && existing.kind !== "staff") return;
        if (existing && existing.status !== "active") return;
        const content = actionEmail({
          heading: existing ? "Sign in to RGXM Staffing" : "Welcome to RGXM Staffing",
          intro: existing
            ? "Tap the button below to sign in. No password needed."
            : "Tap the button below to create your RGXM staff profile. No password needed.",
          actionLabel: existing ? "Sign in" : "Create my profile",
          url,
          footer: "This link expires in 15 minutes and can only be used once.",
        });
        await sendEmail({ to: email, subject: "Your RGXM sign-in link", containsSecretLink: true, ...content });
      },
    }),
    twoFactor({ issuer: "RGXM Staffing" }),
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
