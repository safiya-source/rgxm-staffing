import { desc } from "drizzle-orm";
import { MailIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatInZone } from "@/lib/format";
import { db } from "@/server/db";
import { notificationDeliveries } from "@/server/db/schema";
import { env } from "@/server/env";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "Mail log" };

const TONE = { sent: "success", logged: "info", suppressed: "warning", failed: "danger", queued: "neutral" } as const;
const LABEL = { sent: "Sent", logged: "Logged only", suppressed: "Suppressed (demo)", failed: "Failed", queued: "Queued" } as const;

export default async function MailLogPage() {
  await requireInternal("mail_log.view");
  const rows = await db.select().from(notificationDeliveries).orderBy(desc(notificationDeliveries.createdAt)).limit(100);

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Every outgoing message is recorded here.{" "}
        {env.MAIL_TRANSPORT === "log"
          ? "Email sending is OFF in this environment (MAIL_TRANSPORT=log). Messages are stored but not delivered."
          : "Email is delivered via Resend."}{" "}
        Messages to demo recipients are always suppressed.
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={MailIcon} title="No messages yet" />
      ) : (
        <div className="grid gap-3">
          {rows.map((m) => (
            <Card key={m.id} className="p-4">
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge tone={TONE[m.status]}>{LABEL[m.status]}</Badge>
                  <span className="font-medium">{m.subject}</span>
                  <span className="text-sm text-muted-foreground">to {m.toAddress}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatInZone(m.createdAt, "America/Toronto", "MMM d, h:mm a")}</span>
                </summary>
                <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{m.bodyText}</pre>
                {m.error ? <p className="mt-2 text-sm text-destructive">{m.error}</p> : null}
              </details>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
