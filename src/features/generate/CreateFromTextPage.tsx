import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SparklesIcon } from 'lucide-react';

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
import { suggestDeckTitle } from '@/lib/generate';
import { estimateTokens } from '@/lib/quota';
import { api } from '@/lib/api-client';
import { queryKeys, useQuotaUsage } from '@/lib/queries';
import {
  CARD_KINDS,
  GENERATION_LIMITS,
  GenerateRequest,
  type CardKind,
  type GenerateRequestInput,
} from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { JobProgressPanel } from './JobProgressPanel';
import { useJobProgress } from './useJobProgress';

/**
 * `/create/text` — paste text, watch cards arrive (SPEC §4.1 steps 1–4).
 *
 * ── This runs the document pipeline, not a second one (P10 task 9) ────────
 *
 * It used to POST to a Supabase Edge Function and read an SSE stream. It now
 * posts to `POST /jobs` with `text` instead of an `objectKey` and polls the same
 * job the upload page polls — the *same* path, not a parallel one that happens
 * to share a schema (§8 constraint 8).
 *
 * What that buys beyond tidiness: a paste is now chunked, so a long passage no
 * longer has to fit one model call; it is priced by the same quota; and a
 * refresh mid-generation resumes, because the job is server-side state rather
 * than a stream that dies with the connection.
 *
 * What it costs, stated plainly: cards no longer appear one at a time. They
 * arrive a chunk at a time, which for a single-chunk paste means all at once at
 * the end. The streaming feel was the SSE path's one genuine advantage and it
 * does not survive the move.
 *
 * The form still validates with `GenerateRequest` so a mistake costs a message
 * rather than a round trip; the limits that matter are enforced server-side
 * (SPEC §7.5).
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
  const queryClient = useQueryClient();
  const quota = useQuotaUsage();
  const [titleTouched, setTitleTouched] = useState(false);
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const { job, percent, isFinished } = useJobProgress(jobId);

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
  const started = jobId !== undefined;

  const onSubmit = form.handleSubmit(async values => {
    setStartError(null);
    setStarting(true);
    try {
      // The same endpoint the upload page calls, with `text` where it sends an
      // `objectKey`. Everything after this point -- chunking, quota, the state
      // machine, the review gate -- is identical (P10 task 9).
      const started = await api.post<{ jobId: string; deckId: string; units: number }>(
        '/jobs',
        {
          text: values.text,
          deckTitle: values.deckTitle,
          cardCount: values.cardCount,
          kinds: values.kinds,
          depth: values.depth,
        },
      );
      setJobId(started.jobId);
      // The job has spent its units, so the figure on screen is stale.
      void queryClient.invalidateQueries({ queryKey: queryKeys.quota });
    } catch (caught) {
      // A 402 from the quota gate lands here with the shortfall already worded
      // by the server, which is why this renders the message rather than
      // composing its own.
      setStartError(
        caught instanceof Error ? caught.message : 'The cards could not be written.',
      );
    } finally {
      setStarting(false);
    }
  });

  const startOver = () => {
    setJobId(undefined);
    setStartError(null);
    form.reset();
    setTitleTouched(false);
  };

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
        <div className="space-y-4">
          {job !== undefined && (
            <JobProgressPanel
              job={job}
              percent={percent}
              isFinished={isFinished}
              busyLabel="Reading the text…"
              onReview={deckId => navigate(`/create/review/${deckId}`)}
              onRetry={startOver}
              retryLabel="Start over"
            />
          )}
          {isFinished && (
            <Button variant="ghost" onClick={startOver}>
              Start over
            </Button>
          )}
        </div>
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

              {/*
                The server's own words. A 402 from the quota gate arrives with
                the shortfall already worded ("this needs 13 units and you have
                1 left"), and rephrasing it here would be the second place that
                sentence lives.
              */}
              {startError !== null && <StreamError message={startError} />}

              <Button type="submit" disabled={starting || outOfQuota}>
                <SparklesIcon /> {starting ? 'Starting…' : 'Generate cards'}
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
