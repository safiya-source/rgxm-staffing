// Better Auth plugin: accepting a staff portal invitation signs the person in.
// It is a POST (sent by the /invite page's button) rather than a GET on the emailed link, so
// email security scanners that open links can't use up the single-use invitation.
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/server/db";
import { staffProfiles } from "@/server/db/schema";
import { consumeInvitation } from "@/server/domain/invitations";

export const staffInvite = () =>
  ({
    id: "staff-invite",
    endpoints: {
      acceptStaffInvite: createAuthEndpoint(
        "/staff-invite/accept",
        { method: "POST", body: z.object({ token: z.string().min(1).max(200) }) },
        async (ctx) => {
          const invite = await consumeInvitation(ctx.body.token);
          if (!invite) throw new APIError("BAD_REQUEST", { message: "This invitation link has expired or was already used." });
          const adapter = ctx.context.internalAdapter;
          let user = (await adapter.findUserByEmail(invite.email))?.user;
          if (!user) {
            // The user-create hook links the talent profile by email.
            user = await adapter.createUser({ email: invite.email.toLowerCase(), emailVerified: true, name: invite.name }, { method: "staff-invite" });
          } else if (!user.emailVerified) {
            user = (await adapter.updateUser(user.id, { emailVerified: true })) ?? user;
          }
          if (!user) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Couldn't create the account." });
          // Covers an account that existed before the profile did.
          await db
            .update(staffProfiles)
            .set({ userId: user.id })
            .where(and(eq(staffProfiles.id, invite.staffId), isNull(staffProfiles.userId), eq(sql`lower(${staffProfiles.email})`, user.email.toLowerCase())));
          const session = await adapter.createSession(user.id);
          if (!session) throw new APIError("FORBIDDEN", { message: "This account can't sign in." });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
    },
    rateLimit: [{ pathMatcher: (path: string) => path.startsWith("/staff-invite"), window: 60, max: 10 }],
  }) satisfies BetterAuthPlugin;
