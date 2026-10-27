"use client";
import { startTransition, useActionState } from "react";
import { initialActionState, type ActionResult } from "@/lib/action-result";

/**
 * Like useActionState, but submits via onSubmit so React does not reset the form's fields
 * afterwards. People keep what they typed when the server returns a validation error.
 */
export function useFormAction(action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>) {
  const [state, dispatch, pending] = useActionState(action, initialActionState);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => dispatch(formData));
  };
  return [state, onSubmit, pending] as const;
}
