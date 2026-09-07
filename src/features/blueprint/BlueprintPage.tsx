import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  InfoIcon,
  LayersIcon,
  RotateCcwIcon,
  SparklesIcon,
  TrashIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Meter } from '@/components/Meter';
import {
  allocateQuestions,
  blueprintFromTopics,
  blueprintProblems,
  FORMAT_LABELS,
  GENERATABLE_FORMATS,
  rebalance,
  totalWeight,
  UNFILED_TOPIC_ID,
  type Blueprint,
  type BlueprintTopic,
  type QuestionFormat,
  type TopicDifficulty,
} from '@/lib/blueprint';
import { EmptyState } from '@/components/EmptyState';
import { notebookPath } from '@/lib/notebooks';
import { useDeck, useTopics } from '@/lib/queries';
import { DEFAULT_EXAM_CONFIG } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { CitationList } from './Citation';

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
 * ── What is real here and what is not (DS3 task 3) ────────────────────────
 *
 * **The topics and the weights are the signed-in user's own**, read from
 * `GET /topics` and turned into a blueprint by `blueprintFromTopics`. The
 * fixture is gone; there is no fallback to it, and an account with no cards
 * gets an empty state rather than somebody else's plausible numbers (DS3 §3).
 *
 * Two things are still not real, and the banner says both rather than letting
 * a computed screen imply more than it has:
 *
 * - **The weights are counted, not inferred.** A weight is a topic's share of
 *   the user's active cards. That is a measurement of how much material each
 *   topic occupies, not a model's reading of what an exam will emphasise —
 *   which is Phase C. `blueprintFromTopics` argues the definition at length.
 * - **Edits still do not persist.** There is no endpoint to save a blueprint
 *   to, so changes live in this component's state until reload, exactly as
 *   before.
 *
 * Difficulty is uniformly `medium` for the same reason: nothing measures how
 * hard the *material* is, and FSRS difficulty is a property of the learner.
 */
export function BlueprintPage() {
  const { notebookId } = useParams<{ notebookId: string }>();
  const navigate = useNavigate();

  const topics = useTopics();
  const deck = useDeck(notebookId);

  const [questionCount, setQuestionCount] = useState(DEFAULT_EXAM_CONFIG.questionCount);
  const [showEvidence, setShowEvidence] = useState(false);

  /**
   * The blueprint as computed from the user's own topics.
   *
   * Recomputed whenever the topics change, and **not** stored in state: it is
   * derived data, and a copy in state is a copy that goes stale the moment a
   * card is filed elsewhere in the app.
   */
  const derived = useMemo(() => {
    if (!topics.data || !notebookId) return null;
    return blueprintFromTopics({
      notebookId,
      title: deck.data?.title ?? 'This notebook',
      topics: topics.data.topics,
      unfiledCards: topics.data.unfiledCards,
      ...(deck.data ? { updatedAt: deck.data.updated_at } : {}),
    });
  }, [topics.data, deck.data, notebookId]);

  /**
   * The user's edits, held separately from the derived blueprint.
   *
   * `null` means "nothing has been edited, show what was computed". Keeping the
   * two apart is what lets the derived blueprint stay live while an edited one
   * stays put: a screen that recomputed over the user's typing would discard
   * the one input the model cannot infer (see the schema's `edited` field).
   */
  const [edited, setEdited] = useState<Blueprint | null>(null);

  /*
   * A different notebook is a different blueprint, and an edit made on one must
   * not survive onto another. The route param is the identity here — this
   * component is remounted by the router only when the route pattern changes,
   * not when the id within it does.
   */
  useEffect(() => setEdited(null), [notebookId]);

  const blueprint = edited ?? derived;

  /** How many active cards the weights were counted over. Shown in the banner. */
  const cardTotal = topics.data
    ? topics.data.topics.reduce((sum, topic) => sum + topic.cardCount, 0) +
      topics.data.unfiledCards
    : 0;

  const total = blueprint ? totalWeight(blueprint.topics) : 0;
  const balanced = total === 100;
  const problems = useMemo(
    () => (blueprint ? blueprintProblems(blueprint) : []),
    [blueprint],
  );

  const allocation = useMemo(
    () => (blueprint ? allocateQuestions(blueprint.topics, questionCount) : []),
    [blueprint, questionCount],
  );
  const questionsFor = (topicId: string) =>
    allocation.find(entry => entry.topicId === topicId)?.questions ?? 0;

  /**
   * Apply an edit, starting from whatever is on screen.
   *
   * `edited ?? derived` rather than the state setter's previous value, because
   * the first edit has to be seeded from the computed blueprint — `edited` is
   * null until then.
   */
  const edit = (change: (current: Blueprint) => Blueprint) => {
    setEdited(current => {
      const base = current ?? derived;
      if (!base) return current;
      return { ...change(base), edited: true };
    });
  };

  const update = (id: string, patch: Partial<BlueprintTopic>) =>
    edit(current => ({
      ...current,
      topics: current.topics.map(topic =>
        topic.id === id ? { ...topic, ...patch } : topic,
      ),
    }));

  const remove = (id: string) =>
    edit(current => ({
      ...current,
      topics: current.topics.filter(topic => topic.id !== id),
    }));

  // ── The states before there is a blueprint to show ──────────────────────
  //
  // Three of them, kept distinct. A single "nothing here" would tell a user
  // whose request failed that they have no cards, which is a different and
  // false statement.

  if (topics.isPending) {
    return (
      <Shell>
        <p className="text-muted-foreground text-sm">Reading your topics…</p>
      </Shell>
    );
  }

  if (topics.isError) {
    return (
      <Shell>
        <EmptyState
          icon={<InfoIcon aria-hidden />}
          title="Your topics could not be loaded"
          description="The blueprint is computed from them, so there is nothing to show until that request succeeds."
          action={
            <Button variant="outline" onClick={() => void topics.refetch()}>
              Try again
            </Button>
          }
        />
      </Shell>
    );
  }

  /*
   * No topics and no unfiled cards: a real, common, first-run state.
   *
   * **This is the case DS3 §3 is written against.** The fixture would have
   * rendered a convincing AWS blueprint here, identical for every user on the
   * planet — so a reviewer's fresh account and the demo account would look the
   * same. It says what to do instead.
   */
  if (!blueprint) {
    return (
      <Shell>
        <EmptyState
          icon={<LayersIcon aria-hidden />}
          title="Nothing to weigh yet"
          description="A blueprint is computed from the cards in this notebook and the topics they were filed under. Add a document and accept some cards, and this fills in."
          action={
            notebookId ? (
              <Button onClick={() => void navigate(notebookPath.open(notebookId))}>
                Back to the notebook
              </Button>
            ) : null
          }
        />
      </Shell>
    );
  }

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

        {/*
          `sources` is empty on a derived blueprint: nothing here read a file,
          so naming one would be a provenance claim this screen cannot support.
          The branch stays for the generated blueprints of a later phase.
        */}
        {blueprint.sources.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Inferred from{' '}
            <span className="text-foreground">{blueprint.sources.join(', ')}</span>
          </p>
        )}
      </header>

      {/*
        The honesty banner, rewritten for DS3. It no longer says "sample data",
        because the numbers are now the user's own — but a computed weight and
        an inferred weight are different claims, and a screen that let the
        reader assume the second would be the more convincing kind of dishonest.
      */}
      <div className="flex items-start gap-2 rounded-lg border border-dashed p-3">
        <InfoIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-muted-foreground text-xs leading-relaxed">
          These weights are counted from your own cards — each topic's share of
          the {cardTotal} {cardTotal === 1 ? 'card' : 'cards'} in this notebook.
          A model reading your sources to judge what an exam will actually
          emphasise is a later phase, and difficulty is left at medium for the
          same reason: nothing here measures it yet. Your edits last until you
          reload; there is nowhere to save them.
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
                edit(current => ({ ...current, topics: rebalance(current.topics) }))
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
                    <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-medium">
                      {topic.name}
                      {/*
                        The residue, marked. These cards carry no topic — hand-made
                        ones, and ones whose chunk named none. They are counted
                        rather than dropped, because weights over only the topiced
                        cards would describe a subset while claiming to describe
                        the whole (see `blueprintFromTopics`).
                      */}
                      {topic.id === UNFILED_TOPIC_ID ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          No topic
                        </Badge>
                      ) : null}
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

/**
 * The page frame, shared by the loading, error, empty and populated states.
 *
 * Extracted so the four cannot drift apart: an empty state that sits in a
 * different container from the real screen reads as a broken page rather than
 * as an answer.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">Exam blueprint</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What an exam over this material should cover, and in what proportion.
        </p>
      </header>
      {children}
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
