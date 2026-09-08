import { Fragment, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A chat answer, rendered **as elements**.
 *
 * ═══ The rule, and why it needed its own file ════════════════════════════
 *
 * Chat answers are LLM output and therefore untrusted (CLAUDE.md, plan §3).
 * `dangerouslySetInnerHTML` is blocked by an ESLint rule that must not be
 * disabled, and the plan names the temptation exactly:
 *
 * > Rendering markdown will be tempting — **use a renderer that produces
 * > elements, never HTML.**
 *
 * A markdown library would be the obvious answer and is the wrong one here, for
 * two reasons that both point the same way. First, FR1 drew a deliberate
 * two-dependency line and `package.json` has no markdown package in it; adding
 * `react-markdown` plus its remark/unified tree to render three inline forms is
 * a large amount of new attack surface for a small amount of formatting.
 * Second — and this is the load-bearing one — the safety here is **structural,
 * not configured**: the function below cannot emit HTML because it never
 * produces a string that anything parses as markup. It produces React elements
 * from a regex split, so there is no `skipHtml` option to get wrong and no
 * sanitiser to keep up to date. Turning it unsafe would take a deliberate edit
 * rather than a missed prop.
 *
 * The cost, stated: this understands **three** inline forms and paragraph
 * breaks, and nothing else. Tables, headings, links and nested lists arrive as
 * their literal characters. That is a real limitation and the right trade for
 * a chat answer — but a note *editor* (FR5's territory) wants structure, and
 * the contract already gives it structure: `NoteBlock` is a discriminated union
 * precisely so notes are never one text blob. **Do not grow this file into a
 * markdown engine** — a surface that needs blocks should be taking `NoteBlock`s.
 *
 * ── What it does understand ──────────────────────────────────────────────
 *
 *   `**bold**`   `` `code` ``   `[1]` citation markers   blank-line paragraphs
 *   `- ` bullets at the start of a line
 *
 * Citation markers are the interesting one: the contract's `AskCitation` has a
 * `marker` number, the answer text refers to it as `[1]`, and rendering that as
 * a button is what makes an answer traceable to the source it came from — the
 * whole point of grounded chat.
 */
export function AnswerText({
  text,
  onCitationClick,
  className,
}: {
  text: string;
  /** Called with the marker number when a `[n]` in the text is activated. */
  onCitationClick?: (marker: number) => void;
  className?: string;
}) {
  /*
   * Paragraphs first, then lines within a paragraph, then inline spans within a
   * line. Three passes rather than one clever regex, because each level has a
   * different output element and a combined pattern would be unreadable and
   * only sometimes right.
   */
  const paragraphs = text.split(/\n{2,}/).filter(block => block.trim().length > 0);

  return (
    <div className={cn('flex flex-col gap-snug text-sm leading-relaxed', className)}>
      {paragraphs.map((paragraph, index) => (
        <Paragraph
          key={index}
          text={paragraph}
          {...(onCitationClick ? { onCitationClick } : {})}
        />
      ))}
    </div>
  );
}

function Paragraph({
  text,
  onCitationClick,
}: {
  text: string;
  onCitationClick?: (marker: number) => void;
}) {
  const lines = text.split('\n');
  const bulleted = lines.filter(line => line.trim().length > 0);

  // A paragraph whose every line is a bullet is a list. A mixed block is not —
  // treating it as one would silently reorder the user's prose into items.
  if (bulleted.length > 0 && bulleted.every(line => /^\s*[-*]\s+/.test(line))) {
    return (
      <ul className="ml-base list-disc space-y-hairline">
        {bulleted.map((line, index) => (
          <li key={index}>
            <Inline
              text={line.replace(/^\s*[-*]\s+/, '')}
              {...(onCitationClick ? { onCitationClick } : {})}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <p>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && <br />}
          <Inline text={line} {...(onCitationClick ? { onCitationClick } : {})} />
        </Fragment>
      ))}
    </p>
  );
}

/**
 * The inline pass: bold, code, and citation markers.
 *
 * One capturing split, so the delimiters survive into the array and each chunk
 * is classified by re-testing it. `String.split` with a capturing group keeps
 * the separators, which is what makes a single pass possible without tracking
 * indices by hand.
 */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[\d{1,3}\])/g;

function Inline({
  text,
  onCitationClick,
}: {
  text: string;
  onCitationClick?: (marker: number) => void;
}): ReactNode {
  return text.split(INLINE).map((chunk, index) => {
    if (chunk.length === 0) return null;

    if (chunk.startsWith('**') && chunk.endsWith('**')) {
      return <strong key={index}>{chunk.slice(2, -2)}</strong>;
    }

    if (chunk.startsWith('`') && chunk.endsWith('`')) {
      return (
        <code key={index} className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
          {chunk.slice(1, -1)}
        </code>
      );
    }

    const citation = /^\[(\d{1,3})\]$/.exec(chunk);
    if (citation?.[1] !== undefined) {
      const marker = Number(citation[1]);
      /*
       * A citation with nowhere to go stays text. An inert button that looks
       * clickable is worse than a plain marker — it promises the answer is
       * traceable and then does nothing.
       */
      if (!onCitationClick) {
        return (
          <sup key={index} className="text-muted-foreground mx-0.5 tabular-nums">
            [{marker}]
          </sup>
        );
      }
      return (
        <button
          key={index}
          type="button"
          onClick={() => {
            onCitationClick(marker);
          }}
          aria-label={`Show source ${String(marker)}`}
          className={cn(
            'text-muted-foreground hover:text-foreground mx-0.5 rounded align-super text-[0.7em] tabular-nums',
            'underline decoration-dotted underline-offset-2',
            'focus-visible:ring-ring outline-none focus-visible:ring-2',
          )}
        >
          [{marker}]
        </button>
      );
    }

    return <Fragment key={index}>{chunk}</Fragment>;
  });
}
