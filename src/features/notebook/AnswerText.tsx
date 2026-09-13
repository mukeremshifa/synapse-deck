import { Fragment } from 'react';

import { InlineText } from '@/components/InlineText';
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
 * Second — and this is the load-bearing one — the safety is **structural, not
 * configured**: nothing here produces a string that anything parses as markup,
 * so there is no `skipHtml` option to get wrong and no sanitiser to keep up to
 * date.
 *
 * ── The inline pass moved out; this keeps the block pass ─────────────────
 *
 * `**bold**`, `` `code` `` and `[1]` markers are now `components/InlineText`,
 * because notes need the same three and a second copy of the parser is a second
 * thing to keep in step. That file carries the full argument and the newer
 * forms (`*italic*`, `$math$`).
 *
 * What stays here is what is specific to a chat answer: **blank-line
 * paragraphs, single newlines as breaks, and a paragraph of `- ` lines as a
 * list.** That is block-level shape guessed out of one flat string, and it is
 * exactly what a note must *not* do — a `NoteBlock` already says whether it is
 * a list, so guessing would override the generator. The two surfaces genuinely
 * differ there, which is why only the inline half is shared.
 *
 * **Do not grow this file into a markdown engine** — a surface that needs
 * blocks should be taking `NoteBlock`s.
 *
 * Citation markers are the interesting inline form: the contract's
 * `AskCitation` has a `marker` number, the answer text refers to it as `[1]`,
 * and rendering that as a button is what makes an answer traceable to the
 * source it came from — the whole point of grounded chat.
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
            <InlineText
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
          <InlineText text={line} {...(onCitationClick ? { onCitationClick } : {})} />
        </Fragment>
      ))}
    </p>
  );
}
