"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { setJobBoardAction } from "../../actions";

/** Whether this project's open shifts appear on the contractor job board. */
export function JobBoardToggle({ projectId, show, canEdit }: { projectId: string; show: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-start gap-3 text-sm">
      <Checkbox
        checked={show}
        disabled={!canEdit || pending}
        onCheckedChange={(c) =>
          start(async () => {
            const res = await setJobBoardAction(projectId, Boolean(c));
            if (res.ok) toast.success(res.message ?? "Saved");
            else toast.error(res.error);
            router.refresh();
          })
        }
        aria-label="Show open shifts on the job board"
        className="mt-0.5"
      />
      <span>
        <span className="font-medium">Show open shifts on the job board</span>
        <span className="block text-muted-foreground">
          Qualified contractors see published shifts that still have spots and can say they&apos;re interested without an offer. You still confirm who&apos;s booked. Turn off for
          test or confidential projects.
        </span>
      </span>
    </label>
  );
}
