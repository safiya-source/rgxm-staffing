import { ArrowLeftIcon, DownloadIcon, FileTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listStaffDocuments } from "@/server/domain/comms";
import { requireStaff } from "@/server/session";
import { AcknowledgeButton } from "./acknowledge-button";

export const metadata: Metadata = { title: "Document" };

export default async function DocumentPage({ params }: PageProps<"/portal/documents/[documentId]">) {
  const viewer = await requireStaff();
  const { documentId } = await params;
  const doc = (await listStaffDocuments(viewer.staff!.id)).find((d) => d.id === documentId);
  if (!doc) notFound();
  const isImage = doc.contentType?.startsWith("image/");
  const isPdf = doc.contentType === "application/pdf";
  const href = `/api/documents/${doc.id}/file`;
  return (
    <div className="grid gap-5">
      <Link href="/portal/schedule" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> My schedule
      </Link>
      <div>
        <p className="text-sm text-muted-foreground">{doc.projectName}</p>
        <h1 className="text-[22px] font-semibold">{doc.title}</h1>
        {doc.version > 1 ? <p className="text-sm text-muted-foreground">Updated version {doc.version}</p> : null}
      </div>
      <Card className="overflow-hidden">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${href}?inline=1`} alt={doc.title} className="w-full" />
        ) : isPdf ? (
          <object data={`${href}?inline=1`} type="application/pdf" className="h-[60dvh] w-full" aria-label={doc.title}>
            <p className="p-4 text-sm">This device can&apos;t show PDFs inline. Use the download button below.</p>
          </object>
        ) : (
          <div className="flex items-center gap-3 p-4">
            <FileTextIcon className="size-6 text-muted-foreground" />
            <span className="text-[15px]">{doc.fileName}</span>
          </div>
        )}
      </Card>
      <Button asChild variant="outline">
        <a href={href}>
          <DownloadIcon /> Download
        </a>
      </Button>
      {doc.requiresAck ? <AcknowledgeButton documentId={doc.id} acknowledgedAt={doc.acknowledgedAt?.toISOString() ?? null} /> : null}
    </div>
  );
}
