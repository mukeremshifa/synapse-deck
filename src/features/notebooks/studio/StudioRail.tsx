import { Link } from 'react-router-dom';
import {
  ClipboardCheckIcon,
  LayersIcon,
  PlayIcon,
  SparklesIcon,
  StethoscopeIcon,
  TableIcon,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { plural } from '@/lib/format';
import { notebookPath, type Notebook } from '@/lib/notebooks';
import { cn } from '@/lib/utils';

/**
 * The right rail: what you can make from this notebook, and what is waiting.
 *
 * ── A launcher, not a container ───────────────────────────────────────────
 *
 * Each entry states the thing's current size — 142 cards, 18 due — and opens
 * it. It does not render it. See `NotebookLayout` for the reasoning; the short
 * version is that our artifacts outlive the panel and a timed exam needs the
 * screen.
 *
 * The counts are the point. A rail that just lists "Flashcards / Exam /
 * Practice" is a menu; one that says "18 due" is a reason to click, and in a
 * spaced-repetition product the due count is the single most actionable number
 * the app has.
 */

function StudioEntry({
  icon: Icon,
  title,
  detail,
  to,
  onClick,
  emphasis,
  disabled,
  disabledReason,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  to?: string;
  onClick?: () => void;
  /** The one entry worth doing right now, if there is one. */
  emphasis?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const inner = (
    <>
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          emphasis ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block text-xs">
          {disabled ? (disabledReason ?? detail) : detail}
        </span>
      </span>
    </>
  );

  const className = cn(
    'flex w-full items-center gap-3 rounded-lg border p-3 transition-colors',
    'focus-visible:ring-ring outline-none focus-visible:ring-2',
    disabled
      ? 'cursor-not-allowed opacity-60'
      : 'hover:bg-accent hover:border-foreground/20',
  );

  if (disabled) {
    return (
      <div className={className} aria-disabled>
        {inner}
      </div>
    );
  }

  if (to) {
    return (
      <Link to={to} className={className}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" className={className} onClick={onClick}>
      {inner}
    </button>
  );
}

export function StudioRail({
  notebook,
  onGenerate,
}: {
  notebook: Notebook;
  onGenerate: () => void;
}) {
  const ready = notebook.dueCount + notebook.newCount;
  const hasCards = notebook.cardCount > 0;

  return (
    <div className="space-y-4 p-3">
      <div className="space-y-2">
        <Button className="w-full justify-start" onClick={onGenerate}>
          <SparklesIcon aria-hidden /> Generate cards
        </Button>
      </div>

      <div className="space-y-2">
        <StudioEntry
          icon={PlayIcon}
          title="Practice"
          detail={
            ready > 0
              ? `${ready} ready now`
              : hasCards
                ? 'Nothing due — you are caught up'
                : 'No cards yet'
          }
          to={notebookPath.practice(notebook.id)}
          emphasis={ready > 0}
          disabled={ready === 0}
          disabledReason={
            hasCards ? 'Nothing due — you are caught up' : 'Generate some cards first'
          }
        />

        <StudioEntry
          icon={ClipboardCheckIcon}
          title="Exam"
          detail="Sit a timed exam on this material"
          to={notebookPath.exam(notebook.id)}
          disabled={!hasCards}
          disabledReason="Generate some cards first"
        />

        <StudioEntry
          icon={LayersIcon}
          title="Cards"
          detail={hasCards ? plural(notebook.cardCount, 'card') : 'No cards yet'}
          to={notebookPath.cards(notebook.id)}
          disabled={!hasCards}
          disabledReason="Nothing to browse yet"
        />
      </div>

      {/*
        The exam half of the loop. Separated by a rule rather than mixed into
        the list above, because these two are about *planning and reviewing*
        study while the three above are about doing it — and a rail that mixes
        "practise 18 cards now" with "look at what an exam would weigh" makes
        the daily action harder to find.

        Both run on sample data today and say so on arrival rather than here:
        a disabled entry would hide the two most distinctive screens in the
        product, and a caveat in a 320px rail is a caveat nobody reads.
      */}
      <div className="space-y-2 border-t pt-4">
        <StudioEntry
          icon={TableIcon}
          title="Exam blueprint"
          detail="What an exam here should weigh"
          to={notebookPath.blueprint(notebook.id)}
        />
        <StudioEntry
          icon={StethoscopeIcon}
          title="Diagnostic"
          detail="Topic mastery, and what to do next"
          to={notebookPath.diagnostic(notebook.id)}
        />
      </div>

      {/*
        The way back into an abandoned generation. Only rendered when there is
        one, and it is the last thing in the rail because it is a recovery path
        rather than something you do daily. See P11 §5.3 — `deck_status`.
      */}
      {notebook.resumable ? (
        <div className="border-t pt-4">
          <Button variant="outline" size="sm" className="w-full" asChild>
            <Link to={notebookPath.gate(notebook.id)}>Finish reviewing drafts</Link>
          </Button>
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            This notebook has cards that were generated but never accepted.
          </p>
        </div>
      ) : null}
    </div>
  );
}
