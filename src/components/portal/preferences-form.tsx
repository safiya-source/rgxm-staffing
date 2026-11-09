import { ActionForm } from "@/components/app/action-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { savePreferencesAction } from "@/app/portal/actions";

/** Email preferences and optional consents (portal profile). */
export function PreferencesForm({
  shiftOpportunityEmails,
  consents,
}: {
  shiftOpportunityEmails: boolean;
  consents: { key: string; label: string; description: string; granted: boolean }[];
}) {
  return (
    <section aria-labelledby="prefs" className="grid gap-3">
      <h2 id="prefs" className="font-medium">
        Emails and choices
      </h2>
      <ActionForm action={savePreferencesAction} submitLabel="Save preferences" keep variant="outline" className="grid gap-3">
        <div className="flex items-start gap-3">
          <Checkbox id="shiftOpportunityEmails" name="shiftOpportunityEmails" defaultChecked={shiftOpportunityEmails} className="mt-0.5" />
          <Label htmlFor="shiftOpportunityEmails" className="leading-snug font-normal">
            Email me about new shift opportunities
            <span className="block text-[13px] text-muted-foreground">You&apos;ll still see offers here in the app if you turn this off.</span>
          </Label>
        </div>
        {consents.map((c) => (
          <div key={c.key} className="flex items-start gap-3">
            <Checkbox id={`consent_${c.key}`} name={`consent_${c.key}`} defaultChecked={c.granted} className="mt-0.5" />
            <Label htmlFor={`consent_${c.key}`} className="leading-snug font-normal">
              {c.label} <span className="text-muted-foreground">(optional)</span>
              <span className="block text-[13px] text-muted-foreground">{c.description}</span>
            </Label>
          </div>
        ))}
        <p className="text-[13px] text-muted-foreground">
          Emails about shifts you&apos;ve accepted, your hours, your pay and your account are always sent, because you need them for the work.
        </p>
      </ActionForm>
    </section>
  );
}
