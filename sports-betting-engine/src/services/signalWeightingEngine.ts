// ============================================================
// src/services/signalWeightingEngine.ts
// Phase D — Sport-specific signal weighting engine.
//
// PIPELINE POSITION:
//   ... → signal diversity → [signal weighting] → risk → label → slate
//
// PURPOSE:
//   Different sports and market types have very different pricing
//   efficiency.  A 7% raw edge on an NBA player prop is far less
//   reliable than the same edge on an NHL game line backed by sharp
//   action.  This engine applies sport/market multipliers and per-
//   signal deltas so the risk engine (and by extension label/slate)
//   operate on a calibrated edge rather than a raw probability gap.
//
// WHAT IT DOES:
//   Reads: impliedEdge (set by probabilityEngine), signals[],
//          outcomeSignals[], sportKey, marketType.
//   Writes: weightedAdjustedEdge, weightingReasons,
//           weightingMultiplier, weightingProfile.
//   Does NOT touch: adjustedEdge, riskGrade, riskFlags, riskScore,
//                   adjustedWinProbability, or any label field.
//
// THREE-STAGE AUDIT TRAIL (after full pipeline):
//   impliedEdge          — raw probability delta (probability engine)
//   weightedAdjustedEdge — post sport multiplier + signal deltas (here)
//   adjustedEdge         — post price-only discount   (risk engine)
//
// IMPORTANT: No BET volume cap here.  That is a portfolio-level
//   constraint handled by the slate selector.
//
// ============================================================
// SPORT PROFILES AND BASE MULTIPLIERS
// ============================================================
//
//   NBA_PROP    0.88  Props noisy; role/minutes vary game-to-game
//   NBA_GAME    1.00  Game lines neutral baseline
//   NHL_GAME    0.95  Sharp signal critical; low-scoring, variance high
//   NHL_PROP    0.82  Very thin market; line shoppers dominate
//   MLB_PITCHER 1.05  Pitcher strikeout props — more structured
//   MLB_HITTER  0.70  Hitting props — very high variance
//   MLB_GAME    0.90  Game lines without confirmed pitcher context
//   NCAAB_GAME  1.05  Soft market; closing line moves create real edge
//   NCAAF_GAME  1.02  Slightly softer than NFL
//   DEFAULT     0.95  All other sports / unrecognised profile
//
// ============================================================

import { DecisionCandidate } from './decisionTypes';

// ============================================================
// Profile type
// ============================================================

type SportProfile =
  | 'NBA_PROP'
  | 'NBA_GAME'
  | 'NHL_GAME'
  | 'NHL_PROP'
  | 'MLB_PITCHER'
  | 'MLB_HITTER'
  | 'MLB_GAME'
  | 'NCAAB_GAME'
  | 'NCAAF_GAME'
  | 'DEFAULT';

// ============================================================
// Signal name sets
// ============================================================

/** Outcome signals that positively increase edge confidence. */
const POSITIVE_OUTCOME = new Set([
  'ROLE_STABLE',
  'MINUTES_SECURE',
  'INJURY_OPPORTUNITY_UP',
  'RECENT_FORM_GOOD',
  'FAVORABLE_MATCHUP',
]);

/** Outcome signals that reduce edge confidence. */
const NEGATIVE_OUTCOME = new Set([
  'ROLE_UNSTABLE',
  'MINUTES_RISK',
  'RECENT_FORM_BAD',
  'TOUGH_MATCHUP',
]);

/** Sharp / market-structural intelligence signals. */
const SHARP_SIGNALS = new Set([
  'sharp_money',
  'reverse_line_movement',
  'sharp_action',
  'SHARP_INTEL',
  'LINE_MOVEMENT',
]);

const STEAM_SIGNALS = new Set([
  'steam_move',
  'STEAM_MOVE',
]);

// ============================================================
// Profile detection
// ============================================================

function detectProfile(c: DecisionCandidate): SportProfile {
  const sk  = (c.sportKey ?? '').toLowerCase();
  const mkt = c.marketType;
  const mktName = (c.market ?? '').toLowerCase();

  if (sk.includes('basketball_nba')) {
    return mkt === 'player_prop' ? 'NBA_PROP' : 'NBA_GAME';
  }
  if (sk.includes('icehockey_nhl') || sk.includes('hockey_nhl')) {
    return mkt === 'player_prop' ? 'NHL_PROP' : 'NHL_GAME';
  }
  if (sk.includes('baseball_mlb')) {
    if (mkt === 'player_prop') {
      return (mktName.includes('strikeout') || mktName.includes('pitcher'))
        ? 'MLB_PITCHER'
        : 'MLB_HITTER';
    }
    return 'MLB_GAME';
  }
  if (sk.includes('basketball_ncaab') || sk.includes('ncaab')) {
    return 'NCAAB_GAME';
  }
  if (sk.includes('americanfootball_ncaaf') || sk.includes('ncaaf')) {
    return 'NCAAF_GAME';
  }
  return 'DEFAULT';
}

function baseMultiplier(profile: SportProfile): number {
  switch (profile) {
    case 'NBA_PROP':    return 0.88;
    case 'NBA_GAME':    return 1.00;
    case 'NHL_GAME':    return 0.95;
    case 'NHL_PROP':    return 0.82;
    case 'MLB_PITCHER': return 1.05;
    case 'MLB_HITTER':  return 0.70;
    case 'MLB_GAME':    return 0.90;
    case 'NCAAB_GAME':  return 1.05;
    case 'NCAAF_GAME':  return 1.02;
    case 'DEFAULT':     return 0.95;
  }
}

// ============================================================
// Signal delta computation
// ============================================================

interface SignalDelta { delta: number; reason: string; }

function computeDeltas(
  c: DecisionCandidate,
  profile: SportProfile,
): SignalDelta[] {
  // Flatten all signal arrays into one deduplicated set.
  // signals[]       — core bet signals (set by topTenBets / propScorer)
  // outcomeSignals[] — context signals (set by outcomeSignalEngine)
  const allSignals = new Set([
    ...(c.signals        ?? []),
    ...(c.outcomeSignals ?? []),
  ]);

  const has     = (name: string): boolean => allSignals.has(name);
  const hasSet  = (set: Set<string>): boolean => [...set].some(s => allSignals.has(s));

  const deltas: SignalDelta[] = [];

  // ── NBA_PROP ──────────────────────────────────────────────
  if (profile === 'NBA_PROP') {
    if (has('ROLE_STABLE'))           deltas.push({ delta: +0.005, reason: 'ROLE_STABLE confirmed' });
    if (has('MINUTES_SECURE'))        deltas.push({ delta: +0.008, reason: 'MINUTES_SECURE confirmed' });
    if (has('INJURY_OPPORTUNITY_UP')) deltas.push({ delta: +0.006, reason: 'INJURY_OPPORTUNITY_UP' });
    if (has('RECENT_FORM_GOOD'))      deltas.push({ delta: +0.004, reason: 'RECENT_FORM_GOOD' });
    if (has('FAVORABLE_MATCHUP'))     deltas.push({ delta: +0.005, reason: 'FAVORABLE_MATCHUP' });
    if (hasSet(SHARP_SIGNALS))        deltas.push({ delta: +0.004, reason: 'sharp signal present' });
    if (has('ROLE_UNSTABLE'))         deltas.push({ delta: -0.008, reason: 'ROLE_UNSTABLE penalty' });
    if (has('MINUTES_RISK'))          deltas.push({ delta: -0.007, reason: 'MINUTES_RISK penalty' });
    if (has('RECENT_FORM_BAD'))       deltas.push({ delta: -0.005, reason: 'RECENT_FORM_BAD penalty' });
    if (has('TOUGH_MATCHUP'))         deltas.push({ delta: -0.004, reason: 'TOUGH_MATCHUP penalty' });
  }

  // ── NBA_GAME ──────────────────────────────────────────────
  if (profile === 'NBA_GAME') {
    if (hasSet(SHARP_SIGNALS))  deltas.push({ delta: +0.005, reason: 'sharp signal present' });
    if (hasSet(STEAM_SIGNALS))  deltas.push({ delta: +0.004, reason: 'steam move detected' });
  }

  // ── NHL_GAME ──────────────────────────────────────────────
  if (profile === 'NHL_GAME') {
    // Sharp signal especially critical in low-scoring markets
    if (hasSet(SHARP_SIGNALS))  deltas.push({ delta: +0.010, reason: 'sharp signal — NHL critical' });
    if (hasSet(STEAM_SIGNALS))  deltas.push({ delta: +0.006, reason: 'steam move detected' });
  }

  // ── NHL_PROP ──────────────────────────────────────────────
  if (profile === 'NHL_PROP') {
    if (has('ROLE_STABLE'))    deltas.push({ delta: +0.005, reason: 'ROLE_STABLE confirmed' });
    if (hasSet(SHARP_SIGNALS)) deltas.push({ delta: +0.007, reason: 'sharp signal present' });
    if (has('ROLE_UNSTABLE'))  deltas.push({ delta: -0.010, reason: 'ROLE_UNSTABLE — thin market' });
    if (has('MINUTES_RISK'))   deltas.push({ delta: -0.008, reason: 'MINUTES_RISK — thin market' });
  }

  // ── MLB_PITCHER ───────────────────────────────────────────
  if (profile === 'MLB_PITCHER') {
    if (hasSet(SHARP_SIGNALS))  deltas.push({ delta: +0.008, reason: 'sharp signal — pitcher market' });
  }

  // ── MLB_HITTER ────────────────────────────────────────────
  if (profile === 'MLB_HITTER') {
    if (hasSet(SHARP_SIGNALS))       deltas.push({ delta: +0.006, reason: 'sharp signal present' });
    if (has('RECENT_FORM_GOOD'))     deltas.push({ delta: +0.004, reason: 'RECENT_FORM_GOOD — batter in form' });
    if (has('RECENT_FORM_BAD'))      deltas.push({ delta: -0.008, reason: 'RECENT_FORM_BAD — batter struggling' });
  }

  // ── MLB_GAME ──────────────────────────────────────────────
  if (profile === 'MLB_GAME') {
    if (hasSet(SHARP_SIGNALS))  deltas.push({ delta: +0.006, reason: 'sharp signal present' });
    if (hasSet(STEAM_SIGNALS))  deltas.push({ delta: +0.005, reason: 'steam move detected' });
  }

  // ── NCAAB / NCAAF ─────────────────────────────────────────
  if (profile === 'NCAAB_GAME' || profile === 'NCAAF_GAME') {
    if (hasSet(SHARP_SIGNALS))  deltas.push({ delta: +0.006, reason: 'sharp signal — soft market bonus' });
    if (hasSet(STEAM_SIGNALS))  deltas.push({ delta: +0.004, reason: 'steam move detected' });
  }

  // ── DEFAULT ───────────────────────────────────────────────
  if (profile === 'DEFAULT') {
    if (hasSet(SHARP_SIGNALS))  deltas.push({ delta: +0.004, reason: 'sharp signal present' });
  }

  return deltas;
}

// ============================================================
// Per-candidate weighting
// ============================================================

function weightOne(c: DecisionCandidate): DecisionCandidate {
  const baseEdge = c.impliedEdge;
  if (baseEdge === undefined) {
    // impliedEdge not set (probability engine hasn't run, or candidate
    // is missing price data).  Pass through without weighting.
    return c;
  }

  const profile    = detectProfile(c);
  const multiplier = baseMultiplier(profile);
  const deltas     = computeDeltas(c, profile);
  const totalDelta = deltas.reduce((s, d) => s + d.delta, 0);

  // weightedAdjustedEdge = base × multiplier + signal deltas
  const weighted = baseEdge * multiplier + totalDelta;

  // Build human-readable reasons list
  const weightedPct = `${weighted >= 0 ? '+' : ''}${(weighted * 100).toFixed(1)}%`;
  const reasons: string[] = [
    `${profile} base ×${multiplier.toFixed(2)} → ${weightedPct}`,
    ...deltas.map(d => {
      const sign = d.delta >= 0 ? '+' : '';
      return `${d.reason} ${sign}${(d.delta * 100).toFixed(1)}%`;
    }),
  ];

  return {
    ...c,
    weightedAdjustedEdge: Math.round(weighted * 10000) / 10000,
    weightingReasons:     reasons,
    weightingMultiplier:  multiplier,
    weightingProfile:     profile,
  };
}

// ============================================================
// Public API
// ============================================================

/**
 * Applies sport/market profile weighting to each candidate's
 * impliedEdge, producing weightedAdjustedEdge.
 *
 * Runs BEFORE the risk engine.  The risk engine reads
 * weightedAdjustedEdge (when set) as its base edge input and
 * applies price-only discounts on top of it.
 *
 * Returns a new array of cloned objects — inputs are never mutated.
 * Candidates missing impliedEdge are passed through unchanged.
 */
export function applySignalWeighting(
  candidates: DecisionCandidate[]
): DecisionCandidate[] {
  return candidates.map(weightOne);
}

// ============================================================
// Debug summary
// ============================================================

/**
 * Prints a one-line weighting distribution and up to 3 examples
 * showing the before/after edge change for changed candidates.
 *
 * Example output:
 *   [WEIGHTING] processed: 8 | profiles: NBA_PROP×5, NHL_GAME×2, DEFAULT×1
 *   --- Signal weighting examples ---
 *     [NBA_PROP ] Jaylen Brown Points O  raw impliedEdge: +8.4% → weighted: +7.4%  (-1.0%)
 *     [NHL_GAME ] Oilers vs Flames ML H  raw impliedEdge: +6.1% → weighted: +6.7%  (+0.6%)
 */
export function printWeightingSummary(candidates: DecisionCandidate[]): void {
  const processed = candidates.filter(c => c.weightingProfile !== undefined);
  if (processed.length === 0) return;

  // Profile frequency
  const profileCounts = new Map<string, number>();
  for (const c of processed) {
    const p = c.weightingProfile ?? 'NONE';
    profileCounts.set(p, (profileCounts.get(p) ?? 0) + 1);
  }
  const profileStr = [...profileCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p}×${n}`)
    .join(', ');

  console.log(
    `  [WEIGHTING] processed: ${processed.length} | profiles: ${profileStr}`
  );

  // Examples: up to 3 candidates with the largest absolute change
  const changed = processed
    .filter(c => c.weightedAdjustedEdge !== undefined && c.impliedEdge !== undefined)
    .map(c => ({
      c,
      delta: (c.weightedAdjustedEdge ?? 0) - (c.impliedEdge ?? 0),
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);

  if (changed.length === 0) return;

  const pct = (v: number): string =>
    `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

  console.log('  --- Signal weighting examples ---');
  for (const { c, delta } of changed) {
    const profile = (c.weightingProfile ?? 'DEFAULT').padEnd(10);
    const name    = c.playerName
      ? `${c.playerName} ${c.market ?? ''} ${c.side}`.trim()
      : `${c.matchup} ${c.side}`;
    const raw     = pct(c.impliedEdge ?? 0);
    const final   = pct(c.weightedAdjustedEdge ?? 0);
    const diff    = pct(delta);

    console.log(
      `    [${profile}] ${name.substring(0, 24).padEnd(24)}` +
      `  raw impliedEdge: ${raw.padStart(6)} → weighted: ${final.padStart(6)}  (${diff})`
    );
  }
}
