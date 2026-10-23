import type { Metadata } from "next";
import { PlannedSection } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "Timesheets" };

export default async function Page() {
  await requireInternal("timesheet.view");
  return (
    <>
      <PageHeader title="Timesheets" description="Attendance, hours and approvals." />
      <PlannedSection
        milestone="M4"
        title="Timesheets"
        items={[
    "Check-in and check-out records",
    "Staff corrections and supervisor verification",
    "Final approval of payable hours",
    "Full adjustment history on every change",
        ]}
      />
    </>
  );
}
