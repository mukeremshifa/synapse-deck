import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SparklesIcon, SquareIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { plural } from '@/lib/format';
import { suggestDeckTitle } from '@/lib/generate';
import { estimateTokens } from '@/lib/quota';
import { useQuotaUsage } from '@/lib/queries';
import {
  CARD_KINDS,
  GENERATION_LIMITS,
  GenerateRequest,
  type CardKind,
  type GenerateRequestInput,
} from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { StagingList } from './StagingList';
import { useGenerateCards } from './useGenerateCards';

/**
 * `/create/text` — paste text, watch cards arrive (SPEC §4.1 steps 1–4).
 *
 * The form validates with `GenerateRequest`, the same schema the Edge Function
 * validates against, so the two cannot disagree about what a request is. That
 * check is a courtesy, not a control: the limits that matter are enforced
 * server-side, and this side only exists so a mistake costs a message instead of
 * a round trip (SPEC §7.5).
 */

const KIND_LABELS: Record<CardKind, string> = {
  basic: 'Basic',
  cloze: 'Cloze',
  mcq: 'Multiple choice',
};

const DEPTH_LABELS = {
  recall: 'Recall — definitions, terms, dates',
  balanced: 'Balanced — facts and how they connect',
  deep: 'Deep — mechanisms, causes, distinctions',
} as const;

export function CreateFromTextPage() {
  const navigate = useNavigate();
  const quota = useQuotaUsage();
  const { state, start, cancel, reset } = useGenerateCards();
  const [titleTouched, setTitleTouched] = useState(false);

  const form = useForm<GenerateRequestInput, unknown, GenerateRequest>({
    resolver: zodResolver(GenerateRequest),
    defaultValues: {
      text: '',
      deckTitle: '',
      cardCount: 20,
      kinds: ['basic', 'cloze'],
      depth: 'balanced',
    },
    mode: 'onSubmit',
  });

  const text = form.watch('text') ?? '';
  const { setValue } = form;

  // Suggest a title from the text, and stop the moment the user types their own.
  useEffect(() => {
    if (titleTouched) return;
    setValue('deckTitle', suggestDeckTitle(text).slice(0, 200));
  }, [text, titleTouched, setValue]);

  const stats = useMemo(
    () => ({ chars: text.length, tokens: estimateTokens(text.length) }),
    [text],
  );

  const outOfQuota = quota.data ? quota.data.remaining <= 0 : false;
  const started = state.status !== 'idle';

  const onSubmit = form.handleSubmit(async values => {
    await start(values);
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl tracking-tight">Create from text</h1>
        <p className="text-muted-foreground max-w-prose text-sm">
          Paste a passage and cards are written from it. You approve every card before it
          enters a deck. Have a PDF instead?{' '}
          <Link to="/create/document" className="underline underline-offset-4">
            Upload a document
          </Link>
          .
        </p>
      </header>

      {started ? (
        <GenerationPanel
          state={state}
          onCancel={cancel}
          onStartOver={() => {
            reset();
            form.reset();
            setTitleTouched(false);
          }}
          onReview={deckId => navigate(`/create/review/${deckId}`)}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Source text</CardTitle>
            <CardDescription>
              Between {GENERATION_LIMITS.minChars.toLocaleString()} and{' '}
              {GENERATION_LIMITS.maxChars.toLocaleString()} characters. A few well-chosen
              paragraphs make better cards than a whole chapter.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="generate-text">Text</Label>
                <Textarea
                  id="generate-text"
                  className="min-h-64 font-normal"
                  placeholder="Paste your notes, an article, or a section of a textbook."
                  aria-invalid={Boolean(form.formState.errors.text)}
                  {...form.register('text')}
                />
                <SourceMeter chars={stats.chars} tokens={stats.tokens} />
                <div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
                  <span>an estimate, not a measurement</span>
                  <QuotaNote
                    remaining={quota.data?.remaining}
                    limit={quota.data?.limit}
                  />
                </div>
                <FieldError message={form.formState.errors.text?.message} />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="generate-title">Deck title</Label>
                  <Input
                    id="generate-title"
                    aria-invalid={Boolean(form.formState.errors.deckTitle)}
                    {...form.register('deckTitle', {
                      onChange: () => setTitleTouched(true),
                    })}
                  />
                  <FieldError message={form.formState.errors.deckTitle?.message} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="generate-count">How many cards</Label>
                  <Input
                    id="generate-count"
                    type="number"
                    className="w-32"
                    min={GENERATION_LIMITS.minCards}
                    max={GENERATION_LIMITS.maxCards}
                    aria-invalid={Boolean(form.formState.errors.cardCount)}
                    {...form.register('cardCount', { valueAsNumber: true })}
                  />
                  <FieldError message={form.formState.errors.cardCount?.message} />
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm leading-none font-medium">Card types</legend>
                <div className="flex flex-wrap gap-4 pt-1">
                  {CARD_KINDS.map(kind => (
                    <label key={kind} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        value={kind}
                        className="size-4"
                        {...form.register('kinds')}
                      />
                      {KIND_LABELS[kind]}
                    </label>
                  ))}
                </div>
                <FieldError
                  message={
                    form.formState.errors.kinds?.message ??
                    form.formState.errors.kinds?.root?.message
                  }
                />
              </fieldset>

              <div className="space-y-2">
                <Label htmlFor="generate-depth">Depth</Label>
                <Select
                  id="generate-depth"
                  className="sm:w-96"
                  {...form.register('depth')}
                >
                  {Object.entries(DEPTH_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>

              {outOfQuota && (
                <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
                  You have used all {quota.data?.limit} units this month. You can
                  still add cards by hand from any deck, and everything you already have
                  keeps working.
                </p>
              )}

              <Button type="submit" disabled={form.formState.isSubmitting || outOfQuota}>
                <SparklesIcon /> Generate cards
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {!started && (
        <p className="text-muted-foreground text-xs">
          Generated text is written by a language model and is wrong often enough to
          matter. Nothing reaches a deck until you accept it.
        </p>
      )}
    </div>
  );
}

function GenerationPanel({
  state,
  onCancel,
  onStartOver,
  onReview,
}: {
  state: ReturnType<typeof useGenerateCards>['state'];
  onCancel: () => void;
  onStartOver: () => void;
  onReview: (deckId: string) => void;
}) {
  const streaming = state.status === 'streaming';
  const pending = streaming ? Math.max(0, state.expected - state.cards.length) : 0;
  const hasCards = state.cards.length > 0;

  const arrived = state.cards.length;
  const progress =
    state.expected > 0 ? Math.min(100, (arrived / state.expected) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Sticky: the list below grows past the fold while it fills, and the count
          and the Stop button are the two things that must not scroll away. */}
      <Card className="bg-background/90 sticky top-20 z-30 gap-4 py-4 backdrop-blur-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">
              {streaming ? (
                <>
                  Writing cards —{' '}
                  <span className="font-mono tabular-nums">{arrived}</span> of{' '}
                  <span className="font-mono tabular-nums">{state.expected}</span> so far
                </>
              ) : (
                `${plural(arrived, 'card')} ready`
              )}
            </p>
            <p className="text-muted-foreground text-sm">
              {streaming
                ? 'Cards are saved as they arrive, so you can leave this page and come back.'
                : 'Nothing is in your deck until you accept it.'}
            </p>
          </div>

          <div className="flex gap-2">
            {streaming ? (
              <Button variant="outline" onClick={onCancel}>
                <SquareIcon /> Stop
              </Button>
            ) : (
              <>
                {hasCards && state.deckId && (
                  <Button onClick={() => onReview(state.deckId!)}>Review cards</Button>
                )}
                <Button variant="ghost" onClick={onStartOver}>
                  Start over
                </Button>
              </>
            )}
          </div>
        </CardContent>

        {streaming && (
          <CardContent>
            <div className="bg-muted h-1 overflow-hidden rounded-full" aria-hidden>
              <div
                className="bg-foreground h-full rounded-full transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </CardContent>
        )}
      </Card>

      {state.error && <StreamError message={state.error.message} />}

      {state.status === 'cancelled' && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
          Stopped. {plural(state.cards.length, 'card')} were saved as drafts and are
          waiting for you at the review gate.
        </p>
      )}

      <StagingList cards={state.cards} pending={pending} skipped={state.skipped} />

      {!streaming && !hasCards && !state.error && (
        <p className="text-muted-foreground text-sm">No cards were produced.</p>
      )}
    </div>
  );
}

/**
 * A refusal, as a sentence that stays on the page.
 *
 * Not a toast: quota and rate-limit refusals are the two messages a user most
 * needs to still be able to read ten seconds later (P2 task 6), and a toast that
 * has vanished is indistinguishable from an app that did nothing.
 */
function StreamError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="border-destructive/40 bg-destructive/5 text-foreground rounded-lg border p-3 text-sm"
    >
      {message}
    </p>
  );
}

/**
 * How long the passage is, against the two limits that decide whether it can be
 * sent at all.
 *
 * A character count alone answers "how many" and not "is that enough" — the
 * question someone pasting a page actually has. The bar puts the count between
 * the minimum and the maximum, so being 400 characters short reads as a
 * distance rather than as a number to compare against a sentence in the card
 * header. The limits themselves are still enforced server-side (SPEC §7.5);
 * this is only the readout.
 */
function SourceMeter({ chars, tokens }: { chars: number; tokens: number }) {
  const { minChars, maxChars } = GENERATION_LIMITS;
  const filled = Math.min(100, (chars / maxChars) * 100);
  const short = chars > 0 && chars < minChars;
  const over = chars > maxChars;

  return (
    <div className="space-y-1.5 pt-1">
      <div className="bg-muted relative h-1 overflow-hidden rounded-full">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-200',
            over ? 'bg-destructive' : short ? 'bg-muted-foreground' : 'bg-foreground',
          )}
          style={{ width: `${filled}%` }}
        />
        {/* Where "long enough to be worth sending" starts. */}
        <span
          aria-hidden
          className="bg-background absolute inset-y-0 w-px"
          style={{ left: `${(minChars / maxChars) * 100}%` }}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        <span className="text-foreground font-mono tabular-nums">
          {chars.toLocaleString()}
        </span>{' '}
        of {maxChars.toLocaleString()} characters · about{' '}
        <span className="font-mono tabular-nums">{tokens.toLocaleString()}</span> tokens
        {short && ` · ${(minChars - chars).toLocaleString()} more to reach the minimum`}
        {over && ` · ${(chars - maxChars).toLocaleString()} over the maximum`}
      </p>
    </div>
  );
}

function QuotaNote({ remaining, limit }: { remaining?: number; limit?: number }) {
  if (remaining === undefined || limit === undefined) return null;
  return (
    <span>
      <span className="text-foreground font-mono tabular-nums">{remaining}</span> of{' '}
      <span className="font-mono tabular-nums">{limit}</span> units left this month
      ·{' '}
      <Link to="/settings" className="underline underline-offset-4">
        settings
      </Link>
    </span>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}
