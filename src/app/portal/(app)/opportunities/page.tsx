import { InboxIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "Opportunities" };

export default async function Page() {
  await requireStaff();
  return (
    <div className="grid gap-5">
      <h1 className="text-[22px] font-semibold">Opportunities</h1>
      <EmptyState icon={InboxIcon} title="Coming soon" description="Shift offers from RGXM will appear here. You'll be able to say you're interested, unavailable, or ask for more info." />
    </div>
  );
}
