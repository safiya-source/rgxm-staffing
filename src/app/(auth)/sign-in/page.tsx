import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer, homeFor } from "@/server/session";
import { SignInForms } from "./sign-in-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const viewer = await getViewer();
  if (viewer) redirect(homeFor(viewer));
  const params = await searchParams;
  const tab = params.tab === "team" ? "team" : "staff";
  const error = typeof params.error === "string" ? params.error : undefined;
  return <SignInForms defaultTab={tab} linkError={Boolean(error)} />;
}
