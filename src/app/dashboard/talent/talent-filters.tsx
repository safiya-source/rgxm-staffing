"use client";
import { SearchIcon, XIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { MultiSelect, type Option } from "@/components/app/multi-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FIELD_ROLE_NAMES, FIELD_ROLES } from "@/lib/roles";

export type FilterLookups = {
  cities: string[];
  skills: Option[];
  languages: Option[];
  certifications: Option[];
  lists: Option[];
  projects: Option[];
  canFilterRates: boolean;
};

const MULTI_KEYS = ["city", "skills", "languages", "certs"] as const;
const FILTER_KEYS = ["q", "role", "status", "list", "project", "availableOn", "noConflicts", "minRate", "maxRate", "minExperience", "vehicle", ...MULTI_KEYS];

export function TalentFilters({ lookups }: { lookups: FilterLookups }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const get = (k: string) => params.get(k) ?? "";
  const getList = (k: string) => (params.get(k) ?? "").split(",").filter(Boolean);

  function update(changes: Record<string, string | string[] | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      const value = Array.isArray(v) ? v.join(",") : v;
      if (value) next.set(k, value);
      else next.delete(k);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  // Debounced text search.
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => update({ q: q.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = FILTER_KEYS.some((k) => params.has(k) && !(k === "status" && params.get(k) === "active"));
  const centsToDollars = (v: string) => (v ? String(Number(v) / 100) : "");
  const dollarsToCents = (v: string) => (v && !Number.isNaN(Number(v)) ? String(Math.round(Number(v) * 100)) : null);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, email or phone"
            aria-label="Search staff"
            className="h-9 pl-9"
          />
        </div>
        <NativeSelect aria-label="Role" value={get("role")} onChange={(e) => update({ role: e.target.value || null })} className="h-9 w-auto">
          <option value="">Any role</option>
          {FIELD_ROLES.map((r) => (
            <option key={r} value={r}>
              {FIELD_ROLE_NAMES[r]}
            </option>
          ))}
        </NativeSelect>
        <MultiSelect label="City" options={lookups.cities.map((c) => ({ value: c, label: c }))} value={getList("city")} onChange={(v) => update({ city: v })} />
        <MultiSelect label="Skills" options={lookups.skills} value={getList("skills")} onChange={(v) => update({ skills: v })} />
        <MultiSelect label="Languages" options={lookups.languages} value={getList("languages")} onChange={(v) => update({ languages: v })} />
        <MultiSelect label="Certifications" options={lookups.certifications} value={getList("certs")} onChange={(v) => update({ certs: v })} />
        <NativeSelect aria-label="Saved list" value={get("list")} onChange={(e) => update({ list: e.target.value || null })} className="h-9 w-auto max-w-52">
          <option value="">Any list</option>
          {lookups.lists.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Available on</span>
          <Input
            type="date"
            value={get("availableOn")}
            onChange={(e) => update({ availableOn: e.target.value || null, noConflicts: e.target.value ? get("noConflicts") || null : null })}
            className="h-9 w-40"
            aria-label="Available on date"
          />
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={get("noConflicts") === "1"}
            disabled={!get("availableOn")}
            onCheckedChange={(c) => update({ noConflicts: c ? "1" : null })}
          />
          <span className={get("availableOn") ? "" : "text-muted-foreground"}>No booking conflicts that day</span>
        </label>
        <NativeSelect aria-label="Status" value={get("status") || "active"} onChange={(e) => update({ status: e.target.value === "active" ? null : e.target.value })} className="h-9 w-auto">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
          <option value="archived">Archived</option>
          <option value="any">Any status</option>
        </NativeSelect>
        <NativeSelect aria-label="Worked on project" value={get("project")} onChange={(e) => update({ project: e.target.value || null })} className="h-9 w-auto max-w-56">
          <option value="">Any project history</option>
          {lookups.projects.map((p) => (
            <option key={p.value} value={p.value}>
              Worked on {p.label}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Min. years</span>
          <Input
            type="number"
            min={0}
            defaultValue={get("minExperience")}
            onBlur={(e) => update({ minExperience: e.target.value || null })}
            className="h-9 w-20"
            aria-label="Minimum years of experience"
          />
        </label>
        {lookups.canFilterRates ? (
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Rate $</span>
            <Input
              type="number"
              min={0}
              step="0.5"
              placeholder="min"
              defaultValue={centsToDollars(get("minRate"))}
              onBlur={(e) => update({ minRate: dollarsToCents(e.target.value) })}
              className="h-9 w-20"
              aria-label="Minimum hourly rate"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="number"
              min={0}
              step="0.5"
              placeholder="max"
              defaultValue={centsToDollars(get("maxRate"))}
              onBlur={(e) => update({ maxRate: dollarsToCents(e.target.value) })}
              className="h-9 w-20"
              aria-label="Maximum hourly rate"
            />
          </label>
        ) : null}
        <label className="flex items-center gap-2">
          <Checkbox checked={get("vehicle") === "1"} onCheckedChange={(c) => update({ vehicle: c ? "1" : null })} />
          Has vehicle
        </label>
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
          >
            <XIcon /> Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}
