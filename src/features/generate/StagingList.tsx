import { useEffect, useRef } from 'react';
import { AlertTriangleIcon, CheckIcon, PencilIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { CardBack, CardFront } from '@/features/cards/CardFace';
import { CardEditor } from '@/features/cards/CardEditor';
import type { CardKind, CardPayload } from '@/lib/schemas';
import { cn } from '@/lib/utils';

/**
 * One generated card, as the review gate holds it.
 *
 * Defined here rather than in a hook because the *list* is what outlived the
 * delivery mechanism: these were exported by `useGenerateCards` when cards
 * arrived over SSE, and P10 task 9 deleted that hook when `/create/text` moved
 * onto the job pipeline. The shape never depended on how the cards arrived.
 */
export type StagedCard = {
  id: string;
  index: number;
  payload: CardPayload;
  sourceExcerpt: string | null;
};

/** A card the model produced that did not survive validation. */
export type SkippedCard = { index: number; reason: string };

/**
 * The cards, as they arrive and as they are judged.
 *
 * One component for both halves of the flagship flow, because they are the same
 * list twice: during generation it fills up with skeleton rows for the cards
 * still coming (SPEC §4.1 step 4), and at the review gate the same rows grow
 * accept / reject / edit controls (step 5). Splitting them would mean two
 * renderings of a generated card that could disagree about what a card looks
 * like.
 *
 * Content is rendered by `CardFront` / `CardBack` — the components practice
 * uses — so what the gate approves is exactly what practice will show. Nothing
 * here interprets a payload itself, and nothing here renders HTML (SPEC §10).
 *
 * P6 kept that arrangement and gave the two states different *weight* rather
 * than different layouts: only the row the keyboard is on carries the accent and
 * shows its shortcuts. Twenty accent-filled Accept buttons is twenty things
 * shouting at once, and none of them tells you where you are.
 */

const KIND_LABELS: Record<CardKind, string> = {
  basic: 'Basic',
  cloze: 'Cloze',
  mcq: 'Multiple choice',
};

export type StagingListProps = {
  cards: StagedCard[];
  /** Skeleton rows for cards still on their way. */
  pending?: number;
  skipped?: SkippedCard[];
  /**
   * The row the keyboard is acting on. Only the review gate passes this; during
   * generation there is nothing to act on yet.
   */
  cursor?: number;
  onAccept?: (card: StagedCard) => void;
  onReject?: (card: StagedCard) => void;
  /** Save an edit. The parent owns the write *and* which row is open. */
  onEdit?: (card: StagedCard, payload: CardPayload) => void | Promise<void>;
  /**
   * The row whose editor is open. Controlled by the parent because the keyboard
   * shortcut that opens it (`E`) is bound to the parent's container — two
   * owners of "is an editor open" is how a keystroke ends up typed into a card
   * and interpreted as a shortcut at the same time.
   */
  editingId?: string | null;
  onEditingChange?: (cardId: string | null) => void;
  onFocusCard?: (index: number) => void;
  busyIds?: ReadonlySet<string>;
};

export function StagingList({
  cards,
  pending = 0,
  skipped = [],
  cursor,
  onAccept,
  onReject,
  onEdit,
  onFocusCard,
  busyIds,
  editingId = null,
  onEditingChange,
}: StagingListProps) {
  const interactive = Boolean(onAccept || onReject || onEdit);

  // A card being edited that then leaves the list — accepted by "accept all",
  // or rejected in another tab — must not leave an editor open over nothing.
  useEffect(() => {
    if (editingId && !cards.some(card => card.id === editingId)) onEditingChange?.(null);
  }, [cards, editingId, onEditingChange]);

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {cards.map((card, position) => (
          <li key={card.id}>
            <StagedCardRow
              card={card}
              current={cursor === position}
              editing={editingId === card.id}
              busy={busyIds?.has(card.id) ?? false}
              interactive={interactive}
              onStartEdit={onEdit ? () => onEditingChange?.(card.id) : undefined}
              onCancelEdit={() => onEditingChange?.(null)}
              onSaveEdit={
                onEdit
                  ? async payload => {
                      await onEdit(card, payload);
                      onEditingChange?.(null);
                    }
                  : undefined
              }
              onAccept={onAccept ? () => onAccept(card) : undefined}
              onReject={onReject ? () => onReject(card) : undefined}
              onFocus={onFocusCard ? () => onFocusCard(position) : undefined}
            />
          </li>
        ))}

        {Array.from({ length: Math.max(0, pending) }, (_, index) => (
          <li key={`pending-${index}`} aria-hidden>
            <Card className="py-4">
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-4/5" />
                <Skeleton className="h-5 w-2/3" />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {pending > 0 && (
        <p className="sr-only" role="status">
          {cards.length} cards so far, {pending} still coming.
        </p>
      )}

      {skipped.length > 0 && <SkippedNote skipped={skipped} />}
    </div>
  );
}

function StagedCardRow({
  card,
  current,
  editing,
  busy,
  interactive,
  onAccept,
  onReject,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onFocus,
}: {
  card: StagedCard;
  current: boolean;
  editing: boolean;
  busy: boolean;
  interactive: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  onStartEdit?: () => void;
  onCancelEdit: () => void;
  onSaveEdit?: (payload: CardPayload) => Promise<void>;
  onFocus?: () => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Keep the keyboard cursor in view when it moves past the fold.
  useEffect(() => {
    if (current && !editing) {
      rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [current, editing]);

  return (
    <Card
      ref={rowRef}
      onMouseDown={onFocus}
      className={cn(
        'gap-4 py-5 transition-colors',
        current ? 'ring-ring ring-2' : 'border-border/70 shadow-none',
        busy && 'opacity-60',
      )}
      aria-current={current ? 'true' : undefined}
    >
      <CardContent className="space-y-4">
        {editing && onSaveEdit ? (
          <CardEditor
            defaultValue={card.payload}
            submitLabel="Save card"
            autoFocus
            onCancel={onCancelEdit}
            onSubmit={async payloads => {
              const [first] = payloads;
              if (first) await onSaveEdit(first);
            }}
          />
        ) : (
          <>
            <div className="text-muted-foreground flex items-center gap-2 text-xs tracking-wide uppercase">
              <span className="font-mono normal-case tabular-nums">{card.index + 1}</span>
              <span aria-hidden>·</span>
              <span>{KIND_LABELS[card.payload.kind]}</span>
            </div>

            {/*
              Revealed on purpose: this is a review of the card's content, not a
              test of the reader. A cloze whose deletion is hidden here cannot be
              judged at all.
            */}
            <CardFront payload={card.payload} revealed />
            <CardBack payload={card.payload} />

            {card.sourceExcerpt && (
              <p className="text-muted-foreground border-l-2 pl-3 text-sm italic">
                {card.sourceExcerpt}
              </p>
            )}

            {interactive && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {onAccept && (
                  <Button
                    size="sm"
                    variant={current ? 'default' : 'outline'}
                    onClick={onAccept}
                    disabled={busy}
                  >
                    <CheckIcon /> Accept {current && <Kbd className="ml-1">A</Kbd>}
                  </Button>
                )}
                {onStartEdit && (
                  <Button size="sm" variant="ghost" onClick={onStartEdit} disabled={busy}>
                    <PencilIcon /> Edit {current && <Kbd className="ml-1">E</Kbd>}
                  </Button>
                )}
                {onReject && (
                  <Button size="sm" variant="ghost" onClick={onReject} disabled={busy}>
                    <XIcon /> Reject {current && <Kbd className="ml-1">R</Kbd>}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The cards that did not survive validation.
 *
 * Shown, not hidden: a set of 20 that quietly arrives as 18 looks like a bug in
 * the product. Shown as a plain line rather than a toast, because it is
 * information about this deck, not an event that happened once (SPEC §7.5).
 */
function SkippedNote({ skipped }: { skipped: SkippedCard[] }) {
  return (
    <div className="text-muted-foreground flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <p>
          {skipped.length === 1
            ? 'One card was skipped because it did not come back in a usable shape.'
            : `${skipped.length} cards were skipped because they did not come back in a usable shape.`}
        </p>
        <ul className="mt-1 list-disc pl-5">
          {skipped.map(entry => (
            <li key={entry.index}>{entry.reason}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
