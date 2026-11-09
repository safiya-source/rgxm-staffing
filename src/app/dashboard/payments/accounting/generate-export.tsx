"use client";
import { useState } from "react";
import { useRunAction } from "@/components/app/action-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { createAccountingExportAction } from "../actions";

type Bill = { id: string; billNumber: string; supplier: string; billDate: string; dueDate: string; totalCents: number; taxCents: number; kind: string; status: string };

export function GenerateAccountingExport({ bills }: { bills: Bill[] }) {
  const { pending, run, stepUpDialog } = useRunAction();
  const [selected, setSelected] = useState(() => new Set(bills.map((b) => b.id)));
  const all = bills.length > 0 && bills.every((b) => selected.has(b.id));
  return (
    <>
      {stepUpDialog}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">
              <Checkbox aria-label="Select all bills" checked={all} onCheckedChange={() => setSelected(all ? new Set() : new Set(bills.map((b) => b.id)))} />
            </TableHead>
            <TableHead>Bill</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Bill date / due</TableHead>
            <TableHead className="text-right">Tax</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bills.map((b) => (
            <TableRow key={b.id}>
              <TableCell>
                <Checkbox
                  aria-label={`Select ${b.billNumber}`}
                  checked={selected.has(b.id)}
                  onCheckedChange={() =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (n.has(b.id)) n.delete(b.id);
                      else n.add(b.id);
                      return n;
                    })
                  }
                />
              </TableCell>
              <TableCell className="font-medium">
                {b.billNumber}
                {b.kind === "credit" ? " (credit)" : ""}
              </TableCell>
              <TableCell>{b.supplier}</TableCell>
              <TableCell className="text-sm">
                {b.billDate} / {b.dueDate}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(b.taxCents)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(b.totalCents)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex justify-end border-t p-4">
        <Button
          disabled={pending || selected.size === 0}
          onClick={() =>
            run(
              () => createAccountingExportAction([...selected]),
              (r) => {
                if (r.ok && r.data) {
                  const a = document.createElement("a");
                  a.href = `/api/payments/accounting/${r.data.exportId}`;
                  a.download = "";
                  a.click();
                }
              },
            )
          }
        >
          Generate accounting file · {selected.size} bill{selected.size === 1 ? "" : "s"}
        </Button>
      </div>
    </>
  );
}
