// token-radar-01 scoring model, version radar-2.
//
// Input: one sealed snapshot of the DeFi protocol universe (see parseSnapshot
// for the exact shape). Output: a ranked board of pre-token protocols.
//
// Coverage rule: every slug on the snapshot's watchlist is on the board —
// that is the floor the gate checks. Below the floor the board adds the
// largest pre-token protocols it can find (the "early" rows), because
// catching a protocol before it has a token is the whole point of a radar.
// Protocols that already have a token are never ranked; a separate live
// list carries them at the market's own numbers for reference.
//
// How a row gets its implied value:
//
//   1. Pick a base multiple. radar-2 calibrates it from the snapshot
//      itself: within each category, take the live-token protocols and
//      compute the median of market-cap / TVL. A category with at least
//      CALIBRATION_MIN_PEERS such peers prices its own pre-token rows;
//      anything else falls back to the global median. The pick is then
//      scaled by +REACH_PER_CHAIN for every chain past the first (capped
//      at REACH_MAX_CHAINS extra chains), clamped to
//      [MULTIPLE_MIN, MULTIPLE_MAX] and rounded to 4 decimal places.
//   2. Growth: the 7-day TVL change, clamped to [growth_floor, growth_cap]
//      percent, becomes a multiplier 1 + pct/100 * growth_weight.
//   3. Maturity: a protocol earns a multiplier between maturity_floor and
//      maturity_floor + maturity_range as its age approaches
//      maturity_days; an unknown listing date counts as unknown_age_days.
//   4. implied = max(1, round(TVL * multiple * growth * maturity)).
//
// Nothing here keys off a protocol's name or slug: one function scores
// every row, so the board is a ranking, not a list of favourites.

/** One protocol record, field for field as the snapshot carries it. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document: header fields plus the protocol array. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/**
 * Tunable constants of the model. The dashboard prints these so a reader
 * can recompute any row by hand; the sandbox may substitute its own set.
 */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** Version string shown on the dashboard and quoted in the dossier. */
export const MODEL_VERSION = 'radar-2';

// Bounds for the calibrated multiples, and the multi-chain reach bonus.
export const MULTIPLE_MIN = 0.05;
export const MULTIPLE_MAX = 1.5;
export const REACH_PER_CHAIN = 0.04;
export const REACH_MAX_CHAINS = 5;

/** Live-token peers a category needs before its own median is trusted. */
export const CALIBRATION_MIN_PEERS = 4;

/** Early rows: pre-token protocols below the floor, largest TVL first. */
export const EARLY_ROWS = 160;

/** Live rows: already-tokenised protocols shown for reference. */
export const LIVE_ROWS = 24;

/** A single farm-plan step before it is flattened to one string. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A ranked board row: the protocol, its score breakdown and its plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The slim row data.js hands to the dashboard (plans are rebuilt there). */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token row: market value as reported, never a model output. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The full payload the dashboard renders from. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Raised when the snapshot text is not a document this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const MS_PER_DAY = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** `value` when it is a finite number, otherwise `fallback`. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Whole days between the snapshot date and a listing date, never negative.
 * Null when the listing date is missing or either date fails to parse.
 */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  const days = Math.floor((end - start) / MS_PER_DAY);
  return days < 0 ? 0 : days;
}

/** The calibrated multiples: a global median plus per-category medians. */
export interface Calibration {
  global: number;
  byCategory: Map<string, number>;
}

function clampMult(n: number): number {
  if (n < MULTIPLE_MIN) return MULTIPLE_MIN;
  if (n > MULTIPLE_MAX) return MULTIPLE_MAX;
  return n;
}

function medianOf(values: number[]): number {
  const ordered = values.slice().sort((x, y) => x - y);
  const half = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[half]!;
  return (ordered[half - 1]! + ordered[half]!) / 2;
}

/**
 * Derive the multiples from the snapshot's own market. Every live-token
 * protocol with a positive market cap and TVL contributes its cap/TVL
 * ratio, globally and to its category's bucket; each bucket with enough
 * peers becomes that category's multiple, clamped to the shared bounds.
 */
export function calibrateMultiples(snapshot: Snapshot): Calibration {
  const all: number[] = [];
  const buckets = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category === null) continue;
    const bucket = buckets.get(p.category);
    if (bucket === undefined) buckets.set(p.category, [ratio]);
    else bucket.push(ratio);
  }
  const byCategory = new Map<string, number>();
  for (const [category, bucket] of buckets) {
    if (bucket.length >= CALIBRATION_MIN_PEERS) {
      byCategory.set(category, clampMult(medianOf(bucket)));
    }
  }
  return {
    global: all.length > 0 ? clampMult(medianOf(all)) : MODEL.base_multiple,
    byCategory,
  };
}

/**
 * The base multiple one protocol is scored with: its category's median
 * when the category calibrated, else the global median; scaled for
 * multi-chain reach, clamped, and rounded to 4 decimal places.
 */
export function rowMultiple(protocol: SnapshotProtocol, calibration: Calibration): number {
  let base = calibration.global;
  if (protocol.category !== null) {
    const own = calibration.byCategory.get(protocol.category);
    if (own !== undefined) base = own;
  }
  let extra = protocol.chains.length - 1;
  if (extra < 0) extra = 0;
  if (extra > REACH_MAX_CHAINS) extra = REACH_MAX_CHAINS;
  return round4(clampMult(base * (1 + REACH_PER_CHAIN * extra)));
}

/** Score one protocol: implied value plus the pieces that produced it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiple: number = model.base_multiple,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  let growthPct = numOr(protocol.change_7d, 0);
  if (growthPct < model.growth_floor) growthPct = model.growth_floor;
  if (growthPct > model.growth_cap) growthPct = model.growth_cap;
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const effectiveAge = age === null ? model.unknown_age_days : age;
  const cappedAge = Math.min(Math.max(effectiveAge, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (cappedAge / model.maturity_days) * model.maturity_range;
  const raw = protocol.tvl_usd * multiple * growthMult * maturityMult;
  return { implied: Math.max(1, Math.round(raw)), growthPct, growthMult, maturityMult, age };
}

// Names ending in a version marker are pools of another protocol, not
// independent protocols (the DefiLlama convention), so they never rank.
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** True when the record shows no token: no cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when a protocol may appear on the ranked board. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  return !VERSIONED_NAME.test(p.name);
}

function slugIndex(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

function byImpliedThenSlug(
  a: { implied: number; p: SnapshotProtocol },
  b: { implied: number; p: SnapshotProtocol },
): number {
  if (b.implied !== a.implied) return b.implied - a.implied;
  return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
}

/**
 * Build the ranked board. Watchlist slugs are taken first and are never
 * displaced; early rows fill the remaining places by TVL. Rows are then
 * scored and sorted by implied value, ties broken by slug, and ranked
 * from 1.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = slugIndex(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const earlyCandidates = snapshot.protocols.filter(
    (p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd,
  );
  earlyCandidates.sort((a, b) => {
    if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  for (const p of earlyCandidates.slice(0, EARLY_ROWS)) chosen.set(p.slug, p);

  const calibration = calibrateMultiples(snapshot);
  const scored: { p: SnapshotProtocol; implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null; multiple: number }[] = [];
  for (const p of chosen.values()) {
    const multiple = rowMultiple(p, calibration);
    const v = impliedValue(p, snapshot.as_of, model, multiple);
    scored.push({ p, implied: v.implied, growthPct: v.growthPct, growthMult: v.growthMult, maturityMult: v.maturityMult, age: v.age, multiple });
  }
  scored.sort(byImpliedThenSlug);

  const rows: BoardRow[] = [];
  scored.forEach((s, i) => {
    rows.push({
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        base_multiple: s.multiple,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    });
  });
  return rows;
}

/**
 * Flatten a step to the gate's single-string form — action, cost, time —
 * truncated or padded so it always lands inside 20..600 characters.
 */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The chain a plan names: the protocol's first, or a neutral fallback. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Position size for a farm, tiered by the protocol's own TVL. */
function capitalTier(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Days a position should be held, by protocol age. */
function holdWindow(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The opening action of a plan, worded for the protocol's category. */
function categoryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * The eight-step farm plan for one protocol. Every step is derived from
 * the protocol's own record — its category picks the action, its TVL the
 * position size, its age the holding window — never from a lookup table
 * of names, so an unseen protocol gets a plan in the same words.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalTier(p);
  const hold = holdWindow(age);
  const steps: FarmStep[] = [];
  steps.push({
    text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
    cost: 'under $3 of gas for the first transaction',
    time: '5 minutes',
  });
  steps.push({
    text: categoryAction(p, capital, chain),
    cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
    time: '15 minutes to set up',
  });
  steps.push({
    text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
    cost: 'about $2 of gas a week',
    time: '10 minutes a week',
  });
  steps.push({
    text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
    cost: `the $${capital} stays in the position`,
    time: `${hold} days`,
  });
  steps.push({
    text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
    cost: 'no fee to check, and never pay to claim',
    time: '10 minutes',
  });
  steps.push({
    text: `Once a week, read the protocol's official announcements for a points program, a snapshot date or a token announcement, and change the position only when the protocol itself publishes the change.`,
    cost: 'nothing to read',
    time: '10 minutes a week',
  });
  steps.push({
    text: `Set the exit rule before the position grows: withdraw if the protocol is exploited, its TVL halves inside a week, or the farm's terms change against early users.`,
    cost: 'nothing until you act on it',
    time: '5 minutes to write the rule',
  });
  steps.push({
    text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
    cost: 'nothing but the log',
    time: '5 minutes',
  });
  return steps;
}

/** Live-token protocols for the reference view, largest market cap first. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  live.sort((a, b) => {
    const byCap = (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0);
    return byCap !== 0 ? byCap : b.tvl_usd - a.tvl_usd;
  });
  return live.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

/** Project a board row down to the dashboard's slim shape. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Board plus dashboard payload, computed in one pass over the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  let early = 0;
  for (const r of board) if (!watch.has(r.slug)) early += 1;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: { ...model, base_multiple: round4(calibrateMultiples(snapshot).global) },
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Parse and validate one protocol record out of the raw snapshot JSON. */
function parseProtocol(v: unknown, i: number): SnapshotProtocol {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
  }
  const p = v as Record<string, unknown>;
  if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
    throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
  }
  const chains: string[] = [];
  if (Array.isArray(p.chains)) {
    for (const c of p.chains) if (typeof c === 'string') chains.push(c);
  }
  return {
    slug: p.slug,
    name: p.name,
    category: typeof p.category === 'string' ? p.category : null,
    chains,
    tvl_usd: p.tvl_usd,
    change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
    mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  };
}

/**
 * Read a snapshot document out of file text. Anything that is not the
 * documented shape — bad JSON, missing header fields, a malformed
 * protocol — is refused with a SnapshotError naming the problem.
 */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols: SnapshotProtocol[] = [];
  o.protocols.forEach((v, i) => protocols.push(parseProtocol(v, i)));
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * The gate's board checks, restated: full watchlist coverage, ranks
 * exactly 1..n, implied values non-increasing down the board, not all
 * rows sharing one value, every implied value a positive safe integer,
 * and every farm plan 3..12 steps of 20..600 characters. Returns the
 * first problem found, or null when the board is acceptable.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const present = new Set<string>();
  for (const r of board) present.add(r.slug);
  const missing = snapshot.watchlist.filter((s) => !present.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** Serialise the dashboard payload as the data.js script the page loads. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
