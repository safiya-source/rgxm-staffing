"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { recordAudit } from "@/server/audit";
import { runAction, UserFacingError } from "@/server/actions";
import { db } from "@/server/db";
import { orgSettings } from "@/server/db/schema";
import { BillingError, getAccountingConfig, saveAccountingConfig } from "@/server/domain/billing";
import * as tax from "@/server/domain/tax-config";
import { authorizeInternal } from "@/server/session";

const PATH = "/dashboard/settings/tax";
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof tax.TaxConfigError || err instanceof BillingError) throw new UserFacingError(err.message);
    throw err;
  }
}

function done(message: string): ActionResult {
  revalidatePath(PATH);
  return { ok: true, message };
}

export async function setAutoTaxAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("tax.configure");
    const enabled = str(fd, "enabled") === "true";
    await guard(() => tax.setAutoTax(viewer.userId, enabled, str(fd, "reference") || null));
    return done(enabled ? "Automatic tax calculation is on for new bill lines." : "Automatic tax calculation is off. New lines go to Finance review.");
  });
}

export async function saveServiceCategoryAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("tax.configure");
    await guard(() =>
      tax.saveServiceCategory(viewer.userId, {
        key: str(fd, "key"),
        label: str(fd, "label"),
        description: str(fd, "description") || null,
        placeOfSupplyRule: str(fd, "placeOfSupplyRule") as "event_province" | "finance_review",
      }),
    );
    return done("Service category saved. It needs approval before it's used.");
  });
}

export async function approveServiceCategoryAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("tax.configure");
    await guard(() => tax.approveServiceCategory(viewer.userId, str(fd, "key"), str(fd, "reference")));
    return done("Service category approved.");
  });
}

export async function createTaxRuleAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("tax.configure");
    await guard(() =>
      tax.createTaxRule(viewer.userId, {
        jurisdiction: str(fd, "jurisdiction"),
        component: str(fd, "component") as "GST",
        ratePercent: str(fd, "ratePercent"),
        serviceCategory: str(fd, "serviceCategory"),
        effectiveFrom: str(fd, "effectiveFrom"),
        effectiveTo: str(fd, "effectiveTo"),
        notes: str(fd, "notes") || null,
      }),
    );
    return done("Draft rule added. Approve it once the accountant has confirmed it.");
  });
}

export async function approveTaxRuleAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("tax.configure");
    await guard(() => tax.approveTaxRule(viewer.userId, str(fd, "ruleId"), str(fd, "reference")));
    return done("Rule approved.");
  });
}

export async function retireTaxRuleAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("tax.configure");
    await guard(() => tax.retireTaxRule(viewer.userId, str(fd, "ruleId"), str(fd, "reason")));
    return done("Rule retired. Lines already calculated keep their tax.");
  });
}

export async function saveTreatmentAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("tax.configure");
    await guard(() =>
      tax.saveTreatment(viewer.userId, {
        category: str(fd, "category") as "fee",
        gstHst: str(fd, "gstHst") as "review",
        yearEnd: str(fd, "yearEnd") as "review",
        yearEndBox: str(fd, "yearEndBox"),
        notes: str(fd, "notes") || null,
      }),
    );
    return done("Treatment saved. If it changed, it needs the accountant's approval again.");
  });
}

export async function approveTreatmentAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("tax.configure");
    await guard(() => tax.approveTreatment(viewer.userId, str(fd, "category"), str(fd, "reference")));
    return done("Treatment approved.");
  });
}

export async function setRecoverabilityAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("tax.configure");
    const values: Record<string, string> = {};
    for (const c of ["GST", "HST", "QST", "PST"]) values[c] = str(fd, c) || "unconfirmed";
    await guard(() => tax.setTaxRecoverability(viewer.userId, values));
    return done("Tax recoverability saved.");
  });
}

export async function saveAccountingConfigAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("tax.configure");
    const current = await getAccountingConfig();
    const accounts: Record<string, string> = {};
    for (const k of Object.keys(current.accounts)) {
      const v = str(fd, `account:${k}`);
      if (v) accounts[k] = v;
    }
    const taxCodes: Record<string, string> = {};
    const keys = fd.getAll("taxCodeKey").map((v) => String(v).trim().toUpperCase().replace(/^NONE$/, "none"));
    const values = fd.getAll("taxCodeValue").map((v) => String(v).trim());
    keys.forEach((k, i) => {
      if (k && values[i]) taxCodes[k] = values[i]!;
    });
    await guard(() =>
      saveAccountingConfig(viewer.userId, {
        system: str(fd, "system") || null,
        accounts,
        taxCodes,
        currency: str(fd, "currency").toUpperCase() || "CAD",
        validated: fd.get("validated") === "on",
      }),
    );
    return done("Accounting export settings saved.");
  });
}

export async function saveThresholdAction(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await authorizeInternal("tax.configure");
    const dollars = z.coerce.number({ message: "Enter an amount" }).min(0).max(100000).parse(str(fd, "threshold"));
    const reference = str(fd, "reference");
    if (reference.length < 5) throw new UserFacingError("Record the accountant's confirmation of this threshold.");
    const cents = Math.round(dollars * 100);
    await db.transaction(async (tx) => {
      await tx.update(orgSettings).set({ yearEndThresholdCents: cents, updatedBy: viewer.userId }).where(eq(orgSettings.id, 1));
      await recordAudit({ actorId: viewer.userId, action: "settings.year_end_threshold", entityType: "org_settings", entityId: "1", after: { yearEndThresholdCents: cents }, reason: reference }, tx);
    });
    return done("Year-end threshold saved.");
  });
}
