import type { McqPayload } from '@/lib/schemas';
import { cn } from '@/lib/utils';

/**
 * The options for one exam question, while it is being answered.
 *
 * Close to `features/cards/McqOptions` but deliberately not shared with it, for
 * two reasons that both matter:
 *
 * 1. **Nothing is revealed during an exam.** A card shows you the answer the
 *    moment you pick; an exam does not, and grading happens after submission.
 *    Threading a `revealed` prop that is always false through the card component
 *    would leave dead branches in the one place correctness is least visible.
 * 2. **The radio group needs a per-question name.** `McqOptions` hardcodes
 *    `name="mcq-option"`, which is fine when one card is on screen and wrong the
 *    moment two questions render together — every radio would join one group and
 *    selecting an answer in question 3 would clear question 1.
 *
 * The results review reuses the card component instead, where revealing is the
 * entire point.
 */
export function ExamOptions({
  questionId,
  payload,
  selected,
  onSelect,
}: {
  questionId: string;
  payload: McqPayload;
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Choose an answer</legend>
      {payload.options.map((option, index) => {
        const isSelected = selected === index;

        return (
          <label
            key={index}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-sm transition-colors',
              'has-[:focus-visible]:ring-ring has-[:focus-visible]:border-ring has-[:focus-visible]:ring-2',
              'hover:bg-accent/50',
              // Ink rather than the accent: during an exam nothing is correct or
              // incorrect yet, and colouring a selection green would imply it is.
              isSelected && 'border-foreground bg-accent',
            )}
          >
            <input
              type="radio"
              // Per-question group. See the note above — this is the bug that
              // shows up only once a second question is on screen.
              name={`question-${questionId}`}
              className="sr-only"
              checked={isSelected}
              onChange={() => onSelect(index)}
            />
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                isSelected && 'border-foreground bg-foreground text-background',
              )}
            >
              {String.fromCharCode(65 + index)}
            </span>
            <span className="flex-1 whitespace-pre-wrap">{option.text}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
