import { describe, expect, it } from "vitest";
import { supabaseAuthHeaders } from "@/server/storage";

describe("Supabase storage auth headers", () => {
  it("sends new secret keys as apikey only (a Bearer secret key is rejected as an invalid JWT)", () => {
    expect(supabaseAuthHeaders("sb_secret_abc123XYZ")).toEqual({ apikey: "sb_secret_abc123XYZ" });
  });
  it("sends legacy service_role JWTs as both apikey and Bearer token", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig_nature-1";
    expect(supabaseAuthHeaders(jwt)).toEqual({ apikey: jwt, Authorization: `Bearer ${jwt}` });
  });
});
