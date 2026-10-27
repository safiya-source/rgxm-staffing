"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { sendMessageToRgxmAction } from "@/app/portal/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ReplyBox({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] grid gap-2 rounded-xl border bg-background p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await sendMessageToRgxmAction({ threadId, body });
          if (!res.ok) return void toast.error(res.error);
          setBody("");
          router.refresh();
        });
      }}
    >
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Write a reply" aria-label="Reply" />
      <Button type="submit" disabled={pending || !body.trim()}>
        Send
      </Button>
    </form>
  );
}
