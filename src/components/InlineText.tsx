import { Fragment, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Inline formatting inside one string of untrusted model output — **as
 * elements, never as HTML.**
 *
 * ═══ Why this is a regex split and not a markdown library ════════════════
 *
 * ROADMAP.md priority 1 asks for inline markdown and math in notes, and the
 * brief spells out the constraint: a renderer that emits **elements, never raw
 * HTML**, because `dangerouslySetInnerHTML` is blocked by an ESLint rule that
 * does not get disabled. A library configured with `skipHtml` would satisfy the
 * letter of that. This satisfies it structurally instead, which is the standard
 * `AnswerText` set and this file inherits:
 *
 * > The safety here is **structural, not configured**: the function below
 * > cannot emit HTML because it never produces a string that anything parses as
 * > markup. There is no `skipHtml` option to get wrong and no sanitiser to keep
 * > up to date. Turning it unsafe would take a deliberate edit rather than a
 * > missed prop.
 *
 * Three further reasons a dependency was the wrong answer here, all specific to
 * this codebase rather than general suspicion of libraries:
 *
 * 1. **There is no block structure left to parse.** A markdown engine earns its
 *    keep by turning a document into a tree — headings, lists, quotes, tables.
 *    The contract already did that: `NoteBlock` is a discriminated union of
 *    heading / paragraph / list / quote, and `NoteBlocks.tsx` renders it. What
 *    remains is emphasis *within* one already-structured string, which is a
 *    regex split, not a parser.
 * 2. **It would parse structure the contract cannot produce.** There is no code
 *    block, table or image in `NoteBlock`, so a full engine would be reading
 *    markup out of prose that the generator never meant as markup — a line
 *    starting `# ` in a paragraph would silently become a heading inside a
 *    paragraph.
 * 3. **`AnswerText` already said not to.** Its own note reads "Do not grow this
 *    file into a markdown engine", and FR1 drew a deliberate two-dependency
 *    line. Adding remark/unified plus KaTeX to italicise a word and set a
 *    variable would be a large amount of new surface for a small amount of
 *    formatting.
 *
 * ── Why it is here rather than in `AnswerText` ───────────────────────────
 *
 * Two surfaces need the same inline pass now: chat answers and note blocks.
 * `AnswerText` had the only implementation and its drift note pointed notes at
 * `NoteBlock` for *structure* — correctly — while leaving them with no way to
 * bold a term mid-sentence, which `NoteBlocks` itself logged as gap (1) of what
 * the schema could not express. Copying the parser into notes would have been
 * two regexes to keep in step; this is one, in `components/`, used by both.
 *
 * ── What it understands, and what it does not ────────────────────────────
 *
 *   `**bold**`   `*italic*`   `` `code` ``   `$math$`   `[1]` citation markers
 *
 * Italic delimiters must hug non-space, so arithmetic like `3 * 4 * 5` is left
 * alone rather than read as emphasis — see the pattern's own note.
 *
 * Everything else arrives as its literal characters, deliberately. Links are
 * **not** supported: a URL in untrusted model output rendered as an anchor is a
 * phishing surface, and a note that needs to cite something has `quote` with a
 * real `sourceId` for exactly that.
 *
 * ── The maths, and its honest limit ──────────────────────────────────────
 *
 * `$x^2$` sets its content in a serif italic face with superscripts and
 * subscripts raised — enough for the variables, exponents and indices that
 * appear in study notes, which is what the roadmap's "math" is asking for in
 * practice. **It is not a TeX engine.** No fractions, no integrals, no matrices:
 * those need a real layout engine (KaTeX is ~280KB with its fonts) and the
 * contract has no math block to justify one. A `$...$` span containing anything
 * beyond letters, digits, and simple `^`/`_` groups is left as written, so an
 * expression this cannot set is shown as its source rather than as a wrong
 * rendering — which is the failure mode that matters for something being
 * revised from.
 */

/**
 * One capturing split, so the delimiters survive into the array and each chunk
 * is classified by re-testing it. `String.split` with a capturing group keeps
 * the separators, which is what makes a single pass possible without tracking
 * indices by hand.
 *
 * Order matters: `**bold**` is tried before `*italic*`, or the bold delimiters
 * would match as two empty italics.
 *
 * **The italic alternative refuses to touch spaces, and that is load-bearing.**
 * A naive `\*[^*\n]+\*` turns "multiply 3 * 4 * 5" into an italic " 4 " — it
 * reads two arithmetic operators as delimiters and silently restyles the number
 * between them, which in a page of study notes is a wrong sum rendered
 * confidently. Requiring a non-space on the inside of each delimiter is
 * markdown's own rule and fixes it: `*word*` and `*a*` still italicise, while
 * `3 * 4`, `a * b * c` and a trailing `*` stay literal. Found by probing the
 * parser against real strings, not by reading it.
 */
const INLINE =
  /(\*\*[^*]+\*\*|\*[^\s*][^*\n]*[^\s*]\*|\*[^\s*]\*|`[^`]+`|\$[^$\n]+\$|\[\d{1,3}\])/g;

/** What a `$…$` span may contain before this declines to set it as maths. */
const SIMPLE_MATH = /^[A-Za-z0-9\s+\-=<>(),.|/*^_{}'α-ωΑ-Ω]+$/;

export function InlineText({
  text,
  /** Called with the marker number when a `[n]` in the text is activated. */
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

    /*
     * Single asterisks, after bold. The length guard is what keeps a lone `*`
     * used as a bullet or a footnote mark from swallowing the rest of a line —
     * the pattern already refuses newlines, and this refuses the empty case.
     */
    if (chunk.startsWith('*') && chunk.endsWith('*') && chunk.length > 2) {
      return <em key={index}>{chunk.slice(1, -1)}</em>;
    }

    if (chunk.startsWith('`') && chunk.endsWith('`')) {
      return (
        <code key={index} className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
          {chunk.slice(1, -1)}
        </code>
      );
    }

    if (chunk.startsWith('$') && chunk.endsWith('$') && chunk.length > 2) {
      return <Math key={index} source={chunk.slice(1, -1)} />;
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

/**
 * A short mathematical expression, set rather than laid out.
 *
 * Superscripts and subscripts are real `<sup>` / `<sub>` elements, so `x^2`
 * reads as x² to a screen reader as well as to the eye, and `{}` groups more
 * than one character: `x^{n+1}`.
 *
 * Anything this cannot set confidently is returned as its own source text
 * inside the same face. A half-rendered formula in revision notes is worse than
 * a visibly literal one — the reader can still parse `\frac{a}{b}`, but cannot
 * know that a silently dropped denominator was ever there.
 */
function Math({ source }: { source: string }) {
  if (!SIMPLE_MATH.test(source)) {
    return <span className="font-mono text-[0.95em]">${source}$</span>;
  }

  const parts: ReactNode[] = [];
  let buffer = '';
  let position = 0;

  const flush = () => {
    if (buffer.length > 0) {
      parts.push(<Fragment key={`t${String(parts.length)}`}>{buffer}</Fragment>);
      buffer = '';
    }
  };

  while (position < source.length) {
    const character = source[position];

    if (character === '^' || character === '_') {
      // Read what the script applies to: a braced group, or one character.
      let script = '';
      let cursor = position + 1;
      if (source[cursor] === '{') {
        cursor += 1;
        while (cursor < source.length && source[cursor] !== '}') {
          script += source[cursor];
          cursor += 1;
        }
        // Step past the closing brace, if the group was actually closed.
        cursor += 1;
      } else if (cursor < source.length) {
        script = source[cursor] ?? '';
        cursor += 1;
      }

      // A trailing `^` with nothing after it is literal, not a script.
      if (script.length === 0) {
        buffer += character;
        position += 1;
        continue;
      }

      flush();
      parts.push(
        character === '^' ? (
          <sup key={`s${String(parts.length)}`}>{script}</sup>
        ) : (
          <sub key={`s${String(parts.length)}`}>{script}</sub>
        ),
      );
      position = cursor;
      continue;
    }

    buffer += character;
    position += 1;
  }

  flush();

  return <span className="font-serif italic">{parts}</span>;
}
