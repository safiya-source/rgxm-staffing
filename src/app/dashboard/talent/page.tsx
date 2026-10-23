import type { Metadata } from "next";
import { PlannedSection } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "Talent" };

export default async function Page() {
  await requireInternal("talent.view");
  return (
    <>
      <PageHeader title="Talent" description="Your field staff database." />
      <PlannedSection
        milestone="M2"
        title="Talent"
        items={[
    "Searchable directory with role, city, skill and availability filters",
    "Profiles with qualifications, rates history and availability",
    "Saved lists such as Toronto Preferred BAs",
    "CSV import and export",
        ]}
      />
    </>
  );
}
