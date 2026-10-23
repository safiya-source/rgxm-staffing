// Optimistic gate: bounce requests without a session cookie before rendering.
// Real authentication/authorisation happens server-side in layouts, pages and actions.
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!getSessionCookie(request, { cookiePrefix: "rgxm" })) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/portal/:path*"] };
