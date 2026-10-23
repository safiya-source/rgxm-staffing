import type { Metadata } from "next";
import { PlannedSection } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "Schedule" };

export default async function Page() {
  await requireInternal("project.view");
  return (
    <>
      <PageHeader title="Schedule" description="Shifts across every project and location." />
      <PlannedSection
        milestone="M2"
        title="Schedule"
        items={[
    "Day, week and month calendar views",
    "Bulk and multi-day shift creation, templates, duplication",
    "Overnight and cross-midnight shifts",
    "Coverage indicators and unfilled-shift alerts",
        ]}
      />
    </>
  );
}
