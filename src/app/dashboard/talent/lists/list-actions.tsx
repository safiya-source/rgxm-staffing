"use client";
import { PlusIcon, TrashIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFormAction } from "@/lib/use-form-action";
import { createListAction, deleteListAction } from "../actions";

export function CreateListButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, onSubmit, pending] = useFormAction(async (prev, fd) => {
    const res = await createListAction(prev, fd);
    if (res.ok) {
      toast.success(res.message ?? "List created");
      setOpen(false);
      router.refresh();
    }
    return res;
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon /> New list
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New list</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Name" htmlFor="list-name">
            <Input id="list-name" name="name" required maxLength={80} />
          </Field>
          <Field label="Description (optional)" htmlFor="list-description">
            <Input id="list-description" name="description" />
          </Field>
          {!state.ok ? <FormMessage>{state.error}</FormMessage> : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Create list
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteListButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      variant="ghost"
      size="icon"
      aria-label={`Delete ${name}`}
      title={`Delete "${name}"?`}
      description="The list is removed. The people on it aren't changed."
      confirmLabel="Delete list"
      destructive
      onConfirm={async () => {
        const res = await deleteListAction(id);
        if (res.ok) toast.success(res.message ?? "Deleted");
        else toast.error(res.error);
        router.refresh();
      }}
    >
      <TrashIcon />
    </ConfirmButton>
  );
}
