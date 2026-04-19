// ============================================================
// src/services/probabilityEngine.ts
// Phase 4 — Probability enrichment layer.
//
// Adds winProbability, impliedProbabilityFromBestPrice, and
// impliedEdge to already-scored DecisionCandidate objects.
//
// IMPORTANT: This file is additive only.
//   - It does NOT re-score, re-rank, or re-calibrate anything.
//   - It does NOT filter or gate candidates.
//   - It never mutates input objects (spreads into new copies).
//   - The existing score is READ-ONLY input to the probability model.
//
// ============================================================
// SCORE-TO-PROBABILITY FORMULA
// ============================================================
//
// The existing composite score (0-100) is mapped linearly onto
// the probability range [WIN_PROB_BASE, WIN_PROB_BASE + WIN_PROB_RANGE]:
//
//   winProbability = WIN_PROB_BASE + (score / 100) × WIN_PROB_RANGE
//
// Default parameters:
//   WIN_PROB_BASE  = 0.50   (50% — no edge at all)
//   WIN_PROB_RANGE = 0.15   (upper bound at 65%)
//
// Reference anchors with defaults:
//   score   0  →  50.0%  (random / no information)
//   score  60  →  59.0%  (MLB/NHL MONITOR floor)
//   score  72  →  60.8%  (NBA/NFL MONITOR floor)
//   score  78  →  61.7%  (NBA/NFL LEAN floor)
//   score  85  →  62.75% (NBA/NFL BET floor)
//   score 100  →  65.0%  (theoretical maximum)
//
// Why linear?
//   The score is already calibrated and weight-adjusted by the
//   upstream pipeline. A non-linear transform would imply a
//   structural understanding of the score distribution we don't
//   yet have from retro data. Linear is transparent and reversible.
//
// Why 65% ceiling?
//   Sports-betting win rates above 60% are elite over large samples.
//   65% is already aggressive. Inflating the ceiling would produce
//   Kelly fractions that are reckless. This is intentionally conservative
//   as a first-pass model.
//
// Sport-specific, role-specific, and pitcher/goalie adjustments
// are deferred to a later phase once retro data is available.
//
// ============================================================
// IMPLIED PROBABILITY FORMULA
// ============================================================
//
// Standard American-odds conversion applied to bestPrice.
// No vig removal — we compare against the exact user-accessible
// price, not a theoretical fair line.
//
//   Negative odds (e.g. -110):
//     implied = |odds| / (|odds| + 100)
//     e.g.  -110 →  110 / 210  = 52.38%
//
//   Positive odds (e.g. +130):
//     implied = 100 / (odds + 100)
//     e.g.  +130 →  100 / 230  = 43.48%
//
// ============================================================
// IMPLIED EDGE
// ============================================================
//
//   impliedEdge = winProbability − impliedProbabilityFromBestPrice
//
//   Positive → model believes true win rate exceeds price's implied rate.
//   Negative → book's implied probability is higher than our model's estimate.
//
// ============================================================

import { DecisionCandidate } from './decisionTypes';

// ============================================================
// Configurable parameters — change here, not in formula logic
// ============================================================

/** Minimum win probability assigned to any candidate (score = 0). */
const WIN_PROB_BASE  = 0.50;

/**
 * Total probability range above the base.
 * Base + Range = maximum win probability (assigned when score = 100).
 * Default: 0.50 + 0.15 = 0.65 (65% ceiling).
 */
const WIN_PROB_RANGE = 0.15;

// ============================================================
// Internal helpers
// ============================================================

/**
 * Maps an existing 0-100 composite score to a win probability.
 * See module-level comment for full formula and design rationale.
 */
function scoreToWinProbability(score: number): number {
  const clamped = Math.max(0, Math.min(100, score));
  // Round to 3 decimal places (0.1% precision)
  return Math.round((WIN_PROB_BASE + (clamped / 100) * WIN_PROB_RANGE) * 1000) / 1000;
}

/**
 * Converts American odds to an implied win probability.
 * No vig removal applied.
 */
function americanToImplied(american: number): number {
  if (american >= 0) {
    // Positive odds: underdog
    return Math.round((100 / (american + 100)) * 1000) / 1000;
  } else {
    // Negative odds: favorite
    return Math.round((Math.abs(american) / (Math.abs(american) + 100)) * 1000) / 1000;
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Enriches an array of DecisionCandidates with probability fields.
 *
 * Returns a new array of cloned objects — input is never mutated.
 * Candidates that were not yet qualified are still enriched; the
 * probability model does not depend on the qualification result.
 *
 * Fields added per candidate:
 *   winProbability              — score-to-probability mapping
 *   impliedProbabilityFromBestPrice — from bestPrice (American odds)
 *   impliedEdge                 — win prob minus implied prob
 */
export function enrichWithProbability(
  candidates: DecisionCandidate[]
): DecisionCandidate[] {
  return candidates.map(c => {
    const winProbability             = scoreToWinProbability(c.score);
    const impliedProbabilityFromBestPrice = americanToImplied(c.bestPrice);
    // Round impliedEdge to 3 decimal places
    const impliedEdge = Math.round(
      (winProbability - impliedProbabilityFromBestPrice) * 1000
    ) / 1000;

    return {
      ...c,
      winProbability,
      impliedProbabilityFromBestPrice,
      impliedEdge,
    };
  });
}

// ============================================================
// Debug summary — console output only, no side effects
// ============================================================

/**
 * Prints a single-line probability summary after enrichment.
 * Safe to call in any run mode; produces no side effects.
 *
 * Example output:
 *   [PROB]    10 enriched | avg winProb: 59.2% | positive edge: 6/10 | best edge: +5.1% (Warriors ML)
 */
export function printProbabilitySummary(enriched: DecisionCandidate[]): void {
  if (enriched.length === 0) return;

  const withProb = enriched.filter(c => c.winProbability !== undefined);
  if (withProb.length === 0) return;

  // Average win probability across all enriched candidates
  const avgWinProb = withProb.reduce((sum, c) => sum + (c.winProbability ?? 0), 0)
    / withProb.length;

  // Count of candidates where we believe we have a genuine edge
  const positiveEdgeCount = withProb.filter(c => (c.impliedEdge ?? 0) > 0).length;

  // Best single edge candidate
  const bestEdgeCandidate = withProb.reduce<DecisionCandidate | null>((best, c) => {
    if (best === null) return c;
    return (c.impliedEdge ?? -Infinity) > (best.impliedEdge ?? -Infinity) ? c : best;
  }, null);

  const bestEdge = bestEdgeCandidate?.impliedEdge ?? 0;

  // Human-readable label for the best-edge candidate
  const bestLabel = bestEdgeCandidate
    ? (bestEdgeCandidate.playerName
        ? `${bestEdgeCandidate.playerName} ${bestEdgeCandidate.side}`
        : `${bestEdgeCandidate.matchup.split(' vs ')[0]?.trim() ?? bestEdgeCandidate.matchup} ${bestEdgeCandidate.side}`)
    : '—';

  const edgeSign = bestEdge >= 0 ? '+' : '';

  console.log(
    `  [PROB]    ${withProb.length} enriched | ` +
    `avg winProb: ${(avgWinProb * 100).toFixed(1)}% | ` +
    `positive edge: ${positiveEdgeCount}/${withProb.length} | ` +
    `best edge: ${edgeSign}${(bestEdge * 100).toFixed(1)}% (${bestLabel})`
  );
}
