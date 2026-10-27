// Structured error logging. One JSON line per error so a log drain (Vercel, Datadog, Better Stack…)
// can alert on it. Never pass request headers, cookies, form data or personal details in `context`.
export function logError(err: unknown, context: Record<string, string | number | boolean | null | undefined> = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  console.error(
    JSON.stringify({
      level: "error",
      time: new Date().toISOString(),
      name: e.name,
      message: e.message,
      digest,
      stack: e.stack?.split("\n").slice(0, 8).join("\n"),
      ...context,
    }),
  );
}
