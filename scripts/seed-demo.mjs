#!/usr/bin/env node
/**
 * Fills the demo account with a plausible life: a notebook per subject, all four
 * artifact kinds generated from real sources, about two months of review history
 * on the decks, and finished sittings on the quizzes and exams.
 *
 *   npm run demo:seed            # refuses if the account already has notebooks
 *   npm run demo:seed -- --reset # deletes them first, then rebuilds
 *
 * ── Rewritten again for FR7 ───────────────────────────────────────────────
 *
 * The previous version seeded the pre-FR7 product and had stopped matching the
 * app in two ways, one fatal and one quiet.
 *
 * **Fatal:** it drove `POST /jobs` → `POST /decks/{id}/cards`, the legacy deck
 * pipeline. The app's surfaces read notebooks, artifacts, questions and
 * attempts, so a freshly seeded account opened on an empty Notebooks view — the
 * flagship screen showing nothing at all.
 *
 * **Quiet:** of the four artifact kinds, it produced one. `quiz`, `noteset` and
 * `exam` were never created, no attempt or answer was ever written, and of the
 * eight question kinds only `mcq` existed anywhere in the data. Every surface
 * built for the other seven — and every review screen — had nothing to render,
 * which is indistinguishable from those surfaces being broken.
 *
 * So generation now goes through `POST /notebooks/{id}/jobs`, twice per
 * notebook: once to add the source, once per artifact built from it. That is
 * the same pair of calls the app makes, which is the point.
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
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
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

/**
 * What the demo account contains: one notebook per subject, each with one
 * source and the artifacts built from it.
 *
 * **Every artifact kind appears, and appears more than once.** The old shape
 * was a flat list of decks, which is why three of the four kinds were missing
 * from the seeded account entirely — the data could only be as varied as this
 * constant, and this constant knew about decks.
 *
 * Question counts are deliberately small. Generation is the slow, paid part of
 * this script, and a demo needs a quiz that looks like a quiz rather than a
 * long one.
 */
const NOTEBOOKS = [
  {
    title: "Biology — photosynthesis",
    source: {
      title: "Photosynthesis",
      text: `Photosynthesis converts light energy into chemical energy stored in glucose. It runs in two stages. The light-dependent reactions occur in the thylakoid membranes of the chloroplast: chlorophyll in photosystem II absorbs photons, water is split (photolysis) releasing oxygen, electrons pass down an electron transport chain, and the resulting proton gradient across the thylakoid membrane drives ATP synthase. Photosystem I re-energises those electrons to reduce NADP+ to NADPH.

The light-independent reactions, the Calvin cycle, occur in the stroma. RuBisCO fixes carbon dioxide onto ribulose bisphosphate, producing two molecules of 3-phosphoglycerate. ATP and NADPH from the light reactions reduce these to glyceraldehyde 3-phosphate, one molecule of which leaves the cycle per three turns while the rest regenerate RuBP.

RuBisCO also binds oxygen, a wasteful reaction called photorespiration that increases with temperature. C4 plants such as maize concentrate carbon dioxide in bundle sheath cells to suppress it; CAM plants such as cacti open their stomata at night and store carbon as malate until daylight.`,
    },
    artifacts: [
      { kind: 'deck', title: 'Photosynthesis — core recall', cardCount: 14, cardKinds: ['basic', 'cloze'] },
      { kind: 'quiz', title: 'Photosynthesis — check yourself', questionCount: 8 },
      { kind: 'noteset', title: 'Photosynthesis — study notes', topicCount: 4 },
    ],
  },
  {
    title: "Databases — Postgres internals",
    source: {
      title: "How Postgres indexes work",
      text: `A Postgres B-tree index stores keys in sorted order, so the planner can use it for equality, for range scans, and to satisfy an ORDER BY without a sort. An index on (a, b) can serve a predicate on a alone, or on a and b together, but not on b alone: the leading column determines what the index can seek to.

Not every index scan reads the table. An index-only scan is possible when every column the query needs is present in the index and the visibility map says the page is all-visible; otherwise Postgres must visit the heap to check row visibility, because indexes do not store transaction information.

A partial index carries a WHERE clause and indexes only matching rows, which keeps it small when queries always filter the same way. Expression indexes store the result of a function, and only queries using the identical expression can match.

GIN indexes invert composite values, mapping each element to the rows containing it, which is what makes jsonb containment and full-text search fast; they are slower to update than B-trees. Statistics collected by ANALYZE drive the planner's cost estimates, and a stale estimate is the usual reason a perfectly good index is ignored.`,
    },
    artifacts: [
      { kind: 'deck', title: 'Index behaviour', cardCount: 14, cardKinds: ['basic', 'mcq'], depth: 'deep' },
      { kind: 'quiz', title: 'Indexes — quick quiz', questionCount: 8 },
      { kind: 'exam', title: 'Postgres indexes — mock paper', questionCount: 12, durationMinutes: 25 },
    ],
  },
  {
    title: "History — the Roman Republic",
    source: {
      title: "The Roman Republic",
      text: `The Roman Republic was founded traditionally in 509 BC with the expulsion of the last king, Tarquin the Proud. It replaced monarchy with two annually elected consuls who held imperium and could veto one another. The Senate, an unelected body of former magistrates, controlled finance and foreign policy by custom rather than by law.

The Conflict of the Orders was the long struggle by the plebeians for political rights against the patrician aristocracy. It produced the tribunes of the plebs, whose persons were sacrosanct and who could veto magistrates; the Twelve Tables, the first written codification of Roman law, around 450 BC; and eventually the Lex Hortensia of 287 BC, which made plebiscites binding on all citizens.

Expansion followed. The Punic Wars against Carthage between 264 and 146 BC brought Sicily, Spain and North Africa under Roman control, and Hannibal's crossing of the Alps in 218 BC came close to ending the Republic outright. Wealth from conquest concentrated land in fewer hands, and the reforms attempted by the Gracchi brothers ended in political violence. The civil wars of Marius and Sulla, then of Caesar and Pompey, ended the Republic in practice long before Augustus formalised its end in 27 BC.`,
    },
    artifacts: [
      { kind: 'deck', title: 'Republic — dates and offices', cardCount: 12, cardKinds: ['basic', 'cloze', 'mcq'] },
      { kind: 'noteset', title: 'Republic — narrative notes', topicCount: 4 },
      { kind: 'exam', title: 'The Roman Republic — paper 1', questionCount: 12, durationMinutes: 30 },
    ],
  },
  {
    title: "Learning science",
    source: {
      title: "Memory and spaced repetition",
      text: `Hermann Ebbinghaus, experimenting on himself with nonsense syllables in the 1880s, produced the first forgetting curve: retention falls steeply within hours of learning and then flattens out. He also documented the spacing effect, the finding that repetitions distributed over time produce far more durable memory than the same number massed together.

The testing effect, or retrieval practice, is the finding that trying to recall information strengthens memory more than re-reading it does, even when the attempt fails and is then corrected. Difficulty is part of the mechanism: retrieval that is effortful but successful produces the largest gain, which Bjork called a desirable difficulty.

Modern scheduling algorithms exploit both effects. SM-2, published with SuperMemo in 1987, adjusts an ease factor per card and multiplies the interval by it after each successful recall. FSRS instead models memory with three variables — retrievability, the probability of recall right now; stability, how slowly that probability decays; and difficulty, how much each successful review raises stability — and schedules each card for the day its predicted retrievability crosses a target, by default 0.9.`,
    },
    artifacts: [
      { kind: 'deck', title: 'Memory — key findings', cardCount: 12, cardKinds: ['basic', 'cloze'], depth: 'recall' },
      { kind: 'quiz', title: 'Spacing and testing effects', questionCount: 8 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/**
 * Minimal `.env.local` reader: KEY=value, `#` comments, no quoting rules.
 *
 * Splits on `\r?\n`, not `\n`. On a CRLF file — which is what a checkout on
 * Windows produces — every line ends in a carriage return, and `.` does not
 * match one, so `(.*)$` could never reach the end of the string and *no* line
 * matched. The reader returned an empty object, and the failure surfaced as
 * `Missing configuration: VITE_API_URL, …` naming five values that were sitting
 * in the file all along, which sends you looking at the wrong thing entirely.
 */
function readEnvFile(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
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

  /*
   * Postgres, for the history write only.
   *
   * **`.env.local`'s own `PG*` values are read, and they win over the defaults.**
   * They were not, and the bug that caused was silent in the worst way: the
   * shell rarely exports `PGHOST`, so `??=` fell through to `localhost` and the
   * seeder connected to a *different database from the API it had just written
   * through*. Every card id it had collected was genuinely absent there, so the
   * replay wrote no history at all and said "41 cards no longer exist" — a
   * sentence that describes what it saw and none of what was wrong.
   *
   * The precedence is: the real environment first, then `.env.local`, then the
   * local defaults that match `services/api/src/lib/db.ts`.
   *
   * The password follows the host it belongs to. `.env.local`'s own
   * `PGPASSWORD` is preferred, because that is the one that goes with its
   * `PGHOST`; `LOCAL_PGPASSWORD` is the fallback, and is only right when the
   * host is the local default. Taking `LOCAL_PGPASSWORD` first sends the local
   * password to a managed host and fails authentication — the two values exist
   * precisely because they are passwords for different databases.
   */
  const pgDefaults = {
    PGHOST: 'localhost',
    PGPORT: '5432',
    PGDATABASE: 'synapsedeck',
    PGUSER: 'synapsedeck_app',
  };
  for (const [key, fallback] of Object.entries(pgDefaults)) {
    process.env[key] ??= file[key] ?? fallback;
  }

  const isLocalHost =
    process.env['PGHOST'] === 'localhost' || process.env['PGHOST'] === '127.0.0.1';
  process.env['PGPASSWORD'] ??= isLocalHost
    ? (file['LOCAL_PGPASSWORD'] ?? file['PGPASSWORD'])
    : (file['PGPASSWORD'] ?? file['LOCAL_PGPASSWORD']);

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
 * AWS credentials, from the environment or `~/.aws/credentials`.
 *
 * Enough of the provider chain to cover how this script is actually run, and no
 * more: environment variables first, then the shared credentials file's
 * `AWS_PROFILE` (or `default`) section. No SSO, no IMDS, no assume-role — those
 * belong to the SDK, and pulling the SDK in is what the note below rules out.
 */
function awsCredentials() {
  if (process.env['AWS_ACCESS_KEY_ID'] && process.env['AWS_SECRET_ACCESS_KEY']) {
    return {
      accessKeyId: process.env['AWS_ACCESS_KEY_ID'],
      secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'],
      sessionToken: process.env['AWS_SESSION_TOKEN'],
    };
  }

  const profile = process.env['AWS_PROFILE'] ?? 'default';
  let raw;
  try {
    raw = readFileSync(
      process.env['AWS_SHARED_CREDENTIALS_FILE'] ?? join(homedir(), '.aws', 'credentials'),
      'utf8',
    );
  } catch {
    return null;
  }

  // Walk the ini file, keeping only the requested profile's section.
  const found = {};
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      current = header[1].trim().replace(/^profile\s+/, '');
      continue;
    }
    if (current !== profile) continue;
    const entry = /^\s*([a-z_]+)\s*=\s*(.*)$/i.exec(line);
    if (entry) found[entry[1].toLowerCase()] = entry[2].trim();
  }

  if (!found['aws_access_key_id'] || !found['aws_secret_access_key']) return null;
  return {
    accessKeyId: found['aws_access_key_id'],
    secretAccessKey: found['aws_secret_access_key'],
    sessionToken: found['aws_session_token'],
  };
}

const sha256Hex = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

/**
 * Sign a Cognito request with SigV4.
 *
 * Hand-rolled, for the reason the previous version gave for hand-writing the
 * unsigned call and `dev-api.mjs` gives for hand-verifying a JWT: this is one
 * POST in a dev-only script, and `@aws-sdk/*` + `@smithy/signature-v4` are not
 * declared dependencies of this project. They resolve today only as transitive
 * ones, so importing them would work here and break on a clean install — the
 * worst kind of dependency, the sort that is missing only for someone else.
 */
function signRequest({ region, service, host, target, body, credentials }) {
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = stamp.slice(0, 8);
  const scope = `${date}/${region}/${service}/aws4_request`;

  const headers = {
    'content-type': 'application/x-amz-json-1.1',
    host,
    'x-amz-date': stamp,
    'x-amz-target': target,
    ...(credentials.sessionToken ? { 'x-amz-security-token': credentials.sessionToken } : {}),
  };

  // Signed headers must be sorted, lowercase, and match what is actually sent.
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map(name => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join('\n');

  const toSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonical),
  ].join('\n');

  const signingKey = ['aws4_request'].reduce(
    (key, part) => hmac(key, part),
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, date), region), service),
  );
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');

  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * Sign in as the demo user and return an access token.
 *
 * **`ADMIN_USER_PASSWORD_AUTH`, signed with IAM credentials.** The previous
 * version called `USER_PASSWORD_AUTH`, which the app client does not enable —
 * deliberately, so the SPA cannot use it (`infra/lib/auth-stack.ts`). That made
 * this script unrunnable against the only pool it is ever pointed at: it failed
 * every time with "USER_PASSWORD_AUTH flow not enabled for this client", and its
 * own error text told you to write this function.
 *
 * So this is that function. It is an admin flow, which is the right shape for an
 * operator tool: the seeder proves it is an operator with AWS credentials rather
 * than asking the pool to open a password flow to the whole internet.
 */
async function cognitoSignIn(config) {
  const credentials = awsCredentials();
  if (!credentials) {
    fail(
      [
        'No AWS credentials found, and this sign-in needs them.',
        '',
        'The pool enables ADMIN_USER_PASSWORD_AUTH rather than USER_PASSWORD_AUTH,',
        'so signing in as the demo user is an admin call that must be SigV4-signed.',
        '',
        'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or configure a profile in',
        '~/.aws/credentials (AWS_PROFILE selects it).',
      ].join('\n'),
    );
  }

  const host = `cognito-idp.${config.region}.amazonaws.com`;
  const target = 'AWSCognitoIdentityProviderService.AdminInitiateAuth';
  const body = JSON.stringify({
    AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
    UserPoolId: config.userPoolId,
    ClientId: config.clientId,
    AuthParameters: { USERNAME: config.email, PASSWORD: config.password },
  });

  const response = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: signRequest({
      region: config.region,
      service: 'cognito-idp',
      host,
      target,
      body,
      credentials,
    }),
    body,
  });

  const parsed = await response.json().catch(() => ({}));

  if (!response.ok) {
    const type = String(parsed.__type ?? '').split('#').pop();
    const detail = parsed.message ?? type ?? String(response.status);
    fail(
      [
        `Cognito refused the sign-in: ${detail}`,
        '',
        'If that mentions credentials or authorization, the IAM identity in use',
        'needs cognito-idp:AdminInitiateAuth on this user pool.',
        '',
        'If it mentions the username or password, check DEMO_EMAIL and',
        'DEMO_PASSWORD, and that the account has been confirmed.',
      ].join('\n'),
    );
  }

  const token = parsed.AuthenticationResult?.AccessToken;
  if (!token) {
    fail(
      `Cognito returned a challenge (${parsed.ChallengeName ?? 'unknown'}) rather ` +
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
// Generation — the notebook pipeline, driven the way the app drives it
// ---------------------------------------------------------------------------

/** How long to wait for one job before giving up on it. */
const JOB_TIMEOUT_MS = 5 * 60_000;

/**
 * How long a provider rate-limit window takes to roll over.
 *
 * Groq's free tier meters tokens per *minute*, so a minute and a little is what
 * clears it. Waiting less is not a smaller wait, it is the same wait plus a
 * wasted call.
 */
const RATE_LIMIT_WINDOW_MS = 65_000;

/**
 * Space out generation calls, so the run stays under the provider's budget
 * instead of discovering it.
 *
 * **This is the difference between a seed that finishes and one that does not.**
 * Groq's free tier allows 8,000 tokens per minute; one question-generation call
 * spends a large fraction of it, and this script makes eleven generation calls
 * in a row. Without pacing, everything after roughly the second one fails with a
 * 429 that reaches the script as "The model returned nothing usable" — a message
 * that sends you looking for a bad prompt rather than a rate limit.
 *
 * A flat wait, rather than tracking a token budget: the script cannot see the
 * provider's counter, the limit differs per account and per model, and a seeder
 * that takes a few minutes longer costs nothing. Skipped before the first call,
 * where there is nothing to wait for.
 */
let lastGenerationAt = 0;
async function pace(seconds = 45) {
  if (lastGenerationAt === 0) {
    lastGenerationAt = Date.now();
    return;
  }
  const waitMs = lastGenerationAt + seconds * 1000 - Date.now();
  if (waitMs > 0) {
    console.log(`    pacing ${Math.ceil(waitMs / 1000)}s for the provider's rate limit…`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  lastGenerationAt = Date.now();
}

/**
 * Poll one notebook job to completion.
 *
 * `GET /notebooks/{id}/jobs/{jobId}`, which is what the app's job-progress hook
 * reads. The backoff is not copied: a script watching a job it started can
 * afford a flat two seconds, and what matters here is the outcome rather than
 * the responsiveness.
 */
async function awaitJob(config, token, notebookId, jobId, label) {
  const startedAt = Date.now();
  for (;;) {
    if (Date.now() - startedAt > JOB_TIMEOUT_MS) {
      throw new Error(`${label}: job ${jobId} did not finish within ${JOB_TIMEOUT_MS / 1000}s`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));

    const job = await apiCall(
      config,
      token,
      'GET',
      `/notebooks/${notebookId}/jobs/${jobId}`,
    );

    if (job.status === 'failed') {
      throw new Error(`${label}: ${job.error?.message ?? 'no reason given'}`);
    }
    if (job.status !== 'succeeded') continue;

    if (job.unitsFailed) {
      console.log(`    ${job.unitsFailed} unit(s) produced nothing`);
    }
    return { job, elapsedMs: Date.now() - startedAt };
  }
}

/**
 * Add the notebook's source, and wait for it to be ingested.
 *
 * `POST /notebooks/{id}/jobs` with `type: 'add-source'` — the same call the app
 * makes when text is pasted into a notebook. Artifacts are generated *from*
 * sources, so nothing can be built until this has finished.
 */
async function addSource(config, token, notebookId, source) {
  const started = await apiCall(config, token, 'POST', `/notebooks/${notebookId}/jobs`, {
    type: 'add-source',
    input: { kind: 'text', title: source.title, text: source.text },
  });

  const { job } = await awaitJob(
    config,
    token,
    notebookId,
    started.id,
    `adding source "${source.title}"`,
  );

  const sourceId = job.result?.sourceId;
  if (!sourceId) throw new Error(`source job ${started.id} succeeded without a source id`);
  return sourceId;
}

/**
 * Generate one artifact from one source, and wait for it.
 *
 * The same `POST /notebooks/{id}/jobs` the app makes, with `type:
 * 'create-artifact'`. Every artifact kind goes through this one call — which is
 * the reason the seed can now produce all four without four code paths.
 */
async function generateArtifact(config, token, notebookId, sourceId, spec) {
  const request = {
    type: 'create-artifact',
    input: {
      kind: spec.kind,
      title: spec.title,
      sourceIds: [sourceId],
      depth: spec.depth ?? 'balanced',
      ...(spec.cardCount ? { cardCount: spec.cardCount } : {}),
      ...(spec.cardKinds ? { cardKinds: spec.cardKinds } : {}),
      ...(spec.questionCount ? { questionCount: spec.questionCount } : {}),
      ...(spec.topicCount ? { topicCount: spec.topicCount } : {}),
      ...(spec.kind === 'exam'
        ? {
            config: {
              questionCount: spec.questionCount ?? 12,
              durationMinutes: spec.durationMinutes ?? 30,
            },
          }
        : {}),
    },
  };

  /*
   * Retried with a long backoff, because the thing that fails here is a rate
   * limit rather than a bad model reply.
   *
   * **What the failure actually is.** Groq's free tier allows 8,000 tokens per
   * minute, and one question-generation call spends most of that. Generating
   * ten artifacts back to back exhausts the budget within the first two, and
   * every call after it returns 429 until the window rolls over.
   *
   * That is invisible from the outside: `runCreateArtifact` catches the provider
   * error per source, counts it failed, and reports the generic "The model
   * returned nothing usable." A rate limit and unparseable JSON reach this
   * script as the same sentence, which is why the first fix attempted here — a
   * fast retry — made things worse by spending the next window's budget too.
   *
   * So the backoff is a minute, not three seconds: it waits for the TPM window
   * rather than racing it. `pace()` before each job does the real work; this is
   * the recovery for when it is not enough.
   */
  const attempts = 3;
  for (let attempt = 1; ; attempt += 1) {
    await pace();

    // What the notebook held before this attempt, so the artifact this attempt
    // creates can be told apart from every artifact already there. A failed job
    // does not report its artifact id — `toJob` publishes `result` only on
    // success — so the difference is what identifies it.
    const before = new Set(await artifactIds(config, token, notebookId));

    const started = await apiCall(
      config,
      token,
      'POST',
      `/notebooks/${notebookId}/jobs`,
      request,
    );

    try {
      const { job, elapsedMs } = await awaitJob(
        config,
        token,
        notebookId,
        started.id,
        `generating ${spec.kind} "${spec.title}"`,
      );

      const artifactId = job.result?.artifactId;
      if (!artifactId) {
        throw new Error(`job ${started.id} succeeded without an artifact id`);
      }
      return { artifactId, elapsedMs };
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.log(
        `    attempt ${attempt} failed (${error.message}); waiting out the rate limit…`,
      );
      /*
       * Clean up **only this attempt's artifact**, named by the job it started.
       *
       * This deleted every failed artifact on the notebook, which was a real
       * bug and not a tidier one: a deck that generated fewer cards than asked
       * can be left `failed` *after* its cards were read back, and deleting it
       * cascades to those cards. The replay then inserted reviews against ids
       * that no longer existed and the whole history rolled back on
       * `reviews_card_id_fkey` — a failure at the very last step, blamed on the
       * card table, caused by a cleanup two artifacts earlier.
       */
      for (const id of await artifactIds(config, token, notebookId)) {
        if (!before.has(id)) {
          await apiCall(
            config,
            token,
            'DELETE',
            `/notebooks/${notebookId}/artifacts/${id}`,
          );
        }
      }
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_WINDOW_MS));
    }
  }
}

/** Every artifact id on a notebook, whatever its status. */
async function artifactIds(config, token, notebookId) {
  const artifacts = await apiCall(
    config,
    token,
    'GET',
    `/notebooks/${notebookId}/artifacts`,
  );
  const rows = Array.isArray(artifacts) ? artifacts : (artifacts.items ?? []);
  return rows.map(artifact => artifact.id);
}

/**
 * The card ids of a generated deck, in the order the artifact holds them.
 *
 * Read back rather than returned by generation: a notebook job reports *what*
 * it built, not the rows. The history replay needs the ids, and this is the
 * route the app itself uses to list a deck's cards.
 *
 * The route is paginated (`{ items, nextCursor }`), so this follows the cursor.
 * Today's decks fit in one page and the loop looks like ceremony; it is not.
 * Taking the first page only would silently leave the tail of a larger deck out
 * of the history, and a *partly* seeded deck is the kind of wrong that looks
 * right — a deck whose last cards are all inexplicably new.
 */
async function deckCardIds(config, token, notebookId, artifactId) {
  const ids = [];
  let cursor = null;
  do {
    const path =
      `/notebooks/${notebookId}/artifacts/${artifactId}/cards?limit=100` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const page = await apiCall(config, token, 'GET', path);
    ids.push(...page.items.map(card => card.id));
    cursor = page.nextCursor;
  } while (cursor);
  return ids;
}

/** The questions of a generated quiz or exam, payloads included. */
async function artifactQuestions(config, token, notebookId, artifactId) {
  return apiCall(
    config,
    token,
    'GET',
    `/notebooks/${notebookId}/artifacts/${artifactId}/questions`,
  );
}

// ---------------------------------------------------------------------------
// Sittings — attempts answered through the API, and graded by the server
// ---------------------------------------------------------------------------

/**
 * A response to one question, correct or deliberately not.
 *
 * **Every kind is handled**, which is the point: the seeded account previously
 * contained `mcq` and nothing else, so the seven other runners and every review
 * surface built for them had no data to render. Returns null for a payload this
 * does not understand, which leaves the question unanswered rather than
 * fabricating a response shape the grader would reject.
 *
 * Correctness is *not* asserted here — `POST /notebooks/{id}/attempts/{id}`
 * grades server-side and ignores anything a client claims. This only decides
 * what the demo user picked; whether that was right is the server's finding.
 */
function responseFor(payload, correct) {
  // Shift by one, wrapping, to get a wrong answer from a right one.
  const wrong = (index, length) => (length <= 1 ? index : (index + 1) % length);

  switch (payload?.kind) {
    case 'mcq': {
      const answer = payload.options.findIndex(option => option.correct);
      const index = answer < 0 ? 0 : answer;
      return { kind: 'mcq', option: correct ? index : wrong(index, payload.options.length) };
    }
    case 'msq': {
      const answer = payload.options
        .map((option, index) => (option.correct ? index : -1))
        .filter(index => index >= 0);
      if (correct) return { kind: 'msq', options: answer };
      // Dropping one selection is the realistic near-miss for select-all.
      return { kind: 'msq', options: answer.slice(0, Math.max(0, answer.length - 1)) };
    }
    case 'true_false':
      return { kind: 'true_false', value: correct ? payload.answer : !payload.answer };
    case 'numeric': {
      // Outside any tolerance, so a wrong answer is unambiguously wrong.
      const value = correct ? payload.answer : payload.answer + (payload.tolerance || 1) * 10 + 1;
      return { kind: 'numeric', value, raw: String(value) };
    }
    case 'matching': {
      const pairs = payload.pairs.map((_, index) => index);
      if (correct || pairs.length < 2) return { kind: 'matching', pairs };
      // Swap the first two, which keeps the bijection the payload requires.
      [pairs[0], pairs[1]] = [pairs[1], pairs[0]];
      return { kind: 'matching', pairs };
    }
    case 'ordering': {
      const order = payload.items.map((_, index) => index);
      if (correct || order.length < 2) return { kind: 'ordering', order };
      [order[0], order[1]] = [order[1], order[0]];
      return { kind: 'ordering', order };
    }
    case 'fill_blank': {
      const answer = payload.accepted?.[0] ?? '';
      return { kind: 'fill_blank', text: correct ? answer : `${answer} (not quite)` };
    }
    case 'categorize': {
      const assignments = payload.items.map(item => item.category);
      if (correct || assignments.length === 0) return { kind: 'categorize', assignments };
      assignments[0] = wrong(assignments[0], payload.categories.length);
      return { kind: 'categorize', assignments };
    }
    default:
      return null;
  }
}

/**
 * Sit one quiz or exam, answering most of it correctly, and submit.
 *
 * Through the API exactly as a candidate would: `POST .../attempts` to start,
 * then `POST .../attempts/{id}` to submit. **The score is never written here** —
 * the handler computes `correct` and the score from the stored questions and
 * refuses to take either from the body, so what lands in the database is a real
 * grading of these real answers.
 */
async function sitAttempt(config, token, notebookId, artifactId, accuracy) {
  const questions = await artifactQuestions(config, token, notebookId, artifactId);
  if (questions.length === 0) return null;

  const attempt = await apiCall(
    config,
    token,
    'POST',
    `/notebooks/${notebookId}/artifacts/${artifactId}/attempts`,
  );

  const answers = [];
  for (const question of questions) {
    const response = responseFor(question.payload, random() < accuracy);
    if (!response) continue;
    answers.push({
      questionId: question.id,
      response,
      flagged: false,
      elapsedMs: 8000 + Math.floor(random() * 40_000),
    });
  }

  return apiCall(
    config,
    token,
    'POST',
    `/notebooks/${notebookId}/attempts/${attempt.id}`,
    { answers },
  );
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
  let replayable = [];

  const client = await pool.connect();
  try {
    await client.query('begin');

    /*
     * Only the ids that still name a row this user owns.
     *
     * The ids were read back from the API earlier in the run, and a card can be
     * gone by now — deleting an artifact cascades to its cards, which is what a
     * failed generation's cleanup does. Inserting a review for a missing card
     * violates `reviews_card_id_fkey` and rolls back the entire history, so the
     * whole seed is lost at its last step over a card nobody would have missed.
     *
     * Checked inside the transaction, and filtered on `user_id` as every
     * statement here is: ADR 0008's rule holds for an operator tool too.
     */
    const live = await client.query(
      'select id from public.cards where user_id = $1 and id = any($2::uuid[])',
      [userId, seen],
    );
    const liveIds = new Set(live.rows.map(row => row.id));
    const missing = seen.length - liveIds.size;
    if (missing > 0) {
      console.log(`  ${missing} card(s) no longer exist and are skipped`);
    }

    /*
     * If *nothing* matched, this is not a tidy skip — it is the wrong database.
     *
     * A handful of missing cards is ordinary (a cleaned-up failed generation).
     * Every card missing means the API wrote somewhere this connection cannot
     * see, which is exactly what the `PGHOST` default used to cause. Saying so
     * beats writing an empty history and reporting success, which is how that
     * bug survived a full run that looked like it worked.
     */
    if (seen.length > 0 && liveIds.size === 0) {
      throw new Error(
        `none of the ${seen.length} cards just created are visible in ` +
          `${process.env['PGUSER']}@${process.env['PGHOST']}/${process.env['PGDATABASE']}. ` +
          'The API and this script are pointed at different databases — check the ' +
          'PG* values in .env.local against the API\'s.',
      );
    }

    replayable = seen.filter(cardId => liveIds.has(cardId));

    for (const [index, cardId] of replayable.entries()) {
      const introDay =
        introDays[Math.floor((index * introDays.length) / replayable.length)];
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

  return { introduced: replayable.length, reviews: reviews.length };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Deletes every notebook on the demo account, which cascades to its sources,
 * artifacts, cards, questions, attempts and reviews. Destructive, and
 * deliberately behind a flag: CLAUDE.md treats deleting rows as something to ask
 * about first, and a seeder that wipes whatever account it is pointed at by
 * default is that mistake waiting for a mistyped DEMO_EMAIL.
 *
 * Through the API, one notebook at a time, because deleting a notebook is a
 * thing a user can do — the same call the notebook list makes.
 *
 * Decks are swept too. They are the pre-FR7 shape, and an account seeded by an
 * older version of this script has them with no notebook above them; leaving
 * them would mean `--reset` did not actually reset.
 */
async function resetAccount(config, token) {
  const notebooks = await apiCall(config, token, 'GET', '/notebooks');
  if (notebooks.length > 0) {
    console.log(`removing ${notebooks.length} existing notebook(s):`);
    for (const notebook of notebooks) {
      console.log(`  - ${notebook.title}`);
      await apiCall(config, token, 'DELETE', `/notebooks/${notebook.id}`);
    }
  }

  const decks = await apiCall(config, token, 'GET', '/decks');
  if (decks.length > 0) {
    console.log(`removing ${decks.length} legacy deck(s)`);
    for (const deck of decks) {
      await apiCall(config, token, 'DELETE', `/decks/${deck.id}`);
    }
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

  const existing = await apiCall(config, token, 'GET', '/notebooks');
  if (existing.length > 0 && !reset) {
    fail(
      `This account already has ${existing.length} notebook(s). Re-run with --reset ` +
        'to delete them and rebuild, or point DEMO_EMAIL at a different account.',
    );
  }
  if (reset) await resetAccount(config, token);

  // Opened only now, so a misconfigured API fails before a database connection
  // is made, and a run that never reaches the history step never needs one.
  const { default: pg } = await import('pg');
  // SSL decided the same way `services/api/src/lib/db.ts` decides it: a managed
  // host requires TLS and a local one has none to offer. Relying on the `pg`
  // defaults connected without it, which a remote host simply refuses.
  const pgHost = process.env['PGHOST'];
  const isLocalPg = pgHost === 'localhost' || pgHost === '127.0.0.1';
  const pool = new pg.Pool({
    max: 2,
    ssl: isLocalPg ? false : { rejectUnauthorized: false },
  });
  console.log(`db:  ${process.env['PGUSER']}@${pgHost}/${process.env['PGDATABASE']}`);

  try {
    const cardIds = [];
    const sittings = [];
    let artifactCount = 0;

    for (const [index, notebook] of NOTEBOOKS.entries()) {
      console.log(`\n[${index + 1}/${NOTEBOOKS.length}] ${notebook.title}`);

      const created = await apiCall(config, token, 'POST', '/notebooks', {
        title: notebook.title,
      });

      console.log(`  adding source "${notebook.source.title}"…`);
      const sourceId = await addSource(config, token, created.id, notebook.source);

      for (const spec of notebook.artifacts) {
        console.log(`  generating ${spec.kind} "${spec.title}"…`);
        const { artifactId, elapsedMs } = await generateArtifact(
          config,
          token,
          created.id,
          sourceId,
          spec,
        );
        artifactCount += 1;
        console.log(`    done in ${Math.round(elapsedMs / 1000)}s`);

        // A deck's cards feed the FSRS replay; a quiz's or an exam's questions
        // get sat. A noteset needs neither — it is read, not answered.
        if (spec.kind === 'deck') {
          const ids = await deckCardIds(config, token, created.id, artifactId);
          console.log(`    ${ids.length} cards`);
          cardIds.push(...ids);
        } else if (spec.kind === 'quiz' || spec.kind === 'exam') {
          // Two sittings on a quiz, one on an exam: a quiz is the thing you
          // retake, and a second attempt is what makes the sittings list look
          // like a list rather than a row.
          const attempts = spec.kind === 'quiz' ? 2 : 1;
          for (let n = 0; n < attempts; n += 1) {
            // The second sitting goes better than the first, which is the whole
            // point of retaking one.
            const accuracy = n === 0 ? 0.62 : 0.85;
            const result = await sitAttempt(
              config,
              token,
              created.id,
              artifactId,
              accuracy,
            );
            if (result) {
              sittings.push(result);
              console.log(
                `    sitting ${n + 1}: scored ${Math.round((result.score ?? 0) * 100)}%`,
              );
            }
          }
        }
      }
    }

    console.log(
      `\nreplaying ${HISTORY_DAYS} days of reviews over ${cardIds.length} cards…`,
    );
    const history = await seedHistory(pool, userId, cardIds);
    console.log(
      `  ${history.reviews} reviews across ${history.introduced} cards; ` +
        `${cardIds.length - history.introduced} left unseen`,
    );

    console.log(
      `\n${NOTEBOOKS.length} notebooks · ${artifactCount} artifacts · ` +
        `${sittings.length} sittings`,
    );
  } finally {
    await pool.end();
  }

  console.log('\nDone. Sign in as the demo account and open Notebooks.');
}
// Importable without running, so the replay can be exercised offline.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
