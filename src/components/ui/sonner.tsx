"use client";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      toastOptions={{ classNames: { toast: "!rounded-lg !border !bg-popover !text-popover-foreground !shadow-md" } }}
    />
  );
}
