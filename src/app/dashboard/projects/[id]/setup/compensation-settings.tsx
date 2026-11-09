import { ActionForm } from "@/components/app/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CompensationFields } from "@/components/app/compensation-fields";
import type { CompensationSettings } from "@/server/domain/compensation";
import { saveCompensationSettingsAction } from "../compensation/actions";

/** Per-project switches (all off by default) and rates for allowances, mileage and bonuses. */
export function CompensationSettingsCard({ projectId, settings: s, canEdit }: { projectId: string; settings: CompensationSettings; canEdit: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Allowances, mileage & bonuses</CardTitle>
        <CardDescription>
          Off unless switched on for this project, and shown to contractors on each shift before they accept. Changing a rate only affects items recorded afterwards. Tax
          and year-end treatment follow the accountant-approved rules for each category.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={saveCompensationSettingsAction} hidden={{ projectId }} submitLabel="Save" keep disabled={!canEdit} className="grid gap-4">
          <fieldset disabled={!canEdit} className="grid gap-4">
            <CompensationFields defaults={s} idPrefix="setup-comp" />
          </fieldset>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
