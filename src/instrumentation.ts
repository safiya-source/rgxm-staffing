import type { Instrumentation } from "next";

// Server errors from pages, route handlers and actions, logged as structured JSON (no request
// headers or bodies, which can carry cookies and personal details).
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { logError } = await import("@/server/observability");
  logError(err, { path: request.path.split("?")[0], method: request.method, routerKind: context.routerKind, routeType: context.routeType, routePath: context.routePath });
};
