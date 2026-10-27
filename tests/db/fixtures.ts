import { randomUUID } from "node:crypto";
import { Pool } from "pg";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await pool.query(sql, params);
  return rows[0] as T;
}

export async function makeUser(kind: "internal" | "staff" = "internal") {
  return one<{ id: string }>("insert into users (name, email, kind) values ('Test User', $1, $2) returning id", [
    `${randomUUID()}@example.test`,
    kind,
  ]);
}

export async function makeStaff() {
  return one<{ id: string }>(
    "insert into staff_profiles (first_name, last_name, email) values ('Test', 'Person', $1) returning id",
    [`${randomUUID()}@example.test`],
  );
}

export async function makeProject() {
  const project = await one<{ id: string }>("insert into projects (code, name) values ($1, 'Test project') returning id", [
    `T-${randomUUID().slice(0, 8)}`,
  ]);
  const location = await one<{ id: string }>(
    "insert into project_locations (project_id, name, timezone) values ($1, 'Venue', 'America/Toronto') returning id",
    [project.id],
  );
  return { projectId: project.id, locationId: location.id };
}

export async function makeShift(p: { projectId: string; locationId: string }, startsAt: string, endsAt: string, role = "BA") {
  return one<{ id: string }>(
    `insert into shifts (project_id, location_id, role, starts_at, ends_at, timezone, headcount, rate_cents)
     values ($1, $2, $3, $4, $5, 'America/Toronto', 2, 2500) returning id`,
    [p.projectId, p.locationId, role, startsAt, endsAt],
  );
}

export async function book(
  shiftId: string,
  staffId: string,
  opts: { status?: string; overrideBy?: string; overrideReason?: string; agreedRateCents?: number } = {},
) {
  const status = opts.status ?? "confirmed";
  return one<{ id: string }>(
    `insert into bookings (shift_id, staff_id, project_id, role, starts_at, ends_at, status, agreed_rate_cents, override_by, override_reason)
     select s.id, $2, s.project_id, s.role, s.starts_at, s.ends_at, $3::booking_status, $4, $5, $6 from shifts s where s.id = $1
     returning id`,
    [
      shiftId,
      staffId,
      status,
      opts.agreedRateCents ?? (["confirmed", "completed"].includes(status) ? 2500 : null),
      opts.overrideBy ?? null,
      opts.overrideReason ?? null,
    ],
  );
}
