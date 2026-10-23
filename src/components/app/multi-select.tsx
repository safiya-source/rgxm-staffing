"use client";
import { ChevronDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type Option = { value: string; label: string };

/** Compact multi-select for filter bars: a button showing a count, with a searchable checklist. */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );
  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex h-9 max-w-56 cursor-pointer items-center gap-1.5 rounded-md border bg-card px-3 text-sm shadow-xs hover:bg-accent",
          value.length > 0 && "border-foreground/30",
          className,
        )}
      >
        <span className="truncate">
          {value.length === 0 ? label : value.length === 1 ? selectedLabels[0] : `${label} · ${value.length}`}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="p-0">
        {options.length > 8 ? (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            aria-label={`Search ${label}`}
            className="h-9 w-full border-b bg-transparent px-3 text-sm outline-none"
          />
        ) : null}
        <ul className="max-h-64 overflow-y-auto p-1" aria-label={label}>
          {filtered.length === 0 ? <li className="px-2 py-3 text-center text-sm text-muted-foreground">No matches</li> : null}
          {filtered.map((o) => {
            const checked = value.includes(o.value);
            return (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => onChange(c ? [...value, o.value] : value.filter((v) => v !== o.value))}
                  />
                  {o.label}
                </label>
              </li>
            );
          })}
        </ul>
        {value.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="w-full cursor-pointer border-t px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
