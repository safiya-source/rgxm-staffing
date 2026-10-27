/** Rebuilds a query string from Next.js searchParams, overriding some keys. */
export function withParams(
  base: Record<string, string | string[] | undefined>,
  overrides: Record<string, string | number | undefined | null>,
) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) sp.append(k, item);
  }
  for (const [k, v] of Object.entries(overrides)) {
    sp.delete(k);
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
