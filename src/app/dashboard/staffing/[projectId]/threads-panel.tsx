"use client";
import { TimeAgo } from "@/components/app/time-ago";
import { ArrowLeftIcon, MessageSquareIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { markThreadReadAction, replyToThreadAction } from "../actions";

type Thread = { id: string; staffId: string; staffName: string; lastMessageAt: string | null; unread: boolean; preview: string | null };
type Message = { id: string; body: string; createdAt: string; authorName: string; authorKind: "internal" | "staff" };

export function ThreadsPanel({
  canReply,
  threads,
  openThreadId,
  messages,
}: {
  canReply: boolean;
  threads: Thread[];
  openThreadId: string | null;
  messages: Message[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const open = threads.find((t) => t.id === openThreadId);

  const hrefFor = (thread: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (thread) next.set("thread", thread);
    else next.delete("thread");
    return `${pathname}?${next.toString()}`;
  };

  useEffect(() => {
    if (open?.unread) void markThreadReadAction(open.id).then(() => router.refresh());
  }, [open?.id, open?.unread, router]);

  return (
    <aside aria-labelledby="messages-heading" className="grid content-start gap-2">
      <h2 id="messages-heading" className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquareIcon className="size-4" /> Messages from staff
      </h2>
      {open ? (
        <Card className="flex flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Link href={hrefFor(null)} aria-label="Back to all messages" className="rounded p-1 hover:bg-accent">
              <ArrowLeftIcon className="size-4" />
            </Link>
            <a href={`/dashboard/talent/${open.staffId}`} className="text-sm font-medium hover:underline">
              {open.staffName}
            </a>
          </div>
          <ol className="grid max-h-96 gap-2 overflow-y-auto p-3">
            {messages.map((m) => (
              <li key={m.id} className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", m.authorKind === "staff" ? "bg-muted" : "ml-auto bg-foreground text-background")}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className={cn("mt-1 text-[11px]", m.authorKind === "staff" ? "text-muted-foreground" : "text-background/70")}>
                  {m.authorName} · <TimeAgo date={m.createdAt} />
                </p>
              </li>
            ))}
          </ol>
          {canReply ? (
            <form
              className="grid gap-2 border-t p-3"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const res = await replyToThreadAction(open.id, body);
                  if (res.ok) {
                    setBody("");
                    router.refresh();
                  } else toast.error(res.error);
                });
              }}
            >
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={`Reply to ${open.staffName.split(" ")[0]}`} aria-label="Reply" />
              <Button size="sm" type="submit" disabled={pending || !body.trim()} className="justify-self-end">
                Send reply
              </Button>
            </form>
          ) : null}
        </Card>
      ) : threads.length === 0 ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Questions staff ask about offers appear here.</p>
      ) : (
        <Card className="divide-y">
          {threads.map((t) => (
            <Link key={t.id} href={hrefFor(t.id)} className="block px-3 py-2.5 hover:bg-accent">
              <p className="flex items-center justify-between gap-2 text-sm">
                <span className={cn(t.unread && "font-semibold")}>{t.staffName}</span>
                {t.unread ? <span className="size-2 rounded-full bg-brand" aria-label="Unread" /> : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">{t.preview}</p>
              {t.lastMessageAt ? <p className="text-[11px] text-muted-foreground"><TimeAgo date={t.lastMessageAt} /></p> : null}
            </Link>
          ))}
        </Card>
      )}
    </aside>
  );
}
