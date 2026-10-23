import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/50 px-6 py-14 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="mb-4 inline-flex size-10 items-center justify-center rounded-full bg-secondary">
          <Icon className="size-5 text-muted-foreground" />
        </span>
      ) : null}
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Honest placeholder for a section scheduled in a later milestone. */
export function PlannedSection({ milestone, title, items }: { milestone: string; title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-dashed bg-card/50 p-6">
      <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Planned · {milestone}
      </span>
      <p className="mt-3 font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">This section isn&apos;t built yet. It will include:</p>
      <ul className="mt-3 grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
        {items.map((i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}
