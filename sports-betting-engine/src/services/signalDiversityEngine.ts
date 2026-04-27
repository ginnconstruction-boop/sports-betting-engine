// ============================================================
// src/services/signalDiversityEngine.ts
// Phase A — Signal Diversity Engine.
//
// Runs AFTER mapAllToDecisionCandidates and BEFORE applyRisk.
// Classifies each candidate's signal set as either:
//   - price_only   : all signals are market-structure comparisons only
//   - multi_signal : at least one outcome/intelligence signal present
//
// Sets isPriceOnlyCandidate on each candidate so downstream engines
// can enforce a hard cap:
//   price_only candidates NEVER receive finalDecisionLabel = BET
//
// The labelEngine reads isPriceOnlyCandidate as an explicit guard
// independent of (and in addition to) the risk-engine's price_only_signal
// flag.  Even if riskScore is somehow neutral, BET is still blocked.
//
// IMPORTANT: This engine is additive only.
//   - It does NOT re-score, re-rank, or re-calibrate anything.
//   - It does NOT filter or remove candidates.
//   - It never mutates input objects (spreads into new copies).
// ============================================================

import { DecisionCandidate } from './decisionTypes';

// ============================================================
// Constants — intentionally mirrors MARKET_STRUCTURE_SIGNALS
// in riskEngine to keep the two layers consistent.
// ============================================================

/**
 * Signals that represent pure book-comparison edges.
 * Candidates whose entire signal set falls within this group
 * have no independent predictive information — they are priced
 * opportunistically, not because of form/context/intel.
 */
const MARKET_STRUCTURE_SIGNALS = new Set([
  'PRICE_EDGE',
  'LINE_GAP',
  'JUICE_GAP',
  'LINE_VS_CONSENSUS',
]);

// ============================================================
// Internal helpers
// ============================================================

/**
 * Returns true when the candidate has no outcome-backed signals.
 * An empty or missing signal array is treated as price-only:
 * absence of evidence is not evidence of a predictive edge.
 */
function detectPriceOnly(signals: string[] | undefined): boolean {
  if (!signals || signals.length === 0) return true;
  return signals.every(s => MARKET_STRUCTURE_SIGNALS.has(s));
}

// ============================================================
// Public API
// ============================================================

/**
 * Annotates each candidate with isPriceOnlyCandidate.
 *
 * Returns a new array of cloned objects — inputs are never mutated.
 * Candidates are NOT removed; callers receive the full set annotated.
 */
export function applySignalDiversity(
  candidates: DecisionCandidate[]
): DecisionCandidate[] {
  return candidates.map(c => ({
    ...c,
    isPriceOnlyCandidate: detectPriceOnly(c.signals),
  }));
}

/**
 * Prints a single [STRUCTURE] summary line after applySignalDiversity().
 * Safe to call in any run mode; produces no side effects.
 *
 * Example output:
 *   [STRUCTURE] price_only_candidates: 6 | multi_signal_candidates: 2
 */
export function printSignalDiversitySummary(candidates: DecisionCandidate[]): void {
  if (candidates.length === 0) return;
  const priceOnly   = candidates.filter(c => c.isPriceOnlyCandidate === true).length;
  const multiSignal = candidates.length - priceOnly;
  console.log(
    `  [STRUCTURE] price_only_candidates: ${priceOnly} | ` +
    `multi_signal_candidates: ${multiSignal}`
  );
}
