import { CalendarIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "My schedule" };

export default async function Page() {
  await requireStaff();
  return (
    <div className="grid gap-5">
      <h1 className="text-[22px] font-semibold">My schedule</h1>
      <EmptyState icon={CalendarIcon} title="Coming soon" description="Your confirmed shifts, briefs and check-in will appear here." />
    </div>
  );
}
