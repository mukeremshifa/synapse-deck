import { FlagIcon } from 'lucide-react';

import type { ExamAnswer } from '@/lib/schemas';
import type { PreparedQuestion } from '@/lib/exam';
import { cn } from '@/lib/utils';

/**
 * The question grid — jump to any question, and see at a glance what is left.
 *
 * Every real exam interface has one, and it is what makes flagging worth having:
 * a flag with no way to find the flagged question again is decoration. It also
 * carries the honest count of what is unanswered, which is the number a
 * candidate actually navigates by in the last five minutes.
 *
 * **Not a `<nav>`, and the states are not colour-only.** The grid is a list of
 * buttons in a labelled group; each button's accessible name says its number and
 * its state in words, because the difference between answered and unanswered is
 * carried visually by fill, and fill alone fails anyone who cannot distinguish
 * it. The flag is an icon rather than a second shade for the same reason.
 */
export function QuestionNavigator({
  questions,
  answers,
  currentIndex,
  onNavigate,
}: {
  questions: readonly PreparedQuestion[];
  answers: ReadonlyMap<string, ExamAnswer>;
  currentIndex: number;
  onNavigate: (index: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Question navigator"
      className="flex flex-wrap gap-1.5 rounded-lg border p-3"
    >
      {questions.map((question, index) => {
        const answer = answers.get(question.id);
        // `answer?.selectedOption !== null` alone would be true for a question
        // never visited, where the optional chain yields undefined rather than
        // null — marking every untouched question as answered.
        const answered = answer !== undefined && answer.selectedOption !== null;
        const flagged = answer?.flagged ?? false;
        const isCurrent = index === currentIndex;

        return (
          <button
            key={question.id}
            type="button"
            onClick={() => onNavigate(index)}
            aria-current={isCurrent ? 'true' : undefined}
            // The state in words. A screen reader user navigating this grid needs
            // "12, answered, flagged" — not twelve identical numbered buttons.
            aria-label={`Question ${index + 1}${answered ? ', answered' : ', unanswered'}${
              flagged ? ', flagged' : ''
            }`}
            className={cn(
              'relative flex size-9 items-center justify-center rounded-md border text-xs font-medium tabular-nums transition-colors',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              'hover:bg-accent',
              // Ink for answered, not the accent: during an attempt nothing is
              // correct yet, and a green grid would read as a score.
              answered && 'border-foreground bg-foreground text-background',
              !answered && 'text-muted-foreground border-dashed',
              // The ring, rather than a fill, marks position — so "where I am"
              // and "what I have answered" stay independently readable.
              isCurrent && 'ring-ring ring-2 ring-offset-2',
            )}
          >
            {index + 1}
            {flagged && (
              <FlagIcon
                aria-hidden
                className={cn(
                  'absolute -top-1 -right-1 size-3 fill-current',
                  answered ? 'text-foreground' : 'text-muted-foreground',
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
