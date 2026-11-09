import type { Metadata } from "next";
import { LegalDocumentPage, NotPublished } from "@/components/legal/legal-page";
import { currentDocuments } from "@/server/domain/onboarding";

export const metadata: Metadata = { title: "Independent Contractor Agreement" };
export const dynamic = "force-dynamic";

export default async function ContractorAgreementPage() {
  const { contractor_terms: doc } = await currentDocuments();
  if (!doc) return <NotPublished kind="contractor_terms" />;
  return <LegalDocumentPage kind="contractor_terms" doc={doc} />;
}
