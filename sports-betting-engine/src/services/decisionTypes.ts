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
 * Present on ScoredBet and optionally on ScoredProp.
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

  /** Projection layer fields for NBA player props. */
  projectedStat?: number;
  projectionEdge?: number;
  probability?: number;
  impliedProbability?: number;
  trueEdge?: number;
  modelCompleteness?: number;
  nbaMinutesStable?: boolean;
  nbaMinutesConfidence?: number;
  nbaRoleStabilityScore?: number;
  strongNonMarketSignalCount?: number;
  supportedNBAProjection?: boolean;

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
  // Risk engine support fields
  // Populated by the mapper; consumed by riskEngine.applyRisk().
  // ----------------------------------------------------------

  /**
   * Named signals that contributed to this candidate's score.
   * Props: mapped directly from ScoredProp.signals (e.g. ['PRICE_EDGE', 'LINE_GAP']).
   * Game lines: derived from ScoredBet boolean fields by the mapper.
   * Used by the risk engine to detect price-only vs. intelligence-backed candidates.
   */
  signals?: string[];

  /**
   * Player position string (e.g. "G", "F", "C", "PG", "SF").
   * ScoredProp only; undefined for game-line candidates.
   * Used by the risk engine's volatility/role check.
   */
  position?: string;

  /**
   * Max spread across all book lines for this market (absolute value).
   * ScoredProp only (from AggregatedProp.lineGap); undefined/null for game lines.
   * Used by the risk engine's stale-line outlier detection.
   */
  lineGap?: number | null;

  // ----------------------------------------------------------
  // Decision layer output fields
  // Initialized to neutral defaults by the mapper.
  // Populated by each engine stage in sequence.
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

  // ----------------------------------------------------------
  // Probability enrichment (Phase 4)
  // Set by probabilityEngine.enrichWithProbability().
  // Undefined until that stage runs.
  // ----------------------------------------------------------

  /**
   * Estimated win probability derived from the existing score.
   * Formula: 0.50 + (score / 100) × 0.15  → range [0.50, 0.65]
   * Conservative first-pass model; sport/role adjustments in later phases.
   */
  winProbability?: number;

  /**
   * Implied win probability calculated directly from bestPrice
   * using standard American-odds conversion (no vig removal).
   * Positive odds:  100 / (odds + 100)
   * Negative odds:  |odds| / (|odds| + 100)
   */
  impliedProbabilityFromBestPrice?: number;

  /**
   * winProbability − impliedProbabilityFromBestPrice.
   * Positive = model believes true win rate exceeds book's implied price.
   * Negative = model believes the price overstates our edge.
   */
  impliedEdge?: number;

  // ----------------------------------------------------------
  // Outcome Signal Layer (Phase B)
  // Set by outcomeSignalEngine.applyOutcomeSignals().
  // Runs between probability enrichment and sport intelligence.
  // Undefined on non-NBA / non-prop candidates (pass-through unchanged).
  // ----------------------------------------------------------

  /**
   * All outcome-based signal strings produced by the outcome engine.
   * Possible values (first-pass NBA-only):
   *   Role:       ROLE_STABLE | ROLE_NEUTRAL | ROLE_UNSTABLE
   *   Usage:      USAGE_UP | USAGE_STABLE | USAGE_DOWN
   *   Form:       RECENT_FORM_NEUTRAL  (game-log data not yet available)
   *   Matchup:    MATCHUP_NEUTRAL      (defensive DB not yet available)
   *
   * These signals are for context only — only ROLE_STABLE is also merged
   * into signals[] so the signal diversity engine can detect multi-signal
   * candidates correctly.  Negative/neutral signals are deliberately kept
   * out of signals[] to prevent incorrect risk-bonus triggering.
   */
  outcomeSignals?: string[];

  /**
   * 0–100 estimate of role/usage stability based on posted line value or
   * actual lineup confirmation data when available.
   * ROLE_STABLE → 75 | ROLE_NEUTRAL → 50 | ROLE_UNSTABLE → 25
   * Distinct from sportIntelligenceEngine's roleStabilityScore (0.0–1.0 scale).
   */
  outcomeRoleScore?: number;

  /**
   * 0–100 estimate of usage trend based on line value relative to market
   * thresholds.  USAGE_UP → 80 | USAGE_STABLE → 50 | USAGE_DOWN → 25
   */
  usageTrendScore?: number;

  /**
   * 0–100 matchup difficulty estimate.
   * Phase C: derived from opponent defensiveRating when powerRatings are available.
   * Falls back to 50 (MATCHUP_NEUTRAL) when no power-rating data is present.
   */
  matchupScore?: number;

  /**
   * 0–100 recent-form estimate.
   * Phase C: derived from team last-5 PPG (homeForm / awayForm) for scoring props.
   * Falls back to 50 (RECENT_FORM_NEUTRAL) for non-scoring props or when no context.
   */
  recentFormScore?: number;

  /**
   * 0–100 confidence that the player's minutes / role are secure.
   * Phase C: 85 when lineup confirmed as starter, 15 when scratched,
   * 50 when no lineup data available (MINUTES_UNKNOWN).
   */
  minutesConfidenceScore?: number;

  /**
   * 0–100 score reflecting whether a teammate injury creates usage opportunity.
   * Phase C: 75 when Out/Doubtful teammate found on same team; 50 neutral.
   */
  injuryOpportunityScore?: number;

  /**
   * 0–100 opponent defensive quality score for this market type.
   * Phase C: derived from opponent defensiveRating (PPG allowed).
   * Poor opponent defense → high score; elite defense → low score.
   * 50 when no power-rating data available.
   */
  defensiveMatchupScore?: number;

  // ----------------------------------------------------------
  // Sport + Market Intelligence fields (Phase 4.5)
  // Set by sportIntelligenceEngine.applySportIntelligence().
  // Undefined until that stage runs.
  // ----------------------------------------------------------

  /**
   * 0.0–1.0 quality score for this bet type.
   * HIGH types (pitcher props, stable game lines): >= 0.75
   * LOW types (binary batter unders): <= 0.15
   */
  betTypeQualityScore?: number;

  /**
   * Categorical tier derived from betTypeQualityScore.
   * HIGH   — pitcher props, stable NBA starter props, game lines
   * MEDIUM — standard NBA props, normal hitter props, game totals
   * LOW    — binary batter unders (hits/total_bases UNDER 0.5)
   */
  betTypeQualityTier?: 'HIGH' | 'MEDIUM' | 'LOW';

  /**
   * 0.0–1.0 reliability estimate for the market.
   * Higher = more liquid market with stable multi-book consensus.
   */
  marketReliabilityScore?: number;

  /**
   * 0.0–1.0 estimate of role/usage stability.
   * Pitcher props and game lines score highest; binary unders lowest.
   */
  roleStabilityScore?: number;

  /**
   * Named flags from the sport intelligence engine.
   * Possible values:
   *   "binary_hitter_under"  — line 0.5 Under on a batter stat
   *   "one_event_kills_bet"  — a single positive outcome voids the wager
   *   "fragile_prop_type"    — bet structure highly vulnerable to variance
   */
  intelligenceFlags?: string[];

  // ----------------------------------------------------------
  // Risk engine output (Phase 5)
  // Set by riskEngine.applyRisk().
  // Undefined until that stage runs.
  // ----------------------------------------------------------

  /**
   * Composite risk score.
   * +2 = strong signal diversity (non-price signals present)
   * -2 = price-only signal
   * -1 = volatility/role risk
   * -1 = stale line detected
   * -1 = low edge (impliedEdge < 0.03)
   * Correlation tagging adds no score penalty (informational only).
   */
  riskScore?: number;

  /**
   * Categorical risk grade derived from riskScore.
   * LOW      = riskScore >= 2
   * MODERATE = riskScore 0–1
   * HIGH     = riskScore < 0
   */
  riskGrade?: 'LOW' | 'MODERATE' | 'HIGH';

  /**
   * Array of active risk flag strings.
   * Possible values:
   *   "price_only_signal"  — all signals are market-structure only
   *   "low_edge"           — impliedEdge < 0.03
   *   "role_volatility"    — line value suggests bench/role player
   *   "correlated_game"    — multiple candidates from the same game
   *   "stale_line_risk"    — one book appears to be an outlier
   */
  riskFlags?: string[];

  // ----------------------------------------------------------
  // Signal diversity (Phase A)
  // Set by signalDiversityEngine.applySignalDiversity().
  // Undefined until that stage runs.
  // ----------------------------------------------------------

  /**
   * True when all of the candidate's signals are market-structure only
   * (PRICE_EDGE, LINE_GAP, JUICE_GAP, LINE_VS_CONSENSUS).
   *
   * Used by the label engine as an explicit hard guard:
   * isPriceOnlyCandidate === true → finalDecisionLabel NEVER equals BET,
   * regardless of riskScore or adjustedEdge.
   */
  isPriceOnlyCandidate?: boolean;

  /**
   * Win probability after applying risk discounts.
   * Price-only candidates: winProbability × 0.85 (large gap) or × 0.90 (small gap).
   * Non-price-only candidates: same as winProbability.
   */
  adjustedWinProbability?: number;

  /**
   * adjustedWinProbability − impliedProbabilityFromBestPrice.
   * More conservative than impliedEdge; used as the primary edge metric
   * once the risk engine has run.
   */
  adjustedEdge?: number;

  // ----------------------------------------------------------
  // Signal Weighting (Phase D)
  // Set by signalWeightingEngine.applySignalWeighting().
  // Runs BEFORE the risk engine (between signal diversity and risk).
  // Pipeline: ... → signal diversity → signal weighting → risk → label → slate
  // ----------------------------------------------------------

  /**
   * Pre-risk sport/market calibrated edge.
   * Computed as impliedEdge × sportMultiplier + signalDeltas.
   * When set, the risk engine uses this as its base instead of
   * recomputing from adjustedWinProbability − impliedProb.
   * Preserved for audit — never overwritten after weighting runs.
   *
   * Three-stage audit trail:
   *   impliedEdge          — raw probability delta (probability engine)
   *   weightedAdjustedEdge — after sport multiplier + signal deltas (weighting engine)
   *   adjustedEdge         — after price-only risk discount (risk engine)
   */
  weightedAdjustedEdge?: number;

  /**
   * Ordered list of adjustments applied by the weighting engine, e.g.:
   *   ["NBA_PROP base ×0.88 → 6.2%", "MINUTES_SECURE +0.008", "ROLE_STABLE +0.005"]
   * Empty array when the profile was matched but no signal deltas applied.
   */
  weightingReasons?: string[];

  /**
   * The base sport/market multiplier applied (e.g. 0.88, 1.05).
   * 1.0 for neutral/default profiles.
   * Undefined when the weighting engine has not run on this candidate.
   */
  weightingMultiplier?: number;

  /**
   * The resolved sport/market profile string applied by the weighting engine.
   * e.g. 'NBA_PROP', 'NHL_GAME', 'MLB_PITCHER', 'NCAAB_GAME', 'DEFAULT'.
   * Undefined when the weighting engine has not run.
   */
  weightingProfile?: string;

  /**
   * Set by keyNumberEngine.applyKeyNumbers() for SPREAD game-line candidates
   * on sports with defined key numbers (NFL, NBA, NCAAF, NCAAB).
   * Undefined for all other candidates (props, moneylines, totals, off-season sports).
   * The riskDeltaPct is read by the risk engine to lower adjustedEdge proportionally.
   */
  keyNumberAdjustment?: import('./keyNumberEngine').KeyNumberAdjustment;

  /**
   * Set by the slate selector when the BET volume cap is exceeded.
   * Overrides finalDecisionLabel for display and selection purposes only —
   * finalDecisionLabel itself is never changed (full audit trail preserved).
   *
   *   'LEAN'    — candidate was BET but downgraded by the 3-BET slate cap
   *   'MONITOR' — candidate was BET/LEAN but downgraded by the 5-BET slate cap
   *
   * When set, printSlateSummary renders: [BET → LEAN cap] or [BET → MONITOR cap].
   */
  forcedTierCap?: 'LEAN' | 'MONITOR';

  // ----------------------------------------------------------
  // Label engine output (Phase 6)
  // Set by labelEngine.labelCandidates().
  // Undefined until that stage runs.
  // ----------------------------------------------------------

  /**
   * Final decision classification.
   * BET            — clear actionable edge, low/acceptable risk
   * LEAN           — meaningful edge, moderate risk, worth considering
   * MONITOR        — borderline edge or high risk, watch for improvement
   * BEST_PRICE_ONLY — best accessible number exists but no confident signal
   * PASS           — not qualified, missing data, or risk+edge insufficient
   */
  finalDecisionLabel?: 'BET' | 'LEAN' | 'MONITOR' | 'PASS' | 'BEST_PRICE_ONLY';

  /**
   * Grade derived from finalDecisionLabel + adjustedEdge magnitude.
   * A+ / A  → BET
   * B+ / B  → LEAN
   * C+      → BEST_PRICE_ONLY
   * C       → MONITOR
   * D       → PASS
   */
  finalGrade?: string;

  /**
   * Human-readable explanations for the label assignment.
   * At most 3 reasons populated per candidate.
   */
  labelReasons?: string[];

  // ----------------------------------------------------------
  // Slate selector output (Phase 7)
  // Set by slateSelector.selectSlate().
  // Undefined until that stage runs.
  // ----------------------------------------------------------

  /**
   * 1-based position in the final slate ranking.
   * All input candidates receive a rank regardless of label.
   */
  slateRank?: number;

  /**
   * True on exactly one candidate per slate: the Best Bet.
   * Only set when the candidate meets all Best Bet eligibility
   * rules (BET/LEAN + LOW/MODERATE risk + positive adjustedEdge).
   */
  isBestBet?: boolean;

  /**
   * Human-readable reasons explaining the slate selection decision
   * (rank, label, edge, risk, signal diversity, correlation).
   */
  selectionReasons?: string[];
}

// ============================================================
// Internal mapper helpers
// ============================================================

/**
 * Derives a named-signal array from a ScoredBet's available boolean
 * and string fields.  This approximates the signal names that propScorer
 * stores directly on ScoredProp.signals, so the risk engine can apply
 * identical logic to both candidate types.
 *
 * Mapping:
 *   priceDiff > 0            → PRICE_EDGE
 *   lineDiff > 0             → LINE_GAP
 *   sharpSignal non-empty    → SHARP_INTEL
 *   lineMovementAlert        → LINE_MOVEMENT
 *   priceMovementAlert       → PRICE_MOVEMENT
 *   fadePublicFlag           → FADE_PUBLIC
 *   isRecentMovement         → RECENT_MOVEMENT
 */
function deriveGameLineSignals(bet: ScoredBet): string[] {
  const signals: string[] = [];
  if (bet.priceDiff > 0)                               signals.push('PRICE_EDGE');
  if (bet.lineDiff !== null && bet.lineDiff > 0)       signals.push('LINE_GAP');
  if (bet.sharpSignal && bet.sharpSignal.trim() !== '') signals.push('SHARP_INTEL');
  if (bet.lineMovementAlert)                            signals.push('LINE_MOVEMENT');
  if (bet.priceMovementAlert)                          signals.push('PRICE_MOVEMENT');
  if (bet.fadePublicFlag)                              signals.push('FADE_PUBLIC');
  if (bet.isRecentMovement)                            signals.push('RECENT_MOVEMENT');
  return signals;
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
 *    defaults (qualificationPassed = false, empty arrays, undefineds).
 *  - Downstream engines overwrite these fields on their own copy.
 */
export function mapToDecisionCandidate(
  input: ScoredBet | ScoredProp
): DecisionCandidate {
  // Neutral decision-layer defaults applied to every candidate
  const decisionDefaults = {
    qualificationPassed:  false,
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
      sportKey:         prop.sportKey,
      marketType:       'player_prop',
      // Prop-specific
      playerName:       prop.playerName,
      team:             prop.team,
      market:           prop.market,
      line:             prop.line,
      projectedStat:    prop.projectedStat,
      projectionEdge:   prop.projectionEdge,
      probability:      prop.probability,
      impliedProbability: prop.impliedProbability,
      trueEdge:         prop.trueEdge,
      modelCompleteness: prop.modelCompleteness,
      nbaMinutesStable: prop.nbaMinutesStable,
      nbaMinutesConfidence: prop.nbaMinutesConfidence,
      nbaRoleStabilityScore: prop.nbaRoleStabilityScore,
      strongNonMarketSignalCount: prop.strongNonMarketSignalCount,
      supportedNBAProjection: prop.supportedNBAProjection,
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
      // Risk engine support fields — all present on ScoredProp
      signals:          prop.signals,
      position:         prop.position ?? undefined,
      lineGap:          prop.lineGap,
    };
  }

  // ---- Game line ----
  const bet = input;

  // Use a deterministic compound key so later stages can match the
  // saved top-bet records without depending on eventId alone.
  const id = `${bet.matchup}__${bet.betType}__${bet.side}`;

  return {
    ...decisionDefaults,
    id,
    sport:            bet.sport,
    sportKey:         bet.sportKey,
    marketType:       'game_line',
    // Prop-specific fields absent for game lines
    playerName:       undefined,
    team:             undefined,
    market:           undefined,
    line:             undefined,
    projectedStat:    undefined,
    projectionEdge:   undefined,
    probability:      undefined,
    impliedProbability: undefined,
    trueEdge:         undefined,
    modelCompleteness: undefined,
    nbaMinutesStable: undefined,
    nbaMinutesConfidence: undefined,
    nbaRoleStabilityScore: undefined,
    strongNonMarketSignalCount: undefined,
    supportedNBAProjection: undefined,
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
    // Risk engine support fields — derived from ScoredBet boolean fields
    signals:          deriveGameLineSignals(bet),
    position:         undefined,   // no position concept on game lines
    lineGap:          null,        // AggregatedProp.lineGap has no game-line equivalent
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
