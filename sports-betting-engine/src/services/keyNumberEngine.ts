// ============================================================
// src/services/keyNumberEngine.ts
// Key Number Engine — spread proximity risk adjustment.
//
// In football and basketball, certain score margins occur far
// more often than others.  A bet at -2.5 when 3 is the most
// common NFL margin is materially more risky than -3.5.
// This engine identifies proximity to sport-specific key
// numbers and adds a proportional risk penalty to adjustedEdge.
//
// IMPORTANT: This engine is risk-adjustment only.
//   - It NEVER upgrades a candidate's label.
//   - It NEVER turns a PASS or MONITOR into a BET.
//   - It only applies to SPREAD markets on game lines.
//   - adjustedEdge is lowered by riskDeltaPct (negative delta).
//   - All other pipeline fields are left untouched.
//   - Input objects are never mutated.
//
// Placement: after applySignalDiversity(), before applyRisk().
// The riskDeltaPct is stored on the candidate and consumed by
// the risk engine when computing the final adjustedEdge.
//
// ============================================================
// KEY NUMBERS
// ============================================================
//
//   NFL / NCAAF : 3, 7, 10, 14, 17
//     (3 is by far the most common NFL margin — ~15% of games)
//
//   NBA / NCAAB : 5, 6, 7, 10, 12
//     (5-7 point margins are common in close NBA games)
//
//   NHL / MLB   : no key numbers defined — low-scoring sports
//     where margins are small integers; all values are sensitive.
//
// ============================================================
// SENSITIVITY THRESHOLDS
// ============================================================
//
//   Computed as: distanceFromKey = |abs(line) − nearestKeyNumber|
//
//   distance < 0.5  → 'high'    riskDelta = −0.025 (−2.5%)
//   distance < 1.5  → 'medium'  riskDelta = −0.015 (−1.5%)
//   distance < 2.5  → 'low'     riskDelta = −0.005 (−0.5%)
//   distance ≥ 2.5  → 'none'    riskDelta =  0
//
//   Examples (NFL):
//     −2.5  → nearest key = 3, distance = 0.5 → 'high'   (−2.5%)
//     −3.0  → nearest key = 3, distance = 0.0 → 'high'   (−2.5%)
//     −3.5  → nearest key = 3, distance = 0.5 → 'high'   (−2.5%)
//     −4.5  → nearest key = 3, distance = 1.5 → 'medium' (−1.5%)
//     −6.5  → nearest key = 7, distance = 0.5 → 'high'   (−2.5%)
//     −5.0  → nearest key = 3, distance = 2.0 → 'low'    (−0.5%)
//
// ============================================================

import { DecisionCandidate } from './decisionTypes';

// ── Types ─────────────────────────────────────────────────────────────────────

export type KeyNumberSensitivity = 'none' | 'low' | 'medium' | 'high';

export interface KeyNumberAdjustment {
  /** Which key number is closest to the line. */
  nearestKeyNumber:   number;
  /** |abs(line) − nearestKeyNumber| */
  nearestKeyDistance: number;
  /** Categorical sensitivity to the key number. */
  sensitivity:        KeyNumberSensitivity;
  /**
   * Negative delta to add to adjustedEdge in the risk engine.
   * 0 when sensitivity = 'none'.  Always ≤ 0.
   */
  riskDeltaPct:       number;
  /** The sport key this adjustment was computed for. */
  sportKey:           string;
  /** Human-readable explanation. */
  note:               string;
}

// ── Key number tables ─────────────────────────────────────────────────────────

const KEY_NUMBERS: Record<string, number[]> = {
  americanfootball_nfl:    [3, 7, 10, 14, 17],
  americanfootball_ncaaf:  [3, 7, 10, 14, 17],
  basketball_nba:          [5, 6, 7, 10, 12],
  basketball_ncaab:        [5, 6, 7, 10, 12],
};

// ── Sensitivity thresholds ────────────────────────────────────────────────────

const THRESHOLDS: Array<{ maxDist: number; sensitivity: KeyNumberSensitivity; delta: number }> = [
  { maxDist: 0.5, sensitivity: 'high',   delta: -0.025 },
  { maxDist: 1.5, sensitivity: 'medium', delta: -0.015 },
  { maxDist: 2.5, sensitivity: 'low',    delta: -0.005 },
];

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns the key numbers for a given sport key.
 * Returns an empty array when no key numbers are defined.
 */
function getKeyNumbers(sportKey: string): number[] {
  return KEY_NUMBERS[sportKey] ?? [];
}

/**
 * Returns true when the candidate should receive a key-number adjustment.
 * Criteria:
 *   1. marketType = 'game_line'
 *   2. betType = 'Spread' (not Moneyline or Total)
 *   3. line is a valid number
 *   4. sportKey has key numbers defined
 */
function isEligible(c: DecisionCandidate): boolean {
  if (c.marketType !== 'game_line') return false;
  if (c.betType !== 'Spread' && c.betType !== 'spreads') return false;
  if (c.line == null) return false;
  return getKeyNumbers(c.sportKey ?? '').length > 0;
}

/**
 * Computes the key number adjustment for a single eligible candidate.
 */
function computeAdjustment(c: DecisionCandidate): KeyNumberAdjustment {
  const sportKey  = c.sportKey ?? '';
  const keyNums   = getKeyNumbers(sportKey);
  const absLine   = Math.abs(c.line!);

  // Find nearest key number
  let nearestKey  = keyNums[0];
  let minDistance = Math.abs(absLine - nearestKey);

  for (const k of keyNums) {
    const dist = Math.abs(absLine - k);
    if (dist < minDistance) {
      minDistance = dist;
      nearestKey  = k;
    }
  }

  // Classify sensitivity
  let sensitivity: KeyNumberSensitivity = 'none';
  let delta = 0;

  for (const threshold of THRESHOLDS) {
    if (minDistance < threshold.maxDist) {
      sensitivity = threshold.sensitivity;
      delta       = threshold.delta;
      break;
    }
  }

  const direction = c.line! < 0 ? 'laying' : 'taking';
  const note = sensitivity === 'none'
    ? `line ${c.line} — not near any key number for ${sportKey}`
    : `line ${c.line} (${direction}) is ${minDistance.toFixed(1)} pts from key number ${nearestKey} — ${sensitivity} sensitivity`;

  return {
    nearestKeyNumber:   nearestKey,
    nearestKeyDistance: Math.round(minDistance * 100) / 100,
    sensitivity,
    riskDeltaPct:       delta,
    sportKey,
    note,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Adds a keyNumberAdjustment field to each eligible spread candidate.
 *
 * Only SPREAD market game lines for sports with defined key numbers
 * receive an adjustment. All other candidates are returned unchanged.
 *
 * The riskDeltaPct on the adjustment is consumed by the risk engine
 * when computing adjustedEdge.
 *
 * Returns a new array — input objects are never mutated.
 */
export function applyKeyNumbers(
  candidates: DecisionCandidate[]
): DecisionCandidate[] {
  return candidates.map(c => {
    if (!isEligible(c)) return c;
    const adjustment = computeAdjustment(c);
    if (adjustment.sensitivity === 'none') return c;  // no adjustment needed
    return { ...c, keyNumberAdjustment: adjustment };
  });
}

/**
 * Prints a compact key-number summary to console.
 * Shows how many candidates received adjustments and the breakdown.
 */
export function printKeyNumberSummary(candidates: DecisionCandidate[]): void {
  const adjusted = candidates.filter(c => c.keyNumberAdjustment !== undefined);
  if (adjusted.length === 0) return;

  const high   = adjusted.filter(c => c.keyNumberAdjustment?.sensitivity === 'high').length;
  const medium = adjusted.filter(c => c.keyNumberAdjustment?.sensitivity === 'medium').length;
  const low    = adjusted.filter(c => c.keyNumberAdjustment?.sensitivity === 'low').length;

  console.log(
    `  [KEY#]   ${adjusted.length} spread(s) near key numbers — ` +
    `high: ${high} | medium: ${medium} | low: ${low}`
  );
  for (const c of adjusted.slice(0, 3)) {
    const adj = c.keyNumberAdjustment!;
    console.log(
      `    ${(c.matchup ?? '').substring(0, 35).padEnd(35)} ` +
      `line: ${String(c.line).padEnd(6)}  ${adj.sensitivity.padEnd(6)}  ` +
      `delta: ${(adj.riskDeltaPct * 100).toFixed(1)}%  (key: ${adj.nearestKeyNumber})`
    );
  }
}
