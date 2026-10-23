import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireInternal } from "@/server/session";
import { createStaffAction } from "../actions";
import { EMPTY_STAFF, StaffForm } from "../staff-form";

export const metadata: Metadata = { title: "Add staff" };

export default async function NewStaffPage() {
  await requireInternal("talent.edit");
  return (
    <>
      <Link href="/dashboard/talent" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Talent
      </Link>
      <PageHeader
        title="Add staff"
        description="The person can sign in to the staff portal with this email. Their profile links automatically."
      />
      <Card className="max-w-3xl">
        <CardContent>
          <StaffForm action={createStaffAction} values={EMPTY_STAFF} mode="create" />
        </CardContent>
      </Card>
    </>
  );
}
