import type { Metadata } from "next";
import { PlannedSection } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "Projects" };

export default async function Page() {
  await requireInternal("project.view");
  return (
    <>
      <PageHeader title="Projects" description="Activations, locations, staffing requirements and budgets." />
      <PlannedSection
        milestone="M2"
        title="Projects"
        items={[
    "Create projects with client, code, dates and budget",
    "Multiple locations, each with its own time zone",
    "Staffing requirements by role and location",
    "Project dashboard: filled vs unfilled, costs vs budget",
        ]}
      />
    </>
  );
}
