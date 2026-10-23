"use client";
import { formatDistanceToNow } from "date-fns";
import { FileTextIcon, MegaphoneIcon, MoreHorizontalIcon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/lib/use-form-action";
import { archiveDocumentAction, postAnnouncementAction } from "../../actions";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.docx,.pptx,.xlsx,.txt";

async function upload(url: string, form: FormData) {
  const res = await fetch(url, { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Upload failed.");
}

export function UploadForm({ projectId, categories }: { projectId: string; categories: { value: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      className="grid gap-4 rounded-lg border bg-muted/30 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(undefined);
        start(async () => {
          try {
            await upload(`/api/projects/${projectId}/documents`, fd);
            toast.success("Document uploaded. Confirmed staff have been notified.");
            formRef.current?.reset();
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed.");
          }
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field label="Title" htmlFor="doc-title">
          <Input id="doc-title" name="title" required placeholder="Event brief" />
        </Field>
        <Field label="Type" htmlFor="doc-category">
          <NativeSelect id="doc-category" name="category" defaultValue="event_brief">
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label="File" htmlFor="doc-file" hint="PDF, image, Word, PowerPoint, Excel or text. Up to 20 MB.">
        <Input id="doc-file" name="file" type="file" accept={ACCEPT} required className="h-auto py-1.5" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="requiresAck" defaultChecked /> Staff must confirm they&apos;ve read it
      </label>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button type="submit" disabled={pending} className="w-fit">
        <UploadIcon /> {pending ? "Uploading…" : "Upload"}
      </Button>
    </form>
  );
}

type Doc = {
  id: string;
  title: string;
  category: string;
  fileName: string;
  version: number;
  requiresAck: boolean;
  audience: number;
  acknowledged: number;
  pending: string[];
  uploader: string | null;
  createdAt: string;
};

export function DocumentList({ docs, canManage }: { docs: Doc[]; canManage: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  if (!docs.length) return <p className="text-sm text-muted-foreground">No documents yet.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          const id = replacing;
          e.target.value = "";
          if (!file || !id) return;
          const fd = new FormData();
          fd.set("file", file);
          start(async () => {
            try {
              await upload(`/api/documents/${id}/versions`, fd);
              toast.success("New version uploaded. Staff will be asked to review it again.");
              router.refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Upload failed.");
            }
          });
        }}
      />
      {docs.map((d) => (
        <li key={d.id} className="flex items-start gap-3 p-3">
          <FileTextIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <a href={`/api/documents/${d.id}/file`} className="font-medium hover:underline">
              {d.title}
            </a>
            <p className="text-xs text-muted-foreground">
              {d.category} · {d.fileName}
              {d.version > 1 ? ` · v${d.version}` : ""} · {d.uploader ?? "Unknown"} · {formatDistanceToNow(new Date(d.createdAt), { addSuffix: true })}
            </p>
            {d.requiresAck ? (
              <div className="mt-2">
                <Badge tone={d.audience > 0 && d.acknowledged === d.audience ? "success" : "warning"}>
                  {d.acknowledged}/{d.audience} confirmed reading
                </Badge>
                {d.pending.length ? (
                  <details className="mt-1 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Waiting on {d.pending.length}</summary>
                    <p className="mt-1">{d.pending.join(", ")}</p>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${d.title}`}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setReplacing(d.id);
                    fileRef.current?.click();
                  }}
                >
                  Upload new version
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() =>
                    start(async () => {
                      const res = await archiveDocumentAction(d.id);
                      if (res.ok) toast.success(res.message ?? "Removed");
                      else toast.error(res.error);
                      router.refresh();
                    })
                  }
                >
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function AnnouncementForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, onSubmit, pending] = useFormAction(async (prev, fd) => {
    const res = await postAnnouncementAction(projectId, prev, fd);
    if (res.ok) {
      toast.success(res.message ?? "Posted");
      formRef.current?.reset();
      router.refresh();
    }
    return res;
  });
  const e = state.ok ? undefined : state.fieldErrors;
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3 rounded-lg border bg-muted/30 p-4">
      <Field label="Title" htmlFor="ann-title" error={e?.title}>
        <Input id="ann-title" name="title" required />
      </Field>
      <Field label="Message" htmlFor="ann-body" error={e?.body}>
        <Textarea id="ann-body" name="body" rows={3} required />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="important" /> Important (also send by email)
      </label>
      {!state.ok ? <FormMessage>{state.error}</FormMessage> : null}
      <Button type="submit" disabled={pending} className="w-fit">
        <MegaphoneIcon /> Post announcement
      </Button>
    </form>
  );
}

export function AnnouncementList({ items }: { items: { id: string; title: string; body: string; important: boolean; author: string | null; createdAt: string }[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No announcements yet.</p>;
  return (
    <ul className="grid gap-3">
      {items.map((a) => (
        <li key={a.id} className="rounded-lg border p-3">
          <p className="flex items-center gap-2 font-medium">
            {a.title} {a.important ? <Badge tone="danger">Important</Badge> : null}
          </p>
          <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">{a.body}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {a.author ?? "Unknown"} · {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
          </p>
        </li>
      ))}
    </ul>
  );
}
