import type { Metadata } from "next";
import { PlannedSection } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "Staffing Requests" };

export default async function Page() {
  await requireInternal("booking.offer");
  return (
    <>
      <PageHeader title="Staffing Requests" description="Send shift offers and confirm staff." />
      <PlannedSection
        milestone="M3"
        title="Staffing Requests"
        items={[
    "Eligible-talent suggestions from objective criteria",
    "Offers by email with response deadlines",
    "Live response board: interested, declined, no response",
    "Confirm, waitlist and replace staff with conflict checks",
        ]}
      />
    </>
  );
}
