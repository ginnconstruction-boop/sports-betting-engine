// ============================================================
// src/services/labelEngine.ts
// Phase 6 — Final label engine.
//
// Accepts already-scored, qualified, probability-enriched, and
// risk-assessed DecisionCandidates and assigns the final
// decision classification:
//
//   BET             — clear actionable edge, low/acceptable risk
//   LEAN            — meaningful edge, moderate risk, consider
//   MONITOR         — borderline or high risk; worth watching
//   BEST_PRICE_ONLY — best accessible number exists, but insufficient
//                     signal quality to call it a bet
//   PASS            — not qualified, missing enrichment, or
//                     risk + edge combination is unactionable
//
// IMPORTANT: This file is additive only.
//   - It does NOT re-score, re-rank, or re-calibrate anything.
//   - It does NOT modify existing pipeline output or saves.
//   - It never mutates input objects (spreads into new copies).
//   - All upstream fields (score, winProbability, adjustedEdge,
//     riskGrade, riskFlags) are treated as READ-ONLY.
//
// ============================================================
// THRESHOLD CONFIGURATION
// ============================================================
//
// All thresholds operate on adjustedEdge (Phase 5 risk-discounted
// edge), NOT the raw impliedEdge from Phase 4.
//
//   EDGE_BET_MIN         = 0.07  (7%)   adjustedEdge floor for BET
//   EDGE_LEAN_MIN        = 0.05  (5%)   adjustedEdge floor for LEAN
//   EDGE_MONITOR_MIN     = 0.03  (3%)   adjustedEdge floor for MONITOR
//   EDGE_PASS_HIGH_RISK  = 0.05  (5%)   HIGH-risk PASS cutoff
//   EDGE_BEST_PRICE_MAX  = 0.05  (5%)   BEST_PRICE_ONLY upper bound
//
// Priority order (first match wins):
//   1. PASS        — missing data or failed qualification
//   2. BEST_PRICE  — price-only + positive but fragile edge (0–5%)
//   3. PASS        — HIGH risk + adjustedEdge < 5%
//   4. BET         — LOW risk + adjustedEdge >= 7%
//   5. LEAN        — LOW/MODERATE risk + adjustedEdge >= 5%
//   6. MONITOR     — adjustedEdge >= 3%
//   7. PASS        — anything below 3% adjusted edge (default)
//
// Why BEST_PRICE_ONLY before the risk-based PASS?
//   A price-only candidate with 4% adjusted edge is not worthless.
//   It tells us "FanDuel has the best number available" — useful for
//   book-selection purposes even without a betting recommendation.
//   Putting it in PASS would discard actionable shopping information.
//
// Grade mapping:
//   BET              → A+ (adjEdge >= 10%) or A
//   LEAN             → B+ (adjEdge >= 7%)  or B
//   BEST_PRICE_ONLY  → C+
//   MONITOR          → C
//   PASS             → D
//
// ============================================================

import { DecisionCandidate } from './decisionTypes';

// ============================================================
// Types
// ============================================================

export type FinalLabel = 'BET' | 'LEAN' | 'MONITOR' | 'PASS' | 'BEST_PRICE_ONLY';

// ============================================================
// Configurable thresholds
// ============================================================

/** Minimum adjustedEdge to earn BET label (requires LOW risk). */
const EDGE_BET_MIN = 0.07;

/** Minimum adjustedEdge to earn LEAN label (LOW or MODERATE risk). */
const EDGE_LEAN_MIN = 0.05;

/** Minimum adjustedEdge to earn MONITOR label. */
const EDGE_MONITOR_MIN = 0.03;

/**
 * HIGH-risk candidates with adjustedEdge below this threshold are
 * classified PASS (not even worth monitoring).
 */
const EDGE_PASS_HIGH_RISK = 0.05;

/**
 * BEST_PRICE_ONLY upper bound for adjustedEdge.
 * A price-only candidate must have adjustedEdge in (0, this) to earn
 * the BEST_PRICE_ONLY label.  At or above this threshold the candidate
 * has enough edge to reach MONITOR regardless of signal type.
 */
const EDGE_BEST_PRICE_MAX = 0.05;

// ============================================================
// Internal classification logic
// ============================================================

interface Classification {
  label:   FinalLabel;
  reasons: string[];
}

function pct(edge: number): string {
  return `${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(1)}%`;
}

function classify(c: DecisionCandidate): Classification {
  const adjEdge   = c.adjustedEdge ?? 0;
  const riskGrade = c.riskGrade ?? 'HIGH';
  const isPriceOnly = c.riskFlags?.includes('price_only_signal') ?? false;
  const hasStale    = c.riskFlags?.includes('stale_line_risk') ?? false;

  // ----------------------------------------------------------
  // Priority 1: PASS — missing data or failed qualification
  // ----------------------------------------------------------
  if (!c.qualificationPassed) {
    return {
      label:   'PASS',
      reasons: [
        'failed qualification',
        ...(c.rejectionReasons.slice(0, 2)),
      ],
    };
  }
  if (c.adjustedWinProbability === undefined) {
    return {
      label:   'PASS',
      reasons: ['probability enrichment not available'],
    };
  }

  // ----------------------------------------------------------
  // Priority 2: BEST_PRICE_ONLY
  // Price-only signal + positive but fragile adjusted edge.
  // The candidate has the best accessible number but no
  // independent confirmation beyond market structure.
  // ----------------------------------------------------------
  if (
    isPriceOnly &&
    (c.impliedEdge ?? 0) > 0 &&
    adjEdge > 0 &&
    adjEdge < EDGE_BEST_PRICE_MAX
  ) {
    const reasons: string[] = [
      `best accessible number (${c.bestBook}), no form or intel signal`,
      `adjusted edge: ${pct(adjEdge)} — fragile, price structure only`,
    ];
    if (hasStale) reasons.push('stale line detected — edge may close before placement');
    return { label: 'BEST_PRICE_ONLY', reasons };
  }

  // ----------------------------------------------------------
  // Priority 3: PASS — HIGH risk + insufficient adjusted edge
  // Not even worth monitoring: too risky and not enough edge
  // to overcome it.
  // ----------------------------------------------------------
  if (riskGrade === 'HIGH' && adjEdge < EDGE_PASS_HIGH_RISK) {
    const reasons: string[] = [
      `high risk + adjusted edge ${pct(adjEdge)} below ${pct(EDGE_PASS_HIGH_RISK)} threshold`,
    ];
    if (isPriceOnly) reasons.push('price-only signal: no independent confirmation');
    return { label: 'PASS', reasons };
  }

  // ----------------------------------------------------------
  // Priority 4: BET — low risk, real signal diversity, clear edge
  // ----------------------------------------------------------
  if (riskGrade === 'LOW' && adjEdge >= EDGE_BET_MIN) {
    const reasons: string[] = [
      `signal diversity present, risk LOW, adjusted edge ${pct(adjEdge)}`,
    ];
    if ((c.riskFlags?.length ?? 0) === 0) {
      reasons.push('no risk flags present');
    } else {
      reasons.push(`active flags: ${c.riskFlags?.join(', ') ?? 'none'}`);
    }
    return { label: 'BET', reasons };
  }

  // ----------------------------------------------------------
  // Priority 5: LEAN — moderate or low risk with meaningful edge
  // ----------------------------------------------------------
  if ((riskGrade === 'LOW' || riskGrade === 'MODERATE') && adjEdge >= EDGE_LEAN_MIN) {
    const reasons: string[] = [
      `adjusted edge ${pct(adjEdge)}, risk ${riskGrade}`,
    ];
    if (riskGrade === 'MODERATE') {
      reasons.push('moderate risk: acceptable, monitor for line movement');
    }
    if (c.riskFlags && c.riskFlags.length > 0) {
      reasons.push(`flags: ${c.riskFlags.join(', ')}`);
    }
    return { label: 'LEAN', reasons };
  }

  // ----------------------------------------------------------
  // Priority 6: MONITOR — borderline edge, high risk but not hopeless
  // ----------------------------------------------------------
  if (adjEdge >= EDGE_MONITOR_MIN) {
    const reasons: string[] = [
      `adjusted edge ${pct(adjEdge)} — borderline, worth watching`,
    ];
    if (riskGrade === 'HIGH') {
      reasons.push('high risk: wait for stronger signals or better price');
    }
    if (isPriceOnly) {
      reasons.push('price-only signal: monitor for book convergence');
    }
    return { label: 'MONITOR', reasons };
  }

  // ----------------------------------------------------------
  // Priority 7: PASS — default (adjusted edge too low)
  // ----------------------------------------------------------
  return {
    label:   'PASS',
    reasons: [`adjusted edge ${pct(adjEdge)} below ${pct(EDGE_MONITOR_MIN)} monitoring floor`],
  };
}

function toGrade(label: FinalLabel, adjustedEdge: number): string {
  switch (label) {
    case 'BET':             return adjustedEdge >= 0.10 ? 'A+' : 'A';
    case 'LEAN':            return adjustedEdge >= 0.07 ? 'B+' : 'B';
    case 'BEST_PRICE_ONLY': return 'C+';
    case 'MONITOR':         return 'C';
    case 'PASS':            return 'D';
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Assigns a finalDecisionLabel, finalGrade, and labelReasons to
 * each candidate.
 *
 * Returns a new array of cloned objects — inputs are never mutated.
 * No candidates are removed; callers receive the full set with labels.
 */
export function labelCandidates(
  candidates: DecisionCandidate[]
): DecisionCandidate[] {
  return candidates.map(c => {
    const { label, reasons } = classify(c);

    // Append a note when the sport intelligence layer flagged LOW quality.
    // This is contextual only — no threshold is changed here.
    const allReasons = [...reasons];
    if (
      c.betTypeQualityTier === 'LOW' &&
      (c.intelligenceFlags ?? []).length > 0 &&
      allReasons.length < 3
    ) {
      allReasons.push(`low quality bet type: ${(c.intelligenceFlags ?? []).join(', ')}`);
    }

    return {
      ...c,
      finalDecisionLabel: label,
      finalGrade:         toGrade(label, c.adjustedEdge ?? 0),
      labelReasons:       allReasons,
    };
  });
}

// ============================================================
// Debug summary — console output only, no side effects
// ============================================================

/**
 * Prints a one-line label distribution summary plus the top 3
 * non-PASS candidates sorted by adjustedEdge descending.
 *
 * Example output:
 *   [LABEL]   BET: 0 | LEAN: 0 | MONITOR: 1 | BEST_PRICE_ONLY: 7 | PASS: 0
 *   --- Top labeled candidates ---
 *     [MONITOR/C]          Jaylen Brown Points Under | adjEdge: +7.0% | risk: HIGH
 *        → adjusted edge +7.0% — borderline, worth watching
 *        → high risk: wait for stronger signals or better price
 *     [BEST_PRICE_ONLY/C+] Tyrese Maxey Points Over  | adjEdge: +4.6% | risk: HIGH
 *        → best accessible number (FanDuel), no form or intel signal
 *        → adjusted edge: +4.6% — fragile, price structure only
 */
export function printLabelSummary(candidates: DecisionCandidate[]): void {
  const labeled = candidates.filter(c => c.finalDecisionLabel !== undefined);
  if (labeled.length === 0) return;

  // Count by label
  const counts: Record<FinalLabel, number> = {
    BET: 0, LEAN: 0, MONITOR: 0, BEST_PRICE_ONLY: 0, PASS: 0,
  };
  for (const c of labeled) {
    counts[c.finalDecisionLabel!]++;
  }

  console.log(
    `  [LABEL]   BET: ${counts.BET} | LEAN: ${counts.LEAN} | ` +
    `MONITOR: ${counts.MONITOR} | BEST_PRICE_ONLY: ${counts.BEST_PRICE_ONLY} | ` +
    `PASS: ${counts.PASS}`
  );

  // Top 3 non-PASS candidates by adjustedEdge
  const examples = [...labeled]
    .filter(c => c.finalDecisionLabel !== 'PASS')
    .sort((a, b) => (b.adjustedEdge ?? 0) - (a.adjustedEdge ?? 0))
    .slice(0, 3);

  if (examples.length === 0) return;

  console.log('  --- Top labeled candidates ---');
  for (const c of examples) {
    const label      = c.finalDecisionLabel ?? 'PASS';
    const grade      = c.finalGrade ?? 'D';
    const tag        = `[${label}/${grade}]`;
    const name       = c.playerName
      ? `${c.playerName} ${c.market ?? ''} ${c.side}`.trim()
      : `${c.matchup} ${c.side}`;
    const adjEdgeStr = c.adjustedEdge !== undefined
      ? `${c.adjustedEdge >= 0 ? '+' : ''}${(c.adjustedEdge * 100).toFixed(1)}%`
      : 'n/a';

    console.log(
      `    ${tag.padEnd(22)} ${name.substring(0, 38).padEnd(38)} | ` +
      `adjEdge: ${adjEdgeStr} | risk: ${c.riskGrade ?? '?'}`
    );
    for (const reason of (c.labelReasons ?? []).slice(0, 2)) {
      console.log(`       → ${reason}`);
    }
  }
}
