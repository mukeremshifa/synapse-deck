import { AlertTriangleIcon } from 'lucide-react';

import type { NoteBlock, SourceSnapshot } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * A note set's blocks, as elements.
 *
 * ══ The rule this file exists to hold ═════════════════════════════════════
 *
 * > **Render blocks as elements. Never HTML.**
 *
 * FR5 §4 calls this "the single most likely place in the whole re-architecture
 * for `dangerouslySetInnerHTML` to be reached for", and it is right: a note set
 * looks like a document, documents look like markdown, and markdown looks like
 * a job for an HTML renderer. Card and note content is **untrusted LLM output**
 * (CLAUDE.md, §3 of the plan), the ESLint rule blocking raw HTML must not be
 * disabled, and the safety here is structural rather than a setting: this
 * component **never builds a string that anything parses as markup.** There is
 * nothing to get wrong later.
 *
 * ── Why this is not `AnswerText` ─────────────────────────────────────────
 *
 * FR3 built `features/notebook/AnswerText.tsx` for chat answers and its drift
 * row says exactly what to do here: *"Do not grow it into a markdown engine — a
 * surface that needs real structure should take `NoteBlock`s, which the contract
 * already provides as a discriminated union for exactly this reason."*
 *
 * `AnswerText` handles **inline** forms inside one string: bold, code,
 * citations, bullets. This handles **structure** — headings with levels, lists
 * that know whether they are ordered, quotes that carry a source. That
 * structure is why `NoteBlock` is a union rather than a blob, and why the later
 * editor is cheap: block-level editing, reordering and citation anchoring
 * cannot be added to a string without re-parsing content that was never
 * structured (the contract's own comment).
 *
 * So the two do not share code, and neither is a fallback for the other. A
 * block's text is rendered as text, with `whitespace-pre-wrap` doing the only
 * formatting there is.
 *
 * ── What the schema could not express (FR5 §6.4) ─────────────────────────
 *
 * Recorded here because this is where it was found:
 *
 * 1. **No inline emphasis inside a block.** `paragraph.text` is one flat
 *    string, so a note cannot bold a term mid-sentence — which is exactly what
 *    a study note wants to do. `AnswerText` can do it for chat and this cannot
 *    do it for notes, which is the odd asymmetry of the current shapes.
 * 2. **No nested or multi-level lists**, and no rich list items: `items` is
 *    `string[]`, so a sub-point becomes a separate flat item or is lost.
 * 3. **No code, table, or image block.** Fine for the current material, and a
 *    real gap for anything technical.
 * 4. **A quote carries a `sourceId` but no locator** — no page, no offset — so
 *    a citation can name the document and never the place in it.
 *
 * None of these blocked FR5, and none should be fixed from a consuming phase:
 * adding a block kind is a contract change, and the union is the thing that
 * makes it safe to add one later.
 */
export function NoteBlocks({
  blocks,
  sourcesSnapshot,
  liveSourceIds,
  blockRef,
}: {
  blocks: NoteBlock[];
  /** What the note was built from. Complete, and never dangles. */
  sourcesSnapshot: SourceSnapshot[];
  /** Which of those sources still exist, for deciding if a name is live. */
  liveSourceIds: ReadonlySet<string>;
  /** Lets the reader observe each block, for marking read. */
  blockRef?: (index: number) => (node: HTMLElement | null) => void;
}) {
  return (
    <div className="space-y-gutter">
      {blocks.map((block, index) => (
        <Block
          key={index}
          block={block}
          index={index}
          sourcesSnapshot={sourcesSnapshot}
          liveSourceIds={liveSourceIds}
          {...(blockRef ? { attach: blockRef(index) } : {})}
        />
      ))}
    </div>
  );
}

function Block({
  block,
  index,
  sourcesSnapshot,
  liveSourceIds,
  attach,
}: {
  block: NoteBlock;
  index: number;
  sourcesSnapshot: SourceSnapshot[];
  liveSourceIds: ReadonlySet<string>;
  attach?: (node: HTMLElement | null) => void;
}) {
  // The section anchor a reader's progress is measured against.
  const id = `block-${index}`;

  switch (block.type) {
    case 'heading': {
      const Tag = (['h1', 'h2', 'h3'] as const)[block.level - 1] ?? 'h3';
      return (
        <Tag
          id={id}
          ref={attach}
          className={cn(
            'font-serif leading-tight scroll-mt-20',
            block.level === 1 && 'text-2xl',
            block.level === 2 && 'mt-page text-xl',
            block.level === 3 && 'mt-gutter text-lg',
          )}
        >
          {block.text}
        </Tag>
      );
    }

    case 'paragraph':
      return (
        <p
          id={id}
          ref={attach as ((node: HTMLParagraphElement | null) => void) | undefined}
          className="leading-relaxed whitespace-pre-wrap scroll-mt-20"
        >
          {block.text}
        </p>
      );

    case 'list':
      return block.ordered ? (
        <ol
          id={id}
          ref={attach as ((node: HTMLOListElement | null) => void) | undefined}
          className="ml-5 list-decimal space-y-tight leading-relaxed scroll-mt-20"
        >
          {block.items.map((item, position) => (
            <li key={position} className="whitespace-pre-wrap">
              {item}
            </li>
          ))}
        </ol>
      ) : (
        <ul
          id={id}
          ref={attach as ((node: HTMLUListElement | null) => void) | undefined}
          className="ml-5 list-disc space-y-tight leading-relaxed scroll-mt-20"
        >
          {block.items.map((item, position) => (
            <li key={position} className="whitespace-pre-wrap">
              {item}
            </li>
          ))}
        </ul>
      );

    case 'quote':
      return (
        <figure
          id={id}
          ref={attach as ((node: HTMLElement | null) => void) | undefined}
          className="border-border-strong space-y-tight border-l-2 pl-gutter scroll-mt-20"
        >
          <blockquote className="leading-relaxed whitespace-pre-wrap italic">
            {block.text}
          </blockquote>
          <Attribution
            sourceId={block.sourceId}
            sourcesSnapshot={sourcesSnapshot}
            liveSourceIds={liveSourceIds}
          />
        </figure>
      );
  }
}

/**
 * Where a quote came from — **and the dangling case, which is the point.**
 *
 * The fixtures ship a quote whose source has been deleted, deliberately, so
 * that any reader built against the fake hits this path. The drift log's rule,
 * which the overview's `Provenance` is the worked example of:
 *
 * > **Use `sourceIds` to *link* to a source; use `sourcesSnapshot` to *name*
 * > one.**
 *
 * So the name comes from the snapshot, which is frozen at generation and never
 * dangles, and `liveSourceIds` only decides whether it is still live. A deleted
 * source renders **struck through with a warning, never omitted** — a note that
 * silently dropped its attribution would be claiming the passage came from
 * nowhere.
 *
 * A `sourceId` that is null is a different thing again: the quote never had an
 * attribution, so there is nothing to say and nothing is rendered.
 */
function Attribution({
  sourceId,
  sourcesSnapshot,
  liveSourceIds,
}: {
  sourceId: string | null;
  sourcesSnapshot: SourceSnapshot[];
  liveSourceIds: ReadonlySet<string>;
}) {
  if (sourceId === null) return null;

  const named = sourcesSnapshot.find(source => source.sourceId === sourceId);
  // Not in the snapshot either: the id names something this note was never
  // recorded as being built from. Say that, rather than inventing a title.
  if (!named) {
    return (
      <figcaption className="text-muted-foreground text-xs">
        From a source that is no longer recorded
      </figcaption>
    );
  }

  const live = liveSourceIds.has(sourceId);

  return (
    <figcaption className="text-muted-foreground flex items-center gap-1.5 text-xs">
      {!live && (
        <AlertTriangleIcon className="size-3 shrink-0" aria-hidden />
      )}
      <span className={cn(!live && 'line-through')}>{named.title}</span>
      {!live && <span className="shrink-0">(deleted)</span>}
    </figcaption>
  );
}
