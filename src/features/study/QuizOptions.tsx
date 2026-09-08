import { CheckIcon, XIcon } from 'lucide-react';

import type { McqPayload } from '@/lib/schemas';
import { cn } from '@/lib/utils';

/**
 * The options for one quiz question, before and after it is answered.
 *
 * ── Where the line between quiz and exam is drawn (FR5 §6.3) ──────────────
 *
 * §3 forbids one runner with a `timed` flag. It does not forbid sharing a
 * renderer — but these two surfaces turned out not to want one, and the reason
 * is the thing that makes them different kinds in the first place:
 *
 * > **A quiz reveals. An exam does not.**
 *
 * `ExamOptions` renders a selection and nothing else, because during an exam
 * nothing is correct yet and colouring a choice would claim otherwise. This
 * component's whole job is the state that follows: which option was right,
 * which was picked, and the two shown together. A single component switching on
 * `revealed` would put the exam's correctness — the one place it matters most —
 * behind a branch that is dead in the exam and live in the quiz.
 *
 * So the shared thing is **`AttemptAnswer`**, the record both produce, and the
 * per-question layout. The renderers are separate, which is the same call
 * `ExamOptions` already made against `features/cards/McqOptions` and for the
 * same reason. That is the line, and this comment is where it is recorded.
 *
 * `features/cards/McqOptions` is not reused either: it hardcodes
 * `name="mcq-option"`, which is right for one card on screen and wrong here —
 * the name is per question so that a re-render or a second question cannot join
 * two groups.
 */
export function QuizOptions({
  questionId,
  payload,
  selected,
  onSelect,
  revealed,
}: {
  questionId: string;
  payload: McqPayload;
  selected: number | null;
  onSelect: (index: number) => void;
  revealed: boolean;
}) {
  return (
    <fieldset className="space-y-2" disabled={revealed}>
      <legend className="sr-only">Choose an answer</legend>
      {payload.options.map((option, index) => {
        const isSelected = selected === index;
        const showAsCorrect = revealed && option.correct;
        const showAsWrong = revealed && isSelected && !option.correct;

        return (
          <label
            key={index}
            className={cn(
              'flex items-start gap-3 rounded-lg border p-4 text-sm transition-colors',
              'has-[:focus-visible]:ring-ring has-[:focus-visible]:border-ring has-[:focus-visible]:ring-2',
              revealed ? 'cursor-default' : 'hover:bg-accent/50 cursor-pointer',
              // Neutral means "you picked this"; the accent is reserved for
              // "this is the answer", so the two never have to be told apart
              // by shade.
              isSelected && !revealed && 'border-foreground bg-accent',
              showAsCorrect && 'border-primary bg-primary/20',
              showAsWrong && 'border-destructive/60 bg-destructive/10',
            )}
          >
            <input
              type="radio"
              name={`question-${questionId}`}
              className="sr-only"
              checked={isSelected}
              onChange={() => onSelect(index)}
            />
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                isSelected &&
                  !revealed &&
                  'border-foreground bg-foreground text-background',
                showAsCorrect && 'border-primary bg-primary text-primary-foreground',
                showAsWrong && 'border-destructive bg-destructive text-white',
              )}
            >
              {showAsCorrect ? (
                <CheckIcon className="size-3" />
              ) : showAsWrong ? (
                <XIcon className="size-3" />
              ) : (
                String.fromCharCode(65 + index)
              )}
            </span>
            <span className="flex-1 whitespace-pre-wrap">{option.text}</span>
            {showAsCorrect && (
              <span className="bg-primary text-primary-foreground rounded-sm px-1.5 py-0.5 text-xs font-semibold">
                Correct
              </span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
