import type { Metadata } from "next";
import { PlannedSection } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "Payments" };

export default async function Page() {
  await requireInternal("payments.view");
  return (
    <>
      <PageHeader title="Payments" description="Payables, batches and exports." />
      <PlannedSection
        milestone="M5"
        title="Payments"
        items={[
    "Approved unpaid hours by staff and project",
    "Separate contractor and payroll batches",
    "CSV/XLSX export with duplicate protection",
    "Payment status visible to staff",
        ]}
      />
    </>
  );
}
