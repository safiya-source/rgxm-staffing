import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TaxDetailsForm } from "@/components/app/tax-details-form";
import { getTaxDetails } from "@/server/domain/tax-details";
import { requireStaff } from "@/server/session";
import { saveMyTaxDetailsAction } from "../../../actions";

export const metadata: Metadata = { title: "Tax details" };

export default async function TaxDetailsPage() {
  const viewer = await requireStaff();
  const details = await getTaxDetails(viewer.staff!.id);
  return (
    <div className="grid gap-5">
      <Link href="/portal/profile" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> My profile
      </Link>
      <div>
        <h1 className="text-[22px] font-semibold">Tax details</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          RGXM pays you as an independent contractor. We need these details to pay you correctly and for any year-end tax slip.
          Please don&apos;t enter your SIN here: if it&apos;s needed, RGXM&apos;s accountant will ask you for it directly.
        </p>
      </div>
      {details.gstRegistrationStatus !== "unknown" ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          {details.gstVerificationStatus === "verified"
            ? "RGXM Finance has checked your GST/HST answer."
            : details.gstVerificationStatus === "rejected"
              ? "RGXM Finance couldn't confirm your GST/HST details. They'll be in touch, or message RGXM."
              : "RGXM Finance hasn't checked your GST/HST answer yet. Until they do, tax on your pay is reviewed by hand."}
        </p>
      ) : null}
      <TaxDetailsForm initial={details} action={saveMyTaxDetailsAction} selfService />
    </div>
  );
}
