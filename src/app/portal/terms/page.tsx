import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/app/logo";
import { LegalText } from "@/components/portal/legal-text";
import { currentDocuments } from "@/server/domain/onboarding";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "Contractor agreement & platform terms" };

export default async function TermsPage() {
  await requireStaff({ allowIncompleteOnboarding: true });
  const { contractor_terms: terms } = await currentDocuments();
  if (!terms) notFound();
  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pt-6 pb-16">
      <Logo />
      <div className="mt-8">
        <LegalText doc={terms} />
      </div>
    </div>
  );
}
