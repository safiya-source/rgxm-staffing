import { cn } from "@/lib/utils";

export function Logo({ className, suffix }: { className?: string; suffix?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 font-semibold", className)}>
      <span className="tracking-[0.14em]">RGXM</span>
      <span aria-hidden className="inline-block size-1.5 rounded-full bg-brand" />
      {suffix ? <span className="text-sm font-medium text-muted-foreground">{suffix}</span> : null}
    </span>
  );
}
