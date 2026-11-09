import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/app/action-form";
import { LegalText } from "@/components/portal/legal-text";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { LEGAL_KIND_LABEL, pendingAcceptances, type LegalKind } from "@/server/domain/onboarding";
import { requireStaff } from "@/server/session";
import { acceptAgreementsAction } from "../../actions";

export const metadata: Metadata = { title: "Updated terms" };

export default async function AgreementsPage() {
  const viewer = await requireStaff();
  const pending = await pendingAcceptances(viewer.staff!.id);
  if (!pending.length) {
    return (
      <div className="grid gap-3">
        <h1 className="text-[22px] font-semibold">You&apos;re all set</h1>
        <p className="text-sm text-muted-foreground">You&apos;ve accepted the current privacy notice and terms.</p>
        <Link href="/portal" className="text-sm font-medium hover:underline">
          Back to home →
        </Link>
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[22px] font-semibold">Please review what&apos;s changed</h1>
        <p className="mt-1 text-sm text-muted-foreground">RGXM has published a new version. You need to accept it before you can be confirmed for new shifts.</p>
      </div>
      {pending.map((d) => (
        <section key={d.id} className="rounded-xl border bg-card p-4">
          {d.summaryOfChanges ? <p className="mb-3 rounded-lg bg-info-soft px-3 py-2 text-sm text-info">What changed: {d.summaryOfChanges}</p> : null}
          <LegalText doc={d} />
        </section>
      ))}
      <ActionForm action={acceptAgreementsAction} submitLabel="Continue" size="lg" className="grid gap-3" keep>
        {pending.map((d) => (
          <div key={d.id} className="flex items-start gap-3">
            <Checkbox id={`accept_${d.id}`} name={`accept_${d.id}`} className="mt-0.5" />
            <Label htmlFor={`accept_${d.id}`} className="leading-snug font-normal">
              {d.kind === "privacy_notice" ? "I've read the privacy notice" : `I accept the ${LEGAL_KIND_LABEL[d.kind as LegalKind].toLowerCase()}`} (version {d.version})
            </Label>
          </div>
        ))}
      </ActionForm>
    </div>
  );
}
