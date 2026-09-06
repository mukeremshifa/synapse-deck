import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { InfoIcon, RotateCcwIcon, SparklesIcon, TrashIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Meter } from '@/components/Meter';
import {
  allocateQuestions,
  blueprintProblems,
  FORMAT_LABELS,
  GENERATABLE_FORMATS,
  rebalance,
  totalWeight,
  type Blueprint,
  type BlueprintTopic,
  type QuestionFormat,
  type TopicDifficulty,
} from '@/lib/blueprint';
import { notebookPath } from '@/lib/notebooks';
import { DEFAULT_EXAM_CONFIG } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { CitationList } from './Citation';
import { sampleBlueprint } from './fixtures';

/**
 * The exam blueprint: what an exam over this material will weigh, and why.
 *
 * ── Why this screen is worth building before the backend ──────────────────
 *
 * It is the step that distinguishes the product. "AI generates flashcards" is a
 * crowded space; "the AI read your material, proposed what an exam over it
 * should weigh, showed its evidence, and let you argue with it" is not. The
 * brief says as much (§2), and Phase B builds the generator behind it.
 *
 * ── Editable, because a generated blueprint is a proposal ─────────────────
 *
 * The model infers weights from page counts and repeated headings. That is a
 * reasonable guess and it is sometimes wrong in ways only the student knows —
 * their lecturer said the final leans on metabolism. So every weight is an
 * input, and the running total is displayed live rather than silently corrected,
 * because a screen that quietly renormalises while you type makes the control
 * feel broken. `Rebalance to 100%` is one click, and it is the user's click.
 *
 * ── The provenance drawer is not decoration ───────────────────────────────
 *
 * Each topic can say what the model saw **and where it saw it**. A system that
 * proposes a plan and cannot explain it has no business asking to be edited,
 * and a citation back to the page turns "trust this" into "check this" — which
 * is the difference between this and a model answering from nothing. Topics the
 * user adds by hand carry no evidence and say so rather than borrowing someone
 * else's; see `Citation.tsx` for why grounded and ungrounded claims are drawn
 * differently.
 *
 * ── What is real here and what is not ─────────────────────────────────────
 *
 * The blueprint is a **fixture** (`./fixtures.ts`) and the edits live in this
 * component's state, so they do not survive a reload. Nothing is generated and
 * nothing is saved: there is no endpoint for either. The screen says so, in the
 * banner, rather than implying a persistence it does not have.
 */
export function BlueprintPage() {
  const { notebookId } = useParams<{ notebookId: string }>();
  const navigate = useNavigate();

  const [blueprint, setBlueprint] = useState<Blueprint>(() => ({
    ...sampleBlueprint,
    notebookId: notebookId ?? sampleBlueprint.notebookId,
  }));
  const [questionCount, setQuestionCount] = useState(DEFAULT_EXAM_CONFIG.questionCount);
  const [showEvidence, setShowEvidence] = useState(false);

  const total = totalWeight(blueprint.topics);
  const balanced = total === 100;
  const problems = useMemo(() => blueprintProblems(blueprint), [blueprint]);

  const allocation = useMemo(
    () => allocateQuestions(blueprint.topics, questionCount),
    [blueprint.topics, questionCount],
  );
  const questionsFor = (topicId: string) =>
    allocation.find(entry => entry.topicId === topicId)?.questions ?? 0;

  const update = (id: string, patch: Partial<BlueprintTopic>) => {
    setBlueprint(current => ({
      ...current,
      edited: true,
      topics: current.topics.map(topic =>
        topic.id === id ? { ...topic, ...patch } : topic,
      ),
    }));
  };

  const remove = (id: string) => {
    setBlueprint(current => ({
      ...current,
      edited: true,
      topics: current.topics.filter(topic => topic.id !== id),
    }));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl tracking-tight">Exam blueprint</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              What an exam over this material should cover, and in what proportion.
            </p>
          </div>
          {blueprint.edited ? <Badge variant="secondary">Edited</Badge> : null}
        </div>

        {blueprint.sources.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Inferred from{' '}
            <span className="text-foreground">{blueprint.sources.join(', ')}</span>
          </p>
        )}
      </header>

      {/*
        The honesty banner. This screen is the most convincing thing in the app
        and it is running on a fixture; a demo that does not say so is a demo
        that misleads whoever is watching it.
      */}
      <div className="flex items-start gap-2 rounded-lg border border-dashed p-3">
        <InfoIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-muted-foreground text-xs leading-relaxed">
          This blueprint is sample data. Generating one from your own sources needs
          the ingestion pipeline, and saving your edits needs somewhere to put
          them — neither exists yet, so changes here last until you reload.
        </p>
      </div>

      {/* ── Topics ──────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Topics</h2>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'font-mono text-xs tabular-nums',
                balanced ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {total}% of 100%
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={balanced || blueprint.topics.length === 0}
              onClick={() =>
                setBlueprint(current => ({
                  ...current,
                  edited: true,
                  topics: rebalance(current.topics),
                }))
              }
            >
              <RotateCcwIcon aria-hidden /> Rebalance to 100%
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {blueprint.topics.map(topic => (
                <li key={topic.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {topic.name}
                    </span>

                    <DifficultyControl
                      value={topic.difficulty}
                      onChange={difficulty => update(topic.id, { difficulty })}
                    />

                    <div className="flex items-center gap-1.5">
                      <Label htmlFor={`weight-${topic.id}`} className="sr-only">
                        {topic.name} weight, percent
                      </Label>
                      <Input
                        id={`weight-${topic.id}`}
                        type="number"
                        min={0}
                        max={100}
                        value={topic.weight}
                        onChange={event =>
                          update(topic.id, {
                            weight: clampWeight(event.target.valueAsNumber),
                          })
                        }
                        className="h-8 w-16 text-right font-mono tabular-nums"
                      />
                      <span className="text-muted-foreground text-xs">%</span>
                    </div>

                    <span className="text-muted-foreground w-14 shrink-0 text-right font-mono text-xs tabular-nums">
                      {questionsFor(topic.id)} Q
                    </span>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(topic.id)}
                      aria-label={`Remove ${topic.name}`}
                    >
                      <TrashIcon aria-hidden />
                    </Button>
                  </div>

                  <div className="mt-2">
                    {/*
                      Neutral, not accent. A blueprint weight is not an
                      achievement — colouring it would imply 24% networking is
                      "good", which means nothing. See `Meter`.
                    */}
                    <Meter
                      value={total > 0 ? topic.weight / total : 0}
                      label={`${topic.name}: ${topic.weight}% of the exam`}
                    />
                  </div>

                  {showEvidence && (
                    <div className="mt-3 border-l-2 pl-3">
                      <CitationList
                        evidence={topic.evidence}
                        emptyMessage="You added this topic, so there is nothing the model saw to report."
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowEvidence(value => !value)}
        >
          {showEvidence ? 'Hide' : 'Why these weights?'}
        </Button>
      </section>

      {/* ── Question mix ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Question mix</h2>
        <Card>
          <CardContent className="space-y-3 p-4">
            {(Object.keys(FORMAT_LABELS) as QuestionFormat[]).map(format => {
              const share = blueprint.formatMix[format] ?? 0;
              const generatable = GENERATABLE_FORMATS.includes(format);
              return (
                <div key={format} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm">
                      {FORMAT_LABELS[format]}
                      {/*
                        Marked rather than hidden. A blueprint that silently
                        turns "30% short answer" into multiple choice has broken
                        its own promise; saying which formats the generator can
                        produce is the honest version. `schemas.ts` leaves
                        free-text out of QuestionPayload deliberately.
                      */}
                      {!generatable && share > 0 ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Not generated yet
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                      {share}%
                    </span>
                  </div>
                  <Meter
                    value={share / 100}
                    label={`${FORMAT_LABELS[format]}: ${share}% of the exam`}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      {/* ── Exam length and the way out ─────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Generate an exam</h2>
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="question-count">Questions</Label>
                <Input
                  id="question-count"
                  type="number"
                  min={1}
                  max={50}
                  value={questionCount}
                  onChange={event =>
                    setQuestionCount(
                      Math.min(50, Math.max(1, event.target.valueAsNumber || 1)),
                    )
                  }
                  className="h-9 w-24 font-mono tabular-nums"
                />
              </div>
              <p className="text-muted-foreground flex-1 text-xs leading-relaxed">
                Each topic gets questions in proportion to its weight. A topic
                with any weight at all gets at least one, so nothing on the
                blueprint is silently dropped from the exam.
              </p>
            </div>

            {problems.length > 0 && (
              <ul className="space-y-1">
                {problems.map(problem => (
                  <li key={problem} className="text-destructive text-xs">
                    {problem}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={problems.length > 0}
                onClick={() =>
                  toast('Blueprint-aligned generation is not built yet', {
                    description:
                      'The exam runner works today on sample questions. Generating an exam from this blueprint needs the ingestion pipeline.',
                  })
                }
              >
                <SparklesIcon aria-hidden /> Generate exam
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void navigate(
                    notebookId ? notebookPath.exam(notebookId) : notebookPath.list(),
                  )
                }
              >
                Sit the sample exam
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

const DIFFICULTIES: TopicDifficulty[] = ['easy', 'medium', 'hard'];

/**
 * A three-way difficulty toggle.
 *
 * A segmented control rather than a `<select>` because there are exactly three
 * options and they are ordered — a dropdown hides an ordering that a row of
 * three does not, and this is a value the user changes while scanning the table
 * rather than one they hunt for.
 */
function DifficultyControl({
  value,
  onChange,
}: {
  value: TopicDifficulty;
  onChange: (value: TopicDifficulty) => void;
}) {
  return (
    <div
      className="flex shrink-0 overflow-hidden rounded-md border"
      role="group"
      aria-label="Difficulty"
    >
      {DIFFICULTIES.map(difficulty => (
        <button
          key={difficulty}
          type="button"
          onClick={() => onChange(difficulty)}
          aria-pressed={value === difficulty}
          className={cn(
            'focus-visible:ring-ring px-2 py-1 text-xs capitalize outline-none focus-visible:ring-2',
            value === difficulty
              ? 'bg-secondary text-secondary-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent',
          )}
        >
          {difficulty}
        </button>
      ))}
    </div>
  );
}

function clampWeight(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}
