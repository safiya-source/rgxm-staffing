"use client";
import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Lets people print or save a PDF copy of a document (the agreements say each party may keep a copy). */
export function PrintButton({ label = "Print or save a copy" }: { label?: string }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
      <PrinterIcon /> {label}
    </Button>
  );
}
