import { MessageSquareIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "Messages" };

export default async function Page() {
  await requireStaff();
  return (
    <div className="grid gap-5">
      <h1 className="text-[22px] font-semibold">Messages</h1>
      <EmptyState icon={MessageSquareIcon} title="Coming soon" description="Announcements and messages from your project team will appear here." />
    </div>
  );
}
