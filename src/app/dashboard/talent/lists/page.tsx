import { ArrowLeftIcon, ListIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { canAny } from "@/server/authz/permissions";
import { getTalentLookups } from "@/server/domain/talent";
import { requireInternal, toActor } from "@/server/session";
import { CreateListButton, DeleteListButton } from "./list-actions";

export const metadata: Metadata = { title: "Saved lists" };

export default async function ListsPage() {
  const viewer = await requireInternal("talent.view");
  const canEdit = canAny(toActor(viewer), "talent.edit");
  const { lists } = await getTalentLookups();
  return (
    <>
      <Link href="/dashboard/talent" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Talent
      </Link>
      <PageHeader
        title="Saved lists"
        description="Groups of people you staff together, e.g. Toronto Preferred BAs. Add people from the Talent table."
        actions={canEdit ? <CreateListButton /> : null}
      />
      {lists.length === 0 ? (
        <EmptyState icon={ListIcon} title="No lists yet" />
      ) : (
        <Card className="divide-y">
          {lists.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <Link href={`/dashboard/talent?list=${l.id}&status=any`} className="min-w-0 hover:underline">
                <p className="font-medium">{l.name}</p>
                <p className="text-sm text-muted-foreground">
                  {l.members} {l.members === 1 ? "person" : "people"}
                  {l.description ? ` · ${l.description}` : ""}
                </p>
              </Link>
              {canEdit ? <DeleteListButton id={l.id} name={l.name} /> : null}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
