// ============================================================
// src/services/slateSelector.ts
// Phase 7 — Slate Selector / Best Bet of the Slate.
//
// Consumes already-labeled DecisionCandidates (output of the
// full qualify → probability → risk → label chain) and:
//   1. Ranks all candidates by label priority then composite score.
//   2. Applies a one-pass diversity swap to avoid top-heavy
//      stacking from the same game (top 3 slots only).
//   3. Identifies the single Best Bet of the Slate when a
//      qualifying candidate exists.
//
// IMPORTANT: This file is additive only.
//   - It does NOT re-score, re-rank, or modify any prior stage.
//   - All upstream fields are treated as READ-ONLY.
//   - Input objects are never mutated; results are new copies with
//     slateRank, isBestBet, and selectionReasons added.
//   - No candidate is removed; every candidate receives a slateRank.
//
// ============================================================
// RANKING LOGIC
// ============================================================
//
// Primary sort: label priority (first match wins):
//   BET (4) > LEAN (3) > MONITOR (2) > BEST_PRICE_ONLY (1) > PASS (0)
//
// Within a label tier, composite score:
//   compositeScore = adjustedEdge
//     + riskBonus   (LOW=+0.020, MODERATE=+0.010, HIGH=0)
//     + signalBonus (+0.010 if NOT price_only_signal)
//
// These bonuses are intentionally small — adjustedEdge remains
// the dominant ranking factor.  They only resolve genuine ties.
//
// ============================================================
// BEST BET RULES (all must hold)
// ============================================================
//
//   1. finalDecisionLabel is BET or LEAN
//   2. qualificationPassed = true
//   3. adjustedEdge > 0 (positive edge after risk discount)
//   4. riskGrade is LOW or MODERATE (not HIGH)
//
//   Preference (not hard requirement):
//     Prefer NOT price_only_signal.  If every eligible BET/LEAN
//     candidate is price-only, the best such candidate is used as
//     a fallback with a note in selectionReasons.
//
//   If no candidate meets rules 1–4: bestBet is undefined.
//
// ============================================================
// CORRELATION / DIVERSITY
// ============================================================
//
//   After initial ranking, slots 0–2 (top 3) are inspected.
//   If two adjacent top-ranked candidates share the same matchup
//   AND a replacement candidate exists that:
//     – comes from a different matchup
//     – has the same or higher label tier
//     – has a compositeScore ≥ 80% of the displaced candidate's
//   then the lower-ranked duplicate is swapped with the best
//   such replacement.
//
//   This is a single-pass swap — it does not recurse or fully
//   re-optimise the slate.
//
// ============================================================

import { DecisionCandidate } from './decisionTypes';

// ============================================================
// BET volume cap constants
// ============================================================

/**
 * Maximum BET-labeled candidates in a single slate before the
 * weakest ones are capped down to LEAN via forcedTierCap.
 */
const BET_LEAN_CAP    = 3;

/**
 * Maximum BET-labeled candidates before further excess is capped
 * to MONITOR.  Positions BET_LEAN_CAP+1 through BET_MONITOR_CAP
 * receive 'LEAN'; positions above BET_MONITOR_CAP receive 'MONITOR'.
 */
const BET_MONITOR_CAP = 5;

// ============================================================
// Types
// ============================================================

export interface SlateResult {
  /** All input candidates in slate order, annotated with new fields. */
  ranked:   DecisionCandidate[];
  /** The single Best Bet of the Slate, or undefined when none qualifies. */
  bestBet?: DecisionCandidate;
  /**
   * Human-readable explanation when no best bet is selected.
   * Undefined when a best bet was found.
   */
  noBestBetReason?: string;
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Returns the effective label for ranking and selection, accounting
 * for forcedTierCap.  finalDecisionLabel is never mutated; this helper
 * is the single place that resolves the override.
 *
 * forcedTierCap only downgrades BET candidates, so:
 *   BET + forcedTierCap='LEAN'    → LEAN
 *   BET + forcedTierCap='MONITOR' → MONITOR
 *   LEAN + forcedTierCap='MONITOR' → MONITOR  (if ever applied)
 *   anything else                 → finalDecisionLabel unchanged
 */
function effectiveLabel(c: DecisionCandidate): DecisionCandidate['finalDecisionLabel'] {
  if (c.forcedTierCap === 'MONITOR') return 'MONITOR';
  if (c.forcedTierCap === 'LEAN' && c.finalDecisionLabel === 'BET') return 'LEAN';
  return c.finalDecisionLabel;
}

/** Maps a label to a numeric priority (higher = better). */
function labelPriority(label: DecisionCandidate['finalDecisionLabel']): number {
  switch (label) {
    case 'BET':             return 4;
    case 'LEAN':            return 3;
    case 'MONITOR':         return 2;
    case 'BEST_PRICE_ONLY': return 1;
    case 'PASS':            return 0;
    default:                return 0;
  }
}

// ============================================================
// BET volume cap
// ============================================================

/**
 * Enforces maximum BET counts on the slate by setting forcedTierCap
 * on the weakest-edge excess candidates.
 *
 * Sort order for "weakest": ascending adjustedEdge (lowest edge capped first).
 * Positions 4–5 among BETs → forcedTierCap = 'LEAN'
 * Positions 6+  among BETs → forcedTierCap = 'MONITOR'
 *
 * finalDecisionLabel is never changed.  Only forcedTierCap is set.
 * Returns a new array; inputs are not mutated.
 */
function applyBetCap(candidates: DecisionCandidate[]): DecisionCandidate[] {
  // Collect indices of BET-labeled candidates
  const betIdxs: number[] = candidates
    .map((c, i) => c.finalDecisionLabel === 'BET' ? i : -1)
    .filter(i => i >= 0);

  if (betIdxs.length <= BET_LEAN_CAP) return candidates;  // within cap — no changes

  // Sort by adjustedEdge ASCENDING — weakest BETs are capped first
  betIdxs.sort(
    (a, b) => (candidates[a].adjustedEdge ?? 0) - (candidates[b].adjustedEdge ?? 0)
  );
  // After sort: betIdxs[0] = weakest edge, betIdxs[last] = strongest edge
  // We want to KEEP the strongest (last BET_LEAN_CAP), cap the rest.
  // Re-sort DESCENDING so rank 0 = strongest (protected)
  betIdxs.sort(
    (a, b) => (candidates[b].adjustedEdge ?? 0) - (candidates[a].adjustedEdge ?? 0)
  );

  const result: DecisionCandidate[] = candidates.map(c => ({ ...c }));

  for (let rank = 0; rank < betIdxs.length; rank++) {
    const idx = betIdxs[rank];
    if (rank >= BET_MONITOR_CAP) {
      result[idx] = { ...result[idx], forcedTierCap: 'MONITOR' as const };
    } else if (rank >= BET_LEAN_CAP) {
      result[idx] = { ...result[idx], forcedTierCap: 'LEAN' as const };
    }
    // rank 0 .. BET_LEAN_CAP-1: top 3 BETs — untouched
  }

  return result;
}

/** Small bonus for lower risk — only resolves ties with adjustedEdge. */
function riskBonus(grade: DecisionCandidate['riskGrade']): number {
  if (grade === 'LOW')      return 0.020;
  if (grade === 'MODERATE') return 0.010;
  return 0;
}

/**
 * Returns true when the candidate has at least one non-market-structure
 * signal, as indicated by the absence of the 'price_only_signal' risk flag.
 * This reuses the risk engine's already-computed judgment rather than
 * re-examining the raw signals array.
 */
function hasDiverseSignals(c: DecisionCandidate): boolean {
  // If price_only_signal flag is present → no diversity
  // If riskFlags is missing entirely → treat conservatively as no diversity
  if (!c.riskFlags) return false;
  return !c.riskFlags.includes('price_only_signal');
}

/**
 * Composite score for within-tier ranking.
 * adjustedEdge is the dominant factor; riskBonus and signalBonus
 * are small nudges that only affect genuine ties.
 */
function compositeScore(c: DecisionCandidate): number {
  const edge   = c.adjustedEdge ?? 0;
  const risk   = riskBonus(c.riskGrade);
  const signal = hasDiverseSignals(c) ? 0.010 : 0;
  return edge + risk + signal;
}

/**
 * Sorts candidates by effective label priority (desc) then composite score (desc).
 * Uses effectiveLabel() so that forcedTierCap-capped BETs rank as LEAN/MONITOR.
 * Returns a new array — input is not mutated.
 */
function rankCandidates(candidates: DecisionCandidate[]): DecisionCandidate[] {
  return [...candidates].sort((a, b) => {
    const labelDiff =
      labelPriority(effectiveLabel(b)) - labelPriority(effectiveLabel(a));
    if (labelDiff !== 0) return labelDiff;
    return compositeScore(b) - compositeScore(a);
  });
}

/**
 * One-pass diversity swap for slots 0–2 of the ranked array.
 *
 * Inspects consecutive pairs (0,1) and (1,2).  When two candidates
 * in a pair share a matchup, the lower-ranked one (slot j) is replaced
 * by the best candidate from the remainder of the array that:
 *   – comes from a different matchup than slot i
 *   – has the same or higher label priority
 *   – has compositeScore ≥ 80% of the displaced candidate's score
 *
 * Only the first valid swap per pair is applied.  The function does
 * not recurse or re-sort after swapping.
 */
function applyDiversitySwap(ranked: DecisionCandidate[]): DecisionCandidate[] {
  if (ranked.length <= 2) return ranked;

  const result = [...ranked];

  for (const [i, j] of [[0, 1], [1, 2]] as [number, number][]) {
    if (result[i]?.matchup !== result[j]?.matchup) continue;

    const displaced         = result[j];
    const displacedScore    = compositeScore(displaced);
    const displacedPriority = labelPriority(displaced.finalDecisionLabel);

    let swapIdx       = -1;
    let swapBestScore = -Infinity;

    for (let k = j + 1; k < result.length; k++) {
      const alt = result[k];
      if (alt.matchup === result[i].matchup) continue; // still same game

      const altScore    = compositeScore(alt);
      const altPriority = labelPriority(alt.finalDecisionLabel);

      if (
        altPriority >= displacedPriority &&
        altScore    >= displacedScore * 0.80 &&
        altScore    >  swapBestScore
      ) {
        swapBestScore = altScore;
        swapIdx       = k;
      }
    }

    if (swapIdx !== -1) {
      [result[j], result[swapIdx]] = [result[swapIdx], result[j]];
    }
  }

  return result;
}

/**
 * Selects the Best Bet from the ranked list.
 *
 * Eligibility (all required):
 *   1. finalDecisionLabel BET or LEAN
 *   2. qualificationPassed = true
 *   3. adjustedEdge > 0
 *   4. riskGrade LOW or MODERATE
 *
 * Within eligible candidates, non-price-only candidates are preferred.
 * If every eligible candidate is price-only, the best of them is used
 * as a fallback with a note.
 *
 * Returns the selected candidate (if any) and a plain-text reason.
 */
function pickBestBet(ranked: DecisionCandidate[]): {
  bestBet?: DecisionCandidate;
  reason:   string;
} {
  const eligible = ranked.filter(c =>
    // Use effectiveLabel — a BET capped to LEAN is still eligible as LEAN
    (effectiveLabel(c) === 'BET' || effectiveLabel(c) === 'LEAN') &&
    c.qualificationPassed === true &&
    (c.adjustedEdge ?? 0) > 0 &&
    (c.riskGrade === 'LOW' || c.riskGrade === 'MODERATE')
  );

  if (eligible.length === 0) {
    const anyBetLean = ranked.some(
      c => effectiveLabel(c) === 'BET' || effectiveLabel(c) === 'LEAN'
    );
    return {
      reason: anyBetLean
        ? 'all BET/LEAN candidates carry HIGH risk — wait for stronger signal diversity'
        : 'no BET or LEAN candidates on this slate',
    };
  }

  // Prefer non-price-only; fall back to price-only if nothing else qualifies.
  const nonPriceOnly = eligible.filter(c => hasDiverseSignals(c));
  const pool         = nonPriceOnly.length > 0 ? nonPriceOnly : eligible;

  // Best in pool = first occurrence in the already-ranked array.
  const best = ranked.find(c => pool.some(p => p.id === c.id))!;

  const priceOnlyFallback =
    nonPriceOnly.length === 0 &&
    !hasDiverseSignals(best);

  const edgeStr = `${((best.adjustedEdge ?? 0) * 100).toFixed(1)}%`;
  const reason  = priceOnlyFallback
    ? `best available (price-only signal — no intelligence-backed BET/LEAN found)`
    : `${best.finalDecisionLabel} candidate — ${best.riskGrade} risk, adjusted edge +${edgeStr}`;

  return { bestBet: best, reason };
}

// ============================================================
// Reason builder
// ============================================================

function buildSelectionReasons(
  c:            DecisionCandidate,
  rank:         number,
  isBestBet:    boolean,
  corrMatchups: Set<string>
): string[] {
  const reasons: string[] = [];

  if (isBestBet) {
    reasons.push(`Best Bet of the Slate — rank #${rank}`);
  }

  // Show cap override when present
  if (c.forcedTierCap) {
    reasons.push(
      `BET volume cap: ${c.finalDecisionLabel} → ${c.forcedTierCap} ` +
      `(slate limit of ${c.forcedTierCap === 'LEAN' ? BET_LEAN_CAP : BET_MONITOR_CAP} BETs reached)`
    );
  }

  reasons.push(
    `label: ${effectiveLabel(c) ?? 'unlabeled'}, grade: ${c.finalGrade ?? '?'}` +
    (c.forcedTierCap ? ` [originally ${c.finalDecisionLabel}]` : '')
  );

  if (c.adjustedEdge !== undefined) {
    const sign = c.adjustedEdge >= 0 ? '+' : '';
    reasons.push(`adjusted edge: ${sign}${(c.adjustedEdge * 100).toFixed(1)}%`);
  }

  reasons.push(`risk: ${c.riskGrade ?? 'unknown'}`);

  if (hasDiverseSignals(c)) {
    reasons.push('signal diversity present (non-price-only)');
  } else {
    reasons.push('price-only signal — market structure comparison only');
  }

  if (corrMatchups.has(c.matchup)) {
    reasons.push('correlated game — multiple candidates from same matchup');
  }

  return reasons;
}

// ============================================================
// Public API
// ============================================================

/**
 * Selects and ranks the slate from a set of labeled DecisionCandidates.
 *
 * Input: candidates that have been through the full
 *   qualify → probability → risk → label pipeline.
 *
 * Output:
 *   ranked   — all candidates in slate order, annotated with
 *              slateRank, isBestBet, and selectionReasons.
 *   bestBet  — the single Best Bet candidate (or undefined).
 *   noBestBetReason — plain-text explanation when no best bet
 *              is selected (undefined when a best bet exists).
 *
 * Input objects are never mutated.
 */
export function selectSlate(candidates: DecisionCandidate[]): SlateResult {
  if (candidates.length === 0) {
    return { ranked: [], noBestBetReason: 'no candidates on this slate' };
  }

  // 1. BET volume cap — set forcedTierCap on excess BETs (by adjustedEdge).
  //    Runs before ranking so that capped candidates sort as LEAN/MONITOR.
  const capped = applyBetCap(candidates);

  // 2. Initial ranking by effective label priority then composite score.
  const initialRanked = rankCandidates(capped);

  // 3. One-pass diversity swap on the top 3 slots.
  const diverseRanked = applyDiversitySwap(initialRanked);

  // 4. Identify matchups that appear more than once (for annotation).
  const corrMatchups = new Set<string>();
  const matchupCounts = new Map<string, number>();
  for (const c of capped) {
    matchupCounts.set(c.matchup, (matchupCounts.get(c.matchup) ?? 0) + 1);
  }
  for (const [m, n] of matchupCounts) {
    if (n > 1) corrMatchups.add(m);
  }

  // 5. Best Bet selection (operates on the diversity-adjusted order).
  const { bestBet: bestBetCandidate, reason: bestBetReason } =
    pickBestBet(diverseRanked);

  // 6. Annotate every candidate with slateRank, isBestBet, selectionReasons.
  const ranked = diverseRanked.map((c, idx) => {
    const rank     = idx + 1;
    const isBest   = bestBetCandidate !== undefined && c.id === bestBetCandidate.id;
    const reasons  = buildSelectionReasons(c, rank, isBest, corrMatchups);

    return {
      ...c,
      slateRank:        rank,
      isBestBet:        isBest,
      selectionReasons: reasons,
    };
  });

  const bestBet = ranked.find(c => c.isBestBet);

  return {
    ranked,
    bestBet,
    noBestBetReason: bestBet ? undefined : bestBetReason,
  };
}

// ============================================================
// Debug output — console only, no side effects
// ============================================================

/**
 * Prints the slate selection summary.
 *
 * Example (with best bet):
 *   [SLATE]  ranked: 8 | best bet: Tyrese Maxey Points Over
 *   --- Top 3 slate candidates ---
 *     #1 [MONITOR/C]          Tyrese Maxey Points Over       | adjEdge: +5.2% | risk: HIGH
 *        → label: MONITOR, grade: C
 *        → adjusted edge: +5.2%
 *
 * Example (no best bet):
 *   [SLATE]  ranked: 8 | best bet: none
 *   --- Top 3 slate candidates ---
 *     ...
 *   No best bet selected on this slate: all BET/LEAN candidates carry HIGH risk
 */
export function printSlateSummary(result: SlateResult): void {
  const { ranked, bestBet, noBestBetReason } = result;
  if (ranked.length === 0) return;

  // ---- Single-line header ----
  const bestBetLabel = bestBet
    ? (bestBet.playerName
        ? `${bestBet.playerName} ${bestBet.market ?? ''} ${bestBet.side}`.trim()
        : `${bestBet.matchup} ${bestBet.side}`)
    : 'none';

  const cappedCount = ranked.filter(c => c.forcedTierCap !== undefined).length;
  const capSuffix   = cappedCount > 0 ? ` | BET cap: ${cappedCount} downgraded` : '';
  console.log(`  [SLATE]  ranked: ${ranked.length} | best bet: ${bestBetLabel}${capSuffix}`);

  // ---- Top 3 detail block ----
  const topN = ranked.slice(0, 3);
  if (topN.length > 0) {
    const plural = topN.length === 1 ? '' : 's';
    console.log(`  --- Top ${topN.length} slate candidate${plural} ---`);

    for (const c of topN) {
      // When a BET cap is active, show original → capped label so the
      // output is self-explanatory (e.g. [BET→LEAN/A cap]).
      const effLabel = effectiveLabel(c) ?? 'UNLABELED';
      const grade    = c.finalGrade     ?? '?';
      const tag      = c.forcedTierCap
        ? `[${c.finalDecisionLabel}→${c.forcedTierCap}/${grade} cap]`
        : `[${effLabel}/${grade}]`;
      const name     = c.playerName
        ? `${c.playerName} ${c.market ?? ''} ${c.side}`.trim()
        : `${c.matchup} ${c.side}`;
      const adjStr   = c.adjustedEdge !== undefined
        ? `${c.adjustedEdge >= 0 ? '+' : ''}${(c.adjustedEdge * 100).toFixed(1)}%`
        : 'n/a';
      const bestFlag = c.isBestBet ? ' ★ BEST BET' : '';

      console.log(
        `    #${c.slateRank} ${tag.padEnd(24)} ${name.substring(0, 38).padEnd(38)} | ` +
        `adjEdge: ${adjStr} | risk: ${c.riskGrade ?? '?'}${bestFlag}`
      );
      for (const r of (c.selectionReasons ?? []).slice(0, 2)) {
        console.log(`       → ${r}`);
      }
    }
  }

  // ---- No best bet message ----
  if (!bestBet) {
    console.log(
      `  No best bet selected on this slate: ${noBestBetReason ?? 'unknown reason'}`
    );
  }
}

// ============================================================
// Final Card — authoritative post-pipeline output
// ============================================================

/**
 * Prints the final recommended card from a completed SlateResult.
 *
 * Only shows candidates with actionable labels (BET / LEAN / MONITOR /
 * BEST_PRICE_ONLY). PASS candidates are excluded — they are not
 * presented as plays to the user.
 *
 * This is the authoritative "recommended plays" surface.  The raw
 * scanner output (printTopTen) is a signal-analysis input; this
 * function is the decision-engine output that should be acted on.
 *
 * Call once at the end of the decision pipeline in scan runners.
 */
export function printFinalCard(result: SlateResult): void {
  const { ranked, bestBet, noBestBetReason } = result;

  // Filter to actionable labels only — never show PASS candidates
  const actionable = ranked.filter(c => {
    const lbl = effectiveLabel(c);
    return lbl === 'BET' || lbl === 'LEAN' || lbl === 'MONITOR' || lbl === 'BEST_PRICE_ONLY';
  });

  const time = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  const betCnt  = actionable.filter(c => effectiveLabel(c) === 'BET').length;
  const leanCnt = actionable.filter(c => effectiveLabel(c) === 'LEAN').length;
  const monCnt  = actionable.filter(c => effectiveLabel(c) === 'MONITOR').length;
  const bpoCnt  = actionable.filter(c => effectiveLabel(c) === 'BEST_PRICE_ONLY').length;

  console.log('\n');
  console.log('+==============================================================+');
  console.log('|         FINAL RECOMMENDED PLAYS — DECISION ENGINE            |');
  console.log(`|  ${time.padEnd(60)}|`);
  console.log(
    `|  BET: ${String(betCnt).padEnd(2)} | LEAN: ${String(leanCnt).padEnd(2)} | ` +
    `MONITOR: ${String(monCnt).padEnd(2)} | BEST_PRICE: ${String(bpoCnt).padEnd(2)} | ` +
    `PASS excluded${' '.repeat(15)}|`
  );
  console.log('+==============================================================+');

  if (actionable.length === 0) {
    console.log('\n  No actionable candidates survived the full decision pipeline.');
    console.log(`  All ${ranked.length} candidate(s) received PASS label.`);
    if (noBestBetReason) console.log(`  Reason: ${noBestBetReason}`);
    console.log('  Review the raw signal scan output for context.\n');
    return;
  }

  // Helper: print one candidate card
  function printCard(c: DecisionCandidate): void {
    const lbl      = effectiveLabel(c) ?? 'UNKNOWN';
    const grade    = c.finalGrade ?? '?';
    const capNote  = c.forcedTierCap ? ` [was ${c.finalDecisionLabel}]` : '';
    const bestFlag = c.isBestBet ? ' ★ BEST BET' : '';
    const name     = c.playerName
      ? `${c.playerName} ${c.market ?? ''} ${c.side}`.trim()
      : `${c.matchup} ${c.side}`;
    const adjStr   = c.adjustedEdge !== undefined
      ? `${c.adjustedEdge >= 0 ? '+' : ''}${(c.adjustedEdge * 100).toFixed(1)}%`
      : 'n/a';
    const priceStr = c.bestPrice !== undefined
      ? `${c.bestPrice > 0 ? '+' : ''}${c.bestPrice}`
      : '';

    console.log(`\n  +---------------------------------------------------------`);
    console.log(`  |  #${String(c.slateRank).padEnd(3)} [${lbl}/${grade}]${capNote}${bestFlag}`);
    console.log(`  |  ${name}`);
    console.log(`  |  adj.edge: ${adjStr}  |  risk: ${c.riskGrade ?? '?'}  |  ${c.sport}`);
    if (c.bestBook || priceStr) {
      console.log(`  |  Book: ${(c.bestBook ?? 'n/a').padEnd(14)}  Price: ${priceStr}`);
    }
    for (const reason of (c.labelReasons ?? []).slice(0, 2)) {
      console.log(`  |  → ${reason}`);
    }
    console.log(`  +---------------------------------------------------------`);
  }

  // ---- BET ----
  const bets = actionable.filter(c => effectiveLabel(c) === 'BET');
  if (bets.length > 0) {
    console.log(`\n  ████  BET  (${bets.length})  — all signals aligned, clear actionable edge`);
    bets.forEach(printCard);
  }

  // ---- LEAN ----
  const leans = actionable.filter(c => effectiveLabel(c) === 'LEAN');
  if (leans.length > 0) {
    console.log(`\n  ───  LEAN  (${leans.length})  — meaningful edge, acceptable risk`);
    leans.forEach(printCard);
  }

  // ---- MONITOR ----
  const monitors = actionable.filter(c => effectiveLabel(c) === 'MONITOR');
  if (monitors.length > 0) {
    console.log(`\n  ───  MONITOR  (${monitors.length})  — worth tracking, confirm closer to game`);
    monitors.forEach(printCard);
  }

  // ---- BEST_PRICE_ONLY ----
  const bestPrices = actionable.filter(c => effectiveLabel(c) === 'BEST_PRICE_ONLY');
  if (bestPrices.length > 0) {
    console.log(`\n  ───  BEST PRICE ONLY  (${bestPrices.length})  — best book available, no conviction signal`);
    bestPrices.forEach(printCard);
  }

  // ---- No best bet note ----
  if (!bestBet) {
    console.log(`\n  Note: ${noBestBetReason ?? 'No best bet identified on this slate.'}`);
  }

  console.log('\n  Key: BET=edge+signal+low-risk | LEAN=good spot | MONITOR=watch later');
  console.log('  BEST_PRICE_ONLY=book gap exists, no signal confirmation | PASS=excluded');
  console.log('  Raw signal scan above is analysis input — this card is the recommendation\n');
}
