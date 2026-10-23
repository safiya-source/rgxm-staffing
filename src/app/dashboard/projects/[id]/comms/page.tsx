import { inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canOnProject } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { staffProfiles } from "@/server/db/schema";
import { DOCUMENT_CATEGORIES, listProjectAnnouncements, listProjectDocuments } from "@/server/domain/comms";
import { loadProjectScopes, requireInternal, toActor } from "@/server/session";
import { AnnouncementForm, AnnouncementList, DocumentList, UploadForm } from "./comms-sections";

export const metadata: Metadata = { title: "Briefs & updates" };

export default async function ProjectCommsPage({ params }: PageProps<"/dashboard/projects/[id]/comms">) {
  const viewer = await requireInternal("project.view");
  const { id } = await params;
  const scope = (await loadProjectScopes([id])).get(id)!;
  const canManage = canOnProject(toActor(viewer), "comms.manage", scope);
  const [docs, news] = await Promise.all([listProjectDocuments(id), listProjectAnnouncements(id)]);
  const pendingIds = [...new Set(docs.flatMap((d) => d.pendingStaffIds))];
  const names = pendingIds.length
    ? await db
        .select({ id: staffProfiles.id, name: sql<string>`coalesce(${staffProfiles.preferredName}, ${staffProfiles.firstName}) || ' ' || ${staffProfiles.lastName}` })
        .from(staffProfiles)
        .where(inArray(staffProfiles.id, pendingIds))
    : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="grid content-start gap-6 lg:col-span-3">
        <Card>
          <CardHeader>
            <CardTitle>Briefing documents</CardTitle>
            <CardDescription>Visible to staff confirmed on this project. Track who has confirmed they&apos;ve read required briefs.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {canManage ? <UploadForm projectId={id} categories={DOCUMENT_CATEGORIES.map(([v, l]) => ({ value: v, label: l }))} /> : null}
            <DocumentList
              canManage={canManage}
              docs={docs.map((d) => ({
                id: d.id,
                title: d.title,
                category: DOCUMENT_CATEGORIES.find(([c]) => c === d.category)?.[1] ?? d.category,
                fileName: d.fileName,
                version: d.version,
                requiresAck: d.requiresAck,
                audience: d.audience,
                acknowledged: d.acknowledged,
                pending: d.pendingStaffIds.map((s) => nameOf.get(s) ?? "Unknown"),
                uploader: d.uploader,
                createdAt: d.createdAt.toISOString(),
              }))}
            />
          </CardContent>
        </Card>
      </div>
      <div className="grid content-start gap-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Announcements</CardTitle>
            <CardDescription>Sent to everyone confirmed on upcoming shifts. Important ones are emailed too.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {canManage ? <AnnouncementForm projectId={id} /> : null}
            <AnnouncementList items={news.map(({ a, author }) => ({ id: a.id, title: a.title, body: a.body, important: a.important, author, createdAt: a.createdAt.toISOString() }))} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
