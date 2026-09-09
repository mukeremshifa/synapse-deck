import { questionStem, type QuestionPayload } from '@/lib/schemas';

/**
 * The prompt at the top of a question, for any of the six kinds.
 *
 * Trivial, and it exists anyway: `payload.stem` is wrong for `true_false`,
 * whose prompt is `statement`, and every surface that reads one directly is a
 * surface that will render "undefined" the first time a true/false question
 * reaches it. `questionStem` is the rule; this is the one way to draw it.
 *
 * The kind label sits above rather than beside the text. "Select all that
 * apply" is an instruction the candidate must read *before* the options, and a
 * badge trailing the prompt is read after it or not at all.
 */
export function QuestionPrompt({
  payload,
  className,
}: {
  payload: QuestionPayload;
  className?: string;
}) {
  return (
    <p className={className ?? 'font-serif text-xl leading-snug whitespace-pre-wrap'}>
      {questionStem(payload)}
    </p>
  );
}
