"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Who the Independent Contractor Agreement is with: the person themselves, or a business they're
 * authorized to bind (then also who is accepting for it). Recorded with the acceptance.
 */
export function ContractingPartyFields({ defaults }: { defaults: { legalName: string; businessName: string } }) {
  const [actingFor, setActingFor] = useState<"self" | "business">("self");
  return (
    <fieldset className="grid gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Who is entering the agreement?</legend>
      <div className="grid gap-2 text-sm" role="radiogroup">
        <label className="flex items-center gap-2">
          <input type="radio" name="actingFor" value="self" checked={actingFor === "self"} onChange={() => setActingFor("self")} className="size-4 accent-brand" />
          Me, as an individual
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="actingFor" value="business" checked={actingFor === "business"} onChange={() => setActingFor("business")} className="size-4 accent-brand" />
          A business I&apos;m authorized to sign for
        </label>
      </div>
      {actingFor === "self" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="party-legal-name">Your full legal name</Label>
          <Input id="party-legal-name" name="partyLegalName" defaultValue={defaults.legalName} autoComplete="name" required />
        </div>
      ) : (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="party-business">Business legal name</Label>
            <Input id="party-business" name="partyBusinessName" defaultValue={defaults.businessName} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="party-rep">Your full name (authorized representative)</Label>
            <Input id="party-rep" name="partyRepresentative" defaultValue={defaults.legalName} autoComplete="name" required />
          </div>
          <p className="text-[13px] text-muted-foreground">By accepting, you confirm you&apos;re authorized to bind this business.</p>
        </>
      )}
    </fieldset>
  );
}
