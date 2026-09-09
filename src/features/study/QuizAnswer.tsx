import { useMemo } from 'react';
import { CheckIcon, GripVerticalIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  shuffledOrder,
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
 * `payload.kind`, which is a different axis: six kinds is six input shapes —
 * radios, checkboxes, a number field, two columns, a reorderable list — and
 * they are the same six in both surfaces. Splitting on kind *as well* would
 * mean twelve components and twelve chances for the exam's checkbox to drift
 * from the quiz's. So: one component per surface, switching on kind.
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

/* ── Commit ───────────────────────────────────────────────────────────── */

/**
 * Whether a response is complete enough to be committed as an answer.
 *
 * **The four composite kinds need a confirm step and the two single-choice
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
  }
}

/** Whether this kind commits on the first interaction, or waits for a confirm. */
export function commitsImmediately(kind: QuestionPayload['kind']): boolean {
  return kind === 'mcq' || kind === 'true_false';
}
