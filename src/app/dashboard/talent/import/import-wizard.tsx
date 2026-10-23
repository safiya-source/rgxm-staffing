"use client";
import { CheckCircle2Icon, FileUpIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { FormMessage } from "@/components/app/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { commitImportAction, previewImportAction, type ImportPreview } from "../actions";

const TEMPLATE_ROW = ["Jordan", "Lee", "", "jordan.lee@example.com", "416-555-0100", "Toronto", "ON", "BA|TL", "English|French", "Sampling|Product demos", "3", "25.00", "30.00", "", ""];

export function ImportWizard({ columns, canEditRates }: { columns: string[]; canEditRates: boolean }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, start] = useTransition();

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(`${columns.join(",")}\n${TEMPLATE_ROW.join(",")}\n`)}`;

  async function onFile(file: File | undefined) {
    setError(undefined);
    setPreview(null);
    setDone(undefined);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setError("That file is larger than 2 MB.");
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    start(async () => {
      const res = await previewImportAction(text);
      if (res.ok && res.data) setPreview(res.data);
      else if (!res.ok) setError(res.error);
    });
  }

  if (done) {
    return (
      <Card className="max-w-xl">
        <CardContent className="flex items-start gap-3">
          <CheckCircle2Icon className="mt-0.5 size-5 text-success" />
          <div>
            <p className="font-medium">{done}</p>
            <Button asChild className="mt-4" size="sm">
              <Link href="/dashboard/talent">Go to Talent</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>1. Choose a file</CardTitle>
          <CardDescription>
            Columns: <code className="text-xs">{columns.join(", ")}</code>. Only first_name, last_name and email are required. Separate multiple roles,
            languages or skills with <code>|</code>. Existing people (matched by email) are updated. Blank cells never erase data.
            {canEditRates ? " Rates are hourly, in dollars." : " Rate columns will be ignored (you don't have permission to set rates)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-card px-4 py-2 text-sm font-medium shadow-xs hover:bg-accent">
            <FileUpIcon className="size-4" />
            {fileName || "Select CSV file"}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <a href={templateHref} download="rgxm-staff-template.csv" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Download template
          </a>
          {pending && !preview ? <span className="text-sm text-muted-foreground">Checking…</span> : null}
        </CardContent>
      </Card>

      {error ? <FormMessage>{error}</FormMessage> : null}

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Review</CardTitle>
            <CardDescription>
              {preview.counts.create} new · {preview.counts.update} updates · {preview.counts.error} with errors (skipped)
              {preview.ignoredRateColumns ? " · rate columns ignored" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 pt-2">
            <div className="max-h-96 overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-16">Line</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Problems</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.results.map((r) => (
                    <TableRow key={r.line}>
                      <TableCell className="tabular-nums text-muted-foreground">{r.line}</TableCell>
                      <TableCell>{r.email || "—"}</TableCell>
                      <TableCell>
                        <Badge tone={r.action === "error" ? "danger" : r.action === "create" ? "success" : "info"}>
                          {r.action === "error" ? "Skip" : r.action === "create" ? "New" : "Update"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-destructive">{r.errors.join("; ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center gap-3">
              <Button
                disabled={pending || preview.counts.create + preview.counts.update === 0}
                onClick={() =>
                  start(async () => {
                    const res = await commitImportAction(csv!);
                    if (res.ok) setDone(res.message ?? "Import complete.");
                    else setError(res.error);
                  })
                }
              >
                {pending ? "Importing…" : `Import ${preview.counts.create + preview.counts.update} rows`}
              </Button>
              <span className="text-sm text-muted-foreground">Nothing has been saved yet.</span>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
