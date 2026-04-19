// ============================================================
// src/services/qualificationEngine.ts
// Phase 2 — First gate in the second-layer decision engine.
//
// Applies hard, rule-based filters to a set of DecisionCandidates
// AFTER the existing scoring pipeline has already run.
//
// IMPORTANT: This engine is purely additive.
//   - It does NOT change any score.
//   - It does NOT re-rank candidates.
//   - It does NOT modify runMorningScan, runProps, or runFullScan.
//   - It clones each candidate before setting decision fields;
//     the original scored objects are never mutated.
//
// Callers receive two arrays:
//   qualified — candidates that cleared every rule
//   rejected  — candidates that failed at least one rule, with reasons
//
// Rules applied (in order):
//   1. Minimum signal count     — signalCount < BET_FILTERS.MIN_SIGNALS_REQUIRED
//   2. Price sanity range       — bestPrice outside [minPrice, maxPrice]
//                                 (game lines use BET_FILTERS; props use PROP_CONFIG)
//   3. Price edge presence      — priceDiff <= 0
//   4. Time window              — game already started or starts too soon
//                                 (game lines: < BET_FILTERS.MIN_HOURS_UNTIL_GAME = 1hr)
//                                 (props:      < BET_FILTERS.MIN_HOURS_UNTIL_GAME_PROPS = 0.25hr)
// ============================================================

import { DecisionCandidate } from './decisionTypes';
import { BET_FILTERS }       from '../config/betFilters';
import { PROP_CONFIG }       from '../config/propConfig';

// ============================================================
// Return type
// ============================================================

export interface QualificationResult {
  qualified: DecisionCandidate[];
  rejected:  DecisionCandidate[];
  /** Summary counts for logging / debugging */
  summary: {
    total:     number;
    passed:    number;
    failed:    number;
    /** Count of candidates rejected per rule label */
    byRule: Record<string, number>;
  };
}

// ============================================================
// Internal rule helpers
// Each rule returns a rejection reason string if it fires,
// or null if the candidate passes.
// ============================================================

function checkSignalCount(c: DecisionCandidate): string | null {
  const min = BET_FILTERS.MIN_SIGNALS_REQUIRED;   // 2
  if (c.signalCount < min) {
    return `insufficient signal count (${c.signalCount} < ${min} required)`;
  }
  return null;
}

function checkPriceRange(c: DecisionCandidate): string | null {
  // Props use tighter juice bounds than game lines.
  const minPrice = c.marketType === 'player_prop'
    ? PROP_CONFIG.MIN_PRICE      // -140
    : BET_FILTERS.MIN_PRICE;    // -200

  const maxPrice = c.marketType === 'player_prop'
    ? PROP_CONFIG.MAX_PRICE      // +120
    : BET_FILTERS.MAX_PRICE;    // +180

  if (c.bestPrice < minPrice || c.bestPrice > maxPrice) {
    return `invalid price range (${c.bestPrice} outside [${minPrice}, ${maxPrice}])`;
  }
  return null;
}

function checkPriceEdge(c: DecisionCandidate): string | null {
  if (c.priceDiff <= 0) {
    return 'no price edge (priceDiff <= 0)';
  }
  return null;
}

function checkTimeWindow(c: DecisionCandidate): string | null {
  // Skip the check entirely when hoursUntilGame was not computable.
  if (c.hoursUntilGame === undefined) return null;

  const minHours = c.marketType === 'player_prop'
    ? BET_FILTERS.MIN_HOURS_UNTIL_GAME_PROPS   // 0.25 (15 min)
    : BET_FILTERS.MIN_HOURS_UNTIL_GAME;        // 1.0 (60 min)

  if (c.hoursUntilGame <= 0) {
    return 'game already in progress';
  }
  if (c.hoursUntilGame < minHours) {
    const minutesLeft    = Math.round(c.hoursUntilGame * 60);
    const minutesNeeded  = Math.round(minHours * 60);
    return `starting too soon (${minutesLeft} min until tip, minimum ${minutesNeeded} min required)`;
  }
  return null;
}

// Rule registry — order determines evaluation sequence and label names in summary.
const RULES: Array<{ label: string; check: (c: DecisionCandidate) => string | null }> = [
  { label: 'signal_count',  check: checkSignalCount },
  { label: 'price_range',   check: checkPriceRange  },
  { label: 'price_edge',    check: checkPriceEdge   },
  { label: 'time_window',   check: checkTimeWindow  },
];

// ============================================================
// Public API
// ============================================================

/**
 * Runs each candidate through all qualification rules.
 *
 * Returns:
 *   qualified — candidates that cleared every rule
 *               (qualificationPassed = true, qualificationReasons populated)
 *   rejected  — candidates that failed at least one rule
 *               (qualificationPassed = false, rejectionReasons populated)
 *
 * Input candidates are never mutated; each result object is a fresh copy.
 */
export function qualifyCandidates(
  candidates: DecisionCandidate[]
): QualificationResult {
  const qualified: DecisionCandidate[] = [];
  const rejected:  DecisionCandidate[] = [];
  const byRule: Record<string, number> = {};

  for (const rule of RULES) {
    byRule[rule.label] = 0;
  }

  for (const original of candidates) {
    // Clone into a fresh object — never mutate the input.
    const candidate: DecisionCandidate = {
      ...original,
      qualificationPassed:  false,
      qualificationReasons: [],
      rejectionReasons:     [],
    };

    const failures: string[] = [];

    for (const rule of RULES) {
      const reason = rule.check(candidate);
      if (reason !== null) {
        failures.push(reason);
        byRule[rule.label]++;
        // Continue evaluating all rules so the full rejection picture
        // is visible — do not short-circuit after first failure.
      }
    }

    if (failures.length === 0) {
      candidate.qualificationPassed  = true;
      candidate.qualificationReasons = ['meets minimum market criteria'];
      qualified.push(candidate);
    } else {
      candidate.qualificationPassed = false;
      candidate.rejectionReasons    = failures;
      rejected.push(candidate);
    }
  }

  return {
    qualified,
    rejected,
    summary: {
      total:  candidates.length,
      passed: qualified.length,
      failed: rejected.length,
      byRule,
    },
  };
}

// ============================================================
// Optional diagnostic helper — does not affect scoring
// ============================================================

/**
 * Logs a concise qualification summary to the console.
 * Safe to call in any run mode; produces no side effects.
 *
 * Example output:
 *   [QUALIFY] 18 candidates → 11 passed, 7 rejected
 *             signal_count: 2   price_range: 1   price_edge: 3   time_window: 1
 */
export function printQualificationSummary(result: QualificationResult): void {
  const { summary } = result;
  const ruleBreakdown = Object.entries(summary.byRule)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label}: ${count}`)
    .join('   ');

  console.log(
    `  [QUALIFY] ${summary.total} candidate(s) → ` +
    `${summary.passed} passed, ${summary.failed} rejected` +
    (ruleBreakdown ? `\n            ${ruleBreakdown}` : '')
  );
}
