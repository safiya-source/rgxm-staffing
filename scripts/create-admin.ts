// Creates the first System Administrator in a new (unseeded) database and emails them an
// invitation to set a password. After that, administrators invite everyone else from
// Settings → Team & roles. Refuses if an active administrator already exists.
//
//   npm run admin:create -- --email you@rgxm.ca --name "Your Name"
import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { recordAudit } from "../src/server/audit";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { userRoles, users } from "../src/server/db/schema";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1]?.trim() : undefined;
}

async function main() {
  const email = arg("email")?.toLowerCase();
  const name = arg("name");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) throw new Error('Usage: npm run admin:create -- --email you@example.com --name "Full Name"');
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.role, "admin")))
    .where(eq(users.status, "active"))
    .limit(1);
  if (admin) throw new Error("An active administrator already exists. Invite people from Settings → Team & roles instead.");
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email));
  if (existing) throw new Error("A user with that email already exists.");

  await db.transaction(async (tx) => {
    const [created] = await tx.insert(users).values({ name, email, kind: "internal", emailVerified: true }).returning({ id: users.id });
    await tx.insert(userRoles).values({ userId: created!.id, role: "admin" });
    await recordAudit({ actorId: null, action: "user.bootstrap_admin", entityType: "user", entityId: created!.id, after: { email, name } }, tx);
  });
  await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
  console.log(`Administrator created. An invitation to set a password was sent to ${email} (expires in 24 hours).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
