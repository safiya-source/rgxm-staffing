"use client";
import { useTransition } from "react";
import { markStaffNotificationsReadAction } from "@/app/portal/actions";
import { Button } from "@/components/ui/button";

export function MarkAllRead() {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(() => markStaffNotificationsReadAction())}>
      Mark all read
    </Button>
  );
}
