import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TaxDetailsForm } from "@/components/app/tax-details-form";
import { taxIdStorageReady } from "@/server/crypto/tax-id";
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
          RGXM pays you as an independent contractor. We need these details to pay you correctly and to send your T4A tax slip.
          Your SIN is encrypted and only RGXM&apos;s finance team can use it, for tax slips.
        </p>
      </div>
      <TaxDetailsForm initial={details} action={saveMyTaxDetailsAction} sinAvailable={taxIdStorageReady()} selfService />
    </div>
  );
}
