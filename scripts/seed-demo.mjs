#!/usr/bin/env node
/**
 * Fills the demo account with a plausible life: four generated decks and about
 * two months of review history.
 *
 *   npm run demo:seed            # refuses if the account already has decks
 *   npm run demo:seed -- --reset # deletes them first, then rebuilds
 *
 * Why this exists: a stranger who signs up sees an empty app, and the product's
 * argument does not survive an empty app (P4 task 7). The demo account is what a
 * first visit can be pointed at — so it has to show the flagship flow's *output*,
 * which means the cards are really generated, not typed here.
 *
 * ── Rewritten at P10 task 11, for Cognito and the API ─────────────────────
 *
 * P9 moved decks, cards and reviews onto RDS behind an HTTP API and moved
 * identity to Cognito, which broke this script. P9 could not fix it because
 * generation still lived on Supabase, so there was no single backend to point it
 * at. Task 9 moved the text path onto the job pipeline, and that is what makes
 * this fixable rather than merely broken.
 *
 * It now signs in to **Cognito** and every write a *user* could make goes
 * through the **API** with that token.
 *
 * Three rules it still follows, all of them load-bearing:
 *
 *  1. **It writes as the demo user, through the interface the app uses.** No
 *     admin bypass of the tenancy boundary: every row it creates through the API
 *     is one the app itself could have created. What RLS used to guarantee is
 *     now ADR 0008's discipline, and this script stays inside it.
 *  2. **It drives the real generation pipeline** — `POST /jobs`, the same call
 *     `/create/text` makes, then polls the same job. If the pipeline is
 *     misconfigured this script fails, and that is the entire reason it exists
 *     rather than a fixture file.
 *  3. **The history is replayed, not invented.** Every rating goes through
 *     `applyGrade`, and the card's final scheduling state is whatever those
 *     ratings actually produced. Writing plausible-looking numbers instead would
 *     put a retention figure on /progress that the schedule contradicts.
 *
 * ── The one place it goes around the API, and why ─────────────────────────
 *
 * **The review history is written straight to Postgres.** No route can write a
 * review dated in the past, and none should: the only thing that writes
 * `reviews` is `review_card`, which stamps `reviewed_at` with `now()`. Adding a
 * "replay" endpoint would mean shipping a route, in production, whose sole
 * caller is this script and which would let any client fabricate its own study
 * log — precisely what the append-only trigger exists to prevent.
 *
 * So this script is honest about being an operator tool: it uses the API
 * wherever a user could, and the database only where no user-facing route
 * exists or should. It therefore needs Postgres credentials as well as a
 * password, and it cannot seed an environment it has no direct database access
 * to.
 *
 * Configuration comes from the environment and `.env.local`:
 *
 *   VITE_API_URL, VITE_COGNITO_USER_POOL_ID, VITE_COGNITO_CLIENT_ID
 *   DEMO_EMAIL, DEMO_PASSWORD           (the demo account)
 *   PGHOST / PGUSER / … or LOCAL_PGPASSWORD, for the history write
 *
 * The account must already exist and be confirmed: sign up through the app once.
 * Imports reach into `src/lib/*.ts` directly, which is why the npm script passes
 * `--experimental-strip-types`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Grade } from '../src/lib/schemas.ts';
import { applyGrade, newCardScheduling, projectCard } from '../src/lib/fsrs.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// What the demo account contains
// ---------------------------------------------------------------------------

/** How far back the review log goes. Long enough for a heatmap to have shape. */
const HISTORY_DAYS = 60;

/**
 * Days the demo user did not study, counted back from today. Two clusters early
 * in the window and nothing in the last fortnight: a heatmap with no gaps looks
 * generated, and a gap in the last few days would mean no current streak.
 */
const SKIPPED_DAYS = new Set([57, 56, 41, 33, 32, 31, 22]);

/** Roughly one in six cards is never introduced, so /progress has a `new` slice. */
const UNSEEN_SHARE = 0.17;

/**
 * How the demo user rates. Not uniform — a real log is mostly Good, and the
 * retention split on /progress is only worth showing if Again appears at a
 * believable rate.
 */
const GRADE_WEIGHTS = [
  [Grade.Again, 0.1],
  [Grade.Hard, 0.16],
  [Grade.Good, 0.58],
  [Grade.Easy, 0.16],
];

const DECKS = [
  {
    title: 'Photosynthesis',
    kinds: ['basic', 'cloze'],
    cardCount: 14,
    depth: 'balanced',
    text: `Photosynthesis converts light energy into chemical energy stored in glucose. It runs in two stages. The light-dependent reactions occur in the thylakoid membranes of the chloroplast: chlorophyll in photosystem II absorbs photons, water is split (photolysis) releasing oxygen, electrons pass down an electron transport chain, and the resulting proton gradient across the thylakoid membrane drives ATP synthase. Photosystem I re-energises those electrons to reduce NADP+ to NADPH.

The light-independent reactions, the Calvin cycle, occur in the stroma. RuBisCO fixes carbon dioxide onto ribulose bisphosphate, producing two molecules of 3-phosphoglycerate. ATP and NADPH from the light reactions reduce these to glyceraldehyde 3-phosphate, one molecule of which leaves the cycle per three turns while the rest regenerate RuBP.

RuBisCO also binds oxygen, a wasteful reaction called photorespiration that increases with temperature. C4 plants such as maize concentrate carbon dioxide in bundle sheath cells to suppress it; CAM plants such as cacti open their stomata at night and store carbon as malate until daylight.`,
  },
  {
    title: 'How Postgres indexes work',
    kinds: ['basic', 'mcq'],
    cardCount: 14,
    depth: 'deep',
    text: `A Postgres B-tree index stores keys in sorted order, so the planner can use it for equality, for range scans, and to satisfy an ORDER BY without a sort. An index on (a, b) can serve a predicate on a alone, or on a and b together, but not on b alone: the leading column determines what the index can seek to.

Not every index scan reads the table. An index-only scan is possible when every column the query needs is present in the index and the visibility map says the page is all-visible; otherwise Postgres must visit the heap to check row visibility, because indexes do not store transaction information.

A partial index carries a WHERE clause and indexes only matching rows, which keeps it small when queries always filter the same way. Expression indexes store the result of a function, and only queries using the identical expression can match.

GIN indexes invert composite values, mapping each element to the rows containing it, which is what makes jsonb containment and full-text search fast; they are slower to update than B-trees. Statistics collected by ANALYZE drive the planner's cost estimates, and a stale estimate is the usual reason a perfectly good index is ignored.`,
  },
  {
    title: 'The Roman Republic',
    kinds: ['basic', 'cloze', 'mcq'],
    cardCount: 12,
    depth: 'balanced',
    text: `The Roman Republic was founded traditionally in 509 BC with the expulsion of the last king, Tarquin the Proud. It replaced monarchy with two annually elected consuls who held imperium and could veto one another. The Senate, an unelected body of former magistrates, controlled finance and foreign policy by custom rather than by law.

The Conflict of the Orders was the long struggle by the plebeians for political rights against the patrician aristocracy. It produced the tribunes of the plebs, whose persons were sacrosanct and who could veto magistrates; the Twelve Tables, the first written codification of Roman law, around 450 BC; and eventually the Lex Hortensia of 287 BC, which made plebiscites binding on all citizens.

Expansion followed. The Punic Wars against Carthage between 264 and 146 BC brought Sicily, Spain and North Africa under Roman control, and Hannibal's crossing of the Alps in 218 BC came close to ending the Republic outright. Wealth from conquest concentrated land in fewer hands, and the reforms attempted by the Gracchi brothers ended in political violence. The civil wars of Marius and Sulla, then of Caesar and Pompey, ended the Republic in practice long before Augustus formalised its end in 27 BC.`,
  },
  {
    title: 'Memory and spaced repetition',
    kinds: ['basic', 'cloze'],
    cardCount: 12,
    depth: 'recall',
    text: `Hermann Ebbinghaus, experimenting on himself with nonsense syllables in the 1880s, produced the first forgetting curve: retention falls steeply within hours of learning and then flattens out. He also documented the spacing effect, the finding that repetitions distributed over time produce far more durable memory than the same number massed together.

The testing effect, or retrieval practice, is the finding that trying to recall information strengthens memory more than re-reading it does, even when the attempt fails and is then corrected. Difficulty is part of the mechanism: retrieval that is effortful but successful produces the largest gain, which Bjork called a desirable difficulty.

Modern scheduling algorithms exploit both effects. SM-2, published with SuperMemo in 1987, adjusts an ease factor per card and multiplies the interval by it after each successful recall. FSRS instead models memory with three variables — retrievability, the probability of recall right now; stability, how slowly that probability decays; and difficulty, how much each successful review raises stability — and schedules each card for the day its predicted retrievability crosses a target, by default 0.9.`,
  },
];

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Minimal `.env.local` reader: KEY=value, `#` comments, no quoting rules. */
function readEnvFile(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const values = {};
  for (const line of raw.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return values;
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}


function loadConfig() {
  const file = readEnvFile(join(root, '.env.local'));
  const read = key => process.env[key] ?? file[key];

  const config = {
    apiUrl: (read('VITE_API_URL') ?? '').replace(/\/+$/, ''),
    userPoolId: read('VITE_COGNITO_USER_POOL_ID'),
    clientId: read('VITE_COGNITO_CLIENT_ID'),
    email: read('DEMO_EMAIL'),
    password: read('DEMO_PASSWORD'),
  };

  const missing = Object.entries({
    apiUrl: 'VITE_API_URL',
    userPoolId: 'VITE_COGNITO_USER_POOL_ID',
    clientId: 'VITE_COGNITO_CLIENT_ID',
    email: 'DEMO_EMAIL',
    password: 'DEMO_PASSWORD',
  })
    .filter(([field]) => !config[field])
    .map(([, name]) => name);
  if (missing.length) {
    fail(
      `Missing configuration: ${missing.join(', ')}.\n` +
        'The API and Cognito values come from .env.local; DEMO_EMAIL and ' +
        'DEMO_PASSWORD from your shell.',
    );
  }

  // The pool id carries its own region, the same derivation dev-api.mjs makes.
  config.region = config.userPoolId.split('_')[0];

  // Postgres, for the history write only. The defaults match
  // services/api/src/lib/db.ts, so a local run needs nothing but the password —
  // which comes from LOCAL_PGPASSWORD rather than PGPASSWORD for the reason
  // .env.local gives: loading that file must not repoint every psql in a shell.
  process.env['PGHOST'] ??= 'localhost';
  process.env['PGPORT'] ??= '5432';
  process.env['PGDATABASE'] ??= 'synapsedeck';
  process.env['PGUSER'] ??= 'synapsedeck_app';
  if (!process.env['PGPASSWORD'] && file['LOCAL_PGPASSWORD']) {
    process.env['PGPASSWORD'] = file['LOCAL_PGPASSWORD'];
  }

  return config;
}


// ---------------------------------------------------------------------------
// Determinism and dates
// ---------------------------------------------------------------------------

/** Seeded PRNG (mulberry32), so two runs produce the same-shaped history. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(20260813);

function pickGrade() {
  let roll = random();
  for (const [grade, weight] of GRADE_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return grade;
  }
  return Grade.Good;
}

const DAY_MS = 86_400_000;

/**
 * How many calendar days ago a moment falls — not how many 24-hour periods.
 *
 * The difference is the whole bug this replaced: measuring elapsed milliseconds
 * puts an evening review one bucket earlier than the evening it happened in
 * whenever the seeder runs before that hour, which quietly dropped reviews onto
 * the days the demo user is supposed to have skipped. /progress buckets by local
 * calendar day (`studyDayKey`), so this does too.
 */
function dayOffsetOf(time) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const then = new Date(time);
  then.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - then.getTime()) / DAY_MS);
}

/**
 * A believable moment to have studied on a given day: an evening session, cards
 * a minute or two apart. Local time, because that is the timezone the demo
 * profile carries and the one /progress buckets by.
 */
function studyMoment(dayOffset) {
  const at = new Date(Date.now() - dayOffset * DAY_MS);
  at.setHours(19, 5 + Math.floor(random() * 40), Math.floor(random() * 60), 0);
  return at;
}

// ---------------------------------------------------------------------------
// Cognito, and the API
// ---------------------------------------------------------------------------

/**
 * Sign in as the demo user and return an access token.
 *
 * Called over plain HTTPS rather than through
 * `@aws-sdk/client-cognito-identity-provider`: it is one JSON POST with one
 * header, and the reasoning `dev-api.mjs` gives for hand-verifying a JWT applies
 * here too — a dependency added for a single call in a dev-only script is a
 * dependency in every install for everyone.
 *
 * `USER_PASSWORD_AUTH` is the unauthenticated flow. The app client enables
 * `ADMIN_USER_PASSWORD_AUTH` instead (`infra/lib/auth-stack.ts`), which is
 * admin-only and needs SigV4-signed credentials — so on the deployed pool this
 * call is expected to be refused, and the error below says exactly what to do
 * about it rather than leaving a Cognito error code to decode.
 */
async function cognitoSignIn(config) {
  const response = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: config.clientId,
      AuthParameters: { USERNAME: config.email, PASSWORD: config.password },
    }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const type = String(body.__type ?? '').split('#').pop();
    const detail = body.message ?? type ?? String(response.status);
    fail(
      [
        `Cognito refused the sign-in: ${detail}`,
        '',
        'If that mentions USER_PASSWORD_AUTH not being enabled, this pool allows',
        'ADMIN_USER_PASSWORD_AUTH instead — deliberately, so the SPA cannot use it.',
        'Run this against a pool with USER_PASSWORD_AUTH enabled, or extend this',
        'script to call AdminInitiateAuth with SigV4-signed IAM credentials.',
        '',
        'If it mentions the username or password, check DEMO_EMAIL and',
        'DEMO_PASSWORD, and that the account has been confirmed.',
      ].join('\n'),
    );
  }

  const token = body.AuthenticationResult?.AccessToken;
  if (!token) {
    fail(
      `Cognito returned a challenge (${body.ChallengeName ?? 'unknown'}) rather ` +
        'than a token. Sign in through the app once to clear it, then run this again.',
    );
  }
  return token;
}

/** The `sub` claim: the user id every row is keyed by. */
function subjectOf(accessToken) {
  const payload = accessToken.split('.')[1];
  const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return JSON.parse(json.toString('utf8')).sub;
}

/** One API call as the demo user. Throws carrying the server's own words. */
async function apiCall(config, token, method, path, body) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 204) return undefined;
  const text = await response.text();
  const parsed = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    throw new Error(
      `${method} ${path} answered ${response.status}: ${parsed.error ?? text.slice(0, 300)}`,
    );
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Generation — the real pipeline, driven the way /create/text drives it
// ---------------------------------------------------------------------------

/** How long to wait for one job before giving up on it. */
const JOB_TIMEOUT_MS = 5 * 60_000;

/**
 * Generate one deck, and wait for the job to finish.
 *
 * `POST /jobs` with `text` — the same call `/create/text` makes since task 9,
 * and the same one `/create/document` makes with an `objectKey` instead. Rule 2
 * is what makes doing it the slow way worthwhile: if the pipeline is broken this
 * script fails, rather than quietly producing a deck by some other route.
 *
 * Then poll `GET /jobs/{id}`, which is what `useJobProgress` does. The backoff is
 * not copied: a script watching a job it started can afford a flat two seconds,
 * and what matters here is the outcome rather than the responsiveness.
 */
async function generateDeck(config, token, deck) {
  const started = await apiCall(config, token, 'POST', '/jobs', {
    text: deck.text,
    deckTitle: deck.title,
    cardCount: deck.cardCount,
    kinds: deck.kinds,
    depth: deck.depth,
  });

  const startedAt = Date.now();
  for (;;) {
    if (Date.now() - startedAt > JOB_TIMEOUT_MS) {
      throw new Error(
        `job ${started.jobId} did not finish within ${JOB_TIMEOUT_MS / 1000}s`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    const job = await apiCall(config, token, 'GET', `/jobs/${started.jobId}`);

    if (job.status === 'failed') {
      throw new Error(`job ${started.jobId} failed: ${job.error ?? 'no reason given'}`);
    }
    if (job.status !== 'succeeded') continue;

    // Placeholder cards would make a demo account that demonstrates nothing:
    // every card would read "[STUB CARD — not real content]". Refuse rather than
    // fill the one account strangers see with text that says it is fake.
    if (job.providers.includes('stub')) {
      fail(
        [
          'The pipeline is running with CARD_PROVIDER=stub, so these are',
          'placeholder cards. Seeding the demo account with them would fill the',
          'one account a stranger sees with text saying it is not real.',
          '',
          'Point CARD_PROVIDER at a real provider and run this again.',
        ].join('\n'),
      );
    }

    if (job.chunksFailed) {
      console.log(`    ${job.chunksFailed} section(s) produced no cards`);
    }

    return {
      deckId: job.deckId,
      // The payloads themselves: since task 4 the drafts live in DynamoDB, so
      // accepting them means creating the cards from these.
      payloads: job.cards,
      elapsedMs: Date.now() - startedAt,
      units: started.units,
    };
  }
}

/**
 * The review gate, accepted wholesale. Mirrors what `ReviewGatePage` does; the
 * demo is not the place to model a user rejecting cards.
 */
async function acceptDeck(config, token, deckId, payloads) {
  const created = await apiCall(config, token, 'POST', `/decks/${deckId}/cards`, {
    payloads,
  });
  await apiCall(config, token, 'POST', `/decks/${deckId}/finish-gate`);
  return created.map(card => card.id);
}
// ---------------------------------------------------------------------------
// History — replayed through the scheduler, never invented
// ---------------------------------------------------------------------------

/**
 * Replay one card from its introduction to now.
 *
 * Each rating is applied by `applyGrade` at the moment the card actually came
 * up, and the next review happens when that rating said it should — a day late
 * now and then, because nobody clears their queue every single day. What comes
 * back is the `reviews` rows and the card's final scheduling state, and the two
 * agree by construction rather than by luck.
 */
export function replayCard(userId, cardId, introDay) {
  let scheduling = newCardScheduling(studyMoment(introDay));
  let at = new Date(scheduling.due);
  const rows = [];

  // A card cannot outlive its own history; the cap only stops a pathological
  // learning-step loop from running forever.
  for (let step = 0; step < 60; step += 1) {
    const result = applyGrade(scheduling, pickGrade(), at, {
      durationMs: 2500 + Math.floor(random() * 9000),
    });
    const log = result.log;

    rows.push({
      user_id: userId,
      card_id: cardId,
      rating: log.rating,
      reviewed_at: log.reviewed_at,
      duration_ms: log.duration_ms,
      state_before: log.state_before,
      stability_before: log.stability_before,
      difficulty_before: log.difficulty_before,
      due_before: log.due_before,
      last_review_before: log.last_review_before,
      // The card's own stale counter, which is what undo has to put back — not
      // the same number as `elapsed_days`, which is what actually elapsed.
      elapsed_days_before: scheduling.elapsed_days,
      learning_steps_before: log.learning_steps_before,
      elapsed_days: log.elapsed_days,
      scheduled_days: log.scheduled_days,
      state_after: log.state_after,
      stability_after: log.stability_after,
      difficulty_after: log.difficulty_after,
    });

    scheduling = projectCard(scheduling, result);

    const due = new Date(scheduling.due).getTime();
    if (due > Date.now()) break;

    // A learning card comes back within the same sitting; one due on a later day
    // waits for that evening's session, and sometimes the one after it.
    const dueDay = dayOffsetOf(due);
    let next =
      dueDay === dayOffsetOf(at.getTime())
        ? new Date(due + (3 + random() * 25) * 60_000)
        : studyMoment(Math.max(0, dueDay - (random() < 0.25 ? 1 : 0)));

    // Days the user did not study are days on which nothing was rated: the card
    // waits, it does not get answered early.
    while (SKIPPED_DAYS.has(dayOffsetOf(next.getTime()))) {
      next = new Date(next.getTime() + DAY_MS);
    }

    // Session times are drawn at random within the evening, so the next draw can
    // land before the last one. A review log that goes backwards is not a log.
    if (next.getTime() <= at.getTime()) {
      next = new Date(at.getTime() + (3 + random() * 25) * 60_000);
    }

    if (next.getTime() > Date.now()) break;
    at = next;
  }

  return { rows, scheduling };
}


/**
 * Write the replayed history straight to Postgres.
 *
 * **The one place this script goes around the API**, and the header says why.
 * `reviews` is append-only by trigger, which this respects: these are inserts,
 * and nothing here updates or deletes one.
 *
 * Every statement carries `user_id`, matching ADR 0008's discipline even though
 * this is an operator tool rather than a request handler. A seeder that ignores
 * the tenancy rule because "it is only a script" is how the rule stops being a
 * rule.
 *
 * One transaction: a seed that fails half way should leave nothing behind rather
 * than an account carrying scheduling state with no reviews to explain it.
 */
async function seedHistory(pool, userId, cardIds) {
  // The days the demo user studied, oldest first. Introductions are spread
  // across all of them, so every one has at least one review on it and the
  // streak runs unbroken to today.
  const introDays = [];
  for (let day = HISTORY_DAYS; day >= 1; day -= 1) {
    if (!SKIPPED_DAYS.has(day)) introDays.push(day);
  }

  // Which cards were ever seen is decided first, so the ones that were can be
  // spread across the *whole* window. Deciding as we go would bunch the
  // introductions into the oldest days and leave the recent end — the part a
  // visitor actually looks at — with nothing on it.
  const seen = cardIds.filter(() => random() >= UNSEEN_SHARE);
  const reviews = [];

  const client = await pool.connect();
  try {
    await client.query('begin');

    for (const [index, cardId] of seen.entries()) {
      const introDay = introDays[Math.floor((index * introDays.length) / seen.length)];
      const { rows, scheduling } = replayCard(userId, cardId, introDay);
      reviews.push(...rows);

      await client.query(
        `update public.cards
            set fsrs_state = $3::public.fsrs_state, stability = $4, difficulty = $5,
                due = $6, last_review = $7, reps = $8, lapses = $9,
                scheduled_days = $10, elapsed_days = $11, learning_steps = $12
          where id = $2 and user_id = $1`,
        [
          userId,
          cardId,
          scheduling.fsrs_state,
          scheduling.stability,
          scheduling.difficulty,
          scheduling.due,
          scheduling.last_review,
          scheduling.reps,
          scheduling.lapses,
          scheduling.scheduled_days,
          scheduling.elapsed_days,
          scheduling.learning_steps,
        ],
      );
    }

    for (const row of reviews) {
      await client.query(
        `insert into public.reviews (
           user_id, card_id, rating, reviewed_at, duration_ms,
           state_before, stability_before, difficulty_before, due_before,
           last_review_before, elapsed_days_before, learning_steps_before,
           elapsed_days, scheduled_days,
           state_after, stability_after, difficulty_after
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          row.user_id,
          row.card_id,
          row.rating,
          row.reviewed_at,
          row.duration_ms,
          row.state_before,
          row.stability_before,
          row.difficulty_before,
          row.due_before,
          row.last_review_before,
          row.elapsed_days_before,
          row.learning_steps_before,
          row.elapsed_days,
          row.scheduled_days,
          row.state_after,
          row.stability_after,
          row.difficulty_after,
        ],
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return { introduced: seen.length, reviews: reviews.length };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Deletes every deck on the demo account, which cascades to its cards and their
 * reviews. Destructive, and deliberately behind a flag: CLAUDE.md treats
 * deleting rows as something to ask about first, and a seeder that wipes
 * whatever account it is pointed at by default is that mistake waiting for a
 * mistyped DEMO_EMAIL.
 *
 * Through the API, one deck at a time, because deleting a deck is a thing a user
 * can do — the same call the deck list makes.
 */
async function resetAccount(config, token) {
  const decks = await apiCall(config, token, 'GET', '/decks');
  if (decks.length === 0) return;

  console.log(`removing ${decks.length} existing deck(s):`);
  for (const deck of decks) {
    console.log(`  - ${deck.title}`);
    await apiCall(config, token, 'DELETE', `/decks/${deck.id}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = loadConfig();
  const reset = process.argv.includes('--reset');

  const token = await cognitoSignIn(config);
  const userId = subjectOf(token);
  console.log(`signed in as ${config.email} (${userId})`);
  console.log(`api: ${config.apiUrl}`);

  const existing = await apiCall(config, token, 'GET', '/decks');
  if (existing.length > 0 && !reset) {
    fail(
      `This account already has ${existing.length} decks. Re-run with --reset to ` +
        'delete them and rebuild, or point DEMO_EMAIL at a different account.',
    );
  }
  if (reset) await resetAccount(config, token);

  // Opened only now, so a misconfigured API fails before a database connection
  // is made, and a run that never reaches the history step never needs one.
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ max: 2 });

  try {
    const cardIds = [];
    for (const [index, deck] of DECKS.entries()) {
      // SPEC §7.5 control 4 allows three generations per 60 seconds. Jobs take
      // long enough that this rarely bites, but the fourth deck is exactly where
      // it would, and a refusal half way through a seed leaves a mess.
      if (index > 0 && index % 3 === 0) {
        console.log('\npausing 60s for the burst limiter…');
        await new Promise(resolve => setTimeout(resolve, 61_000));
      }

      console.log(`\n[${index + 1}/${DECKS.length}] generating "${deck.title}"…`);
      const generated = await generateDeck(config, token, deck);
      console.log(
        `    ${generated.payloads.length} cards in ` +
          `${Math.round(generated.elapsedMs / 1000)}s · ${generated.units} unit(s)`,
      );

      const accepted = await acceptDeck(
        config,
        token,
        generated.deckId,
        generated.payloads,
      );
      console.log(`    accepted ${accepted.length} cards`);
      cardIds.push(...accepted);
    }

    console.log(
      `\nreplaying ${HISTORY_DAYS} days of reviews over ${cardIds.length} cards…`,
    );
    const history = await seedHistory(pool, userId, cardIds);
    console.log(
      `  ${history.reviews} reviews across ${history.introduced} cards; ` +
        `${cardIds.length - history.introduced} left unseen`,
    );
  } finally {
    await pool.end();
  }

  console.log('\nDone. Sign in as the demo account and check /progress.');
}

// Importable without running, so the replay can be exercised offline.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
