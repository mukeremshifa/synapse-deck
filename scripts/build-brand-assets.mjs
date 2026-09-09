#!/usr/bin/env node
/**
 * Renders every shipped brand asset from the masters in `assets/brand/`.
 *
 *   npm run brand:assets
 *
 * The masters are the source of truth for the artwork; `public/` holds only
 * outputs, and they are committed so the deploy never needs this toolchain.
 * Re-running must be a no-op — `git status --porcelain public/` staying empty is
 * an acceptance criterion of P5, and `src/test/brand-assets.test.ts` leans on it.
 *
 * Three things here are load-bearing and easy to undo by accident:
 *
 *  1. **The fonts are decompressed from the very woff2 files the app ships.**
 *     resvg's font database reads TrueType/OpenType only. Handed a `.woff2` it
 *     does not error — it accepts the path, finds no family, and silently falls
 *     back, producing a social card set in something that is not the brand face.
 *     That failure is invisible in CI and obvious to the first person who shares
 *     a link, so `wawoff2` unpacks them to TTF in a temp directory first.
 *
 *  2. **Family names differ between CSS and the font binary.** `globals.css`
 *     asks for `Mona Sans Variable`, which is the name fontsource gives
 *     its `@font-face`. The name inside the file — the only one resvg can match —
 *     is `Mona Sans`. Use FAMILY below, not the CSS names.
 *
 *  3. **The colours are parsed out of `globals.css`, never typed here.** The OG
 *     card's grade ramp is the same four tokens the rating buttons use. Copying
 *     the hex values into this file would let the card and the app drift apart
 *     silently, which is exactly the kind of drift nobody notices.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import { decompress } from 'wawoff2';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'assets', 'brand');
const out = join(root, 'public');

const FAMILY = {
  serif: 'DM Serif Display',
  sans: 'Mona Sans',
  mono: 'JetBrains Mono',
};

const WOFF2 = [
  '@fontsource/dm-serif-display/files/dm-serif-display-latin-400-normal.woff2',
  '@fontsource-variable/mona-sans/files/mona-sans-latin-wght-normal.woff2',
  '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
];

/* ---------------------------------------------------------------- colour --- */

/** oklch() → #rrggbb. The one piece of colour maths this repo needs. */
function oklchToHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

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

/** Pull the light-theme `:root` tokens out of globals.css and resolve them. */
function readTokens() {
  const css = readFileSync(join(root, 'src', 'styles', 'globals.css'), 'utf8');
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'));
  const tokens = {};
  for (const [, name, L, C, H] of rootBlock.matchAll(
    /--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g,
  )) {
    tokens[name] = oklchToHex(Number(L), Number(C), Number(H));
  }
  const required = ['primary', 'grade-again', 'grade-hard', 'grade-good', 'grade-easy'];
  const missing = required.filter(key => !tokens[key]);
  if (missing.length) {
    console.error(
      `globals.css is missing ${missing.join(', ')} — did a token get renamed?`,
    );
    process.exit(1);
  }
  return tokens;
}

/* ----------------------------------------------------------------- fonts --- */

/**
 * woff2 → ttf, one at a time.
 *
 * **The sequential loop is the fix for a real bug, not a style preference.**
 * `decompress` hands back a view onto the wasm module's output heap rather than
 * a copy, so decompressing all three under `Promise.all` lets the calls
 * interleave and overwrite each other. The damage is quiet: every file is still
 * written at exactly the right length, so a size check passes, and only the
 * glyph data is wrong — resvg then fails to match the family and silently falls
 * back, which is how the first run of this script produced a social card set
 * entirely in JetBrains Mono. Await each one.
 */
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

/* ------------------------------------------------------------------ card --- */

const INK = '#0A0A0A';
const PAPER = '#FAFAFA';
const DIM = '#9E9E9E';

/** The social card. Text is measurement-free: nothing is centred or boxed. */
function ogSvg(tokens, { width, height }) {
  const tall = height > 700;
  const headY = tall ? 470 : 300;
  const lead = tall ? 96 : 88;
  const stripY = height - 16;
  const bands = ['grade-again', 'grade-hard', 'grade-good', 'grade-easy'];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${INK}"/>

  <g transform="translate(80 68) scale(1.7)">
    <rect x="3" y="4" width="11" height="22" rx="2.5" fill="${PAPER}"/>
    <rect x="18" y="6" width="11" height="22" rx="2.5" fill="${PAPER}"/>
    <circle cx="16" cy="16" r="3.6" fill="${tokens.primary}"/>
  </g>
  <text x="145" y="105" font-family="${FAMILY.serif}" font-size="40" fill="${PAPER}">SynapseDeck</text>

  <text x="80" y="${headY}" font-family="${FAMILY.serif}" font-size="82" fill="${PAPER}">Forgetting is</text>
  <text x="80" y="${headY + lead}" font-family="${FAMILY.serif}" font-size="82" fill="${PAPER}">the schedule.</text>

  <text x="80" y="${headY + lead + 78}" font-family="${FAMILY.sans}" font-size="27" fill="${DIM}">Paste your notes. Get cards worth reviewing.</text>
  <text x="80" y="${headY + lead + 118}" font-family="${FAMILY.sans}" font-size="27" fill="${DIM}">Get drilled at the right time.</text>

  ${bands
    .map(
      (token, i) =>
        `<rect x="${(width / 4) * i}" y="${stripY}" width="${width / 4}" height="16" fill="${tokens[token]}"/>`,
    )
    .join('\n  ')}
</svg>`;
}

/* ------------------------------------------------------------------ main --- */

async function main() {
  const tokens = readTokens();
  const fontDir = mkdtempSync(join(tmpdir(), 'synapsedeck-fonts-'));

  try {
    const fontFiles = await unpackFonts(fontDir);
    const font = { fontFiles, loadSystemFonts: false, defaultFontFamily: FAMILY.sans };
    mkdirSync(out, { recursive: true });

    const master = name => readFileSync(join(brand, name), 'utf8');
    const render = (svg, width) =>
      new Resvg(svg, { font, fitTo: { mode: 'width', value: width } }).render().asPng();

    const written = [];
    const emit = (name, buffer) => {
      writeFileSync(join(out, name), buffer);
      written.push(`${name}  ${(buffer.length / 1024).toFixed(1)} kB`);
    };

    // Vector, straight through.
    emit('favicon.svg', Buffer.from(master('favicon.svg')));
    emit('logo-mark.svg', Buffer.from(master('mark.svg')));
    emit('logo-mark-dark.svg', Buffer.from(master('mark-dark.svg')));

    // Raster icons off the tile master.
    const icon = master('icon.svg');
    emit('apple-touch-icon.png', render(icon, 180));
    emit('icon-192.png', render(icon, 192));
    emit('icon-512.png', render(icon, 512));
    emit('icon-512-maskable.png', render(master('icon-maskable.svg'), 512));

    // The .ico carries three real resolutions. 16 comes from its own drawing —
    // at that size the stagger is mud, so the plates thicken and the accent
    // moves onto the right plate to carry the idea instead.
    emit(
      'favicon.ico',
      await pngToIco([
        render(master('mark-16.svg'), 16),
        render(icon, 32),
        render(icon, 48),
      ]),
    );

    emit('og-image.png', render(ogSvg(tokens, { width: 1200, height: 630 }), 1200));
    emit(
      'og-image-square.png',
      render(ogSvg(tokens, { width: 1200, height: 1200 }), 1200),
    );

    console.log(`Wrote ${written.length} assets to public/:\n  ${written.join('\n  ')}`);
  } finally {
    rmSync(fontDir, { recursive: true, force: true });
  }
}

await main();

// A courtesy, not a check: the script cannot know whether the diff is intended.
try {
  const dirty = execFileSync('git', ['status', '--porcelain', 'public'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  console.log(dirty ? `\npublic/ changed:\n${dirty}` : '\npublic/ unchanged.');
} catch {
  /* Not a git checkout, or no git. Nothing to report. */
}
