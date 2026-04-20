// ============================================================
// src/services/sportIntelligenceEngine.ts
// Phase 4.5 — Sport + Market Intelligence Layer
//
// Evaluates bet type quality, market reliability, and role
// stability for each DecisionCandidate.
//
// Pipeline position: after probability enrichment, before risk.
//   qualify → probability → sport intelligence → risk → label → slate
//
// IMPORTANT: This file is additive only.
//   - Does NOT re-score, re-rank, or re-calibrate anything.
//   - Does NOT modify existing engine logic or thresholds.
//   - Never mutates input objects (spreads into new copies).
//   - All existing fields are READ-ONLY.
//
// ============================================================
// QUALITY TIERS
// ============================================================
//
// LOW (score <= 0.15)
//   MLB batter total_bases UNDER 0.5 — a single hit kills the bet
//   MLB batter hits UNDER 0.5        — same extreme binary structure
//   Flags: binary_hitter_under, one_event_kills_bet, fragile_prop_type
//
// MEDIUM (score ~0.45–0.60)
//   Standard NBA points/rebounds/assists (non-starter lines)
//   MLB hitter props (non-binary)
//   Normal game totals
//
// HIGH (score >= 0.75)
//   MLB pitcher props (strikeouts, outs recorded)
//   NBA starter props (line suggests starter-level usage)
//   Game lines (always HIGH — multi-book, liquid, well-priced)
//
// ============================================================

import { DecisionCandidate } from './decisionTypes';

// ============================================================
// Internal helpers — detection
// ============================================================

function mkt(c: DecisionCandidate): string {
  return (c.market ?? '').toLowerCase();
}

function sideStr(c: DecisionCandidate): string {
  return (c.side ?? '').toLowerCase();
}

/** True for MLB batter props (hits, total bases, RBI, etc.) — excludes pitcher. */
function isMLBBatterProp(c: DecisionCandidate): boolean {
  if (c.sport !== 'MLB') return false;
  const m = mkt(c);
  return (
    m.includes('batter') ||
    m.includes('total_bases') ||
    m.includes('hits') ||
    m.includes('runs_scored') ||
    m.includes('rbi') ||
    m.includes('home_run') ||
    m.includes('stolen_base')
  ) && !m.includes('pitcher');
}

/** True for MLB pitcher props (strikeouts, outs recorded, earned runs). */
function isMLBPitcherProp(c: DecisionCandidate): boolean {
  if (c.sport !== 'MLB') return false;
  const m = mkt(c);
  return m.includes('pitcher') || m.includes('strikeout') || m.includes('outs_recorded');
}

/**
 * True when line is exactly 0.5 and side is Under.
 * These are binary — one positive outcome from the opposing player negates the bet.
 * e.g. "Matt Olson batter total bases UNDER 0.5" = he must get 0 total bases.
 */
function isBinaryUnder05(c: DecisionCandidate): boolean {
  return c.line === 0.5 && sideStr(c) === 'under';
}

/** True for NBA player props only (not game lines). */
function isNBAProp(c: DecisionCandidate): boolean {
  return c.sport === 'NBA' && c.marketType === 'player_prop';
}

// ============================================================
// Internal evaluation
// ============================================================

interface IntelResult {
  betTypeQualityScore:    number;
  betTypeQualityTier:     'HIGH' | 'MEDIUM' | 'LOW';
  marketReliabilityScore: number;
  roleStabilityScore:     number;
  intelligenceFlags:      string[];
}

function evaluate(c: DecisionCandidate): IntelResult {
  // ── Game lines — HIGH quality by default ─────────────────
  // Multi-book, liquid markets with stable consensus.
  if (c.marketType === 'game_line') {
    return {
      betTypeQualityScore:    0.8,
      betTypeQualityTier:     'HIGH',
      marketReliabilityScore: c.bookCount >= 5 ? 0.8 : 0.6,
      roleStabilityScore:     1.0,
      intelligenceFlags:      [],
    };
  }

  // ── LOW: MLB batter UNDER 0.5 (critical) ─────────────────
  // A single hit, total base, etc. negates the wager entirely.
  // This is an extreme binary structure with no margin for variance.
  if (isMLBBatterProp(c) && isBinaryUnder05(c)) {
    return {
      betTypeQualityScore:    0.1,
      betTypeQualityTier:     'LOW',
      marketReliabilityScore: 0.3,
      roleStabilityScore:     0.2,
      intelligenceFlags:      ['binary_hitter_under', 'one_event_kills_bet', 'fragile_prop_type'],
    };
  }

  // ── HIGH: MLB pitcher props ───────────────────────────────
  // Starter role is known and stable; market is well-established.
  if (isMLBPitcherProp(c)) {
    return {
      betTypeQualityScore:    0.85,
      betTypeQualityTier:     'HIGH',
      marketReliabilityScore: 0.75,
      roleStabilityScore:     0.8,
      intelligenceFlags:      [],
    };
  }

  // ── MEDIUM: MLB hitter props (non-binary) ─────────────────
  // Lower reliability than pitcher props; total_bases/hits markets
  // have unusual stat structures compared to standard HR/RBI.
  if (isMLBBatterProp(c)) {
    const m = mkt(c);
    const isUnusualStat = m.includes('total_bases') || m.includes('hits');
    return {
      betTypeQualityScore:    0.45,
      betTypeQualityTier:     'MEDIUM',
      marketReliabilityScore: isUnusualStat ? 0.45 : 0.55,
      roleStabilityScore:     0.5,
      intelligenceFlags:      [],
    };
  }

  // ── NBA player props ──────────────────────────────────────
  if (isNBAProp(c)) {
    const m        = mkt(c);
    const line     = c.line ?? 0;

    const isPoints   = m.includes('point')   && !m.includes('rebound');
    const isRebounds = m.includes('rebound') && !m.includes('point');
    const isAssists  = m.includes('assist')  && !m.includes('point');
    const isStandard = isPoints || isRebounds || isAssists;

    // Starter proxy: line above the typical bench-player floor.
    // No minutes data available — line threshold is the best proxy.
    const likelyStarter =
      (isPoints   && line >= 12) ||
      (isRebounds && line >= 5)  ||
      (isAssists  && line >= 4);

    if (isStandard && likelyStarter) {
      return {
        betTypeQualityScore:    0.75,
        betTypeQualityTier:     'HIGH',
        marketReliabilityScore: 0.7,
        roleStabilityScore:     c.position ? 0.7 : 0.55,
        intelligenceFlags:      [],
      };
    }

    // Standard market but lower line or no position signal → MEDIUM
    return {
      betTypeQualityScore:    0.55,
      betTypeQualityTier:     'MEDIUM',
      marketReliabilityScore: 0.6,
      roleStabilityScore:     c.position ? 0.6 : 0.5,
      intelligenceFlags:      [],
    };
  }

  // ── Default: MEDIUM for all other prop types ──────────────
  return {
    betTypeQualityScore:    0.5,
    betTypeQualityTier:     'MEDIUM',
    marketReliabilityScore: 0.55,
    roleStabilityScore:     0.5,
    intelligenceFlags:      [],
  };
}

// ============================================================
// Public API
// ============================================================

/**
 * Applies sport + market intelligence scoring to each candidate.
 *
 * Adds betTypeQualityScore, betTypeQualityTier, marketReliabilityScore,
 * roleStabilityScore, and intelligenceFlags to each candidate.
 *
 * Returns a new array of cloned objects — inputs are never mutated.
 * No candidates are filtered; all pass through.
 */
export function applySportIntelligence(
  candidates: DecisionCandidate[]
): DecisionCandidate[] {
  return candidates.map(c => {
    const intel = evaluate(c);
    return {
      ...c,
      betTypeQualityScore:    intel.betTypeQualityScore,
      betTypeQualityTier:     intel.betTypeQualityTier,
      marketReliabilityScore: intel.marketReliabilityScore,
      roleStabilityScore:     intel.roleStabilityScore,
      intelligenceFlags:      intel.intelligenceFlags,
    };
  });
}

// ============================================================
// Debug summary — console output only, no side effects
// ============================================================

/**
 * Prints a one-line intel distribution summary plus LOW-quality examples.
 *
 * Example output:
 *   [INTEL]   HIGH: 2 | MEDIUM: 3 | LOW: 2 | binary_hitter_under: 2
 *   --- Low quality bet types ---
 *     [LOW] Matt Olson batter total bases Under | binary_hitter_under, one_event_kills_bet, fragile_prop_type
 */
export function printIntelSummary(candidates: DecisionCandidate[]): void {
  const withIntel = candidates.filter(c => c.betTypeQualityTier !== undefined);
  if (withIntel.length === 0) return;

  const high   = withIntel.filter(c => c.betTypeQualityTier === 'HIGH').length;
  const medium = withIntel.filter(c => c.betTypeQualityTier === 'MEDIUM').length;
  const low    = withIntel.filter(c => c.betTypeQualityTier === 'LOW').length;
  const binary = withIntel.filter(c => c.intelligenceFlags?.includes('binary_hitter_under')).length;

  let line = `  [INTEL]   HIGH: ${high} | MEDIUM: ${medium} | LOW: ${low}`;
  if (binary > 0) line += ` | binary_hitter_under: ${binary}`;
  console.log(line);

  // Show up to 3 LOW-quality examples so the operator can see what's flagged
  const lowExamples = withIntel
    .filter(c => c.betTypeQualityTier === 'LOW')
    .slice(0, 3);

  if (lowExamples.length > 0) {
    console.log('  --- Low quality bet types ---');
    for (const c of lowExamples) {
      const name = c.playerName
        ? `${c.playerName} ${c.market ?? ''} ${c.side}`.trim()
        : `${c.matchup} ${c.side}`;
      const flagStr = (c.intelligenceFlags ?? []).join(', ');
      console.log(`    [LOW] ${name.substring(0, 42)} | ${flagStr}`);
    }
  }
}
