import { redirect } from "next/navigation";
import { getViewer, homeFor } from "@/server/session";

export default async function Root() {
  const viewer = await getViewer();
  redirect(viewer ? homeFor(viewer) : "/sign-in");
}
