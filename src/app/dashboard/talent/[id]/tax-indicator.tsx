// The contractor's GST/HST status at a glance, at the top of their profile: whether they charge
// HST and whether Finance has confirmed it. Only shown to people who can see pay setup.
import { AlertTriangleIcon, BadgeCheckIcon, CircleHelpIcon, ReceiptIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Gst = { status: "yes" | "no" | "unsure" | "unknown"; verification: "unverified" | "verified" | "rejected"; number: string | null };

export function taxState(g: Gst) {
  if (g.status === "yes" && g.verification === "verified") return { tone: "ok", short: "HST registered", text: `Registered for GST/HST${g.number ? ` · ${g.number}` : ""} · confirmed by Finance` } as const;
  if (g.status === "yes" && g.verification === "rejected") return { tone: "bad", short: "HST: couldn't confirm", text: `Says they're registered${g.number ? ` (${g.number})` : ""}, but Finance couldn't confirm it` } as const;
  if (g.status === "yes") return { tone: "todo", short: "HST: confirm", text: `Added a GST/HST number${g.number ? ` (${g.number})` : ""}. Not confirmed by Finance yet` } as const;
  // A "not registered" answer is accepted as declared: nothing to confirm.
  if (g.status === "no") return { tone: "plain", short: "No HST", text: "Not registered for GST/HST · paid without tax" } as const;
  if (g.status === "unsure") return { tone: "todo", short: "HST: unsure", text: "Unsure whether they're registered for GST/HST. Follow up with them" } as const;
  return { tone: "missing", short: "HST: no answer", text: "Hasn't answered the GST/HST question yet" } as const;
}

const TONE = {
  ok: "border-success/30 bg-success-soft text-success",
  todo: "border-warning/40 bg-warning-soft text-warning",
  bad: "border-destructive/30 bg-danger-soft text-destructive",
  plain: "border-border bg-secondary text-secondary-foreground",
  missing: "border-border bg-secondary text-muted-foreground",
} as const;

const ICON = { ok: BadgeCheckIcon, todo: AlertTriangleIcon, bad: AlertTriangleIcon, plain: ReceiptIcon, missing: CircleHelpIcon } as const;

/** Full-width strip under the profile header. */
export function TaxIndicator({ gst, canVerify }: { gst: Gst; canVerify: boolean }) {
  const s = taxState(gst);
  const Icon = ICON[s.tone];
  const action = canVerify && (s.tone === "todo" || s.tone === "bad") && gst.status !== "unsure";
  return (
    <div role="status" aria-label="GST/HST status" className={cn("mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3", TONE[s.tone])}>
      <p className="flex items-center gap-2.5 text-sm">
        <Icon className="size-5 shrink-0" />
        <span>
          <span className="font-semibold">{s.short}</span>
          <span className="ml-2 opacity-90">{s.text}</span>
        </span>
      </p>
      {action ? (
        <a href="#gst" className="text-sm font-semibold underline underline-offset-4">
          {gst.status === "yes" ? "Confirm the number" : "Confirm it"}
        </a>
      ) : null}
    </div>
  );
}

/** Small chip for lists. */
export function TaxChip({ gst }: { gst: Gst }) {
  const s = taxState(gst);
  return (
    <span title={s.text} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", TONE[s.tone])}>
      {s.short}
    </span>
  );
}
