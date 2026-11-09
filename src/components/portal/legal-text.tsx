import { format } from "date-fns";

/** Renders an approved legal document's plain text as paragraphs. */
export function LegalText({ doc }: { doc: { title: string; version: string; effectiveAt: Date | null; body: string } }) {
  return (
    <article className="grid gap-3">
      <header>
        <h2 className="text-lg font-semibold">{doc.title}</h2>
        <p className="text-xs text-muted-foreground">
          Version {doc.version}
          {doc.effectiveAt ? ` · in effect since ${format(doc.effectiveAt, "MMMM d, yyyy")}` : ""}
        </p>
      </header>
      {doc.body
        .split(/\n{2,}/)
        .map((para) => para.trim())
        .filter(Boolean)
        .map((para, i) => (
          <p key={i} className="text-[15px] leading-relaxed whitespace-pre-line">
            {para}
          </p>
        ))}
    </article>
  );
}
