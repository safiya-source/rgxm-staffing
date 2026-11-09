import type { Metadata } from "next";
import { LegalDocumentPage, NotPublished } from "@/components/legal/legal-page";
import { currentDocuments } from "@/server/domain/onboarding";

export const metadata: Metadata = { title: "Platform Terms of Use" };
export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const { platform_terms: doc } = await currentDocuments();
  if (!doc) return <NotPublished kind="platform_terms" />;
  return <LegalDocumentPage kind="platform_terms" doc={doc} />;
}
