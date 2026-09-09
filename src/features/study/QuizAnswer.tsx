import { useMemo } from 'react';
import { CheckIcon, GripVerticalIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  gradeResponse,
  shuffledOrder,
  splitBlank,
  type CategorizePayload,
  type FillBlankPayload,
  type MatchingPayload,
  type McqPayload,
  type MsqPayload,
  type NumericPayload,
  type OrderingPayload,
  type QuestionPayload,
  type QuestionResponse,
  type TrueFalsePayload,
} from '@/lib/schemas';
import { cn } from '@/lib/utils';

/**
 * The answer surface for one quiz question, whatever kind it is.
 *
 * ── Why one component with a switch, when the runners are two ─────────────
 *
 * FR5 §3 forbids one *runner* with a `timed` flag, and `QuizOptions` — which
 * this replaces — recorded why the quiz and the exam do not share a renderer:
 * **a quiz reveals and an exam does not**, so a single component branching on
 * `revealed` would put the exam's correctness behind a branch that is dead in
 * the exam and live in the quiz.
 *
 * That argument is about *reveal*, and it is untouched. This switches on
 * `payload.kind`, which is a different axis: eight kinds is eight input shapes
 * — radios, checkboxes, a number field, two columns, a reorderable list, a
 * blank inside a sentence, a set of buckets — and they are the same eight in
 * both surfaces. Splitting on kind *as well* would mean sixteen components and
 * sixteen chances for the exam's checkbox to drift from the quiz's. So: one
 * component per surface, switching on kind.
 *
 * ── Presentation order is resolved once, and this is where ────────────────
 *
 * `matching`'s right column and `ordering`'s items are stored **in the correct
 * order** — the payload is its own answer key. Rendering them as stored would
 * hand over the answer, so both are shuffled here, memoised on the question id
 * so a re-render does not reshuffle beneath a candidate mid-answer.
 *
 * Every index in a `QuestionResponse` is into the **presented** order for
 * exactly this reason (see the contract). `presentedToStored` is the
 * permutation, and grading maps back through it before comparing to the key.
 */
export function QuizAnswer({
  questionId,
  payload,
  response,
  onRespond,
  revealed,
}: {
  questionId: string;
  payload: QuestionPayload;
  response: QuestionResponse | null;
  onRespond: (response: QuestionResponse) => void;
  revealed: boolean;
}) {
  switch (payload.kind) {
    case 'mcq':
      return (
        <ChoiceAnswer
          questionId={questionId}
          payload={payload}
          response={response}
          onRespond={onRespond}
          revealed={revealed}
        />
      );
    case 'msq':
      return (
        <ChoiceAnswer
          questionId={questionId}
          payload={payload}
          response={response}
          onRespond={onRespond}
          revealed={revealed}
        />
      );
    case 'true_false':
      return (
        <TrueFalseAnswer payload={payload} response={response} onRespond={onRespond} revealed={revealed} />
      );
    case 'numeric':
      return (
        <NumericAnswer payload={payload} response={response} onRespond={onRespond} revealed={revealed} />
      );
    case 'matching':
      return (
        <MatchingAnswer
          questionId={questionId}
          payload={payload}
          response={response}
          onRespond={onRespond}
          revealed={revealed}
        />
      );
    case 'ordering':
      return (
        <OrderingAnswer
          questionId={questionId}
          payload={payload}
          response={response}
          onRespond={onRespond}
          revealed={revealed}
        />
      );
    case 'fill_blank':
      return (
        <FillBlankAnswer
          payload={payload}
          response={response}
          onRespond={onRespond}
          revealed={revealed}
        />
      );
    case 'categorize':
      return (
        <CategorizeAnswer
          questionId={questionId}
          payload={payload}
          response={response}
          onRespond={onRespond}
          revealed={revealed}
        />
      );
  }
}

/* ── Shared option row ─────────────────────────────────────────────────── */

/**
 * One selectable option, for both `mcq` and `msq`.
 *
 * The colour rule is `QuizOptions`' and is kept verbatim, because it was right:
 * **neutral means "you picked this", the accent is reserved for "this is the
 * answer"**, so the two never have to be told apart by shade. That matters more
 * with checkboxes than it did with radios — a multi-select reveal shows a
 * correct-and-chosen, a correct-and-missed and a wrong-and-chosen at once, and
 * only the middle one is distinguishable by colour alone.
 */
function OptionRow({
  label,
  text,
  multiple,
  name,
  checked,
  correct,
  revealed,
  onToggle,
}: {
  label: string;
  text: string;
  multiple: boolean;
  name: string;
  checked: boolean;
  correct: boolean;
  revealed: boolean;
  onToggle: () => void;
}) {
  const showAsCorrect = revealed && correct;
  const showAsWrong = revealed && checked && !correct;
  // Correct, and they did not pick it. Only reachable on a multi-select, and
  // unlabelled it reads as an ordinary correct row — which would tell someone
  // they found an answer they missed.
  const showAsMissed = revealed && correct && !checked && multiple;

  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 text-sm transition-colors',
        'has-[:focus-visible]:ring-ring has-[:focus-visible]:border-ring has-[:focus-visible]:ring-2',
        revealed ? 'cursor-default' : 'hover:bg-accent/50 cursor-pointer',
        checked && !revealed && 'border-foreground bg-accent',
        showAsCorrect && 'border-primary bg-primary/20',
        showAsWrong && 'border-destructive/60 bg-destructive/10',
      )}
    >
      <input
        type={multiple ? 'checkbox' : 'radio'}
        name={name}
        className="sr-only"
        checked={checked}
        disabled={revealed}
        onChange={onToggle}
      />
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center border text-xs font-medium',
          multiple ? 'rounded-md' : 'rounded-full',
          checked && !revealed && 'border-foreground bg-foreground text-background',
          showAsCorrect && 'border-primary bg-primary text-primary-foreground',
          showAsWrong && 'border-destructive bg-destructive text-white',
        )}
      >
        {showAsCorrect ? (
          <CheckIcon className="size-3" />
        ) : showAsWrong ? (
          <XIcon className="size-3" />
        ) : (
          label
        )}
      </span>
      <span className="flex-1 whitespace-pre-wrap">{text}</span>
      {showAsCorrect && (
        <span
          className={cn(
            'rounded-sm px-1.5 py-0.5 text-xs font-semibold',
            showAsMissed
              ? 'bg-primary/20 text-primary'
              : 'bg-primary text-primary-foreground',
          )}
        >
          {showAsMissed ? 'Missed' : 'Correct'}
        </span>
      )}
    </label>
  );
}

/* ── mcq and msq ───────────────────────────────────────────────────────── */

function ChoiceAnswer({
  questionId,
  payload,
  response,
  onRespond,
  revealed,
}: {
  questionId: string;
  payload: McqPayload | MsqPayload;
  response: QuestionResponse | null;
  onRespond: (response: QuestionResponse) => void;
  revealed: boolean;
}) {
  const multiple = payload.kind === 'msq';
  const chosen = new Set<number>(
    response?.kind === 'mcq'
      ? [response.option]
      : response?.kind === 'msq'
        ? response.options
        : [],
  );

  const toggle = (index: number) => {
    if (revealed) return;
    if (!multiple) {
      onRespond({ kind: 'mcq', option: index });
      return;
    }
    // A multi-select accumulates rather than replacing, and stays sorted so
    // two responses with the same options are the same value.
    const next = new Set(chosen);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onRespond({ kind: 'msq', options: [...next].sort((a, b) => a - b) });
  };

  return (
    <div className="space-y-2">
      {multiple && (
        <p className="text-muted-foreground text-xs font-medium">
          Select all that apply — then confirm.
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className="sr-only">
          {multiple ? 'Select every correct answer' : 'Choose an answer'}
        </legend>
        {payload.options.map((option, index) => (
          <OptionRow
            key={index}
            label={String.fromCharCode(65 + index)}
            text={option.text}
            multiple={multiple}
            name={`question-${questionId}`}
            checked={chosen.has(index)}
            correct={option.correct}
            revealed={revealed}
            onToggle={() => toggle(index)}
          />
        ))}
      </fieldset>
    </div>
  );
}

/* ── true / false ──────────────────────────────────────────────────────── */

function TrueFalseAnswer({
  payload,
  response,
  onRespond,
  revealed,
}: {
  payload: TrueFalsePayload;
  response: QuestionResponse | null;
  onRespond: (response: QuestionResponse) => void;
  revealed: boolean;
}) {
  const chosen = response?.kind === 'true_false' ? response.value : null;

  return (
    <fieldset className="grid grid-cols-2 gap-3">
      <legend className="sr-only">True or false</legend>
      {[true, false].map(value => {
        const isChosen = chosen === value;
        const showAsCorrect = revealed && payload.answer === value;
        const showAsWrong = revealed && isChosen && payload.answer !== value;

        return (
          <button
            key={String(value)}
            type="button"
            disabled={revealed}
            aria-pressed={isChosen}
            onClick={() => onRespond({ kind: 'true_false', value })}
            className={cn(
              'focus-visible:ring-ring flex items-center justify-center gap-2 rounded-lg border p-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
              revealed ? 'cursor-default' : 'hover:bg-accent/50 cursor-pointer',
              isChosen && !revealed && 'border-foreground bg-accent',
              showAsCorrect && 'border-primary bg-primary/20',
              showAsWrong && 'border-destructive/60 bg-destructive/10',
            )}
          >
            {showAsCorrect && <CheckIcon className="text-primary size-4" />}
            {showAsWrong && <XIcon className="text-destructive size-4" />}
            {value ? 'True' : 'False'}
          </button>
        );
      })}
    </fieldset>
  );
}

/* ── numeric ───────────────────────────────────────────────────────────── */

function NumericAnswer({
  payload,
  response,
  onRespond,
  revealed,
}: {
  payload: NumericPayload;
  response: QuestionResponse | null;
  onRespond: (response: QuestionResponse) => void;
  revealed: boolean;
}) {
  const raw = response?.kind === 'numeric' ? response.raw : '';

  /*
   * Parsed on every keystroke, kept raw alongside.
   *
   * `Number('')` is 0 and `Number(' ')` is 0, both of which would record an
   * empty box as a confident answer of zero — so the empty case is checked
   * before parsing rather than trusted to `Number`.
   */
  const change = (next: string) => {
    if (revealed) return;
    const trimmed = next.trim();
    const parsed = trimmed === '' ? Number.NaN : Number(trimmed);
    onRespond({
      kind: 'numeric',
      value: Number.isFinite(parsed) ? parsed : null,
      raw: next.slice(0, 100),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          type="text"
          inputMode="decimal"
          value={raw}
          disabled={revealed}
          onChange={event => change(event.target.value)}
          placeholder="Your answer"
          aria-label="Your numeric answer"
          className="max-w-48 font-mono tabular-nums"
        />
        {payload.unit && (
          <span className="text-muted-foreground text-sm">{payload.unit}</span>
        )}
      </div>

      {/*
        The tolerance is stated up front, not saved for the reveal. A candidate
        who does not know whether three significant figures will pass is being
        tested on the marking scheme rather than the material.
      */}
      {payload.tolerance > 0 && !revealed && (
        <p className="text-muted-foreground text-xs">
          Within ±{payload.tolerance}
          {payload.unit ? ` ${payload.unit}` : ''} is accepted.
        </p>
      )}

      {revealed && (
        <p className="text-sm">
          <span className="text-muted-foreground">Answer: </span>
          <span className="text-primary font-mono tabular-nums">
            {payload.answer}
            {payload.unit ? ` ${payload.unit}` : ''}
          </span>
          {payload.tolerance > 0 && (
            <span className="text-muted-foreground"> (±{payload.tolerance})</span>
          )}
        </p>
      )}
    </div>
  );
}

/* ── matching ──────────────────────────────────────────────────────────── */

function MatchingAnswer({
  questionId,
  payload,
  response,
  onRespond,
  revealed,
}: {
  questionId: string;
  payload: MatchingPayload;
  response: QuestionResponse | null;
  onRespond: (response: QuestionResponse) => void;
  revealed: boolean;
}) {
  /*
   * The right column, shuffled once.
   *
   * Memoised on the question id rather than on the payload: a re-render that
   * reshuffled the column would move the option a candidate was reaching for,
   * and would invalidate every index already recorded.
   */
  const presented = useMemo(
    () => shuffledOrder(payload.pairs.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one shuffle per question, deliberately
    [questionId, payload.pairs.length],
  );

  const pairs =
    response?.kind === 'matching'
      ? response.pairs
      : payload.pairs.map(() => null);

  const choose = (leftIndex: number, presentedIndex: number | null) => {
    if (revealed) return;
    const next = payload.pairs.map((_, index) => pairs[index] ?? null);
    // Store the *stored* index, not the presented one, so grading is a
    // comparison against the identity permutation and nothing has to remember
    // which shuffle produced it.
    const stored =
      presentedIndex === null ? null : (presented[presentedIndex] ?? null);

    // A right-hand item matches one left-hand item. Assigning it again releases
    // it from wherever it was, rather than silently appearing twice.
    for (let index = 0; index < next.length; index += 1) {
      if (stored !== null && next[index] === stored) next[index] = null;
    }
    next[leftIndex] = stored;
    onRespond({ kind: 'matching', pairs: next });
  };

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-medium">
        Match each item on the left to one on the right.
      </p>
      <ul className="space-y-2">
        {payload.pairs.map((pair, leftIndex) => {
          const stored = pairs[leftIndex] ?? null;
          const isCorrect = stored === leftIndex;
          const presentedIndex =
            stored === null ? '' : String(presented.indexOf(stored));

          return (
            <li
              key={leftIndex}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm transition-colors',
                revealed && isCorrect && 'border-primary bg-primary/15',
                revealed && !isCorrect && 'border-destructive/60 bg-destructive/10',
              )}
            >
              <span className="min-w-0 flex-1 whitespace-pre-wrap">{pair.left}</span>

              {revealed ? (
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-right">
                  <span className="text-primary">{pair.right}</span>
                  {/*
                    What they chose, but only when it was not the answer.
                    Repeating a correct choice under the correct answer is
                    noise; showing a wrong one is the whole review.
                  */}
                  {!isCorrect && (
                    <span className="text-muted-foreground text-xs">
                      {stored === null
                        ? 'Left unmatched'
                        : `You chose: ${payload.pairs[stored]?.right ?? '—'}`}
                    </span>
                  )}
                </span>
              ) : (
                <select
                  aria-label={`Match for ${pair.left}`}
                  value={presentedIndex}
                  onChange={event =>
                    choose(
                      leftIndex,
                      event.target.value === '' ? null : Number(event.target.value),
                    )
                  }
                  className="border-input bg-background focus-visible:ring-ring min-w-0 flex-1 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  <option value="">Choose…</option>
                  {presented.map((storedIndex, position) => (
                    <option key={storedIndex} value={position}>
                      {payload.pairs[storedIndex]?.right ?? ''}
                    </option>
                  ))}
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── ordering ──────────────────────────────────────────────────────────── */

function OrderingAnswer({
  questionId,
  payload,
  response,
  onRespond,
  revealed,
}: {
  questionId: string;
  payload: OrderingPayload;
  response: QuestionResponse | null;
  onRespond: (response: QuestionResponse) => void;
  revealed: boolean;
}) {
  /*
   * The opening arrangement, shuffled once and guaranteed not to be the answer
   * — `shuffledOrder` rejects the identity, because a question that opens
   * already solved is not a question.
   */
  const initial = useMemo(
    () => shuffledOrder(payload.items.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one shuffle per question, deliberately
    [questionId, payload.items.length],
  );

  const order = response?.kind === 'ordering' ? response.order : initial;

  /*
   * Move by button, not by drag.
   *
   * Drag-and-drop needs a pointer, and an ordering question that cannot be
   * answered from a keyboard is an ordering question a keyboard user cannot
   * answer at all. Buttons are operable by touch, mouse and keyboard with no
   * extra work, and they are what a screen reader can describe. A drag
   * affordance can be added on top of this later; it cannot replace it.
   */
  const move = (position: number, delta: number) => {
    if (revealed) return;
    const target = position + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const a = next[position];
    const b = next[target];
    if (a === undefined || b === undefined) return;
    next[position] = b;
    next[target] = a;
    onRespond({ kind: 'ordering', order: next });
  };

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-medium">
        Put these in the correct order — then confirm.
      </p>
      <ol className="space-y-2">
        {order.map((storedIndex, position) => {
          const isCorrect = storedIndex === position;
          return (
            <li
              key={storedIndex}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors',
                revealed && isCorrect && 'border-primary bg-primary/15',
                revealed && !isCorrect && 'border-destructive/60 bg-destructive/10',
              )}
            >
              <span
                aria-hidden
                className="text-muted-foreground flex size-6 shrink-0 items-center justify-center font-mono text-xs tabular-nums"
              >
                {position + 1}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap">
                {payload.items[storedIndex]}
              </span>

              {revealed ? (
                isCorrect ? (
                  <CheckIcon className="text-primary size-4 shrink-0" />
                ) : (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    goes at {storedIndex + 1}
                  </span>
                )
              ) : (
                <span className="flex shrink-0 items-center gap-1">
                  <GripVerticalIcon
                    aria-hidden
                    className="text-muted-foreground size-4"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={position === 0}
                    onClick={() => move(position, -1)}
                    aria-label={`Move ${payload.items[storedIndex]} up`}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={position === order.length - 1}
                    onClick={() => move(position, 1)}
                    aria-label={`Move ${payload.items[storedIndex]} down`}
                  >
                    ↓
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ── fill in the blank ─────────────────────────────────────────────────── */

function FillBlankAnswer({
  payload,
  response,
  onRespond,
  revealed,
}: {
  payload: FillBlankPayload;
  response: QuestionResponse | null;
  onRespond: (response: QuestionResponse) => void;
  revealed: boolean;
}) {
  const typed = response?.kind === 'fill_blank' ? response.text : '';
  const { before, after } = splitBlank(payload.text);

  /*
   * Graded through the same function the runner uses, not re-derived here. A
   * component that decided its own correctness would be the second opinion
   * `gradeResponse` exists to prevent.
   */
  const isCorrect = revealed && response !== null && gradeResponse(payload, response);

  /*
   * The input sits *inside* the sentence rather than beneath it.
   *
   * A blank rendered as a separate field below the text turns "read this
   * sentence and supply the missing word" into "read this sentence, then answer
   * a question about it" — the reader loses the surrounding grammar, which is
   * the only thing that makes the accepted-answer list fair.
   */
  return (
    <div className="space-y-3">
      <p className="text-sm leading-8 whitespace-pre-wrap">
        {before}
        {revealed ? (
          <span
            className={cn(
              'mx-1 inline-flex items-center rounded-md border px-2 py-0.5 font-medium',
              isCorrect
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-destructive/60 bg-destructive/10',
            )}
          >
            {typed.trim() === '' ? '—' : typed}
          </span>
        ) : (
          <Input
            type="text"
            value={typed}
            onChange={event =>
              onRespond({ kind: 'fill_blank', text: event.target.value.slice(0, 200) })
            }
            placeholder="…"
            aria-label="Your answer for the blank"
            /*
             * Inline rather than a block field, so it flows with the text — a
             * full-width box in the middle of a sentence reads as a form field
             * rather than as a gap in a line of prose.
             */
            className="mx-1 inline-flex h-8 w-40 max-w-full align-baseline"
          />
        )}
        {after}
      </p>

      {revealed && (
        <p className="text-sm">
          <span className="text-muted-foreground">
            {isCorrect ? 'Accepted: ' : 'Answer: '}
          </span>
          <span className="text-primary font-medium">{payload.accepted[0]}</span>
          {/*
            The rest of the accepted list, shown only when the learner got it
            wrong. Someone who was right does not need to be told what else
            would have passed; someone who was wrong may have written one of
            them with a typo, and seeing the set explains the mark.
          */}
          {!isCorrect && payload.accepted.length > 1 && (
            <span className="text-muted-foreground text-xs">
              {' '}
              (also accepted: {payload.accepted.slice(1).join(', ')})
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/* ── categorise ────────────────────────────────────────────────────────── */

function CategorizeAnswer({
  questionId,
  payload,
  response,
  onRespond,
  revealed,
}: {
  questionId: string;
  payload: CategorizePayload;
  response: QuestionResponse | null;
  onRespond: (response: QuestionResponse) => void;
  revealed: boolean;
}) {
  /*
   * Items are shuffled for presentation; the buckets are not.
   *
   * `payload.items` is stored grouped by category — it is its own key — so
   * rendering it as stored would put every item of a category together in the
   * tray and hand over the grouping. The categories are labelled, so their
   * order carries no information and is left alone.
   */
  const presented = useMemo(
    () => shuffledOrder(payload.items.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one shuffle per question, deliberately
    [questionId, payload.items.length],
  );

  const assignments =
    response?.kind === 'categorize'
      ? response.assignments
      : payload.items.map(() => null);

  const assign = (itemIndex: number, category: number | null) => {
    if (revealed) return;
    const next = payload.items.map((_, index) => assignments[index] ?? null);
    next[itemIndex] = category;
    onRespond({ kind: 'categorize', assignments: next });
  };

  const unsorted = presented.filter(itemIndex => assignments[itemIndex] == null);

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs font-medium">
        Put every item into a group — drag it, or use the menu on each item.
      </p>

      {/* The tray of unsorted items, and the target for putting one back. */}
      {!revealed && (
        <div
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault();
            const itemIndex = Number(event.dataTransfer.getData('text/plain'));
            if (Number.isInteger(itemIndex)) assign(itemIndex, null);
          }}
          className="border-input min-h-14 rounded-lg border border-dashed p-2"
        >
          {unsorted.length === 0 ? (
            <p className="text-muted-foreground p-1 text-xs">
              Everything is sorted. Drag an item back here to unsort it.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {unsorted.map(itemIndex => (
                <li key={itemIndex}>
                  <ItemChip
                    text={payload.items[itemIndex]?.text ?? ''}
                    itemIndex={itemIndex}
                    categories={payload.categories}
                    current={null}
                    onAssign={assign}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {payload.categories.map((category, categoryIndex) => {
          const held = presented.filter(
            itemIndex => assignments[itemIndex] === categoryIndex,
          );

          return (
            <div
              key={categoryIndex}
              onDragOver={event => {
                if (!revealed) event.preventDefault();
              }}
              onDrop={event => {
                if (revealed) return;
                event.preventDefault();
                const itemIndex = Number(event.dataTransfer.getData('text/plain'));
                if (Number.isInteger(itemIndex)) assign(itemIndex, categoryIndex);
              }}
              className="bg-muted/30 min-h-24 rounded-lg border p-2"
            >
              <p className="mb-2 text-xs font-semibold">{category}</p>
              <ul className="flex flex-wrap gap-2">
                {held.map(itemIndex => (
                  <li key={itemIndex}>
                    <ItemChip
                      text={payload.items[itemIndex]?.text ?? ''}
                      itemIndex={itemIndex}
                      categories={payload.categories}
                      current={categoryIndex}
                      onAssign={assign}
                      state={
                        revealed
                          ? payload.items[itemIndex]?.category === categoryIndex
                            ? 'correct'
                            : 'wrong'
                          : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/*
        On reveal, name the right bucket for everything misplaced. Colouring a
        chip red says it is wrong; it does not say where it belonged, and that
        is the part worth reading.
      */}
      {revealed && (
        <ul className="space-y-1 text-xs">
          {payload.items.map((item, itemIndex) =>
            assignments[itemIndex] === item.category ? null : (
              <li key={itemIndex} className="text-muted-foreground">
                <span className="font-medium">{item.text}</span> belongs in{' '}
                <span className="text-primary">{payload.categories[item.category]}</span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * One item chip: draggable for a pointer, with a bucket menu for everyone else.
 *
 * **Drag is the affordance and the menu is the interface.** Drag-and-drop needs
 * a pointer, so a categorise question that could only be dragged could not be
 * answered from a keyboard at all — the same argument `OrderingAnswer` makes
 * for its move buttons. The `<select>` is what a keyboard and a screen reader
 * use; the drag handlers are layered on top of it, never in place of it.
 */
function ItemChip({
  text,
  itemIndex,
  categories,
  current,
  onAssign,
  state,
}: {
  text: string;
  itemIndex: number;
  categories: string[];
  current: number | null;
  onAssign: (itemIndex: number, category: number | null) => void;
  state?: 'correct' | 'wrong';
}) {
  const revealed = state !== undefined;

  return (
    <span
      draggable={!revealed}
      onDragStart={event => {
        event.dataTransfer.setData('text/plain', String(itemIndex));
        event.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'bg-background flex items-center gap-1 rounded-md border py-1 pr-1 pl-2 text-sm',
        !revealed && 'cursor-grab active:cursor-grabbing',
        state === 'correct' && 'border-primary bg-primary/15',
        state === 'wrong' && 'border-destructive/60 bg-destructive/10',
      )}
    >
      <span className="whitespace-pre-wrap">{text}</span>
      {!revealed && (
        <select
          aria-label={`Group for ${text}`}
          value={current === null ? '' : String(current)}
          onChange={event =>
            onAssign(
              itemIndex,
              event.target.value === '' ? null : Number(event.target.value),
            )
          }
          className="border-input bg-background focus-visible:ring-ring rounded border px-1 py-0.5 text-xs focus-visible:ring-2 focus-visible:outline-none"
        >
          <option value="">—</option>
          {categories.map((category, index) => (
            <option key={index} value={index}>
              {category}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}

/* ── Commit ───────────────────────────────────────────────────────────── */

/**
 * Whether a response is complete enough to be committed as an answer.
 *
 * **The six composite kinds need a confirm step and the two single-choice
 * kinds do not**, and this predicate is the seam between them. Clicking one
 * radio is a whole answer; ticking one checkbox of three is not, and a runner
 * that recorded it as one would grade a half-built multi-select wrong the
 * instant the first box was ticked.
 *
 * `numeric` counts an unparseable entry as incomplete rather than as a wrong
 * answer — someone mid-way through typing "-" or "3." has not answered yet.
 */
export function isComplete(response: QuestionResponse | null): boolean {
  if (!response) return false;
  switch (response.kind) {
    case 'mcq':
    case 'true_false':
      return true;
    case 'msq':
      return response.options.length > 0;
    case 'numeric':
      return response.value !== null;
    case 'matching':
      return response.pairs.every(pair => pair !== null);
    case 'ordering':
      return response.order.length > 0;
    /*
     * A blank with only whitespace in it is not an answer. Same reasoning as
     * `numeric`: someone who has typed nothing yet has not answered, and
     * recording it would grade them wrong for not having started.
     */
    case 'fill_blank':
      return response.text.trim() !== '';
    case 'categorize':
      return response.assignments.every(assignment => assignment !== null);
  }
}

/** Whether this kind commits on the first interaction, or waits for a confirm. */
export function commitsImmediately(kind: QuestionPayload['kind']): boolean {
  return kind === 'mcq' || kind === 'true_false';
}

/**
 * Whether a keystroke came from somewhere the runner must not read it.
 *
 * **Both runners bind their shortcuts on a container, so every keystroke made
 * inside an answer field bubbles up to them.** With six kinds that was already
 * wrong for `numeric` — typing `3` into the box also selected option 3 of a
 * question that had no options, and `n` was unreachable as a character because
 * it moved to the next question. `fill_blank` makes it unmissable: its answer
 * is prose, so every navigation letter is a keystroke a learner means to type.
 *
 * The guard is on the event target rather than on the question kind, because
 * the thing that matters is where the caret is, not what is being asked. A
 * `<select>` is included: it does its own type-ahead, and stealing digits from
 * it breaks choosing a category by keyboard.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
