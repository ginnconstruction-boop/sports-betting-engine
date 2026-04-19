// ============================================================
// src/services/decisionTypes.ts
// Shared type bridge for the second-layer decision engine.
//
// DecisionCandidate unifies ScoredBet (game lines) and
// ScoredProp (player props) into a single shape that all
// decision-layer engines (qualification, probability, risk,
// label, slate selector) consume.
//
// IMPORTANT: This file is additive only.
//   - It does NOT modify ScoredBet or ScoredProp.
//   - It does NOT re-score, re-rank, or change existing logic.
//   - The mapper copies fields; it never mutates the source object.
// ============================================================

import { ScoredBet }  from './topTenBets';
import { ScoredProp } from './propScorer';

// ============================================================
// Core unified type
// ============================================================

export interface DecisionCandidate {
  // ----------------------------------------------------------
  // Identity
  // ----------------------------------------------------------

  /**
   * Stable key for this candidate.
   * Game lines:  "<matchup>__<betType>__<side>"   (ScoredBet has no eventId at runtime)
   * Player props: "<eventId>__<market>__<playerName>" (ScoredProp.eventId is optional;
   *               falls back to "<matchup>__<market>__<playerName>")
   */
  id: string;

  /** Display name, e.g. "NBA", "MLB". Sourced from ScoredBet.sport / ScoredProp.sport. */
  sport: string;

  /**
   * API sport key, e.g. "basketball_nba".
   * Present on ScoredProp via the sportKey field (when available).
   * NOT present on ScoredBet at runtime — left undefined for game-line candidates.
   */
  sportKey?: string;

  /** Discriminator set by the mapper — never inferred downstream. */
  marketType: 'game_line' | 'player_prop';

  // ----------------------------------------------------------
  // Prop-only fields (undefined on game-line candidates)
  // ----------------------------------------------------------

  /** Player name. ScoredProp only. */
  playerName?: string;

  /** Player team abbreviation/name. ScoredProp only. */
  team?: string;

  /**
   * Prop market key, e.g. "player_points".
   * Sourced from ScoredProp.market.
   */
  market?: string;

  /**
   * Posted line (e.g. 24.5 points).
   * ScoredProp only.
   */
  line?: number;

  // ----------------------------------------------------------
  // Game / matchup (both types)
  // ----------------------------------------------------------

  /** Full matchup string, e.g. "Boston Celtics vs Miami Heat". */
  matchup: string;

  /**
   * Bet direction.
   * Game lines: team name string from ScoredBet.side.
   * Props: "Over" | "Under" from ScoredProp.side.
   */
  side: string;

  /**
   * Market type label, e.g. "Spread", "Total", "Moneyline".
   * ScoredBet only; undefined on prop candidates.
   */
  betType?: string;

  // ----------------------------------------------------------
  // Pricing (both types)
  // ----------------------------------------------------------

  /** Best accessible book name. Mapped from bestUserBook. */
  bestBook: string;

  /** Best accessible price (american odds). Mapped from bestUserPrice. */
  bestPrice: number;

  /**
   * Consensus market price (american odds).
   * ScoredBet: number (non-nullable in the interface, defaults to 0 when missing).
   * ScoredProp: number | null.
   */
  consensusPrice: number | null;

  /**
   * Difference between bestPrice and consensusPrice (american odds points).
   * Positive = user has access to better price than the market consensus.
   * Used as the primary edge signal.
   */
  priceDiff: number;

  // ----------------------------------------------------------
  // Market quality (both types)
  // ----------------------------------------------------------

  /**
   * Existing 0–100 score produced by the current scoring pipeline.
   * The decision layer treats this as READ-ONLY — it is never modified.
   */
  score: number;

  /**
   * Number of independent signals fired for this candidate.
   * Used by the qualification gate (minimum 2 required).
   */
  signalCount: number;

  /**
   * Number of bookmakers offering this market.
   * Higher = more reliable consensus.
   */
  bookCount: number;

  /** Tier assigned by the existing scoring pipeline. */
  tier: 'BET' | 'LEAN' | 'MONITOR';

  /** Letter grade assigned by the existing scoring pipeline. */
  grade: string;

  /**
   * Quarter-Kelly recommended bet fraction (% of bankroll).
   * Present on ScoredBet. Absent on ScoredProp (props use prediction.kelly).
   */
  kellyPct?: number;

  // ----------------------------------------------------------
  // Timing (both types; undefined if not computable)
  // ----------------------------------------------------------

  /**
   * Hours until game start.  Negative = already in progress.
   * Both ScoredBet and ScoredProp populate this field.
   */
  hoursUntilGame?: number;

  // ----------------------------------------------------------
  // Decision layer output fields
  // Initialized to neutral defaults by the mapper.
  // Populated by the qualification engine (and later stages).
  // ----------------------------------------------------------

  /** True once the candidate clears all qualification gates. */
  qualificationPassed: boolean;

  /**
   * Human-readable reasons for a passing qualification.
   * Example: ["meets minimum market criteria"]
   */
  qualificationReasons: string[];

  /**
   * Human-readable reasons for a failing qualification.
   * Example: ["insufficient signal count", "no price edge"]
   * Empty when qualificationPassed is true.
   */
  rejectionReasons: string[];
}

// ============================================================
// Type guards
// ============================================================

/**
 * Returns true when the input is a ScoredProp.
 * Discriminates by the presence of `playerName`, which is a
 * required field on ScoredProp and absent from ScoredBet.
 */
function isScoredProp(input: ScoredBet | ScoredProp): input is ScoredProp {
  return 'playerName' in input;
}

// ============================================================
// Mapper
// ============================================================

/**
 * Converts a ScoredBet or ScoredProp into a DecisionCandidate.
 *
 * Rules:
 *  - Never mutates the source object (spreads into a new object).
 *  - Never assumes prop-only fields exist on game-line inputs.
 *  - All decision-layer output fields are initialised to neutral
 *    defaults (qualificationPassed = false, empty arrays).
 *  - Downstream engines overwrite these fields on their own copy.
 */
export function mapToDecisionCandidate(
  input: ScoredBet | ScoredProp
): DecisionCandidate {
  // Neutral decision-layer defaults applied to every candidate
  const decisionDefaults = {
    qualificationPassed: false,
    qualificationReasons: [] as string[],
    rejectionReasons:     [] as string[],
  };

  if (isScoredProp(input)) {
    // ---- Player prop ----
    const prop = input;

    // Build a stable id.  eventId is optional on ScoredProp so fall back
    // to matchup when absent rather than using undefined.
    const baseId = prop.eventId ?? prop.matchup;
    const id = `${baseId}__${prop.market}__${prop.playerName}`;

    return {
      ...decisionDefaults,
      id,
      sport:            prop.sport,
      sportKey:         undefined,    // not promoted to ScoredProp; future stages can set it
      marketType:       'player_prop',
      // Prop-specific
      playerName:       prop.playerName,
      team:             prop.team,
      market:           prop.market,
      line:             prop.line,
      // Game context
      matchup:          prop.matchup,
      side:             prop.side,
      betType:          undefined,
      // Pricing
      bestBook:         prop.bestUserBook,
      bestPrice:        prop.bestUserPrice,
      consensusPrice:   prop.consensusPrice,
      priceDiff:        prop.priceDiff,
      // Market quality
      score:            prop.score,
      signalCount:      prop.signalCount,
      bookCount:        prop.bookCount,
      tier:             prop.tier,
      grade:            prop.grade,
      kellyPct:         undefined,    // prop kelly lives in prediction.kelly
      // Timing
      hoursUntilGame:   prop.hoursUntilGame,
    };
  }

  // ---- Game line ----
  const bet = input;

  // ScoredBet does not carry eventId at runtime (not included in the
  // scoreAllBets push object).  Build a deterministic compound key instead.
  const id = `${bet.matchup}__${bet.betType}__${bet.side}`;

  return {
    ...decisionDefaults,
    id,
    sport:            bet.sport,
    sportKey:         (bet as any).sportKey,  // not in interface; may be present at runtime
    marketType:       'game_line',
    // Prop-specific fields absent for game lines
    playerName:       undefined,
    team:             undefined,
    market:           undefined,
    line:             undefined,
    // Game context
    matchup:          bet.matchup,
    side:             bet.side,
    betType:          bet.betType,
    // Pricing
    bestBook:         bet.bestUserBook,
    bestPrice:        bet.bestUserPrice,
    consensusPrice:   bet.consensusPrice === 0 ? null : bet.consensusPrice,
    priceDiff:        bet.priceDiff,
    // Market quality
    score:            bet.score,
    signalCount:      bet.signalCount,
    bookCount:        bet.bookCount,
    tier:             bet.tier,
    grade:            bet.grade,
    kellyPct:         bet.kellyPct,
    // Timing
    hoursUntilGame:   bet.hoursUntilGame,
  };
}

/**
 * Convenience wrapper: maps an array of ScoredBet or ScoredProp
 * values to DecisionCandidate[], preserving original order.
 */
export function mapAllToDecisionCandidates(
  inputs: Array<ScoredBet | ScoredProp>
): DecisionCandidate[] {
  return inputs.map(mapToDecisionCandidate);
}
