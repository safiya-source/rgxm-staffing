import { format } from "date-fns";
import { Fragment } from "react";

const EMAIL = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** Inline text: **bold** and email addresses as mailto links. Everything else is plain text (no HTML). */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={i}>
            {part.split(EMAIL).map((bit, j) =>
              j % 2 === 1 ? (
                <a key={j} href={`mailto:${bit}`} className="underline underline-offset-2">
                  {bit}
                </a>
              ) : (
                bit
              ),
            )}
          </Fragment>
        ),
      )}
    </>
  );
}

/**
 * Renders a legal document stored as simple text: "## " section headings, "### " subheadings,
 * "- " bullet lists, **bold**, and paragraphs separated by blank lines (single line breaks kept,
 * e.g. for addresses).
 */
export function LegalBody({ body }: { body: string }) {
  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="grid gap-3">
      {blocks.map((block, i) => {
        if (block.startsWith("### ")) return <h4 key={i} className="mt-2 font-semibold">{block.slice(4)}</h4>;
        if (block.startsWith("## ")) return <h3 key={i} className="mt-4 text-base font-semibold">{block.slice(3)}</h3>;
        const lines = block.split("\n");
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i} className="grid list-disc gap-1.5 pl-5 text-[15px] leading-relaxed">
              {lines.map((l, j) => (
                <li key={j}>
                  <Inline text={l.slice(2)} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-[15px] leading-relaxed whitespace-pre-line">
            <Inline text={block} />
          </p>
        );
      })}
    </div>
  );
}

/** An approved legal document with its title, version and effective date. */
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
      <LegalBody body={doc.body} />
    </article>
  );
}
