import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { WorkDetailsForm } from "@/components/portal/work-details-form";
import { getWorkDetails } from "@/server/domain/work-details";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "Work details" };

export default async function WorkDetailsPage() {
  const viewer = await requireStaff();
  const initial = await getWorkDetails(viewer.staff!.id);
  return (
    <div className="grid gap-5">
      <Link href="/portal/profile" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> My profile
      </Link>
      <div>
        <h1 className="text-[22px] font-semibold">Work details</h1>
        <p className="mt-1 text-sm text-muted-foreground">Helps RGXM offer you shifts that fit, like ones that need a driver or a second language. Every answer is optional.</p>
      </div>
      <WorkDetailsForm mode="profile" initial={initial} />
    </div>
  );
}
