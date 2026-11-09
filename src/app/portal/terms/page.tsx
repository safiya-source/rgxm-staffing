import { redirect } from "next/navigation";

// The contractor agreement now has a public page (people can read it before signing up).
export default function PortalTermsPage() {
  redirect("/contractor-agreement");
}
