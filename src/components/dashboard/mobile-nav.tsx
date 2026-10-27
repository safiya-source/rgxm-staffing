"use client";
import { MenuIcon } from "lucide-react";
import { useState } from "react";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav } from "./sidebar-nav";

export function MobileNav({ allowed }: { allowed: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <MenuIcon />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="bg-sidebar p-4">
        <SheetTitle className="mb-6 px-2.5 pt-1">
          <Logo />
        </SheetTitle>
        <SidebarNav allowed={allowed} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
