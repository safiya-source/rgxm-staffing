import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { getOrgSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Privacy notice" };

// DRAFT. Must be reviewed by RGXM's legal/privacy advisor before production use (PIPEDA).
export default async function PrivacyPage() {
  const settings = await getOrgSettings();
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <Link href="/">
        <Logo />
      </Link>
      <p className="mt-8 inline-flex rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning">
        Draft · pending legal review
      </p>
      <h1 className="mt-4 text-3xl font-semibold">Privacy notice</h1>
      <div className="mt-6 grid gap-5 text-[15px] leading-relaxed text-muted-foreground [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground">
        <p>
          RGXM uses this platform to offer event work, schedule shifts, record attendance and pay the people who work our
          activations. This notice explains what we collect and why.
        </p>
        <h2>What we collect</h2>
        <p>
          Your name, contact details, city, the roles you can work, your availability, the shifts you&apos;re offered and
          work, the times you check in and out, the hours approved for payment, and the payment and tax details needed to pay
          you. If you choose to provide them: an emergency contact, certifications, licences and a resume.
        </p>
        <h2>Location</h2>
        <p>
          On some activations we ask for your location at the moment you check in or out, to confirm you&apos;re on site. We
          never track your location at any other time. You&apos;ll always see when location is being requested.
        </p>
        <h2>Who can see it</h2>
        <p>
          Only authorised RGXM staff, on a need-to-know basis. Rates, payment details, evaluations and emergency contacts
          are restricted further. Other field staff never see your rates or private details. Your data is stored in
          Canada.
        </p>
        <h2>How long we keep it</h2>
        <p>
          Check-in locations are cleared automatically after {settings.locationRetentionDays} days (the check-in time stays
          with your timesheet). Copies of emails we send you are cleared from our records after {settings.mailLogRetentionDays}{" "}
          days. Work and payment records are kept as long as the law requires (generally six years for tax records in Canada).
        </p>
        <h2>Your rights</h2>
        <p>
          You can download a copy of your data at any time from <em>My profile → Download a copy of my data</em>. You can ask
          us to correct your information, withdraw consent, or delete your account from <em>My profile → Ask RGXM to correct
          or delete my information</em>, or by contacting RGXM&apos;s privacy officer. When we delete an account we erase your
          name, contact details, availability, skills, files and notes, and keep only the work, payment and tax records we
          are legally required to retain.
        </p>
      </div>
    </div>
  );
}
