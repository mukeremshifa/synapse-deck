import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangleIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ArtifactKind,
  type ArtifactKind as ArtifactKindType,
  type CreateArtifactInput,
  type Source,
} from '@/lib/api';
// The limits are shared with the server, per CLAUDE.md's one-definition rule:
// the form clamps to the same numbers the contract validates against.
import { EXAM_LIMITS, GENERATION_LIMITS, NOTESET_LIMITS } from '@/lib/schemas';
import { useModal } from '@/app/modals';
import { failureFromError } from './generation-errors';
import { useCreateArtifact, useSources } from './queries';

/**
 * Generate an artifact from this notebook's sources. **FR4 task 1.**
 *
 * ═══ One modal, four kinds ═══════════════════════════════════════════════
 *
 * The plan says "one per artifact kind", and this is that — but as one
 * component with a kind-specific middle, not four files. What differs between
 * the kinds is a handful of numeric options; what they share is everything
 * else: the title, **source selection**, the depth, the submit path, the error
 * handling, and the rule that a foreign source id is rejected rather than
 * dropped. Four files would be four copies of the shared two thirds, and the
 * first change to source selection would land in one of them.
 *
 * The kind-specific part is `<KindOptions>`, and it is a `switch` on the
 * contract's discriminated union — so a fifth kind added to `ArtifactKind`
 * fails to compile here until it has a form. That is the same property brief
 * §1.1 wants from the model: a new feature is a new kind, and the places that
 * must learn about it say so.
 *
 * ── Source selection is the piece with no precedent ──────────────────────
 *
 * The old flow took *one document* and made a *notebook*. Here the user picks
 * from **this notebook's** sources and the chosen ids become the artifact's
 * `sourceIds`, which the server snapshots. Three rules follow, all of them
 * visible below:
 *
 * 1. **Only this notebook's sources** (brief §1.2(6)). The list is
 *    `useSources(notebookId)` and there is no way to reach another notebook's —
 *    the contract's server rejects a foreign id rather than silently dropping
 *    it, so a UI that could offer one would be building a failed request.
 * 2. **Only `ready` sources can be chosen.** A `processing` source has no
 *    extracted text yet and a `failed` one never will. Both are shown, disabled,
 *    with the reason — offering them and failing is what the contract's own
 *    note about `status` exists to prevent.
 * 3. **At least one source.** Generation from nothing is not a request worth
 *    sending, so submit is disabled and says why.
 *
 * ── The address ──────────────────────────────────────────────────────────
 *
 * `?modal=generate&kind=<ArtifactKind>`, which is FR3's contract and unchanged.
 * `kind` is **validated, never trusted** — a modal's params are user-editable
 * text — and a hand-typed `?kind=nonsense` falls back to a chooser rather than
 * throwing. That was FR3's behaviour and the plan says to keep both.
 */
export function GenerateModal({ notebookId }: { notebookId: string }) {
  const { modalProps, modalParam, closeModal } = useModal();

  // Never trusted: a modal's params are user-editable text (FR3, `modals.tsx`).
  const parsed = ArtifactKind.safeParse(modalParam('kind'));
  const kind = parsed.success ? parsed.data : null;

  return (
    <Dialog {...modalProps('generate')}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {kind === null ? (
          <UnknownKind onClose={closeModal} />
        ) : (
          /*
           * Remount when the kind changes: the form holds a working copy of the
           * options, and a quiz's question count is not an exam's. Without the
           * key, reopening for another kind would carry the previous one's
           * state into a form that no longer has those fields.
           */
          <GenerateForm
            key={kind}
            kind={kind}
            notebookId={notebookId}
            onClose={closeModal}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** What the user sees when the URL names a kind that does not exist. */
function UnknownKind({ onClose }: { onClose: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Generate</DialogTitle>
        <DialogDescription>
          This link asks for something this notebook cannot make.
        </DialogDescription>
      </DialogHeader>
      <p className="text-muted-foreground py-base text-sm leading-relaxed">
        Close this and choose Quiz, Cards, Notes or Exam simulator from the Studio.
      </p>
      <DialogFooter>
        <Button onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  );
}

/** The words the Studio uses for each kind. One vocabulary, both surfaces. */
const KIND_LABELS: Record<ArtifactKindType, { title: string; blurb: string }> = {
  deck: {
    title: 'New cards',
    blurb: 'Spaced repetition over the sources you choose.',
  },
  quiz: {
    title: 'New quiz',
    blurb: 'Questions to check yourself with. Untimed, and repeatable.',
  },
  noteset: {
    title: 'New note set',
    blurb: 'A structured reading of one source, in as many topics as you choose.',
  },
  exam: {
    title: 'New exam',
    blurb: 'A timed paper, weighted by a blueprint.',
  },
};

/**
 * The options each kind carries, as the state this form holds.
 *
 * One flat shape rather than a union, because a form's working copy is not the
 * request: the user switches nothing here, but keeping `cardCount` alongside
 * `questionCount` means the fields a kind does not use simply go unread. The
 * *request* is built by `toInput` below, and that is where the discriminated
 * union is honoured — one place, checked by the compiler.
 */
interface Options {
  title: string;
  cardCount: number;
  cardKinds: ('basic' | 'cloze' | 'mcq')[];
  questionCount: number;
  topicCount: number;
  depth: 'recall' | 'balanced' | 'deep';
  durationMinutes: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  focusMode: boolean;
}

const DEFAULTS: Options = {
  title: '',
  cardCount: 20,
  cardKinds: ['basic', 'cloze'],
  questionCount: 10,
  topicCount: 5,
  depth: 'balanced',
  durationMinutes: 20,
  shuffleQuestions: true,
  shuffleOptions: true,
  focusMode: true,
};

function GenerateForm({
  kind,
  notebookId,
  onClose,
}: {
  kind: ArtifactKindType;
  notebookId: string;
  onClose: () => void;
}) {
  const sources = useSources(notebookId);
  const create = useCreateArtifact(notebookId);

  const [options, setOptions] = useState<Options>(DEFAULTS);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const set = <K extends keyof Options>(key: K, value: Options[K]) => {
    setOptions(current => ({ ...current, [key]: value }));
  };

  const ready = useMemo(
    () => (sources.data ?? []).filter(source => source.status === 'ready'),
    [sources.data],
  );

  /**
   * **A note set takes exactly one source; every other kind takes many.**
   *
   * The contract is what forces this (`sourceIds.length(1)`), and the reason is
   * in §4.2: a note set is a structured reading *of a resource*, so its topics
   * are that resource's topics. The modal enforces it by construction rather
   * than by validating afterwards — the picker below renders radios instead of
   * checkboxes — because a form that lets you tick four things and then refuses
   * is a form that wasted your time.
   */
  const singleSource = kind === 'noteset';

  /*
   * Preselected — the common case is "generate from what I have", and a modal
   * that opens with nothing ticked makes the user do work to express the
   * default. Everything ready, or **the first ready one** when only one is
   * allowed. Runs when the ready set changes, so a source that finishes
   * processing while the modal is open joins the selection rather than
   * appearing silently unticked.
   */
  useEffect(() => {
    if (singleSource) {
      const first = ready[0];
      // Preserved across a re-run so a deliberate choice is not overwritten
      // when another source finishes processing behind the modal.
      setSelected(current =>
        current.size === 1 && ready.some(source => current.has(source.id))
          ? current
          : new Set(first ? [first.id] : []),
      );
      return;
    }
    setSelected(new Set(ready.map(source => source.id)));
  }, [ready, singleSource]);

  const toggle = (sourceId: string) => {
    // Choosing replaces rather than adds when only one is allowed.
    if (singleSource) {
      setSelected(new Set([sourceId]));
      return;
    }
    setSelected(current => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  const sourceIds = [...selected];
  const title = options.title.trim();
  const canSubmit = sourceIds.length > 0 && title.length > 0 && !create.isPending;

  const submit = () => {
    if (!canSubmit) return;
    create.mutate(toInput(kind, { ...options, title }, sourceIds), {
      onSuccess: job => {
        onClose();
        /*
         * A job can come back **already failed** — a quota refusal is decided
         * at submission, so `createArtifact` resolves with a failed job rather
         * than rejecting. Announcing "Generation started" there would be the
         * toast contradicting the panel that is already showing the refusal.
         * Found in a browser.
         *
         * The failure itself is not repeated in a toast: the Studio panel
         * states it in full, with what the user can do about it, and a toast
         * saying the same thing worse would be gone in four seconds.
         */
        if (job.status === 'failed') return;
        /*
         * "Generating", not "Created": `createArtifact` returns a **job**, and
         * the artifact is not usable when this resolves. Saying "Created" would
         * be the toast contradicting the Studio, which shows the row greyed and
         * unopenable with its progress underneath.
         */
        toast.success('Generation started', {
          description: 'It appears in the Studio as it builds.',
        });
      },
      onError: (error: unknown) => {
        /*
         * A failure *starting* a job — a quota refusal is the common one, and
         * it arrives here rather than as a failed job because the server
         * refuses at submission. The modal stays open: the user's choices are
         * still on screen and still valid, which is what makes "wait and try
         * again" a real option rather than a re-entry of the whole form.
         */
        const failure = failureFromError(error);
        toast.error(failure.title, { description: failure.detail });
      },
    });
  };

  const labels = KIND_LABELS[kind];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{labels.title}</DialogTitle>
        <DialogDescription>{labels.blurb}</DialogDescription>
      </DialogHeader>

      <div className="gap-base py-base flex flex-col">
        <div className="gap-tight flex flex-col">
          <Label htmlFor="generate-title">Title</Label>
          <Input
            id="generate-title"
            autoFocus
            value={options.title}
            maxLength={200}
            placeholder={PLACEHOLDERS[kind]}
            onChange={event => {
              set('title', event.target.value);
            }}
          />
        </div>

        <SourcePicker
          sources={sources.data}
          isPending={sources.isPending}
          selected={selected}
          singleSource={singleSource}
          onToggle={toggle}
          onSelectAll={() => {
            setSelected(new Set(ready.map(source => source.id)));
          }}
          onSelectNone={() => {
            setSelected(new Set());
          }}
        />

        <KindOptions kind={kind} options={options} set={set} />
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={!canSubmit} onClick={submit}>
          {create.isPending ? 'Starting…' : 'Generate'}
        </Button>
      </DialogFooter>

      {/*
        Why the button is disabled, said rather than left to be worked out. A
        disabled control with no explanation is the most common way a form
        becomes a dead end.
      */}
      {!create.isPending && (sourceIds.length === 0 || title.length === 0) && (
        <p className="text-muted-foreground text-xs">
          {title.length === 0
            ? 'Give this a title to generate it.'
            : singleSource
              ? 'Choose the source these notes are about.'
              : 'Choose at least one source to generate from.'}
        </p>
      )}
    </>
  );
}

const PLACEHOLDERS: Record<ArtifactKindType, string> = {
  deck: 'Beta-lactams — core cards',
  quiz: 'Week 3 self-check',
  noteset: 'Antibiotic resistance — summary',
  exam: 'Pharmacology mock paper',
};

/**
 * Which sources this artifact is built from.
 *
 * **A source that is not `ready` is shown and disabled, never hidden.** Hiding
 * it means a user who just added a document finds their new source missing with
 * no explanation and assumes the upload failed. Showing it disabled, with its
 * status, says the thing that is actually true: it is here, it is not usable
 * yet, and it will be shortly.
 */
function SourcePicker({
  sources,
  isPending,
  selected,
  singleSource,
  onToggle,
  onSelectAll,
  onSelectNone,
}: {
  sources: Source[] | undefined;
  isPending: boolean;
  selected: ReadonlySet<string>;
  /** One source only — a note set. Radios, and no All/None. */
  singleSource: boolean;
  onToggle: (sourceId: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}) {
  if (isPending) {
    return (
      <p className="text-muted-foreground text-sm">Loading this notebook’s sources…</p>
    );
  }

  const all = sources ?? [];
  if (all.length === 0) {
    return (
      <div className="border-border p-snug rounded-md border border-dashed">
        <p className="text-muted-foreground text-sm leading-relaxed">
          This notebook has no sources yet. Add one first — everything generated here is
          built from them.
        </p>
      </div>
    );
  }

  return (
    <div className="gap-tight flex flex-col">
      <div className="gap-tight flex items-center">
        <Label>{singleSource ? 'Source' : 'Sources'}</Label>
        {/*
          **No count and no All/None when only one is allowed** — "1 of 4" reads
          as a selection the user is part way through making, and an "All"
          button offers something the contract forbids.
        */}
        {!singleSource && (
          <>
            <span className="text-muted-foreground text-xs tabular-nums">
              {selected.size} of {all.filter(source => source.status === 'ready').length}
            </span>
            <div className="gap-hairline ml-auto flex">
              <Button type="button" variant="ghost" size="sm" onClick={onSelectAll}>
                All
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onSelectNone}>
                None
              </Button>
            </div>
          </>
        )}
      </div>

      {singleSource && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          Notes are written about one resource, so its sections are that resource&rsquo;s
          sections.
        </p>
      )}

      <ul className="border-border gap-hairline p-tight flex max-h-48 flex-col overflow-y-auto rounded-md border">
        {all.map(source => {
          const usable = source.status === 'ready';
          return (
            <li key={source.id}>
              <label
                className={
                  usable
                    ? 'hover:bg-accent gap-tight p-hairline flex cursor-pointer items-start rounded-sm'
                    : 'gap-tight p-hairline flex items-start rounded-sm opacity-60'
                }
              >
                {/*
                  A **radio** when one source is allowed, and a checkbox when
                  many are. Not a styling choice: the control is what tells the
                  user, before they touch it, that choosing here replaces rather
                  than adds. A checkbox that silently unticks its neighbour is
                  the control lying about what it does.
                */}
                {singleSource ? (
                  <input
                    type="radio"
                    name="generate-source"
                    className="accent-primary mt-0.5 size-4 shrink-0"
                    disabled={!usable}
                    checked={selected.has(source.id)}
                    onChange={() => {
                      onToggle(source.id);
                    }}
                  />
                ) : (
                  <Checkbox
                    className="mt-0.5"
                    disabled={!usable}
                    checked={selected.has(source.id)}
                    onCheckedChange={() => {
                      onToggle(source.id);
                    }}
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{source.title}</span>
                  {!usable && (
                    <span className="text-muted-foreground block text-xs">
                      {source.status === 'processing'
                        ? 'Still processing — not usable yet'
                        : (source.error ?? 'This source could not be read')}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The kind-specific options.
 *
 * A `switch` over the contract's union, with no `default` — so adding a fifth
 * artifact kind is a compile error here rather than a modal that silently
 * offers nothing to configure.
 */
function KindOptions({
  kind,
  options,
  set,
}: {
  kind: ArtifactKindType;
  options: Options;
  set: <K extends keyof Options>(key: K, value: Options[K]) => void;
}) {
  switch (kind) {
    case 'deck':
      return (
        <>
          <NumberField
            id="generate-card-count"
            label="Cards"
            value={options.cardCount}
            min={GENERATION_LIMITS.minCards}
            max={GENERATION_LIMITS.maxCards}
            onChange={value => {
              set('cardCount', value);
            }}
          />
          <CardKindsField
            value={options.cardKinds}
            onChange={value => {
              set('cardKinds', value);
            }}
          />
          <DepthField
            value={options.depth}
            onChange={value => {
              set('depth', value);
            }}
          />
        </>
      );

    case 'quiz':
      return (
        <>
          {/*
            Question count only. **A quiz is untimed** (brief §1.2(3)) — it is
            training material you repeat, and adding a duration here is the
            first step toward the "one kind with a flag" the brief rejects.
          */}
          <NumberField
            id="generate-question-count"
            label="Questions"
            value={options.questionCount}
            min={1}
            max={50}
            onChange={value => {
              set('questionCount', value);
            }}
          />
          <DepthField
            value={options.depth}
            onChange={value => {
              set('depth', value);
            }}
          />
        </>
      );

    case 'noteset':
      return (
        <>
          {/*
            **Topics of the one chosen resource, not a number of resources.**
            The count is the number of sections written, and so also the number
            of things the reader will be asked to tick off — which is why the
            ceiling is 12 rather than the 50 a deck allows (`NOTESET_LIMITS`).
          */}
          <NumberField
            id="generate-topic-count"
            label="Topics"
            value={options.topicCount}
            min={NOTESET_LIMITS.minTopics}
            max={NOTESET_LIMITS.maxTopics}
            onChange={value => {
              set('topicCount', value);
            }}
          />
          <DepthField
            value={options.depth}
            onChange={value => {
              set('depth', value);
            }}
          />
        </>
      );

    case 'exam':
      return (
        <>
          <NumberField
            id="generate-exam-questions"
            label="Questions"
            value={options.questionCount}
            min={EXAM_LIMITS.minQuestions}
            max={EXAM_LIMITS.maxQuestions}
            onChange={value => {
              set('questionCount', value);
            }}
          />
          <DurationField
            value={options.durationMinutes}
            onChange={value => {
              set('durationMinutes', value);
            }}
          />
          <ExamToggles options={options} set={set} />
          {/*
            **The blueprint is deliberately not edited here.** It belongs to the
            exam (brief §1.2(9)), and the contract makes it optional on create
            with a documented meaning: omitted means "weight it for me", and the
            server derives the weights from card counts. Asking a user to
            allocate questions across topics *before the exam exists* is asking
            them to blueprint something they cannot see — which is the exact
            problem per-exam blueprints were introduced to fix. Editing it comes
            with the exam, in FR5/FR6.
          */}
          <p className="text-muted-foreground text-xs leading-relaxed">
            Questions are weighted across this notebook’s topics automatically. The
            blueprint belongs to the exam, and you can adjust it once it exists.
          </p>
        </>
      );
  }
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="gap-tight flex flex-col">
      <Label htmlFor={id}>
        {label}{' '}
        <span className="text-muted-foreground font-normal">
          ({min}–{max})
        </span>
      </Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={event => {
          const next = Number(event.target.value);
          // Clamped rather than validated-on-submit: the limits are shared with
          // the server, so a value outside them is a request that cannot succeed.
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
    </div>
  );
}

/** Which card shapes to write. At least one, because zero generates nothing. */
function CardKindsField({
  value,
  onChange,
}: {
  value: ('basic' | 'cloze' | 'mcq')[];
  onChange: (value: ('basic' | 'cloze' | 'mcq')[]) => void;
}) {
  return (
    <div className="gap-tight flex flex-col">
      <Label>Card types</Label>
      <ToggleGroup
        type="multiple"
        value={value}
        onValueChange={(next: string[]) => {
          // The contract requires at least one. Ignoring an empty selection
          // keeps the last valid one rather than letting the form reach a state
          // the server would reject.
          if (next.length > 0) onChange(next as ('basic' | 'cloze' | 'mcq')[]);
        }}
      >
        <ToggleGroupItem value="basic" size="sm">
          Basic
        </ToggleGroupItem>
        <ToggleGroupItem value="cloze" size="sm">
          Cloze
        </ToggleGroupItem>
        <ToggleGroupItem value="mcq" size="sm">
          Multiple choice
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

/** How hard the material should be. Shared by every kind that generates prose. */
function DepthField({
  value,
  onChange,
}: {
  value: Options['depth'];
  onChange: (value: Options['depth']) => void;
}) {
  return (
    <div className="gap-tight flex flex-col">
      <Label>Depth</Label>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(next: string) => {
          if (next === 'recall' || next === 'balanced' || next === 'deep') onChange(next);
        }}
      >
        <ToggleGroupItem value="recall" size="sm">
          Recall
        </ToggleGroupItem>
        <ToggleGroupItem value="balanced" size="sm">
          Balanced
        </ToggleGroupItem>
        <ToggleGroupItem value="deep" size="sm">
          Deep
        </ToggleGroupItem>
      </ToggleGroup>
      <p className="text-muted-foreground text-xs">
        {value === 'recall'
          ? 'Facts and definitions, as they are stated.'
          : value === 'deep'
            ? 'Application and reasoning across sources.'
            : 'A mix of recall and understanding.'}
      </p>
    </div>
  );
}

/**
 * How long the exam runs. **Timed is the point of an exam** (brief §1.2(3)),
 * but the contract allows null, so untimed is offered rather than faked.
 */
function DurationField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="gap-tight flex flex-col">
      <Label htmlFor="generate-duration">Time limit</Label>
      <Select
        id="generate-duration"
        value={value === null ? 'none' : String(value)}
        onChange={event => {
          onChange(event.target.value === 'none' ? null : Number(event.target.value));
        }}
      >
        <option value="none">Untimed</option>
        {[15, 20, 30, 45, 60, 90, 120].map(minutes => (
          <option key={minutes} value={minutes}>
            {minutes} minutes
          </option>
        ))}
      </Select>
    </div>
  );
}

function ExamToggles({
  options,
  set,
}: {
  options: Options;
  set: <K extends keyof Options>(key: K, value: Options[K]) => void;
}) {
  return (
    <div className="gap-tight flex flex-col">
      <CheckRow
        id="generate-shuffle-questions"
        label="Shuffle questions"
        checked={options.shuffleQuestions}
        onChange={next => {
          set('shuffleQuestions', next);
        }}
      />
      <CheckRow
        id="generate-shuffle-options"
        label="Shuffle answer options"
        checked={options.shuffleOptions}
        onChange={next => {
          set('shuffleOptions', next);
        }}
      />
      <CheckRow
        id="generate-focus-mode"
        label="Focus mode"
        checked={options.focusMode}
        onChange={next => {
          set('focusMode', next);
        }}
      />
      {/*
        Named honestly, and the naming is deliberate (brief §2, #5). Browser
        lockdown is trivially defeated — a second device, a phone camera — so
        this says what it does rather than claiming to prevent anything.
      */}
      <p className="text-muted-foreground gap-hairline flex items-start text-xs leading-relaxed">
        <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
        Focus mode is full-screen with locked navigation and auto-submit. It makes an exam
        feel like an exam; it is not anti-cheating.
      </p>
    </div>
  );
}

function CheckRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="gap-tight flex cursor-pointer items-center">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={next => {
          onChange(next === true);
        }}
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

/**
 * The form's flat working copy, as the contract's discriminated union.
 *
 * **This is the one place the union is built**, which is what keeps the form
 * simple and the request correct: every field a kind does not use is simply not
 * read here, and the compiler checks that each branch produces a complete,
 * valid `CreateArtifactInput` for its kind.
 *
 * `blueprint` is omitted for an exam on purpose — the contract documents the
 * omission as "weight it for me", and `KindOptions` explains why that is the
 * right default at creation time.
 */
function toInput(
  kind: ArtifactKindType,
  options: Options,
  sourceIds: string[],
): CreateArtifactInput {
  switch (kind) {
    case 'deck':
      return {
        kind: 'deck',
        title: options.title,
        sourceIds,
        cardCount: options.cardCount,
        cardKinds: options.cardKinds,
        depth: options.depth,
      };
    case 'quiz':
      return {
        kind: 'quiz',
        title: options.title,
        sourceIds,
        questionCount: options.questionCount,
        depth: options.depth,
      };
    case 'noteset':
      return {
        kind: 'noteset',
        title: options.title,
        sourceIds,
        topicCount: options.topicCount,
        depth: options.depth,
      };
    case 'exam':
      return {
        kind: 'exam',
        title: options.title,
        sourceIds,
        config: {
          questionCount: options.questionCount,
          durationMinutes: options.durationMinutes,
          shuffleQuestions: options.shuffleQuestions,
          shuffleOptions: options.shuffleOptions,
          focusMode: options.focusMode,
        },
      };
  }
}
