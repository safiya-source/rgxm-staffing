import { WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "Payments" };

export default async function Page() {
  await requireStaff();
  return (
    <div className="grid gap-5">
      <h1 className="text-[22px] font-semibold">Payments</h1>
      <EmptyState icon={WalletIcon} title="Coming soon" description="Your approved hours, payment statements and payment status will appear here." />
    </div>
  );
}
