import { desc, ne } from "drizzle-orm";
import { DownloadIcon, ListIcon, PlusIcon, UploadIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Button } from "@/components/ui/button";
import { withParams } from "@/lib/search-params";
import { canAny } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { projects } from "@/server/db/schema";
import { getTalentLookups } from "@/server/domain/talent";
import { PAGE_SIZE, parseTalentFilters, searchTalent } from "@/server/domain/talent-search";
import { getOrgSettings } from "@/server/settings";
import { requireInternal, toActor } from "@/server/session";
import { TalentFilters } from "./talent-filters";
import { TalentTable } from "./talent-table";

export const metadata: Metadata = { title: "Talent" };

export default async function TalentPage({ searchParams }: PageProps<"/dashboard/talent">) {
  const viewer = await requireInternal("talent.view");
  const actor = toActor(viewer);
  const params = await searchParams;
  const filters = parseTalentFilters(params);
  const canSeeRates = canAny(actor, "rates.view");
  const settings = await getOrgSettings();

  const [lookups, result, projectOptions] = await Promise.all([
    getTalentLookups(),
    searchTalent(filters, { canSeeRates, timeZone: settings.defaultTimezone }),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(ne(projects.status, "draft")).orderBy(desc(projects.startDate)).limit(100),
  ]);
  const canEdit = canAny(actor, "talent.edit");
  const canExport = canAny(actor, "talent.export");
  const exportQuery = withParams(params, { page: null });

  return (
    <>
      <PageHeader
        title="Talent"
        description={`${result.total} ${result.total === 1 ? "person" : "people"} match.`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/talent/lists">
                <ListIcon /> Lists
              </Link>
            </Button>
            {canExport ? (
              <Button asChild variant="outline" size="sm">
                <a href={`/dashboard/talent/export${exportQuery}`}>
                  <DownloadIcon /> Export CSV
                </a>
              </Button>
            ) : null}
            {canAny(actor, "talent.import") ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/talent/import">
                  <UploadIcon /> Import CSV
                </Link>
              </Button>
            ) : null}
            {canEdit ? (
              <Button asChild size="sm">
                <Link href="/dashboard/talent/new">
                  <PlusIcon /> Add staff
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-5">
        <TalentFilters
          lookups={{
            cities: lookups.cities,
            skills: lookups.skills.map((s) => ({ value: s.id, label: s.name })),
            languages: lookups.languages.map((s) => ({ value: s.id, label: s.name })),
            certifications: lookups.certifications.map((s) => ({ value: s.id, label: s.name })),
            lists: lookups.lists.map((s) => ({ value: s.id, label: s.name })),
            projects: projectOptions.map((p) => ({ value: p.id, label: p.name })),
            canFilterRates: canSeeRates,
          }}
        />
        <TalentTable
          rows={result.rows.map((r) => ({
            id: r.id,
            name: `${r.preferredName ?? r.firstName} ${r.lastName}`,
            email: r.email,
            phone: r.phone,
            city: r.city,
            status: r.status,
            roles: r.roles,
            rates: r.rates,
            completedShifts: r.completedShifts,
            lastShiftAt: r.lastShiftAt ? new Date(r.lastShiftAt).toISOString() : null,
            hasAccount: r.hasAccount,
            isDemo: r.isDemo,
          }))}
          showRates={canSeeRates}
          lists={lookups.lists.map((l) => ({ value: l.id, label: l.name }))}
          canEdit={canEdit}
          canExport={canExport}
        />
        <Pagination page={filters.page} pageSize={PAGE_SIZE} total={result.total} hrefFor={(p) => `/dashboard/talent${withParams(params, { page: p })}`} />
      </div>
    </>
  );
}
