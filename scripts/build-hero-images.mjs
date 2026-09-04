#!/usr/bin/env node
/**
 * Renders the 16:9 product hero, once per theme, into `assets/hero/`.
 *
 *   npm run hero:images            # 7680 x 4320 (8K UHD), both themes
 *   npm run hero:images -- 3840    # any width; height follows at exactly 16:9
 *   npm run hero:images -- 1600    # the size to iterate at
 *
 * These are presentation assets — a README banner, a portfolio tile, a slide —
 * and they are *not* wired into the app. `public/` is untouched, so
 * `brand:assets` stays a no-op and `src/test/brand-assets.test.ts` is unaffected.
 *
 * Everything load-bearing in `scripts/build-brand-assets.mjs` is load-bearing
 * here too, for the same reasons written out at the top of that file:
 *
 *  1. **Fonts are decompressed from the woff2 the app itself ships.** resvg reads
 *     TrueType only; handed a .woff2 it silently falls back to something that is
 *     not the brand face. `wawoff2` unpacks them first, sequentially — the
 *     decompressor returns a view onto its wasm heap, so concurrent calls
 *     overwrite each other and produce files of the right length holding the
 *     wrong glyphs.
 *  2. **Family names come from the font binary, not from the CSS.** `globals.css`
 *     says `Plus Jakarta Sans Variable`; the name resvg can match is
 *     `Plus Jakarta Sans`.
 *  3. **No `font-weight`, anywhere.** These are variable faces, and resvg matches
 *     the default instance. Asking for 600 risks the silent family fallback in
 *     (1), so hierarchy here is carried by size, colour and case instead. This is
 *     why the drawing never looks "bold" — it is not allowed to be.
 *  4. **Colours are parsed out of `globals.css`, never typed in.** Both blocks:
 *     `:root` is the light theme, `.dark` is the dark one. A hex copied into this
 *     file is a hero image that drifts from the product it is a picture of.
 *
 * The drawing is the product, not a decoration around it: the mark, the h1 that
 * `LandingPage` and `public/og-image.png` both commit to, a card mid-review at
 * the top of a stack, the four FSRS ratings with the intervals they hand out,
 * and the review heatmap that /progress counts out of the review log.
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import { decompress } from 'wawoff2';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets', 'hero');

const FAMILY = {
  serif: 'DM Serif Display',
  sans: 'Plus Jakarta Sans',
  mono: 'JetBrains Mono',
};

const WOFF2 = [
  '@fontsource/dm-serif-display/files/dm-serif-display-latin-400-normal.woff2',
  '@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2',
  '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
];

/* ---------------------------------------------------------------- colour --- */

/** oklab -> #rrggbb. Same maths as scripts/build-brand-assets.mjs. */
function oklabToHex(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return (
    '#' +
    lin
      .map(v => {
        const srgb = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
        const clamped = Math.min(255, Math.max(0, Math.round(srgb * 255)));
        return clamped.toString(16).padStart(2, '0');
      })
      .join('')
  );
}

/** The polar form the CSS is written in. */
const oklch = (L, C, hDeg) => {
  const h = (hDeg * Math.PI) / 180;
  return { L, a: C * Math.cos(h), b: C * Math.sin(h) };
};

/**
 * Both palettes, resolved to hex.
 *
 * The light theme is the `:root` block and the dark theme is `.dark`, which is
 * exactly how the app resolves them — `.dark` overrides a subset, so it is
 * layered onto light rather than read alone. Missing that layering is how a
 * token nobody thought to override would come out undefined instead of
 * inherited.
 */
function readThemes() {
  const css = readFileSync(join(root, 'src', 'styles', 'globals.css'), 'utf8');
  const slice = (from, to) => css.slice(css.indexOf(from), css.indexOf(to));

  const parse = block => {
    const tokens = {};
    for (const [, name, L, C, HUE] of block.matchAll(
      /--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g,
    )) {
      tokens[name] = oklch(Number(L), Number(C), Number(HUE));
    }
    return tokens;
  };

  const lightLab = parse(slice(':root {', '.dark {'));
  const darkLab = { ...lightLab, ...parse(slice('.dark {', '@theme inline {')) };

  /**
   * A palette the drawing can use: `t.token` is a hex string, and
   * `t.mix(a, ratio, b)` is `color-mix(in oklab, a ratio, b)` — the same
   * operation, in the same space, that `Heatmap.tsx` writes in CSS.
   */
  const palette = lab => {
    const t = Object.fromEntries(
      Object.entries(lab).map(([k, v]) => [k, oklabToHex(v.L, v.a, v.b)]),
    );
    t.mix = (aName, ratio, bName) => {
      const [A, B] = [lab[aName], lab[bName]];
      const at = (x, y) => y + (x - y) * ratio;
      return oklabToHex(at(A.L, B.L), at(A.a, B.a), at(A.b, B.b));
    };
    return t;
  };

  const light = palette(lightLab);
  const dark = palette(darkLab);

  const required = [
    'background',
    'foreground',
    'card',
    'card-foreground',
    'muted',
    'muted-foreground',
    'secondary',
    'secondary-foreground',
    'border',
    'primary',
    'primary-foreground',
    'grade-again',
    'grade-hard',
    'grade-good',
    'grade-easy',
  ];
  for (const [name, tokens] of [
    ['light', light],
    ['dark', dark],
  ]) {
    const missing = required.filter(key => !tokens[key]);
    if (missing.length) {
      console.error(`globals.css ${name}: missing ${missing.join(', ')} — renamed?`);
      process.exit(1);
    }
  }

  return { light, dark };
}

/* ----------------------------------------------------------------- fonts --- */

/** woff2 -> ttf, one at a time. The sequential loop is the fix for a real bug. */
async function unpackFonts(dir) {
  const written = [];
  for (const rel of WOFF2) {
    const dest = join(
      dir,
      rel
        .split('/')
        .pop()
        .replace(/\.woff2$/, '.ttf'),
    );
    const bytes = await decompress(readFileSync(join(root, 'node_modules', rel)));
    writeFileSync(dest, Buffer.from(bytes));
    written.push(dest);
  }
  return written;
}

/* ------------------------------------------------------------- the image --- */

/* Drawn in a 1600x900 box and rasterised up. Nothing here is in pixels of the
   output: resvg scales the vector, so 7680 is a re-render rather than an
   enlargement, and every edge and glyph is resolved at the final size. */
const W = 1600;
const H = 900;

const PAD = 100; // outer margin
const COL = 880; // where the right-hand column starts
const CW = W - PAD - COL; // 620 — the card, the ramp and the heatmap all share it

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** `<text>`, with the boilerplate that every call would otherwise repeat. */
function text(
  x,
  y,
  string,
  { family = FAMILY.sans, size = 16, fill, anchor, track, opacity } = {},
) {
  return (
    `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" fill="${fill}"` +
    (anchor ? ` text-anchor="${anchor}"` : '') +
    (track ? ` letter-spacing="${track}"` : '') +
    (opacity ? ` fill-opacity="${opacity}"` : '') +
    `>${esc(string)}</text>`
  );
}

/**
 * The review heatmap, 40 weeks of it.
 *
 * Seeded rather than random: re-running this script must produce byte-identical
 * PNGs, or the images churn in every diff for no reason. Density climbs toward
 * the right because that is what the graphic is *for* — a habit that took hold —
 * and the final column stops partway through, since today is a Wednesday
 * somewhere in it.
 *
 * **The five shades are `Heatmap.tsx`'s, not an opacity ramp.** That component
 * mixes `--primary` into `--muted` at 28 / 52 / 76 / 100%, and level 0 is
 * `--muted` alone. Fading the accent toward transparent instead looks the same
 * on the dark ground and inverts on the light one: `--primary` is oklch(0.922),
 * *lighter* than paper's `--muted` at 0.97 is dark, so a 30%-opacity cell came
 * out paler than an empty one and a quiet day read as busier than a dead one.
 * Mixing toward the same token the app mixes toward keeps the scale monotonic
 * in both themes.
 */
function heatmap(t, { x, y, cols = 40, rows = 7 }) {
  const gap = 3.5;
  const pitch = (CW + gap) / cols;
  const cell = pitch - gap;

  // A 32-bit LCG. Small, deterministic, and good enough for texture.
  let seed = 0x5eed1e;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;

  const shades = [
    t.muted,
    t.mix('primary', 0.28, 'muted'),
    t.mix('primary', 0.52, 'muted'),
    t.mix('primary', 0.76, 'muted'),
    t.primary,
  ];
  const cells = [];

  for (let c = 0; c < cols; c++) {
    // Ramp from a thin start to a dense finish, then cut the current week short.
    const density = 0.18 + 0.62 * (c / (cols - 1)) ** 1.35;
    for (let r = 0; r < rows; r++) {
      if (c === cols - 1 && r > 2) continue;
      // `** 1.6` skews the busy days toward the bottom of the scale, because a
      // real year of reviews is mostly ones and twos with a few heavy days.
      const level = rand() < density ? 1 + Math.floor(rand() ** 1.6 * 4) : 0;
      cells.push(
        `<rect x="${(x + c * pitch).toFixed(2)}" y="${(y + r * pitch).toFixed(2)}" ` +
          `width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" rx="2" fill="${shades[level]}"/>`,
      );
    }
  }

  return { svg: cells.join(''), height: rows * pitch - gap };
}

/** The four FSRS grades, with the interval each one actually hands out. */
function gradeRamp(t, { x, y, height }) {
  const gap = 10;
  const w = (CW - gap * 3) / 4;
  const bands = [
    { key: '1', label: 'Again', interval: '10m', fill: t['grade-again'] },
    { key: '2', label: 'Hard', interval: '2d', fill: t['grade-hard'] },
    { key: '3', label: 'Good', interval: '5d', fill: t['grade-good'] },
    { key: '4', label: 'Easy', interval: '12d', fill: t['grade-easy'] },
  ];

  return bands
    .map(({ key, label, interval, fill }, i) => {
      const bx = x + i * (w + gap);
      const cx = bx + w / 2;
      // Ink on all four bands, the same as RatingButtons: the ramp climbs in
      // lightness (0.60 -> 0.92) so one foreground reads on the whole scale.
      const ink = t['primary-foreground'];
      return (
        `<rect x="${bx.toFixed(2)}" y="${y}" width="${w.toFixed(2)}" height="${height}" rx="8" fill="${fill}"/>` +
        text(cx - 30, y + 27, key, {
          family: FAMILY.mono,
          size: 13,
          fill: ink,
          opacity: 0.55,
        }) +
        text(cx - 14, y + 27, label, { size: 16, fill: ink }) +
        text(cx, y + 49, interval, {
          family: FAMILY.mono,
          size: 13,
          fill: ink,
          anchor: 'middle',
          opacity: 0.7,
        })
      );
    })
    .join('');
}

function heroSvg(t, theme) {
  const dark = theme === 'dark';

  /* ----- the card, and the two behind it ----- */
  const cardY = 186;
  // Sized to its contents: the show-answer bar ends 294 below the card's top,
  // so 330 leaves the same 36 under it that padX leaves either side.
  const cardH = 330;
  const padX = 36;
  const inner = CW - padX * 2;

  // A deck is cards in a stack, so the hero card sits on top of one. Only the
  // top edge of each plate below shows.
  const plates = [
    { inset: 28, dy: 26, opacity: 0.45 },
    { inset: 14, dy: 13, opacity: 0.75 },
  ]
    .map(
      ({ inset, dy, opacity }) =>
        `<rect x="${COL + inset}" y="${cardY - dy}" width="${CW - inset * 2}" height="${cardH}" rx="14" ` +
        `fill="${t.card}" stroke="${t.border}" opacity="${opacity}"/>`,
    )
    .join('');

  // The question is the one on the landing page's own showcase card, wrapped by
  // hand: resvg has no line breaking, so every line here is a decision.
  const question = [
    'Why does a spaced-repetition scheduler need',
    'to know when you last saw a card, and not',
    'only how many times you have seen it?',
  ];

  const ramp = { y: 544, height: 64 };
  const heatY = 644;
  const heat = heatmap(t, { x: COL, y: heatY });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${t.foreground}" stop-opacity="${dark ? 0.055 : 0.03}"/>
      <stop offset="1" stop-color="${t.foreground}" stop-opacity="0"/>
    </radialGradient>
    <filter id="lift" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="${dark ? 0.5 : 0.11}"/>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="${t.background}"/>
  <!-- Achromatic on purpose. Rule 1 of the palette: every grey is chroma 0, and
       a ground tinted toward the accent muddies the only colour allowed to mean
       anything here. -->
  <ellipse cx="${COL + CW / 2}" cy="420" rx="720" ry="560" fill="url(#glow)"/>

  <!-- ============================================================ mark === -->
  <g transform="translate(${PAD} 72) scale(1.5)">
    <rect x="3" y="4" width="11" height="22" rx="2.5" fill="${t.foreground}"/>
    <rect x="18" y="6" width="11" height="22" rx="2.5" fill="${t.foreground}"/>
    <circle cx="16" cy="16" r="3.6" fill="${t.primary}"/>
  </g>
  ${text(PAD + 62, 109, 'SynapseDeck', { family: FAMILY.serif, size: 36, fill: t.foreground })}

  <!-- ======================================================== the line === -->
  <!-- Not free text. public/og-image.png and the landing page h1 are both set to
       this sentence; a hero that says something else is a third version of the
       product's opening claim. -->
  ${text(PAD, 392, 'Forgetting is', { family: FAMILY.serif, size: 96, fill: t.foreground })}
  ${text(PAD, 500, 'the schedule.', { family: FAMILY.serif, size: 96, fill: t.foreground })}

  ${text(PAD, 570, 'Paste what you are studying. SynapseDeck drafts flashcards', { size: 21, fill: t['muted-foreground'] })}
  ${text(PAD, 604, 'from it, you decide which ones are worth keeping, and a real', { size: 21, fill: t['muted-foreground'] })}
  ${text(PAD, 638, 'spaced-repetition scheduler decides when you see each one again.', { size: 21, fill: t['muted-foreground'] })}

  ${text(PAD, 706, 'FSRS SCHEDULER   ·   REVIEW GATE   ·   APPEND-ONLY REVIEW LOG', { family: FAMILY.mono, size: 13, fill: t['muted-foreground'], track: 1.6 })}

  <!-- ============================================== a card mid-review === -->
  <g filter="url(#lift)">
    ${plates}
    <rect x="${COL}" y="${cardY}" width="${CW}" height="${cardH}" rx="14" fill="${t.card}" stroke="${t.border}"/>
  </g>

  ${text(COL + padX, cardY + 50, '14 left  ·  4 done', { size: 14, fill: t['muted-foreground'] })}
  <rect x="${COL + CW - padX - 66}" y="${cardY + 34}" width="66" height="24" rx="12" fill="none" stroke="${t.border}"/>
  ${text(COL + CW - padX - 33, cardY + 50, 'Review', { size: 13, fill: t['muted-foreground'], anchor: 'middle' })}

  <rect x="${COL + padX}" y="${cardY + 70}" width="${inner}" height="5" rx="2.5" fill="${t.muted}"/>
  <rect x="${COL + padX}" y="${cardY + 70}" width="${(inner * 0.22).toFixed(1)}" height="5" rx="2.5" fill="${t.foreground}"/>

  ${question
    .map((line, i) =>
      text(COL + padX, cardY + 136 + i * 40, line, {
        family: FAMILY.serif,
        size: 26,
        fill: t['card-foreground'],
      }),
    )
    .join('\n  ')}

  <rect x="${COL + padX}" y="${cardY + 248}" width="${inner}" height="46" rx="8" fill="${t.secondary}"/>
  ${text(COL + CW / 2 - 84, cardY + 277, 'Show answer', { size: 15, fill: t['secondary-foreground'] })}
  <rect x="${COL + CW / 2 + 18}" y="${cardY + 259}" width="52" height="24" rx="5" fill="${t.card}" stroke="${t.border}"/>
  ${text(COL + CW / 2 + 44, cardY + 276, 'Space', { family: FAMILY.mono, size: 12, fill: t['muted-foreground'], anchor: 'middle' })}

  <!-- ========================================== the four ratings, as one === -->
  ${gradeRamp(t, { x: COL, y: ramp.y, height: ramp.height })}

  <!-- =================================================== what /progress === -->
  ${heat.svg}
  ${text(COL, heatY + heat.height + 30, 'Every review appends a row. The streak, the heatmap and', { size: 14, fill: t['muted-foreground'] })}
  ${text(COL, heatY + heat.height + 52, 'retention are counted back out of it, never estimated.', { size: 14, fill: t['muted-foreground'] })}
</svg>`;
}

/* ------------------------------------------------------------------ main --- */

async function main() {
  const width = Number(process.argv[2]) || 7680;
  if (width % 16 !== 0) {
    console.error(`Width ${width} is not divisible by 16; 16:9 would not be exact.`);
    process.exit(1);
  }

  const themes = readThemes();
  const fontDir = mkdtempSync(join(tmpdir(), 'synapsedeck-hero-'));

  try {
    const fontFiles = await unpackFonts(fontDir);
    const font = { fontFiles, loadSystemFonts: false, defaultFontFamily: FAMILY.sans };
    mkdirSync(out, { recursive: true });

    for (const theme of ['dark', 'light']) {
      const started = Date.now();
      const svg = heroSvg(themes[theme], theme);
      const png = new Resvg(svg, { font, fitTo: { mode: 'width', value: width } })
        .render()
        .asPng();

      const name = `hero-${theme}.png`;
      writeFileSync(join(out, name), png);
      console.log(
        `${name}  ${width}x${(width * 9) / 16}  ` +
          `${(png.length / 1024 / 1024).toFixed(2)} MB  ${Date.now() - started} ms`,
      );
    }
  } finally {
    rmSync(fontDir, { recursive: true, force: true });
  }
}

await main();
