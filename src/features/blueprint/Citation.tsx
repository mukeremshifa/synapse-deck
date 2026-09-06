import { FileTextIcon, QuoteIcon } from 'lucide-react';

import { isGrounded, type TopicEvidence } from '@/lib/blueprint';
import { cn } from '@/lib/utils';

/**
 * One piece of evidence, shown as a citation back to the material.
 *
 * ── Why this component exists at all ──────────────────────────────────────
 *
 * Evidence used to be a list of sentences. A sentence explains; a citation
 * *proves*. "The longest section of the notes: 38 of 210 pages" is a claim the
 * user has to take on faith, and "…— SAA-C03 study notes.pdf, pp. 41-79" is one
 * they can check in ten seconds. That difference is the product's core promise:
 * the model read *your* material and can point at where.
 *
 * ── Grounded and ungrounded are rendered differently, on purpose ───────────
 *
 * `isGrounded` splits the two cases and this component never blurs them. A
 * claim with a source gets the file, the position and the quote. A claim without
 * one is shown as an assertion and visibly lacks the apparatus — no icon, no
 * attribution line, muted. The temptation is to make them look alike so the
 * drawer is tidy; that tidiness would be a lie, and it would be the exact lie
 * this feature exists to prevent.
 *
 * ── The quote is untrusted output ─────────────────────────────────────────
 *
 * `quote` reaches this component from the same place card content does: a model.
 * It is rendered as a text node inside `<blockquote>` and nothing else.
 * CLAUDE.md forbids `dangerouslySetInnerHTML` here and an ESLint rule enforces
 * it; the reason is that a passage extracted from an uploaded PDF is attacker-
 * controlled the moment a user uploads a PDF someone else wrote.
 *
 * ── Not a link, yet ───────────────────────────────────────────────────────
 *
 * `chunkIndex` is carried on the schema and deliberately not displayed. It is
 * the join back into the source text, and it becomes a link the day a source
 * viewer exists to receive one. A citation that looks clickable and is not is
 * worse than one that plainly is not.
 */
export function Citation({
  evidence,
  className,
}: {
  evidence: TopicEvidence;
  className?: string;
}) {
  const grounded = isGrounded(evidence);

  return (
    <li className={cn('text-xs leading-relaxed', className)}>
      <div className="flex items-start gap-1.5">
        {grounded ? (
          <FileTextIcon
            className="text-muted-foreground mt-0.5 size-3 shrink-0"
            aria-hidden
          />
        ) : null}
        <p className={grounded ? 'text-foreground' : 'text-muted-foreground'}>
          {evidence.claim}
        </p>
      </div>

      {/*
        The passage, in the material's own words. Indented and quoted so it
        reads as borrowed rather than asserted — the visual distinction between
        what the source says and what the model concluded from it.
      */}
      {evidence.quote ? (
        <blockquote className="text-muted-foreground mt-1.5 ml-4.5 border-l-2 pl-2.5 italic">
          <QuoteIcon className="mb-0.5 inline size-3 shrink-0" aria-hidden />{' '}
          {evidence.quote}
        </blockquote>
      ) : null}

      {grounded ? (
        <p className="text-muted-foreground mt-1 ml-4.5 font-mono text-[0.6875rem]">
          {evidence.source}
          {evidence.locator ? ` · ${evidence.locator}` : ''}
        </p>
      ) : null}
    </li>
  );
}

/**
 * A topic's evidence, with the honest empty and ungrounded cases.
 *
 * The counter is deliberately "3 of 4 traced to a source" rather than a
 * percentage: a ratio hides the difference between one thin citation and forty,
 * and the whole point of the line is to let the reader judge the weight of what
 * is behind the number.
 */
export function CitationList({
  evidence,
  emptyMessage,
}: {
  evidence: readonly TopicEvidence[];
  emptyMessage: string;
}) {
  if (evidence.length === 0) {
    return <p className="text-muted-foreground text-xs">{emptyMessage}</p>;
  }

  const grounded = evidence.filter(isGrounded).length;

  return (
    <div className="space-y-2">
      <ul className="space-y-2.5">
        {evidence.map((item, index) => (
          <Citation key={`${item.claim}-${index}`} evidence={item} />
        ))}
      </ul>

      {/*
        Only shown when something is missing. A "4 of 4" line on every topic is
        noise that trains the eye to skip it, which is precisely when the "2 of
        4" would stop being noticed.
      */}
      {grounded < evidence.length ? (
        <p className="text-muted-foreground text-[0.6875rem]">
          {grounded} of {evidence.length} traced to a source.
        </p>
      ) : null}
    </div>
  );
}
