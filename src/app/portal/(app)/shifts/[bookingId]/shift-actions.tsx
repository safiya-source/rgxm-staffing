"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { sendMessageToRgxmAction, withdrawFromBookingAction } from "@/app/portal/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function ShiftActions({ bookingId, projectId, canWithdraw }: { bookingId: string; projectId: string; canWithdraw: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"message" | "withdraw" | null>(null);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2 border-t pt-5">
      <Button variant="outline" onClick={() => setMode("message")}>
        Message RGXM about this shift
      </Button>
      {canWithdraw ? (
        <button className="cursor-pointer py-2 text-sm text-destructive" onClick={() => setMode("withdraw")}>
          I can&apos;t make this shift
        </button>
      ) : null}
      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "withdraw" ? "Can't make this shift?" : "Message RGXM"}</DialogTitle>
            <DialogDescription>
              {mode === "withdraw"
                ? "This cancels your booking and tells RGXM right away so they can find a replacement. Please only do this if you really can't attend."
                : "Your message goes to the project team. Replies appear in Messages."}
            </DialogDescription>
          </DialogHeader>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label={mode === "withdraw" ? "Reason" : "Message"} />
          <DialogFooter>
            <Button
              variant={mode === "withdraw" ? "destructive" : "default"}
              disabled={pending || !text.trim()}
              onClick={() =>
                start(async () => {
                  const res = mode === "withdraw" ? await withdrawFromBookingAction(bookingId, text) : await sendMessageToRgxmAction({ projectId, body: text });
                  if (res.ok) {
                    toast.success(res.message ?? "Sent");
                    setText("");
                    setMode(null);
                    router.refresh();
                  } else toast.error(res.error);
                })
              }
            >
              {mode === "withdraw" ? "Cancel my booking" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
