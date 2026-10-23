import type { Metadata } from "next";
import { PlannedSection } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "Reports" };

export default async function Page() {
  await requireInternal("reports.view");
  return (
    <>
      <PageHeader title="Reports" description="Operational, financial and talent KPIs." />
      <PlannedSection
        milestone="Phase 2"
        title="Reports"
        items={[
    "Fill rate, time to fill and acceptance rate",
    "Spend by client, project and role",
    "Cancellation and no-show trends",
    "Filters by date, project, client, location and role",
        ]}
      />
    </>
  );
}
