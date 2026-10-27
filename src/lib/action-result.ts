export type ActionResult<T = unknown> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined>; data?: T };

export const initialActionState: ActionResult = { ok: true };
