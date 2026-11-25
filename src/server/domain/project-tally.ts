// Pure: tallies a batch's lines into each contractor's total per project, the way RGXM sends pay
// to its finance team (by project), and into one total per contractor (who to pay, how much).
// Used by the batch page, the summary download and the Excel bank file.

export type TallyLine = { projectCode: string; projectName: string; staffName: string; email?: string | null; subtotalCents: number; taxCents: number; totalCents: number };
export type TallyPerson = { staffName: string; email: string | null; lines: number; subtotalCents: number; taxCents: number; totalCents: number };
export type TallyProject = { projectCode: string; projectName: string; people: TallyPerson[]; subtotalCents: number; taxCents: number; totalCents: number };

// People are told apart by email (two contractors can share a name), falling back to the name.
const personKey = (l: TallyLine) => (l.email ? l.email.toLowerCase() : `name:${l.staffName}`);

function addTo(t: { subtotalCents: number; taxCents: number; totalCents: number }, l: TallyLine) {
  t.subtotalCents += l.subtotalCents;
  t.taxCents += l.taxCents;
  t.totalCents += l.totalCents;
}

const byName = (a: TallyPerson, b: TallyPerson) => a.staffName.localeCompare(b.staffName);

export function tallyByProject(lines: TallyLine[]) {
  const projects = new Map<string, TallyProject & { byPerson: Map<string, TallyPerson> }>();
  for (const l of lines) {
    let p = projects.get(l.projectCode);
    if (!p) {
      p = { projectCode: l.projectCode, projectName: l.projectName, people: [], subtotalCents: 0, taxCents: 0, totalCents: 0, byPerson: new Map() };
      projects.set(l.projectCode, p);
    }
    let who = p.byPerson.get(personKey(l));
    if (!who) {
      who = { staffName: l.staffName, email: l.email ?? null, lines: 0, subtotalCents: 0, taxCents: 0, totalCents: 0 };
      p.byPerson.set(personKey(l), who);
    }
    who.lines += 1;
    addTo(who, l);
    addTo(p, l);
  }
  const out: TallyProject[] = [...projects.values()]
    .map(({ byPerson, ...p }) => ({ ...p, people: [...byPerson.values()].sort(byName) }))
    .sort((a, b) => a.projectCode.localeCompare(b.projectCode));
  const totals = out.reduce((t, p) => ({ subtotalCents: t.subtotalCents + p.subtotalCents, taxCents: t.taxCents + p.taxCents, totalCents: t.totalCents + p.totalCents }), { subtotalCents: 0, taxCents: 0, totalCents: 0 });
  return { projects: out, ...totals };
}

/** One total per contractor across the whole batch: who to pay and how much. */
export function tallyByPerson(lines: TallyLine[]) {
  const people = new Map<string, TallyPerson>();
  for (const l of lines) {
    let who = people.get(personKey(l));
    if (!who) {
      who = { staffName: l.staffName, email: l.email ?? null, lines: 0, subtotalCents: 0, taxCents: 0, totalCents: 0 };
      people.set(personKey(l), who);
    }
    who.lines += 1;
    addTo(who, l);
  }
  return [...people.values()].sort(byName);
}

/** Rows for a spreadsheet: a header per project, one row per contractor, then the project subtotal and a grand total. */
export function tallySheetRows(t: ReturnType<typeof tallyByProject>, money: (cents: number) => number) {
  const rows: (string | number)[][] = [["Project", "Contractor", "Email", "Lines", "Before tax", "Tax", "Total"]];
  for (const p of t.projects) {
    for (const who of p.people) rows.push([`${p.projectCode} · ${p.projectName}`, who.staffName, who.email ?? "", who.lines, money(who.subtotalCents), money(who.taxCents), money(who.totalCents)]);
    rows.push([`${p.projectCode} subtotal`, "", "", p.people.reduce((n, w) => n + w.lines, 0), money(p.subtotalCents), money(p.taxCents), money(p.totalCents)]);
    rows.push([]);
  }
  rows.push(["Batch total", "", "", "", money(t.subtotalCents), money(t.taxCents), money(t.totalCents)]);
  return rows;
}

/** Rows for the "Pay summary" sheet: contractor, email and the amount to send, then the batch total. */
export function paySummaryRows(people: TallyPerson[], money: (cents: number) => number) {
  const rows: (string | number)[][] = [["Contractor", "Email", "Amount to pay", "Before tax", "Tax", "Lines"]];
  for (const w of people) rows.push([w.staffName, w.email ?? "", money(w.totalCents), money(w.subtotalCents), money(w.taxCents), w.lines]);
  const sum = (k: "totalCents" | "subtotalCents" | "taxCents") => people.reduce((n, w) => n + w[k], 0);
  rows.push([]);
  rows.push(["Batch total", "", money(sum("totalCents")), money(sum("subtotalCents")), money(sum("taxCents")), people.reduce((n, w) => n + w.lines, 0)]);
  return rows;
}
