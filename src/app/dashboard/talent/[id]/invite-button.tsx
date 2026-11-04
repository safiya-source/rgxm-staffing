"use client";
import { MailIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { inviteStaffAction } from "../actions";

/** "Send portal invite" / "Resend invite" on a talent profile. */
export function InviteButton({ staffId, invitedRecently }: { staffId: string; invitedRecently: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await inviteStaffAction([staffId], invitedRecently);
          if (res.ok) toast.success(res.message ?? "Invitation queued");
          else toast.error(res.error);
          router.refresh();
        })
      }
    >
      <MailIcon /> {invitedRecently ? "Resend invite" : "Send portal invite"}
    </Button>
  );
}
