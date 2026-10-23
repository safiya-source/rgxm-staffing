"use client";
import { formatDistanceToNow } from "date-fns";
import { DownloadIcon, ListPlusIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/empty-state";
import { DemoBadge, StatusBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { addToListAction } from "./actions";

export type TalentTableRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  status: string;
  roles: string[];
  rates: { role: string; rateCents: number }[];
  completedShifts: number;
  lastShiftAt: string | null;
  hasAccount: boolean;
  isDemo: boolean;
};

export function TalentTable({
  rows,
  showRates,
  lists,
  canEdit,
  canExport,
}: {
  rows: TalentTableRow[];
  showRates: boolean;
  lists: { value: string; label: string }[];
  canEdit: boolean;
  canExport: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [listId, setListId] = useState("");
  const [pending, start] = useTransition();
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  if (rows.length === 0) {
    return <EmptyState icon={UsersIcon} title="No staff match these filters" description="Try removing a filter or widening the date." />;
  }

  return (
    <div className="grid gap-3">
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-xs" role="region" aria-label="Bulk actions">
          <span className="font-medium">{selected.length} selected</span>
          {canEdit && lists.length ? (
            <>
              <NativeSelect value={listId} onChange={(e) => setListId(e.target.value)} className="h-8 w-auto" aria-label="Choose list">
                <option value="">Add to list…</option>
                {lists.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </NativeSelect>
              <Button
                size="sm"
                variant="outline"
                disabled={!listId || pending}
                onClick={() =>
                  start(async () => {
                    const res = await addToListAction(listId, selected);
                    if (res.ok) toast.success(res.message ?? "Added");
                    else toast.error(res.error);
                    router.refresh();
                  })
                }
              >
                <ListPlusIcon /> Add
              </Button>
            </>
          ) : null}
          {canExport ? (
            <Button size="sm" variant="outline" asChild>
              <a href={`/dashboard/talent/export?ids=${selected.join(",")}`}>
                <DownloadIcon /> Export selected
              </a>
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear selection
          </Button>
        </div>
      ) : null}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all on this page"
                  checked={allSelected}
                  onCheckedChange={(c) => setSelected(c ? rows.map((r) => r.id) : [])}
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>City</TableHead>
              {showRates ? <TableHead>Rates</TableHead> : null}
              <TableHead className="text-right">Shifts</TableHead>
              <TableHead>Last worked</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} data-state={selected.includes(r.id) ? "selected" : undefined} className="data-[state=selected]:bg-muted/50">
                <TableCell>
                  <Checkbox
                    aria-label={`Select ${r.name}`}
                    checked={selected.includes(r.id)}
                    onCheckedChange={(c) => setSelected((s) => (c ? [...s, r.id] : s.filter((x) => x !== r.id)))}
                  />
                </TableCell>
                <TableCell>
                  <Link href={`/dashboard/talent/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  {r.isDemo ? <DemoBadge className="ml-1.5" /> : null}
                  <p className="text-xs text-muted-foreground">
                    {r.email}
                    {!r.hasAccount ? " · not signed up yet" : ""}
                  </p>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {r.roles.map((role) => (
                      <Badge key={role}>{role}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{r.city ?? "—"}</TableCell>
                {showRates ? (
                  <TableCell className="text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                    {r.rates.length
                      ? r.rates
                          .sort((a, b) => a.role.localeCompare(b.role))
                          .map((x) => `${x.role} ${formatMoney(x.rateCents)}`)
                          .join(" · ")
                      : "—"}
                  </TableCell>
                ) : null}
                <TableCell className="text-right tabular-nums">{r.completedShifts}</TableCell>
                <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                  {r.lastShiftAt ? formatDistanceToNow(new Date(r.lastShiftAt), { addSuffix: true }) : "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge kind="staff" status={r.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
