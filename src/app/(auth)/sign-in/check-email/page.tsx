import { MailIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: PageProps<"/sign-in/check-email">) {
  const { email } = await searchParams;
  return (
    <div>
      <span className="inline-flex size-11 items-center justify-center rounded-full bg-secondary">
        <MailIcon className="size-5" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold">Check your email</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        If {typeof email === "string" && email ? <strong className="text-foreground">{email}</strong> : "that address"} can
        sign in, we&apos;ve sent a link. It expires in 15 minutes.
      </p>
      <p className="mt-6 text-sm text-muted-foreground">
        Didn&apos;t get it? Check spam, or{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
          try again
        </Link>
        .
      </p>
    </div>
  );
}
