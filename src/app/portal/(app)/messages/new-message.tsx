"use client";
import { PenSquareIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { sendMessageToRgxmAction } from "@/app/portal/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function NewMessage({ initialBody = "", initiallyOpen = false }: { initialBody?: string; initiallyOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [body, setBody] = useState(initialBody);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PenSquareIcon /> Message RGXM
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Message RGXM</DialogTitle>
          <DialogDescription>For a question about a specific shift, use the button on that shift instead.</DialogDescription>
        </DialogHeader>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} aria-label="Message" />
        <DialogFooter>
          <Button
            disabled={pending || !body.trim()}
            onClick={() =>
              start(async () => {
                const res = await sendMessageToRgxmAction({ body });
                if (!res.ok) return void toast.error(res.error);
                toast.success("Message sent");
                setBody("");
                setOpen(false);
                router.push(`/portal/messages/${res.data!.threadId}`);
              })
            }
          >
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
