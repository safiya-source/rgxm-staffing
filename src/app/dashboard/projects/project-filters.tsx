"use client";
import { SearchIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export function ProjectFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function update(k: string, v: string | null) {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => update("q", q.trim() || null), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full sm:w-72">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, code or client" aria-label="Search projects" className="h-9 pl-9" />
      </div>
      <NativeSelect aria-label="Status" value={params.get("status") ?? "active"} onChange={(e) => update("status", e.target.value)} className="h-9 w-auto">
        <option value="active">Active</option>
        <option value="all">All statuses</option>
        {["draft", "staffing", "confirmed", "live", "completed", "reconciliation", "closed", "cancelled"].map((s) => (
          <option key={s} value={s} className="capitalize">
            {s[0]!.toUpperCase() + s.slice(1)}
          </option>
        ))}
      </NativeSelect>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={params.get("mine") === "1"} onCheckedChange={(c) => update("mine", c ? "1" : null)} /> My projects
      </label>
    </div>
  );
}
