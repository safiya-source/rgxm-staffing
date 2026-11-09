// Public pages for RGXM's legal documents. Each shows the version RGXM approved (Settings →
// Contractors & legal), links to the other documents, the contacts, and a print/save button.
import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { PrintButton } from "@/components/legal/print-button";
import { LegalText } from "@/components/portal/legal-text";
import { cn } from "@/lib/utils";
import { LEGAL_KIND_LABEL, LEGAL_KIND_PATH, LEGAL_KINDS, type LegalKind } from "@/server/domain/onboarding";
import { getOrgSettings } from "@/server/settings";

export function LegalNav({ current }: { current?: LegalKind }) {
  return (
    <nav aria-label="Legal documents" className="flex flex-wrap gap-x-4 gap-y-1 text-sm print:hidden">
      {LEGAL_KINDS.map((k) => (
        <Link key={k} href={LEGAL_KIND_PATH[k]} aria-current={k === current ? "page" : undefined} className={cn("hover:text-foreground", k === current ? "font-medium text-foreground" : "text-muted-foreground")}>
          {LEGAL_KIND_LABEL[k]}
        </Link>
      ))}
    </nav>
  );
}

export async function Contacts() {
  const s = await getOrgSettings();
  return (
    <section aria-labelledby="contacts" className="mt-10 grid gap-3 rounded-xl border bg-card p-5 text-[15px]">
      <h2 id="contacts" className="text-lg font-semibold">
        Contacts
      </h2>
      <div>
        <p className="font-medium">Privacy Officer</p>
        {s.privacyOfficerName || s.privacyOfficerEmail ? (
          <p className="text-muted-foreground">
            {s.privacyOfficerName ? <span className="block">{s.privacyOfficerName}</span> : null}
            {s.privacyOfficerAddress ? <span className="block">{s.privacyOfficerAddress}</span> : null}
            {s.privacyOfficerEmail ? (
              <a href={`mailto:${s.privacyOfficerEmail}`} className="block underline underline-offset-2">
                {s.privacyOfficerEmail}
              </a>
            ) : null}
            {s.privacyOfficerPhone ? <span className="block">{s.privacyOfficerPhone}</span> : null}
          </p>
        ) : (
          <p className="text-muted-foreground">To be appointed by RGXM.</p>
        )}
      </div>
      {s.supportEmail ? (
        <p>
          <span className="font-medium">Platform support and account closure: </span>
          <a href={`mailto:${s.supportEmail}`} className="underline underline-offset-2">
            {s.supportEmail}
          </a>
        </p>
      ) : null}
      {s.financeEmail ? (
        <p>
          <span className="font-medium">Finance and payments: </span>
          <a href={`mailto:${s.financeEmail}`} className="underline underline-offset-2">
            {s.financeEmail}
          </a>
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">Never send a Social Insurance Number, bank credentials or card details by ordinary email.</p>
    </section>
  );
}

export function LegalShell({ current, children }: { current?: LegalKind; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <div className="flex items-center justify-between gap-4">
        <Link href="/">
          <Logo />
        </Link>
        <PrintButton />
      </div>
      <div className="mt-6">
        <LegalNav current={current} />
      </div>
      <div className="mt-8">{children}</div>
      <Contacts />
    </div>
  );
}

export function LegalDocumentPage({ kind, doc }: { kind: LegalKind; doc: { title: string; version: string; effectiveAt: Date | null; body: string } }) {
  return (
    <LegalShell current={kind}>
      <LegalText doc={doc} />
    </LegalShell>
  );
}

export function NotPublished({ kind }: { kind: LegalKind }) {
  return (
    <LegalShell current={kind}>
      <h1 className="text-2xl font-semibold">{LEGAL_KIND_LABEL[kind]}</h1>
      <p className="mt-3 text-[15px] text-muted-foreground">RGXM hasn&apos;t published this document yet. You&apos;ll be asked to review it in the staff portal when it is.</p>
    </LegalShell>
  );
}
