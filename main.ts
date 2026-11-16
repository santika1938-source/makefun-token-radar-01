// token-radar-01 entrypoint (Node 22, standard library only).
//
// Pipeline:
//   1. Locate the sealed snapshot: --input names either the snapshot.json
//      file itself or the directory holding it (default /input).
//   2. Score it with the model in lib/model.ts and gate-check the board.
//   3. Write board.json and data.js (the dashboard's dataset) to the
//      output directory: /output, or MAKEFUN_OUTPUT_DIR outside the
//      grader's container, or --output.
//   4. Copy this repository's dashboard/ and screenshots/ across, so the
//      judge sees the same page and images the repository carries.
//   5. Write dossier.json last, with the vendored make.fun library: the
//      scorer rebuilds it from the finished /output and compares bytes,
//      so nothing may be written after it.
//
// The dashboard is three static files with no framework and no network
// access; it renders from the data.js this program writes, which is
// serialised from the very same board that lands in board.json.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// Caps from reference/gate.json: the dossier text cap shapes the bytes of
// dossier.json; the screenshot caps refuse the run when exceeded.
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_LIMITS = { max_files: 400, max_bytes: 4_194_304 };
const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** Read a `--name value` or `--name=value` argument, else the fallback. */
function cliArg(name: string, fallback: string): string {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && i + 1 < argv.length) return argv[i + 1]!;
    if (argv[i]!.startsWith(`--${name}=`)) return argv[i]!.slice(name.length + 3);
  }
  return fallback;
}

const inputArg = cliArg('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outDir = cliArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`, 1);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/**
 * Copy the regular files of one directory into another, skipping
 * dotfiles, and return the names copied (used for the screenshot count
 * and name checks below).
 */
function copyDir(from: string, to: string): string[] {
  const copied: string[] = [];
  if (!existsSync(from)) return copied;
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyDir(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
}
for (const name of shots) {
  if (!SCREENSHOT_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  }
}

// Written last on purpose: the dossier summarises the finished output.
const dossier = buildDossier(outDir, {
  text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
  screenshots: SCREENSHOT_LIMITS,
  dashboard: DASHBOARD_LIMITS,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
