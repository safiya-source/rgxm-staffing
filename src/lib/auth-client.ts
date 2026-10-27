"use client";
import { magicLinkClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    magicLinkClient(),
    // The sign-in form routes to /sign-in/two-factor itself when the response asks for a second factor.
    twoFactorClient(),
  ],
});
