import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Blueprint, BlueprintWeight } from '@/lib/api';
import { useUpdateBlueprint } from './queries';

/**
 * Reweighting an exam — **a promise FR4 made and nothing kept until now.**
 *
 * FR4's generate modal tells the user the blueprint "belongs to the exam, and
 * you can adjust it once it exists". FR5 rendered it read-only on the brief,
 * because the contract's `updateArtifact` took `{ title }` and there was no way
 * to send a blueprint at all. FR6 widened it, and this is the surface.
 *
 * ── Why the editor is here and not on the overview ────────────────────────
 *
 * The blueprint belongs to its exam (brief §1.2(9)), which is what finally
 * gives a blueprint something to blueprint — a per-notebook one describes an
 * exam that does not exist, so nothing can be checked against it. FR6's own
 * plan puts per-exam blueprints out of the overview's scope for that reason.
 * The exam brief is where the weighting is information the candidate can act
 * on, so it is where they can change it.
 *
 * ── The total is the constraint, and it is shown, not enforced silently ───
 *
 * An exam asks a fixed number of questions. Weights that do not add up to it
 * are not a weighting — they are a different exam. So the running total is
 * always visible against the target and Save is disabled until they match,
 * rather than the dialog quietly rescaling what was typed. Rescaling would
 * change numbers the user had just chosen deliberately.
 *
 * The server checks the same thing. That is not duplication for its own sake:
 * this check is a convenience so the user is not told after a round trip, and
 * the server's is the rule. A UI-only check is not a constraint.
 */
export function BlueprintEditor({
  notebookId,
  examId,
  blueprint,
  questionCount,
  open,
  onOpenChange,
}: {
  notebookId: string;
  examId: string;
  blueprint: Blueprint;
  /** What the weights must sum to — the exam's own `config.questionCount`. */
  questionCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  /*
   * Seeded from the exam's current blueprint each time the dialog opens. Keyed
   * on `open` so reopening after a cancel starts from what is stored rather
   * than from the abandoned edit — a cancelled edit that reappears looks like
   * the cancel did not work.
   */
  const [weights, setWeights] = useState<BlueprintWeight[]>(blueprint.weights);
  const [seededFor, setSeededFor] = useState(open);
  if (open !== seededFor) {
    setSeededFor(open);
    if (open) setWeights(blueprint.weights);
  }

  const update = useUpdateBlueprint(notebookId, examId);

  const total = useMemo(
    () => weights.reduce((sum, weight) => sum + weight.questions, 0),
    [weights],
  );
  const balanced = total === questionCount;

  const setQuestions = (index: number, raw: string) => {
    // An empty field is 0 rather than NaN: a user clearing a box to retype is
    // mid-edit, and NaN would make the total read "NaN of 40".
    const parsed = Number.parseInt(raw, 10);
    const value = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setWeights(current =>
      current.map((weight, at) => (at === index ? { ...weight, questions: value } : weight)),
    );
  };

  const save = () => {
    update.mutate(
      { weights, basis: 'manual' },
      {
        onSuccess: () => {
          toast.success('Blueprint updated', {
            description: 'This exam will be weighted the way you set it.',
          });
          onOpenChange(false);
        },
        onError: error =>
          toast.error('Could not update the blueprint', {
            description: error instanceof Error ? error.message : undefined,
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How this exam is weighted</DialogTitle>
          <DialogDescription>
            How many of this exam&rsquo;s {questionCount} questions come from each
            topic. The generated weighting follows your card counts; change it if
            your exam is weighted differently.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex max-h-80 flex-col gap-tight overflow-y-auto">
          {weights.map((weight, index) => (
            <li
              key={weight.topicId ?? `unfiled-${String(index)}`}
              className="flex items-center gap-snug"
            >
              <Label
                htmlFor={`weight-${String(index)}`}
                className="min-w-0 flex-1 truncate font-normal"
              >
                {weight.topicName}
              </Label>
              <Input
                id={`weight-${String(index)}`}
                type="number"
                min={0}
                max={questionCount}
                value={weight.questions}
                onChange={event => setQuestions(index, event.target.value)}
                className="w-20 shrink-0 tabular-nums"
              />
            </li>
          ))}
        </ul>

        <p
          className={
            balanced
              ? 'text-muted-foreground text-sm tabular-nums'
              : 'text-sm tabular-nums text-(--color-grade-hard-mark)'
          }
          // Announced, because the total changing is the feedback that tells
          // the user whether Save will be available, and a sighted user sees it
          // move while a screen-reader user would not be told at all.
          aria-live="polite"
        >
          {total} of {questionCount} questions allocated
          {balanced ? '' : total > questionCount ? ' — that is too many' : ' — some are unallocated'}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!balanced || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save weighting'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
