import { CalendarIcon, ChevronRightIcon, ReceiptTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "You're all set" };

/** The last setup screen: prompts (never requires) availability and tax details, then Home. */
export default async function OnboardingNextPage() {
  const viewer = await requireStaff();
  const name = viewer.staff?.preferredName ?? viewer.staff?.firstName ?? null;
  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pt-6 pb-16">
      <Logo />
      <h1 className="mt-10 text-2xl font-semibold">You&apos;re all set{name ? `, ${name}` : ""}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">Two more things help you get offers and get paid. Do them now or later from My profile.</p>
      <Card className="mt-8 divide-y">
        <Link href="/portal/availability" className="flex items-center gap-3 px-4 py-4 hover:bg-accent">
          <CalendarIcon className="size-5 text-brand" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">Set your availability now</span>
            <span className="block text-sm text-muted-foreground">The days and hours you can usually work.</span>
          </span>
          <ChevronRightIcon className="size-4 text-muted-foreground" />
        </Link>
        <Link href="/portal/profile/tax" className="flex items-center gap-3 px-4 py-4 hover:bg-accent">
          <ReceiptTextIcon className="size-5 text-brand" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">Add tax details</span>
            <span className="block text-sm text-muted-foreground">Your GST/HST answer and mailing address, so RGXM can pay you correctly.</span>
          </span>
          <ChevronRightIcon className="size-4 text-muted-foreground" />
        </Link>
      </Card>
      <Button asChild variant="ghost" size="lg" className="mt-4 w-full">
        <Link href="/portal">Skip for now and go to Home</Link>
      </Button>
    </div>
  );
}
