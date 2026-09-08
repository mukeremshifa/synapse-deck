#!/usr/bin/env node
/**
 * Contrast, computed rather than asserted (FR1 §5.1).
 *
 * The palette in `src/styles/globals.css` is written in OKLCH, which no WCAG
 * formula speaks. This parses the tokens straight out of that file, converts
 * OKLCH → linear sRGB → relative luminance, and reports the ratio for every
 * pair the app actually renders.
 *
 * **It reads the CSS. It does not carry its own copy of the palette.** A
 * checker with its own values is a checker that keeps passing after the palette
 * has drifted away from it, which is the exact failure this phase was told to
 * avoid.
 *
 *   node scripts/check-contrast.mjs          report every pair
 *   node scripts/check-contrast.mjs --fail   exit 1 if any required pair fails
 *
 * Deliberately not wired into `check` or `verify`. Gamut clipping means a pair
 * can be "correct but 4.48", and a gate that blocks a commit on the third
 * decimal of a colour is a gate someone disables. Run it when you touch the
 * palette; the numbers it prints are the ones recorded in
 * docs/DESIGN-SYSTEM.md.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/styles/globals.css'), 'utf8');

/* ── OKLCH → sRGB ─────────────────────────────────────────────────────────
   Björn Ottosson's Oklab matrices, then clipping to the sRGB gamut. Clipping
   is what a browser does too, so a ratio here is the ratio a user gets rather
   than an idealised one. */

function oklchToLinearSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(v => Math.min(1, Math.max(0, v)));
}

/** WCAG 2.1 relative luminance, from *linear* sRGB — no second linearisation. */
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* ── Parse the tokens out of the CSS ──────────────────────────────────── */

function block(selector) {
  const re = new RegExp(`^${selector}\\s*\\{([\\s\\S]*?)^\\}`, 'm');
  const found = re.exec(css);
  if (!found) throw new Error(`No ${selector} block in globals.css`);

  const tokens = {};
  const decl = /--([a-z0-9-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g;
  let m;
  while ((m = decl.exec(found[1])) !== null) {
    const [, name, L, C, h] = m;
    tokens[name] = {
      L: Number(L),
      C: Number(C),
      h: Number(h),
      rgb: oklchToLinearSrgb(Number(L), Number(C), Number(h)),
    };
  }
  return tokens;
}

const themes = { light: block(':root'), dark: block('\\.dark') };

/* ── The pairs the app renders ────────────────────────────────────────────
   Each is [foreground, background, minimum, where]. 4.5 is WCAG AA for body
   text; 3.0 is AA for large text and for UI component boundaries (SC 1.4.11).

   A pair listed here is one some screen actually draws. Adding aspirational
   pairs would turn the report into a wish list — FR1 §7.2 is explicit that a
   token pair nothing uses yet stays unchecked until a later phase uses it. */

const PAIRS = [
  ['foreground', 'background', 4.5, 'body text on the page'],
  ['muted-foreground', 'background', 4.5, 'secondary text on the page'],
  ['muted-foreground', 'muted', 4.5, 'secondary text on a muted fill'],
  ['card-foreground', 'card', 4.5, 'text on a card'],
  ['popover-foreground', 'popover', 4.5, 'text in a popover'],
  ['primary-foreground', 'primary', 4.5, 'label on the brand field'],
  ['secondary-foreground', 'secondary', 4.5, 'label on a secondary button'],
  ['accent-foreground', 'accent', 4.5, 'label on a hover surface'],
  ['destructive-foreground', 'destructive', 4.5, 'label on a destructive button'],
  ['foreground', 'card', 4.5, 'body text on a card'],
  ['foreground', 'muted', 4.5, 'body text on a muted fill'],
  // Boundaries. `--border` is deliberately absent: it is decorative (a card
  // hairline), and SC 1.4.11 governs boundaries that carry *information*. Those
  // use `--border-strong` / `--input`, and those are what is checked. Putting
  // `--border` here would mean either a permanent FAIL row everyone learns to
  // ignore, or darkening a hairline until the app looks like a spreadsheet.
  // See rule 5 in globals.css.
  ['border-strong', 'background', 3.0, 'a meaningful boundary against the page'],
  ['border-strong', 'card', 3.0, 'a meaningful boundary against a card'],
  ['input', 'background', 3.0, 'a field outline against the page'],
  ['ring', 'background', 3.0, 'the focus ring against the page'],
  ['ring', 'card', 3.0, 'the focus ring against a card'],
  // The grade ramp, in both of its roles (rule 4 in globals.css).
  //
  // FIELD: ink sits on every stop, because RatingButtons draws one rule for the
  // row rather than four exceptions — so all four have to clear 4.5 on ink.
  ['grade-ink', 'grade-again', 4.5, 'ink on the Again field'],
  ['grade-ink', 'grade-hard', 4.5, 'ink on the Hard field'],
  ['grade-ink', 'grade-good', 4.5, 'ink on the Good field'],
  ['grade-ink', 'grade-easy', 4.5, 'ink on the Easy field'],
  // MARK: each stop sitting on the page — SessionSummary's dots, a chart
  // stroke, an icon. This is the pair the old single ramp failed at 1.22:1.
  ['grade-again-mark', 'background', 3.0, 'the Again mark against the page'],
  ['grade-hard-mark', 'background', 3.0, 'the Hard mark against the page'],
  ['grade-good-mark', 'background', 3.0, 'the Good mark against the page'],
  ['grade-easy-mark', 'background', 3.0, 'the Easy mark against the page'],
  ['grade-again-mark', 'card', 3.0, 'the Again mark against a card'],
  ['grade-easy-mark', 'card', 3.0, 'the Easy mark against a card'],
];

let failures = 0;
const rows = [];

for (const [theme, tokens] of Object.entries(themes)) {
  for (const [fgName, bgName, min, what] of PAIRS) {
    const fg = tokens[fgName];
    const bg = tokens[bgName];
    if (!fg || !bg) {
      rows.push([theme, `${fgName} on ${bgName}`, '—', min, 'MISSING', what]);
      failures += 1;
      continue;
    }
    const r = ratio(fg.rgb, bg.rgb);
    const pass = r >= min;
    if (!pass) failures += 1;
    rows.push([
      theme,
      `${fgName} on ${bgName}`,
      r.toFixed(2),
      min,
      pass ? 'pass' : 'FAIL',
      what,
    ]);
  }
}

/* ── The ramp's other requirement: lightness must climb ───────────────────
   Brief §3.6 and FR1 §3.2. The ramp has to stay legible when hue is flattened
   by deuteranopia, and only monotonic lightness gives you that. */

const RAMPS = {
  field: ['grade-again', 'grade-hard', 'grade-good', 'grade-easy'],
  mark: ['grade-again-mark', 'grade-hard-mark', 'grade-good-mark', 'grade-easy-mark'],
};
const rampRows = [];

for (const [theme, tokens] of Object.entries(themes)) {
  for (const [role, names] of Object.entries(RAMPS)) {
    const Ls = names.map(n => tokens[n]?.L);
    const climbs = Ls.every(
      (L, i) => i === 0 || (L !== undefined && Ls[i - 1] !== undefined && L > Ls[i - 1]),
    );
    const steps = Ls.slice(1).map((L, i) => (L - Ls[i]).toFixed(3));
    if (!climbs) failures += 1;
    rampRows.push([
      theme,
      role,
      Ls.join(' → '),
      steps.join(', '),
      climbs ? 'climbs' : 'NOT MONOTONIC',
    ]);
  }
}

/* ── Report ──────────────────────────────────────────────────────────── */

const pad = (s, n) => String(s).padEnd(n);

console.log('\nContrast — computed from src/styles/globals.css\n');
console.log(
  pad('theme', 7) + pad('pair', 44) + pad('ratio', 8) + pad('min', 6) + pad('', 8) + 'where',
);
console.log('-'.repeat(112));
for (const [theme, pair, r, min, verdict, what] of rows) {
  console.log(
    pad(theme, 7) + pad(pair, 44) + pad(r, 8) + pad(min.toFixed(1), 6) + pad(verdict, 8) + what,
  );
}

console.log('\nGrade ramp lightness — must climb, so value carries what hue cannot\n');
console.log(pad('theme', 7) + pad('role', 7) + pad('L values', 34) + pad('steps', 26) + 'verdict');
console.log('-'.repeat(112));
for (const [theme, role, Ls, steps, verdict] of rampRows) {
  console.log(pad(theme, 7) + pad(role, 7) + pad(Ls, 34) + pad(steps, 26) + verdict);
}

console.log(
  failures === 0
    ? '\nAll pairs meet their minimum, and the ramp climbs in both themes.\n'
    : `\n${failures} problem(s). See the FAIL rows above.\n`,
);

if (process.argv.includes('--fail') && failures > 0) process.exit(1);
