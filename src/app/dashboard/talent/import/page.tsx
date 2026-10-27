import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { canAny } from "@/server/authz/permissions";
import { IMPORT_COLUMNS, IMPORT_MAX_ROWS } from "@/server/domain/talent";
import { requireInternal, toActor } from "@/server/session";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import staff" };

export default async function ImportPage() {
  const viewer = await requireInternal("talent.import");
  const canEditRates = canAny(toActor(viewer), "rates.edit");
  return (
    <>
      <Link href="/dashboard/talent" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Talent
      </Link>
      <PageHeader title="Import staff from CSV" description={`Up to ${IMPORT_MAX_ROWS} rows. You'll see a preview before anything is saved.`} />
      <ImportWizard columns={[...IMPORT_COLUMNS]} canEditRates={canEditRates} />
    </>
  );
}
