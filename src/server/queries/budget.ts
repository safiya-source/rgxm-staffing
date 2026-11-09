// Project budget: what's paid-for (approved), waiting on approval, and still scheduled,
// against the project budget. Every figure comes from agreed-rate snapshots or approved payables, before HST
// (registered businesses usually recover HST as input tax credits; confirm with the accountant).
import { sql } from "drizzle-orm";
import { utcToZoned } from "@/lib/time";
import { db } from "@/server/db";
import { basePayCents } from "@/server/domain/pay-rules";

export type CostBucket = "actual" | "pending" | "committed";
export type BudgetLine = { key: string; actual: number; pending: number; committed: number };

const MINUTE = 60_000;

export async function getProjectBudget(projectId: string, now = new Date()) {
  const r = await db.execute<{
    booking_id: string;
    role: string;
    location: string;
    starts_at: Date;
    ends_at: Date;
    timezone: string;
    agreed_rate_cents: number | null;
    worked_start: Date | null;
    worked_end: Date | null;
    break_minutes: number | null;
    payable_total: string | null;
    timesheet_status: string | null;
  }>(sql`
    select b.id as booking_id, b.role::text as role, l.name as location, s.starts_at, s.ends_at, s.timezone, b.agreed_rate_cents,
           t.worked_start, t.worked_end, t.break_minutes, t.status::text as timesheet_status,
           (select p.base_cents from payable_items p where p.timesheet_id = t.id and p.status <> 'void' limit 1) as payable_total
      from bookings b
      join shifts s on s.id = b.shift_id
      join project_locations l on l.id = s.location_id
      left join timesheets t on t.booking_id = b.id
     where b.project_id = ${projectId} and b.status in ('confirmed', 'completed')`);

  const lines = { role: new Map<string, BudgetLine>(), location: new Map<string, BudgetLine>(), date: new Map<string, BudgetLine>() };
  const totals: BudgetLine = { key: "total", actual: 0, pending: 0, committed: 0 };
  let unpriced = 0;
  const add = (map: Map<string, BudgetLine>, key: string, bucket: CostBucket, cents: number) => {
    const l = map.get(key) ?? { key, actual: 0, pending: 0, committed: 0 };
    l[bucket] += cents;
    map.set(key, l);
  };

  for (const row of r.rows) {
    const start = new Date(row.starts_at);
    const end = new Date(row.ends_at);
    let bucket: CostBucket;
    let cents: number;
    if (row.payable_total != null) {
      bucket = "actual";
      cents = Number(row.payable_total);
    } else {
      if (row.agreed_rate_cents == null) {
        unpriced++;
        continue;
      }
      // Ended but not approved: estimate from the hours under review, else the schedule.
      const ended = end <= now;
      const minutes =
        ended && row.worked_start && row.worked_end
          ? Math.max(Math.round((new Date(row.worked_end).getTime() - new Date(row.worked_start).getTime()) / MINUTE) - (row.break_minutes ?? 0), 0)
          : Math.round((end.getTime() - start.getTime()) / MINUTE);
      bucket = ended ? "pending" : "committed";
      cents = basePayCents(minutes, row.agreed_rate_cents);
    }
    totals[bucket] += cents;
    add(lines.role, row.role, bucket, cents);
    add(lines.location, row.location, bucket, cents);
    add(lines.date, utcToZoned(start, row.timezone).date, bucket, cents);
  }
  const sorted = (m: Map<string, BudgetLine>) => [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { totals, byRole: sorted(lines.role), byLocation: sorted(lines.location), byDate: sorted(lines.date), unpriced };
}

/**
 * Approved bill lines by category (fees, allowances, mileage, bonuses, adjustments) and their sales
 * tax split by whether RGXM recovers it (Settings → Tax & accounting; "unconfirmed" until the
 * accountant says). Budget comparisons use pre-tax cost plus non-recoverable and unconfirmed tax.
 */
export async function getProjectCostCategories(projectId: string) {
  const [settings] = (await db.execute<{ r: Record<string, string> | null }>(sql`select tax_recoverability as r from org_settings where id = 1`)).rows;
  const recoverability = settings?.r ?? {};
  const { rows } = await db.execute<{ category: string; base: string }>(sql`
    select category, coalesce(sum(base_cents), 0) as base from payable_items where project_id = ${projectId} and status <> 'void' group by category`);
  const { rows: taxRows } = await db.execute<{ component: string; tax: string }>(sql`
    select t.component, sum(t.tax_cents) as tax from payable_tax_lines t join payable_items p on p.id = t.payable_item_id
    where p.project_id = ${projectId} and p.status <> 'void' group by t.component`);
  const sum = (cats: string[]) => rows.filter((r) => cats.includes(r.category)).reduce((n, r) => n + Number(r.base), 0);
  const tax = { recoverable: 0, nonRecoverable: 0, unconfirmed: 0 };
  for (const t of taxRows) {
    const k = recoverability[t.component] ?? "unconfirmed";
    tax[k === "recoverable" ? "recoverable" : k === "non_recoverable" ? "nonRecoverable" : "unconfirmed"] += Number(t.tax);
  }
  return {
    fees: sum(["fee"]),
    meals: sum(["meal_breakfast", "meal_lunch", "meal_dinner", "per_diem"]),
    mileage: sum(["mileage"]),
    bonuses: sum(["bonus"]),
    adjustments: sum(["adjustment"]),
    tax,
  };
}
