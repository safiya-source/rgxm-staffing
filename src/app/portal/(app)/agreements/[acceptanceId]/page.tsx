import { format } from "date-fns";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/legal/print-button";
import { LegalText } from "@/components/portal/legal-text";
import { acceptedCopy } from "@/server/domain/onboarding";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "My copy" };

/** The exact version the contractor accepted, with the acceptance record, to print or save. */
export default async function AcceptedCopyPage({ params }: PageProps<"/portal/agreements/[acceptanceId]">) {
  const viewer = await requireStaff();
  const { acceptanceId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(acceptanceId)) notFound();
  const row = await acceptedCopy(viewer.staff!.id, acceptanceId);
  if (!row) notFound();
  const { a, d } = row;
  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/portal/agreements" className="text-sm text-muted-foreground hover:text-foreground">
          ← My agreements
        </Link>
        <PrintButton />
      </div>
      <LegalText doc={d} />
      <section aria-labelledby="record" className="rounded-xl border bg-card p-4 text-sm">
        <h2 id="record" className="font-semibold">
          Acceptance record
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {d.kind === "contractor_terms" ? (
            <>
              <dt className="text-muted-foreground">RGXM contracting entity</dt>
              <dd>RGXM Inc.</dd>
              <dt className="text-muted-foreground">Contractor legal name/entity</dt>
              <dd>{a.contractingParty ?? "—"}</dd>
              <dt className="text-muted-foreground">Authorized representative</dt>
              <dd>{a.authorizedRepresentative ?? "Not applicable (accepted as an individual)"}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Document version</dt>
          <dd>{d.version}</dd>
          <dt className="text-muted-foreground">Accepted</dt>
          <dd>{format(a.acceptedAt, "MMMM d, yyyy 'at' h:mm a")} through your RGXM Crew account</dd>
          <dt className="text-muted-foreground">Record ID</dt>
          <dd className="font-mono text-xs">{a.id}</dd>
        </dl>
      </section>
    </div>
  );
}
