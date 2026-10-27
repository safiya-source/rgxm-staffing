"use client";
import { BriefcaseIcon, SearchIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { globalSearch, type SearchResult } from "@/app/dashboard/actions";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const requestId = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const r = await globalSearch(query);
        if (id === requestId.current) {
          setResults(r);
          setActive(0);
        }
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const visible = query.trim().length < 2 ? [] : results;

  function go(r: SearchResult) {
    setOpen(false);
    setQuery("");
    router.push(r.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-sm cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-sm text-muted-foreground shadow-xs hover:border-ring/40"
      >
        <SearchIcon className="size-4" />
        <span className="flex-1 text-left">Search staff and projects</span>
        <kbd className="hidden rounded border bg-muted px-1.5 text-[11px] font-medium sm:inline">⌘K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[15%] max-w-xl translate-y-0 gap-0 p-0">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="flex items-center gap-2 border-b px-4">
            <SearchIcon className="size-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, visible.length - 1));
                if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
                if (e.key === "Enter" && visible[active]) go(visible[active]);
              }}
              placeholder="Search by name, email, project or client…"
              className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              aria-label="Search"
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-2" role="listbox">
            {query.trim().length < 2 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Type at least two characters.</p>
            ) : visible.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{pending ? "Searching…" : "No matches."}</p>
            ) : (
              visible.map((r, i) => {
                const Icon = r.type === "staff" ? UserIcon : BriefcaseIcon;
                return (
                  <Link
                    key={`${r.type}-${r.id}`}
                    href={r.href}
                    onClick={() => setOpen(false)}
                    onMouseEnter={() => setActive(i)}
                    role="option"
                    aria-selected={i === active}
                    className={cn("flex items-center gap-3 rounded-md px-3 py-2", i === active && "bg-accent")}
                  >
                    <Icon className="size-4 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{r.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span>
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
