// Briefing documents, announcements and staff ↔ RGXM messages.
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import {
  announcements,
  bookings,
  documentAcknowledgements,
  documents,
  messages,
  messageThreads,
  projects,
  shifts,
  staffProfiles,
  users,
} from "@/server/db/schema";
import { enqueue } from "@/server/notify/outbox";
import { storage, validateUpload } from "@/server/storage";

export class CommsError extends Error {}

// ─── Documents ──────────────────────────────────────────────────────────────

export const DOCUMENT_CATEGORIES = [
  ["event_brief", "Event brief"],
  ["brand_guidelines", "Brand guidelines"],
  ["training", "Training"],
  ["talking_points", "Talking points"],
  ["uniform", "Uniform guidelines"],
  ["site_map", "Site map"],
  ["run_of_show", "Run of show"],
  ["emergency", "Emergency procedures"],
  ["other", "Other"],
] as const;

export const documentMetaSchema = z.object({
  title: z.string().trim().min(2, "Give the document a title").max(120),
  category: z.enum(DOCUMENT_CATEGORIES.map(([c]) => c) as [string, ...string[]]),
  requiresAck: z.boolean(),
  shiftId: z.string().uuid().nullable(),
});

async function storeFile(projectId: string, fileName: string, data: Buffer) {
  const { safeName, contentType } = validateUpload(fileName, data);
  const key = `projects/${projectId}/${randomUUID()}/${safeName}`;
  await storage().put(key, data, contentType);
  return { key, safeName, contentType };
}

export async function uploadDocument(
  actorId: string,
  projectId: string,
  meta: z.infer<typeof documentMetaSchema>,
  file: { name: string; data: Buffer },
) {
  if (meta.shiftId) {
    const [s] = await db.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.id, meta.shiftId), eq(shifts.projectId, projectId)));
    if (!s) throw new CommsError("That shift isn't part of this project.");
  }
  // Store first; if the database write fails the orphaned object is harmless and unreachable.
  const stored = await storeFile(projectId, file.name, file.data);
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({
        projectId,
        shiftId: meta.shiftId,
        title: meta.title,
        category: meta.category as (typeof documents.category.enumValues)[number],
        fileName: stored.safeName,
        storageKey: stored.key,
        contentType: stored.contentType,
        sizeBytes: file.data.length,
        requiresAck: meta.requiresAck,
        uploadedBy: actorId,
      })
      .returning({ id: documents.id });
    await recordAudit({ actorId, action: "document.upload", entityType: "document", entityId: doc!.id, projectId, after: { ...meta, fileName: stored.safeName } }, tx);
    await enqueue(tx, { type: "document.published", payload: { documentId: doc!.id, version: 1 }, dedupeKey: `document.published:${doc!.id}:1` });
    return doc!.id;
  });
}

/** Uploads a new version. Acknowledgements are per version, so everyone needs to re-acknowledge. */
export async function replaceDocument(actorId: string, documentId: string, file: { name: string; data: Buffer }) {
  const [current] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!current || current.archivedAt) throw new CommsError("Document not found.");
  const stored = await storeFile(current.projectId, file.name, file.data);
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(documents).where(eq(documents.id, documentId)).for("update");
    const version = d!.version + 1;
    await tx
      .update(documents)
      .set({ version, fileName: stored.safeName, storageKey: stored.key, contentType: stored.contentType, sizeBytes: file.data.length })
      .where(eq(documents.id, documentId));
    await recordAudit(
      {
        actorId,
        action: "document.replace",
        entityType: "document",
        entityId: documentId,
        projectId: d!.projectId,
        before: { version: d!.version, storageKey: d!.storageKey },
        after: { version, storageKey: stored.key },
      },
      tx,
    );
    await enqueue(tx, { type: "document.published", payload: { documentId, version }, dedupeKey: `document.published:${documentId}:${version}` });
    return version;
  });
}

export async function archiveDocument(actorId: string, documentId: string) {
  await db.transaction(async (tx) => {
    const [d] = await tx.update(documents).set({ archivedAt: new Date() }).where(eq(documents.id, documentId)).returning();
    if (!d) throw new CommsError("Document not found.");
    await recordAudit({ actorId, action: "document.archive", entityType: "document", entityId: documentId, projectId: d.projectId }, tx);
  });
}

/** Staff may see a document if they're confirmed (or completed) on its project — or on its shift, if it's shift-specific. */
export async function staffCanAccessDocument(staffId: string, doc: { projectId: string; shiftId: string | null; archivedAt: Date | null }) {
  if (doc.archivedAt) return false;
  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.staffId, staffId),
        eq(bookings.projectId, doc.projectId),
        inArray(bookings.status, ["confirmed", "completed"]),
        doc.shiftId ? eq(bookings.shiftId, doc.shiftId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function acknowledgeDocument(staff: { userId: string; staffId: string }, documentId: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc || !(await staffCanAccessDocument(staff.staffId, doc))) throw new CommsError("Document not found.");
  if (!doc.requiresAck) return;
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(documentAcknowledgements)
      .values({ documentId, documentVersion: doc.version, staffId: staff.staffId })
      .onConflictDoNothing()
      .returning({ id: documentAcknowledgements.id });
    if (inserted.length) {
      await recordAudit(
        { actorId: staff.userId, action: "document.acknowledge", entityType: "document", entityId: documentId, projectId: doc.projectId, after: { version: doc.version } },
        tx,
      );
    }
  });
}

/** Project documents with acknowledgement progress among currently confirmed staff. */
export async function listProjectDocuments(projectId: string) {
  const docs = await db
    .select({ doc: documents, uploader: users.name })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.uploadedBy))
    .where(and(eq(documents.projectId, projectId), isNull(documents.archivedAt)))
    .orderBy(desc(documents.createdAt));
  const confirmedStaff = await db
    .selectDistinct({ staffId: bookings.staffId, shiftId: bookings.shiftId })
    .from(bookings)
    .where(and(eq(bookings.projectId, projectId), inArray(bookings.status, ["confirmed", "completed"])));
  const acks = docs.length
    ? await db
        .select()
        .from(documentAcknowledgements)
        .where(inArray(documentAcknowledgements.documentId, docs.map((d) => d.doc.id)))
    : [];
  return docs.map(({ doc, uploader }) => {
    const audience = new Set(confirmedStaff.filter((c) => !doc.shiftId || c.shiftId === doc.shiftId).map((c) => c.staffId));
    const acked = new Set(acks.filter((a) => a.documentId === doc.id && a.documentVersion === doc.version && audience.has(a.staffId)).map((a) => a.staffId));
    return { ...doc, uploader, audience: audience.size, acknowledged: acked.size, pendingStaffIds: [...audience].filter((id) => !acked.has(id)) };
  });
}

/** Documents for a staff member's confirmed work, newest first, with whether they've acknowledged the current version. */
export async function listStaffDocuments(staffId: string, opts: { projectId?: string } = {}) {
  const rows = await db
    .selectDistinct({ doc: documents, projectName: projects.name })
    .from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .innerJoin(
      bookings,
      and(
        eq(bookings.projectId, documents.projectId),
        eq(bookings.staffId, staffId),
        inArray(bookings.status, ["confirmed", "completed"]),
        or(isNull(documents.shiftId), eq(bookings.shiftId, documents.shiftId)),
        gte(bookings.endsAt, sql`now() - interval '30 days'`),
      ),
    )
    .where(and(isNull(documents.archivedAt), opts.projectId ? eq(documents.projectId, opts.projectId) : undefined))
    .orderBy(desc(documents.createdAt));
  const acks = rows.length
    ? await db
        .select()
        .from(documentAcknowledgements)
        .where(and(eq(documentAcknowledgements.staffId, staffId), inArray(documentAcknowledgements.documentId, rows.map((r) => r.doc.id))))
    : [];
  return rows.map(({ doc, projectName }) => {
    const ack = acks.find((a) => a.documentId === doc.id && a.documentVersion === doc.version);
    return { ...doc, projectName, acknowledgedAt: ack?.acknowledgedAt ?? null };
  });
}

// ─── Announcements ──────────────────────────────────────────────────────────

export const announcementSchema = z.object({
  title: z.string().trim().min(2, "Add a title").max(120),
  body: z.string().trim().min(1, "Write the announcement").max(4000),
  important: z.boolean(),
});

export async function postAnnouncement(actorId: string, projectId: string, input: z.infer<typeof announcementSchema>) {
  return db.transaction(async (tx) => {
    const [a] = await tx.insert(announcements).values({ projectId, ...input, authorId: actorId }).returning({ id: announcements.id });
    await recordAudit({ actorId, action: "announcement.post", entityType: "announcement", entityId: a!.id, projectId, after: input }, tx);
    await enqueue(tx, { type: "announcement.posted", payload: { announcementId: a!.id }, dedupeKey: `announcement.posted:${a!.id}` });
    return a!.id;
  });
}

export async function listProjectAnnouncements(projectId: string) {
  return db
    .select({ a: announcements, author: users.name })
    .from(announcements)
    .leftJoin(users, eq(users.id, announcements.authorId))
    .where(eq(announcements.projectId, projectId))
    .orderBy(desc(announcements.createdAt))
    .limit(50);
}

/** Announcements on projects where the person has (or recently had) confirmed work. */
export async function listStaffAnnouncements(staffId: string) {
  return db
    .selectDistinct({ a: announcements, projectName: projects.name, author: users.name })
    .from(announcements)
    .innerJoin(projects, eq(projects.id, announcements.projectId))
    .leftJoin(users, eq(users.id, announcements.authorId))
    .innerJoin(
      bookings,
      and(
        eq(bookings.projectId, announcements.projectId),
        eq(bookings.staffId, staffId),
        inArray(bookings.status, ["confirmed", "completed"]),
        gte(bookings.endsAt, sql`now() - interval '30 days'`),
      ),
    )
    .orderBy(desc(announcements.createdAt))
    .limit(30);
}

// ─── Messages ───────────────────────────────────────────────────────────────

export async function getOrCreateThread(tx: Tx | typeof db, staffId: string, projectId: string | null) {
  const [existing] = await tx
    .select()
    .from(messageThreads)
    .where(and(eq(messageThreads.staffId, staffId), projectId ? eq(messageThreads.projectId, projectId) : isNull(messageThreads.projectId)));
  if (existing) return existing;
  await tx.insert(messageThreads).values({ staffId, projectId }).onConflictDoNothing();
  const [created] = await tx
    .select()
    .from(messageThreads)
    .where(and(eq(messageThreads.staffId, staffId), projectId ? eq(messageThreads.projectId, projectId) : isNull(messageThreads.projectId)));
  return created!;
}

/** Posts a message. `side` records which party wrote it, for unread tracking and notification routing. */
export async function postMessage(tx: Tx | typeof db, input: { threadId: string; authorUserId: string; body: string; side: "staff" | "rgxm" }) {
  const body = input.body.trim();
  if (!body) throw new CommsError("Write a message first.");
  if (body.length > 4000) throw new CommsError("Messages are limited to 4,000 characters.");
  const now = new Date();
  const [m] = await tx.insert(messages).values({ threadId: input.threadId, authorId: input.authorUserId, body }).returning({ id: messages.id });
  await tx
    .update(messageThreads)
    .set({ lastMessageAt: now, ...(input.side === "staff" ? { staffLastReadAt: now } : { rgxmLastReadAt: now }) })
    .where(eq(messageThreads.id, input.threadId));
  await enqueue(tx, { type: "message.posted", payload: { messageId: m!.id }, dedupeKey: `message.posted:${m!.id}` });
  return m!.id;
}

export async function getThreadMessages(threadId: string) {
  return db
    .select({ id: messages.id, body: messages.body, createdAt: messages.createdAt, authorId: messages.authorId, authorName: users.name, authorKind: users.kind })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt);
}

export async function markThreadRead(threadId: string, side: "staff" | "rgxm") {
  await db
    .update(messageThreads)
    .set(side === "staff" ? { staffLastReadAt: new Date() } : { rgxmLastReadAt: new Date() })
    .where(eq(messageThreads.id, threadId));
}

export async function listProjectThreads(projectId: string) {
  return db
    .select({
      id: messageThreads.id,
      staffId: messageThreads.staffId,
      staffName: sql<string>`coalesce(${staffProfiles.preferredName}, ${staffProfiles.firstName}) || ' ' || ${staffProfiles.lastName}`,
      lastMessageAt: messageThreads.lastMessageAt,
      unread: sql<boolean>`${messageThreads.lastMessageAt} > coalesce(${messageThreads.rgxmLastReadAt}, 'epoch'::timestamptz)`,
      preview: sql<string | null>`(select m.body from ${messages} m where m.thread_id = ${messageThreads.id} order by m.created_at desc limit 1)`,
    })
    .from(messageThreads)
    .innerJoin(staffProfiles, eq(staffProfiles.id, messageThreads.staffId))
    .where(and(eq(messageThreads.projectId, projectId), sql`${messageThreads.lastMessageAt} is not null`))
    .orderBy(desc(messageThreads.lastMessageAt));
}

export async function listStaffThreads(staffId: string) {
  return db
    .select({
      id: messageThreads.id,
      projectId: messageThreads.projectId,
      projectName: projects.name,
      lastMessageAt: messageThreads.lastMessageAt,
      unread: sql<boolean>`${messageThreads.lastMessageAt} > coalesce(${messageThreads.staffLastReadAt}, 'epoch'::timestamptz)`,
      preview: sql<string | null>`(select m.body from ${messages} m where m.thread_id = ${messageThreads.id} order by m.created_at desc limit 1)`,
    })
    .from(messageThreads)
    .leftJoin(projects, eq(projects.id, messageThreads.projectId))
    .where(and(eq(messageThreads.staffId, staffId), sql`${messageThreads.lastMessageAt} is not null`))
    .orderBy(desc(messageThreads.lastMessageAt));
}
