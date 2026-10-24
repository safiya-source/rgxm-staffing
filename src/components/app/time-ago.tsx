"use client";
import { formatDistanceToNow } from "date-fns";

/** "3 minutes ago". The server and browser render at slightly different moments, so the text may differ on hydration. */
export function TimeAgo({ date }: { date: Date | string }) {
  const d = new Date(date);
  return (
    <time dateTime={d.toISOString()} suppressHydrationWarning>
      {formatDistanceToNow(d, { addSuffix: true })}
    </time>
  );
}
