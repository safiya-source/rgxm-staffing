// Pure: tallies a batch's lines into each contractor's total per project, the way RGXM sends pay
// to its finance team (by project). Used by the batch page, the summary download and the Excel bank file.

export type TallyLine = { projectCode: string; projectName: string; staffName: string; subtotalCents: number; taxCents: number; totalCents: number };
export type TallyPerson = { staffName: string; lines: number; subtotalCents: number; taxCents: number; totalCents: number };
export type TallyProject = { projectCode: string; projectName: string; people: TallyPerson[]; subtotalCents: number; taxCents: number; totalCents: number };

export function tallyByProject(lines: TallyLine[]) {
  const projects = new Map<string, TallyProject & { byPerson: Map<string, TallyPerson> }>();
  for (const l of lines) {
    let p = projects.get(l.projectCode);
    if (!p) {
      p = { projectCode: l.projectCode, projectName: l.projectName, people: [], subtotalCents: 0, taxCents: 0, totalCents: 0, byPerson: new Map() };
      projects.set(l.projectCode, p);
    }
    let who = p.byPerson.get(l.staffName);
    if (!who) {
      who = { staffName: l.staffName, lines: 0, subtotalCents: 0, taxCents: 0, totalCents: 0 };
      p.byPerson.set(l.staffName, who);
    }
    who.lines += 1;
    who.subtotalCents += l.subtotalCents;
    who.taxCents += l.taxCents;
    who.totalCents += l.totalCents;
    p.subtotalCents += l.subtotalCents;
    p.taxCents += l.taxCents;
    p.totalCents += l.totalCents;
  }
  const out: TallyProject[] = [...projects.values()]
    .map(({ byPerson, ...p }) => ({ ...p, people: [...byPerson.values()].sort((a, b) => a.staffName.localeCompare(b.staffName)) }))
    .sort((a, b) => a.projectCode.localeCompare(b.projectCode));
  const totals = out.reduce((t, p) => ({ subtotalCents: t.subtotalCents + p.subtotalCents, taxCents: t.taxCents + p.taxCents, totalCents: t.totalCents + p.totalCents }), { subtotalCents: 0, taxCents: 0, totalCents: 0 });
  return { projects: out, ...totals };
}

/** Rows for a spreadsheet: a header per project, one row per contractor, then the project subtotal and a grand total. */
export function tallySheetRows(t: ReturnType<typeof tallyByProject>, money: (cents: number) => number) {
  const rows: (string | number)[][] = [["Project", "Contractor", "Lines", "Before tax", "Tax", "Total"]];
  for (const p of t.projects) {
    for (const who of p.people) rows.push([`${p.projectCode} · ${p.projectName}`, who.staffName, who.lines, money(who.subtotalCents), money(who.taxCents), money(who.totalCents)]);
    rows.push([`${p.projectCode} subtotal`, "", p.people.reduce((n, w) => n + w.lines, 0), money(p.subtotalCents), money(p.taxCents), money(p.totalCents)]);
    rows.push([]);
  }
  rows.push(["Batch total", "", "", money(t.subtotalCents), money(t.taxCents), money(t.totalCents)]);
  return rows;
}
