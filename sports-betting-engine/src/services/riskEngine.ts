// ============================================================
// src/services/riskEngine.ts
// Phase 5 — Risk engine.
//
// Accepts already-scored, already-enriched DecisionCandidates
// and adds risk scoring, risk grading, risk flags, and a
// signal-quality-discounted win probability.
//
// IMPORTANT: This file is additive only.
//   - It does NOT re-score, re-rank, or re-calibrate anything.
//   - It does NOT filter or remove candidates.
//   - It never mutates input objects (spreads into new copies).
//   - The existing score, winProbability, and impliedEdge are
//     READ-ONLY inputs; they are never overwritten.
//
// ============================================================
// RISK RULES
// ============================================================
//
// Five rules produce flags and risk score adjustments:
//
// 1. SIGNAL-TYPE DISCOUNT (critical)
//    Market-structure-only signals (PRICE_EDGE, LINE_GAP,
//    JUICE_GAP, LINE_VS_CONSENSUS) indicate a book-comparison
//    edge rather than a predictive edge.  Without form/context
//    signals the probability estimate is inflated.
//
//    Detection: all signals in MARKET_STRUCTURE_SIGNALS set.
//    Flag:      "price_only_signal"
//    Penalty:   riskScore -2
//    Probability discount applied to adjustedWinProbability:
//      × 0.85 if priceDiff > 50 (large structural gap; likely stale)
//      × 0.90 if priceDiff <= 50 (smaller gap; might be real value)
//
// 2. EDGE FLOOR
//    Candidates with impliedEdge < 0.03 (3%) after the raw
//    probability mapping are unlikely to be actionable.
//    Flag:  "low_edge"
//    Penalty: riskScore -1
//
// 3. VOLATILITY / ROLE FLAG
//    Props with very low lines are typically bench/role players
//    whose minutes are highly variable.  The probability model
//    has no minutes or depth-chart data, so these carry higher
//    outcome variance.
//    Proxy (no minutes data available):
//      Points:    line < 10
//      Rebounds:  line < 4
//      Assists:   line < 3
//      PRA combo: line < 15
//      Threes:    line < 1.5
//      Other:     line < 8
//    Flag:  "role_volatility"
//    Penalty: riskScore -1
//
// 4. CORRELATION FLAG (informational only)
//    Multiple candidates from the same game are correlated —
//    a blowout or overtime affects all of them simultaneously.
//    Flag:  "correlated_game"
//    No riskScore penalty (just visibility).
//
// 5. STALE LINE / OUTLIER BOOK
//    A large lineGap suggests one book has an outlier line that
//    has not been updated.  The line-gap edge may close before
//    the bet is placed, or it may reflect a genuinely stale book.
//    Detection:
//      lineGap >= 3  (absolute 3-point gap across books)
//      OR  lineGap / line >= 0.25  (gap > 25% of the posted line)
//    Flag:  "stale_line_risk"
//    Penalty: riskScore -1
//
// ============================================================
// RISK SCORE → GRADE MAPPING
// ============================================================
//
//   riskScore >= 2   →  LOW       (signal diversity present)
//   riskScore 0–1    →  MODERATE  (neutral; no strong discounts)
//   riskScore < 0    →  HIGH      (one or more penalties applied)
//
// ============================================================

import { DecisionCandidate } from './decisionTypes';

// ============================================================
// Constants
// ============================================================

/**
 * Signals that represent pure market-structure information.
 * Candidates whose entire signal set falls within this group
 * are flagged as "price_only_signal" — their win-probability
 * estimate is over-stated and receives a discount.
 */
const MARKET_STRUCTURE_SIGNALS = new Set([
  'PRICE_EDGE',
  'LINE_GAP',
  'JUICE_GAP',
  'LINE_VS_CONSENSUS',
]);

/** Minimum implied edge to avoid the low_edge flag (3%). */
const MIN_EDGE_THRESHOLD = 0.03;

/**
 * priceDiff threshold for choosing between the two discount factors.
 * > 50 American-odds points → likely stale-book large gap → heavier discount.
 */
const LARGE_PRICE_DIFF_THRESHOLD = 50;

/** Win-probability discount for price-only + large structural gap. */
const DISCOUNT_LARGE = 0.85;

/** Win-probability discount for price-only + smaller gap. */
const DISCOUNT_SMALL = 0.90;

// ============================================================
// Internal helpers
// ============================================================

/**
 * Returns true when all present signals are market-structure only.
 * An empty or missing signals array is treated as price-only
 * (no evidence of real intelligence signals).
 */
function isPriceOnlySignal(signals: string[] | undefined): boolean {
  if (!signals || signals.length === 0) return true;
  return signals.every(s => MARKET_STRUCTURE_SIGNALS.has(s));
}

/**
 * Returns true when at least one signal is NOT market-structure.
 * These signals (SHARP_INTEL, LINE_MOVEMENT, PRICE_MOVEMENT,
 * FADE_PUBLIC, RECENT_FORM, PROP_STREAK, MATCHUP, etc.) indicate
 * genuine information beyond simple book-comparison.
 */
function hasStrongSignalDiversity(signals: string[] | undefined): boolean {
  if (!signals || signals.length === 0) return false;
  return signals.some(s => !MARKET_STRUCTURE_SIGNALS.has(s));
}

/**
 * Returns true when the candidate appears to be a bench/role player
 * based on the posted line.  This is a conservative proxy — no
 * actual minutes or depth-chart data is available at this phase.
 *
 * Market-specific low-line thresholds:
 *   Points only:               < 10
 *   Rebounds only:             < 4
 *   Assists only:              < 3
 *   Pts+Reb+Ast (any combo):   < 15
 *   Threes made:               < 1.5
 *   Default (blocks/steals):   < 8
 */
function isLikelyBenchPlayer(c: DecisionCandidate): boolean {
  if (c.line === undefined || c.line === null) return false;
  const mkt = (c.market ?? '').toLowerCase();

  const isPoints    = mkt.includes('point')   && !mkt.includes('rebound') && !mkt.includes('assist');
  const isRebounds  = mkt.includes('rebound') && !mkt.includes('point')   && !mkt.includes('assist');
  const isAssists   = mkt.includes('assist')  && !mkt.includes('point')   && !mkt.includes('rebound');
  const isCombo     = (mkt.includes('pts') && mkt.includes('reb')) ||
                      mkt.includes('points_rebounds') ||
                      mkt.includes('points_assists')  ||
                      mkt.includes('rebounds_assists');
  const isThrees    = mkt.includes('three') || mkt.includes('3p');

  if (isPoints)   return c.line < 10;
  if (isRebounds) return c.line < 4;
  if (isAssists)  return c.line < 3;
  if (isCombo)    return c.line < 15;
  if (isThrees)   return c.line < 1.5;
  return c.line < 8;  // default for blocks/steals/other
}

/**
 * Returns true when lineGap indicates an outlier book.
 * Either the absolute gap is >= 3 points, or the gap represents
 * >= 25% of the posted line (catches outliers on low-line props).
 */
function hasStaleLineRisk(c: DecisionCandidate): boolean {
  if (c.lineGap == null || c.lineGap <= 0) return false;
  if (c.line == null || c.line <= 0)       return c.lineGap >= 3;
  return c.lineGap >= 3 || (c.lineGap / c.line) >= 0.25;
}

/**
 * Identifies matchups that appear more than once in the candidate set.
 * Returns a Set of matchup strings where multiple candidates exist —
 * used to tag "correlated_game" without filtering.
 */
function findCorrelatedMatchups(candidates: DecisionCandidate[]): Set<string> {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    counts.set(c.matchup, (counts.get(c.matchup) ?? 0) + 1);
  }
  const correlated = new Set<string>();
  for (const [matchup, count] of counts) {
    if (count > 1) correlated.add(matchup);
  }
  return correlated;
}

// ============================================================
// Public API
// ============================================================

/**
 * Applies risk rules to an array of DecisionCandidates.
 *
 * For each candidate:
 *   - Evaluates all five risk rules
 *   - Computes riskScore, riskGrade, and riskFlags
 *   - Computes adjustedWinProbability (discounted if price-only)
 *   - Computes adjustedEdge = adjustedWinProbability − impliedProb
 *
 * Returns a new array of cloned objects — inputs are never mutated.
 * Candidates are NOT removed; caller decides what to do with HIGH-risk items.
 */
export function applyRisk(
  candidates: DecisionCandidate[]
): DecisionCandidate[] {
  // Pre-compute correlated games once across the whole set
  const correlatedMatchups = findCorrelatedMatchups(candidates);

  return candidates.map(c => {
    const flags: string[] = [];
    let riskScore = 0;

    // ----------------------------------------------------------
    // Rule 1: Signal-type discount
    // ----------------------------------------------------------
    const priceOnly      = isPriceOnlySignal(c.signals);
    const strongDiversity = hasStrongSignalDiversity(c.signals);

    if (strongDiversity) {
      riskScore += 2;  // intelligence signals present — positive indicator
    }
    if (priceOnly) {
      flags.push('price_only_signal');
      riskScore -= 2;
    }

    // ----------------------------------------------------------
    // Rule 2: Edge floor
    // ----------------------------------------------------------
    if ((c.impliedEdge ?? 0) < MIN_EDGE_THRESHOLD) {
      flags.push('low_edge');
      riskScore -= 1;
    }

    // ----------------------------------------------------------
    // Rule 3: Volatility / role flag
    // ----------------------------------------------------------
    if (isLikelyBenchPlayer(c)) {
      flags.push('role_volatility');
      riskScore -= 1;
    }

    // ----------------------------------------------------------
    // Rule 4: Correlation tag (informational — no score penalty)
    // ----------------------------------------------------------
    if (correlatedMatchups.has(c.matchup)) {
      flags.push('correlated_game');
    }

    // ----------------------------------------------------------
    // Rule 5: Stale line / outlier book
    // ----------------------------------------------------------
    if (hasStaleLineRisk(c)) {
      flags.push('stale_line_risk');
      riskScore -= 1;
    }

    // ----------------------------------------------------------
    // Rule 6: Low quality bet type (sport intelligence layer)
    // Informational flag only — riskScore unchanged in this pass.
    // Thresholds will be adjusted in a subsequent calibration pass.
    // ----------------------------------------------------------
    if (c.betTypeQualityTier === 'LOW') {
      flags.push('low_quality_bet_type');
    }

    // ----------------------------------------------------------
    // Risk grade
    // ----------------------------------------------------------
    const riskGrade: 'LOW' | 'MODERATE' | 'HIGH' =
      riskScore >= 2 ? 'LOW' :
      riskScore >= 0 ? 'MODERATE' :
                       'HIGH';

    // ----------------------------------------------------------
    // Adjusted win probability
    // Price-only candidates receive a discount that brings the
    // Phase 4 "14–17%" raw edges down to a realistic 4–7% range.
    // Non-price-only candidates keep their winProbability unchanged.
    // adjustedWinProbability is preserved for diagnostic output.
    // ----------------------------------------------------------
    const baseWinProb = c.winProbability ?? 0;
    let adjustedWinProbability = baseWinProb;

    if (priceOnly) {
      const discountFactor = c.priceDiff > LARGE_PRICE_DIFF_THRESHOLD
        ? DISCOUNT_LARGE   // 0.85 — large structural gap, likely stale
        : DISCOUNT_SMALL;  // 0.90 — smaller gap, might be genuine value
      adjustedWinProbability =
        Math.round(baseWinProb * discountFactor * 1000) / 1000;
    }

    // ----------------------------------------------------------
    // Adjusted edge
    //
    // When signalWeightingEngine has run (weightedAdjustedEdge is set),
    // use the pre-calibrated sport/market edge as the base and apply
    // the price-only discount multiplicatively on top of it.
    //
    // When weighting has not run (e.g. runFullScan, runLiveCheck which
    // skip the weighting step), fall back to the raw probability formula:
    //   adjustedWinProbability − impliedProbabilityFromBestPrice
    // which preserves existing behaviour exactly.
    //
    // Three-stage audit trail:
    //   impliedEdge          (probability engine) — untouched
    //   weightedAdjustedEdge (weighting engine)   — untouched
    //   adjustedEdge         (here)               — final value label/slate read
    // ----------------------------------------------------------
    const impliedProb = c.impliedProbabilityFromBestPrice;

    let adjustedEdge: number | undefined;

    if (c.weightedAdjustedEdge !== undefined) {
      // Weighting path: apply price-only discount to the weighted edge.
      if (priceOnly) {
        const discountFactor = c.priceDiff > LARGE_PRICE_DIFF_THRESHOLD
          ? DISCOUNT_LARGE
          : DISCOUNT_SMALL;
        adjustedEdge = Math.round(c.weightedAdjustedEdge * discountFactor * 1000) / 1000;
      } else {
        adjustedEdge = Math.round(c.weightedAdjustedEdge * 1000) / 1000;
      }
    } else if (impliedProb !== undefined) {
      // Fallback path (no weighting engine): raw probability delta formula.
      adjustedEdge = Math.round((adjustedWinProbability - impliedProb) * 1000) / 1000;
    }

    return {
      ...c,
      riskScore,
      riskGrade,
      riskFlags:              flags,
      adjustedWinProbability,
      adjustedEdge,
    };
  });
}

// ============================================================
// Debug summary — console output only, no side effects
// ============================================================

/**
 * Prints a single-line risk summary after applyRisk().
 * Safe to call in any run mode; produces no side effects.
 *
 * Example output:
 *   [RISK]    LOW: 0 | MODERATE: 0 | HIGH: 8 | avg adjEdge: +4.7% |
 *             price_only: 8 | stale_line: 6 | correlated: 8 | volatile: 2
 */
export function printRiskSummary(candidates: DecisionCandidate[]): void {
  const withRisk = candidates.filter(c => c.riskGrade !== undefined);
  if (withRisk.length === 0) return;

  const low      = withRisk.filter(c => c.riskGrade === 'LOW').length;
  const moderate = withRisk.filter(c => c.riskGrade === 'MODERATE').length;
  const high     = withRisk.filter(c => c.riskGrade === 'HIGH').length;

  const withEdge    = withRisk.filter(c => c.adjustedEdge !== undefined);
  const avgAdjEdge  = withEdge.length > 0
    ? withEdge.reduce((s, c) => s + (c.adjustedEdge ?? 0), 0) / withEdge.length
    : 0;

  const priceOnly   = withRisk.filter(c => c.riskFlags?.includes('price_only_signal')).length;
  const staleLine   = withRisk.filter(c => c.riskFlags?.includes('stale_line_risk')).length;
  const correlated  = withRisk.filter(c => c.riskFlags?.includes('correlated_game')).length;
  const volatile    = withRisk.filter(c => c.riskFlags?.includes('role_volatility')).length;
  const lowQuality  = withRisk.filter(c => c.riskFlags?.includes('low_quality_bet_type')).length;

  const edgeSign = avgAdjEdge >= 0 ? '+' : '';

  let summary =
    `  [RISK]    LOW: ${low} | MODERATE: ${moderate} | HIGH: ${high} | ` +
    `avg adjEdge: ${edgeSign}${(avgAdjEdge * 100).toFixed(1)}% | ` +
    `price_only: ${priceOnly} | stale_line: ${staleLine} | ` +
    `correlated: ${correlated} | volatile: ${volatile}`;
  if (lowQuality > 0) summary += ` | low_quality_bet_type: ${lowQuality}`;
  console.log(summary);
}
