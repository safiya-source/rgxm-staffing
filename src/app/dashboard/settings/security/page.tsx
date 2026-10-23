import type { Metadata } from "next";
import { requireInternal } from "@/server/session";
import { TwoFactorSettings } from "./two-factor-settings";

export const metadata: Metadata = { title: "My security" };

export default async function SecurityPage() {
  const viewer = await requireInternal();
  return <TwoFactorSettings enabled={viewer.twoFactorEnabled} />;
}
