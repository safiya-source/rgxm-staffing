// Finance reports. All amounts in cents; demo data excluded. Costs come from bill lines (approved
// work), so they include work not yet paid. Sales tax is split into recoverable, non-recoverable
// and unconfirmed according to Settings (as confirmed by RGXM's accountant); budget variance uses
// the pre-tax cost plus non-recoverable and unconfirmed tax.
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { getOrgSettings } from "@/server/settings";

const num = (v: unknown) => Number(v ?? 0);

export async function projectCostReport() {
  const settings = await getOrgSettings();
  const recoverability = settings.taxRecoverability ?? {};
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select pr.id, pr.code, pr.name, pr.status, pr.budget_cents, c.id as client_id, coalesce(c.name, 'No client') as client,
      coalesce(sum(p.base_cents) filter (where p.category = 'fee'), 0) as fees,
      coalesce(sum(p.base_cents) filter (where p.category in ('meal_breakfast', 'meal_lunch', 'meal_dinner', 'per_diem')), 0) as meals,
      coalesce(sum(p.base_cents) filter (where p.category = 'mileage'), 0) as mileage,
      coalesce(sum(p.base_cents) filter (where p.category = 'bonus'), 0) as bonuses,
      coalesce(sum(p.base_cents) filter (where p.category = 'adjustment'), 0) as adjustments,
      coalesce(sum(p.base_cents), 0) as pre_tax,
      count(p.id) filter (where p.tax_status = 'review_required') as tax_reviews
    from projects pr
    left join clients c on c.id = pr.client_id
    left join payable_items p on p.project_id = pr.id and p.status <> 'void'
    where not pr.is_demo
    group by pr.id, c.id
    having count(p.id) > 0 or pr.budget_cents is not null
    order by pr.code
  `);
  const { rows: taxRows } = await db.execute<{ project_id: string; component: string; tax: string }>(sql`
    select p.project_id, t.component, sum(t.tax_cents) as tax
    from payable_tax_lines t join payable_items p on p.id = t.payable_item_id join projects pr on pr.id = p.project_id
    where p.status <> 'void' and not pr.is_demo
    group by p.project_id, t.component
  `);
  return rows.map((r) => {
    const tax = { recoverable: 0, nonRecoverable: 0, unconfirmed: 0 };
    for (const t of taxRows.filter((x) => x.project_id === r.id)) {
      const kind = recoverability[t.component] ?? "unconfirmed";
      tax[kind === "recoverable" ? "recoverable" : kind === "non_recoverable" ? "nonRecoverable" : "unconfirmed"] += num(t.tax);
    }
    const preTax = num(r.pre_tax);
    const costForBudget = preTax + tax.nonRecoverable + tax.unconfirmed;
    const budget = r.budget_cents == null ? null : num(r.budget_cents);
    return {
      projectId: String(r.id),
      code: String(r.code),
      name: String(r.name),
      status: String(r.status),
      clientId: (r.client_id as string | null) ?? null,
      client: String(r.client),
      fees: num(r.fees),
      meals: num(r.meals),
      mileage: num(r.mileage),
      bonuses: num(r.bonuses),
      adjustments: num(r.adjustments),
      preTax,
      tax,
      costForBudget,
      budget,
      variance: budget == null ? null : budget - costForBudget,
      taxReviews: num(r.tax_reviews),
    };
  });
}
export type ProjectCostRow = Awaited<ReturnType<typeof projectCostReport>>[number];

export function clientCostRollup(rows: ProjectCostRow[]) {
  const map = new Map<string, { client: string; projects: number; preTax: number; recoverable: number; nonRecoverable: number; unconfirmed: number; budget: number }>();
  for (const r of rows) {
    const e = map.get(r.client) ?? { client: r.client, projects: 0, preTax: 0, recoverable: 0, nonRecoverable: 0, unconfirmed: 0, budget: 0 };
    e.projects++;
    e.preTax += r.preTax;
    e.recoverable += r.tax.recoverable;
    e.nonRecoverable += r.tax.nonRecoverable;
    e.unconfirmed += r.tax.unconfirmed;
    e.budget += r.budget ?? 0;
    map.set(r.client, e);
  }
  return [...map.values()].sort((a, b) => a.client.localeCompare(b.client));
}

/** Approved work that isn't on a finalized bill yet, plus compensation still awaiting approval. */
export async function approvedUnbilledWork() {
  const { rows: lines } = await db.execute<Record<string, unknown>>(sql`
    select p.id, p.category, p.service_date, p.base_cents, p.tax_cents, p.total_cents, p.status, p.tax_status,
      pr.code as project, coalesce(sp.preferred_name, sp.first_name) || ' ' || sp.last_name as name
    from payable_items p join projects pr on pr.id = p.project_id join staff_profiles sp on sp.id = p.staff_id
    where p.bill_id is null and p.status in ('pending', 'batched', 'failed') and not pr.is_demo
    order by p.service_date
  `);
  const { rows: missing } = await db.execute<Record<string, unknown>>(sql`
    select t.id, t.status, pr.code as project, coalesce(sp.preferred_name, sp.first_name) || ' ' || sp.last_name as name, t.approved_at
    from timesheets t join projects pr on pr.id = t.project_id join staff_profiles sp on sp.id = t.staff_id
    where t.status = 'approved' and not pr.is_demo
      and not exists (select 1 from payable_items p where p.timesheet_id = t.id and p.status <> 'void')
  `);
  const { rows: compensation } = await db.execute<Record<string, unknown>>(sql`
    select ci.id, ci.category, ci.work_date, ci.amount_cents, pr.code as project, coalesce(sp.preferred_name, sp.first_name) || ' ' || sp.last_name as name
    from compensation_items ci join projects pr on pr.id = ci.project_id join staff_profiles sp on sp.id = ci.staff_id
    where ci.status = 'pending' and not pr.is_demo
    order by ci.work_date
  `);
  return { lines, approvedWithoutLine: missing, pendingCompensation: compensation };
}

/** Bills not fully paid: what's settled and what's outstanding on each. */
export async function outstandingBills() {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select b.id, b.bill_number, b.bill_date, b.due_date, b.total_cents, b.terms_snapshot ->> 'approved' as terms_approved,
      s.display_name as supplier,
      coalesce(sum(p.total_cents) filter (where p.status = 'paid'), 0) as settled_cents,
      coalesce(sum(p.total_cents) filter (where p.status not in ('paid', 'void')), 0) as outstanding_cents,
      exists (select 1 from accounting_export_bills ab where ab.bill_id = b.id and ab.active) as in_accounting
    from bills b join accounting_suppliers s on s.id = b.supplier_id join payable_items p on p.bill_id = b.id
    where b.status = 'open' and not b.is_demo
    group by b.id, s.id
    order by b.due_date, b.bill_number
  `);
  return rows;
}

/** Payments that failed, were returned or cancelled by the bank and haven't been paid since. */
export async function failedPayments() {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select distinct on (p.id) p.id as payable_id, p.total_cents, p.category, p.service_date, b.bill_number, i.state, i.failure_reason, i.bank_reference,
      coalesce(i.returned_at, i.reconciled_at) as at, pb.reference as batch, coalesce(sp.preferred_name, sp.first_name) || ' ' || sp.last_name as name
    from payable_items p
    join payment_batch_items i on i.payable_item_id = p.id and i.state in ('failed', 'returned', 'bank_cancelled')
    join payment_batches pb on pb.id = i.batch_id
    join staff_profiles sp on sp.id = p.staff_id
    left join bills b on b.id = p.bill_id
    where p.status = 'failed' and not pb.is_demo
    order by p.id, coalesce(i.returned_at, i.reconciled_at) desc
  `);
  return rows;
}

/** Payment attempts not yet reconciled with the bank, and settlements recorded without bank evidence. */
export async function unreconciledItems(now = new Date()) {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select i.id, pb.reference as batch, pb.id as batch_id, i.state, i.amount_cents, pb.submitted_at,
      (select max(e.created_at) from payment_exports e where e.batch_id = pb.id and e.purpose = 'bank') as exported_at,
      coalesce(sp.preferred_name, sp.first_name) || ' ' || sp.last_name as name,
      i.evidence
    from payment_batch_items i join payment_batches pb on pb.id = i.batch_id join payable_items p on p.id = i.payable_item_id join staff_profiles sp on sp.id = p.staff_id
    where not pb.is_demo and (
      (i.active and i.state in ('exported', 'submitted'))
      or (i.state = 'settled' and i.evidence like 'Marked paid in Crew by Finance%')
    )
    order by pb.reference
  `);
  return rows.map((r) => ({ ...r, legacy: String(r.evidence ?? "").startsWith("Marked paid in Crew"), ageDays: r.exported_at ? Math.floor((now.getTime() - new Date(r.exported_at as string).getTime()) / 86_400_000) : null }));
}

/** Lines waiting for a Finance tax decision. */
export async function taxReviewQueue() {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select p.id, p.category, p.service_date, p.base_cents, p.tax_basis, p.status, pr.code as project, pr.event_province, pr.supply_type,
      coalesce(sp.preferred_name, sp.first_name) || ' ' || sp.last_name as name, p.staff_id
    from payable_items p join projects pr on pr.id = p.project_id join staff_profiles sp on sp.id = p.staff_id
    where p.tax_status = 'review_required' and p.status in ('pending', 'failed')
    order by p.service_date
  `);
  return rows;
}
