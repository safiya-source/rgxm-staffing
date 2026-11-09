import { format } from "date-fns";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/app/action-form";
import { ContractingPartyFields } from "@/components/portal/contracting-party-fields";
import { LegalText } from "@/components/portal/legal-text";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { acceptanceHistory, acceptLabel, LEGAL_KIND_LABEL, LEGAL_KIND_PATH, pendingAcceptances, type LegalKind } from "@/server/domain/onboarding";
import { getTaxDetails } from "@/server/domain/tax-details";
import { requireStaff } from "@/server/session";
import { acceptAgreementsAction } from "../../actions";

export const metadata: Metadata = { title: "My agreements" };

export default async function AgreementsPage() {
  const viewer = await requireStaff();
  const staffId = viewer.staff!.id;
  const [pending, history, tax] = await Promise.all([pendingAcceptances(staffId), acceptanceHistory(staffId), getTaxDetails(staffId)]);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[22px] font-semibold">My agreements</h1>
        <p className="mt-1 text-sm text-muted-foreground">The documents you&apos;ve accepted, with the version and date. Open one to print or save your copy.</p>
      </div>

      {pending.length ? (
        <section className="grid gap-4">
          <h2 className="text-base font-semibold">Please review</h2>
          <p className="text-sm text-muted-foreground">RGXM has published {pending.length === 1 ? "a document" : "documents"} you haven&apos;t accepted yet. You need to accept {pending.length === 1 ? "it" : "them"} before you can be confirmed for new shifts.</p>
          {pending.map((d) => (
            <div key={d.id} className="rounded-xl border bg-card p-4">
              {d.summaryOfChanges ? <p className="mb-3 rounded-lg bg-info-soft px-3 py-2 text-sm text-info">What changed: {d.summaryOfChanges}</p> : null}
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  {d.title} (version {d.version}) · read it here or on its{" "}
                  <Link href={LEGAL_KIND_PATH[d.kind as LegalKind]} target="_blank" className="underline underline-offset-2">
                    own page
                  </Link>
                </summary>
                <div className="mt-4">
                  <LegalText doc={d} />
                </div>
              </details>
            </div>
          ))}
          <ActionForm action={acceptAgreementsAction} submitLabel="Continue" size="lg" className="grid gap-3" keep>
            {pending.some((d) => d.kind === "contractor_terms") ? <ContractingPartyFields defaults={{ legalName: tax.legalName ?? viewer.name, businessName: tax.businessName ?? "" }} /> : null}
            {pending.map((d) => (
              <div key={d.id} className="flex items-start gap-3">
                <Checkbox id={`accept_${d.id}`} name={`accept_${d.id}`} className="mt-0.5" />
                <Label htmlFor={`accept_${d.id}`} className="leading-snug font-normal">
                  {acceptLabel(d)} (version {d.version})
                </Label>
              </div>
            ))}
          </ActionForm>
        </section>
      ) : null}

      <section className="grid gap-2">
        <h2 className="text-base font-semibold">Accepted</h2>
        {history.length ? (
          <ul className="divide-y rounded-xl border bg-card">
            {history.map((a) => (
              <li key={a.id}>
                <Link href={`/portal/agreements/${a.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent">
                  <span>
                    <span className="block text-sm font-medium">{LEGAL_KIND_LABEL[a.kind as LegalKind] ?? a.kind}</span>
                    <span className="block text-xs text-muted-foreground">
                      Version {a.version} · accepted {format(a.acceptedAt, "MMM d, yyyy")}
                      {a.contractingParty ? ` · ${a.contractingParty}` : ""}
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">View copy →</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing accepted yet.</p>
        )}
      </section>
    </div>
  );
}
