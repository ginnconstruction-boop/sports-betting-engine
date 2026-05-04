// ============================================================
// src/services/propScorer.ts
// Enhanced with full prop intelligence layer
// NBA player prop edge scorer
// Criteria: line gap, juice gap, implied vs posted,
//           form window, back-to-back, matchup, movement
// ============================================================

import { AggregatedProp, PropOffer } from './propNormalizer';
import { PROP_CONFIG } from '../config/propConfig';
import { BET_FILTERS } from '../config/betFilters';
import { getUserBookKeys, getBookmakerDisplayName } from '../config/bookmakers';

export interface ScoredProp {
  prediction?: any;          // PropPrediction from intelligence layer
  intelligenceScore: number; // score contribution from player context
  rank: number;
  grade: string;
  score: number;
  tier: 'BET' | 'LEAN' | 'MONITOR';
  // Game
  matchup: string;
  gameTime: string;
  hoursUntilGame: number;
  sport: string;
  // Prop
  playerName: string;
  team?: string;
  position?: string;
  statType?: string;
  eventId?: string;
  sportKey?: string;
  market: string;
  side: 'Over' | 'Under';
  line: number;
  projectedStat?: number;
  projectionEdge?: number;
  probability?: number;
  impliedProbability?: number;
  trueEdge?: number;
  modelCompleteness?: number;
  edgeConfidence?: number;
  nbaMinutesStable?: boolean;
  nbaMinutesConfidence?: number;
  nbaRoleStabilityScore?: number;
  strongNonMarketSignalCount?: number;
  supportedNBAProjection?: boolean;
  // Best accessible book
  bestUserBook: string;
  bestUserPrice: number;
  altUserBook: string;
  altUserPrice: number | null;
  // Market context
  consensusLine: number | null;
  consensusPrice: number | null;
  lineGap: number | null;
  juiceGap: number | null;
  bookCount: number;
  priceDiff: number;        // user best vs consensus price
  lineDiffVsConsensus: number | null; // line vs consensus
  // Signals
  signals: string[];
  signalCount: number;
  // Flags
  lineGapAlert: boolean;
  juiceGapAlert: boolean;
  isBackToBack: boolean;
  // Full reasoning
  fullReasoning: string[];
}

// ------------------------------------
// Helpers
// ------------------------------------

function fmtPrice(p: number): string { return p > 0 ? `+${p}` : `${p}`; }
function scoreToGrade(s: number): string {
  if (s >= 88) return 'A+';
  if (s >= 78) return 'A';
  if (s >= 68) return 'B+';
  if (s >= 55) return 'B';
  if (s >= 42) return 'C+';
  if (s >= 30) return 'C';
  return 'D';
}
function getTier(score: number, signals: number): 'BET' | 'LEAN' | 'MONITOR' {
  if (score >= 70 && signals >= 3) return 'BET';
  if (score >= 50 && signals >= 2) return 'LEAN';
  return 'MONITOR';
}
function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3600000;
}

function americanToImpliedProbability(american: number): number {
  if (american >= 0) {
    return Math.round((100 / (american + 100)) * 1000) / 1000;
  }
  return Math.round((Math.abs(american) / (Math.abs(american) + 100)) * 1000) / 1000;
}

function clampScore(score: number): number {
  return Math.round(Math.max(0, Math.min(100, score)));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundToThousandths(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const MARKET_STRUCTURE_SIGNALS = new Set([
  'PRICE_EDGE', 'LINE_GAP', 'JUICE_GAP', 'LINE_VS_CONSENSUS',
]);

const NBA_PREDICTIVE_CONTEXT_SIGNALS = new Set([
  'MINUTES_SECURE',
  'ROLE_STABLE',
  'ROLE_CHANGE',
  'FORM_CONFIRMED',
  'MINUTES_SPIKE',
  'USAGE_SPIKE',
  'USAGE_PROXY_SPIKE',
  'POINTS_MATCHUP_EDGE',
  'ASSIST_MATCHUP_EDGE',
  'REBOUND_MATCHUP_EDGE',
  'THREE_MATCHUP_EDGE',
]);

const MLB_PREDICTIVE_CONTEXT_SIGNALS = new Set([
  'PITCHER_K_RATE_EDGE',
  'LOW_CONTACT_OPP',
  'INNINGS_STABILITY',
  'PITCHER_FORM',
  'BATTER_FORM',
  'PLATOON_EDGE',
  'PITCHER_WEAKNESS',
  'BALLPARK_FACTOR',
]);

const NHL_PREDICTIVE_CONTEXT_SIGNALS = new Set([
  'SHOT_VOLUME_BASELINE',
  'SHOT_VOLUME_FORM',
  'ICE_TIME_STABILITY',
  'OPP_SHOT_ALLOWANCE',
  'GOALIE_SAVE_BASELINE',
  'GOALIE_WORKLOAD_STABILITY',
  'GOALIE_STARTER_CONFIDENCE',
  'OPP_SHOT_VOLUME',
]);

function getSideProjectionEdge(
  side: 'Over' | 'Under',
  projectionEdge: number | undefined
): number {
  if (projectionEdge === undefined) return 0;
  return side === 'Over' ? projectionEdge : -projectionEdge;
}

function computeEdgeConfidence(
  sideProjectionEdge: number,
  modelProbability: number,
  modelCompleteness: number,
  strongNonMarketSignalCount: number
): number {
  const projectionComponent = clampUnit(sideProjectionEdge / 2.0);
  const probabilityComponent = clampUnit((modelProbability - 0.50) / 0.08);
  const contextComponent = clampUnit(strongNonMarketSignalCount / 2);
  const completenessComponent = clampUnit(modelCompleteness);

  return roundToThousandths(
    (projectionComponent * 0.40) +
    (probabilityComponent * 0.30) +
    (contextComponent * 0.20) +
    (completenessComponent * 0.10)
  );
}

function scoreNBAProjection(
  modelProbability: number,
  sideProjectionEdge: number,
  trueEdge: number,
  modelCompleteness: number,
  intelligenceScore: number,
  minutesConfidence: number,
  isThreeProp: boolean,
  strongNonMarketSignalCount: number
): number {
  const probabilityPoints = modelProbability > 0.5
    ? Math.min((modelProbability - 0.5) * 180, 18)
    : -10;
  const projectionPoints = sideProjectionEdge > 0
    ? Math.min(sideProjectionEdge * 14, 24)
    : 0;
  const trueEdgePoints = trueEdge > 0
    ? Math.min(trueEdge * 320, 24)
    : 0;
  const completenessPoints = modelCompleteness > 0.6
    ? Math.min((modelCompleteness - 0.6) * 40, 12)
    : 0;
  const intelligencePoints = Math.max(-6, Math.min(intelligenceScore / 4, 6));
  const minutesPoints = Math.max(-18, Math.min((minutesConfidence - 0.7) * 32, 10));
  const contextPoints = strongNonMarketSignalCount >= 2
    ? 8
    : strongNonMarketSignalCount === 1
      ? 3
      : -10;
  const threesPenalty = isThreeProp ? -4 : 0;

  return clampScore(
    8 + probabilityPoints + projectionPoints + trueEdgePoints +
    completenessPoints + intelligencePoints + minutesPoints +
    contextPoints + threesPenalty
  );
}

// ------------------------------------
// Score a single prop
// ------------------------------------

function scoreProp(
  priceDiff: number,
  lineGap: number | null,
  juiceGap: number | null,
  bookCount: number,
  isBackToBack: boolean
): number {
  // Price edge vs consensus: 0-40 pts
  const priceScore = priceDiff > 0 ? Math.min((priceDiff / 20) * 40, 40) : 0;

  // Line gap between books: 0-35 pts
  // 1.5+ gap is excellent, 3.0+ is exceptional
  const lineScore = lineGap !== null && lineGap > 0
    ? Math.min((lineGap / 3.0) * 35, 35) : 0;

  // Juice gap: 0-15 pts
  const juiceScore = juiceGap !== null && juiceGap > 0
    ? Math.min((juiceGap / 20) * 15, 15) : 0;

  // Book coverage: 0-5 pts
  const coverageScore = Math.min((bookCount / 4) * 5, 5);

  // Back-to-back penalty: -10 pts on overs
  const b2bPenalty = isBackToBack ? -10 : 0;

  return Math.round(Math.max(0, Math.min(
    priceScore + lineScore + juiceScore + coverageScore + b2bPenalty,
    100
  )));
}

// ------------------------------------
// Score all props -- only use user-accessible books for recommendations
// ------------------------------------

import { buildPropPredictions, PropCoverageSummary } from './propIntelligence';
import { NBAContextSnapshot } from './nbaContextProvider';
import { MLBContextSnapshot } from './mlbContextProvider';
import { NHLContextSnapshot } from './nhlContextProvider';
import { findPlayerId, getPlayerProfile } from './playerStats';
import { applyLearnedWeights } from './retroAnalysis';

export async function scoreAllPropsWithIntelligence(
  props: AggregatedProp[],
  windowHours: number,
  contextMap: Map<string, any>,
  sportKey: string = 'basketball_nba',
  extraIntel?: {
    injuryMap?: Map<string, any[]>;
    lineupMap?: Map<string, any>;
    publicBetting?: Map<string, any>;
    powerRatings?: Map<string, any>;
    steamMoves?: any[];
    atsSituations?: Map<string, any>;
    weatherMap?: Map<string, any>;
    nbaContextSnapshot?: NBAContextSnapshot;
    mlbContextSnapshot?: MLBContextSnapshot;
    nhlContextSnapshot?: NHLContextSnapshot;
  },
  learnedWeights: Record<string, number> = {}
): Promise<ScoredProp[]> {
  const supportedNBAProjectionMarkets = new Set([
    'player_points',
    'player_rebounds',
    'player_assists',
    'player_threes',
  ]);
  const supportedMLBProjectionMarkets = new Set([
    'pitcher_strikeouts',
    'pitcher_hits_allowed',
    'pitcher_earned_runs',
    'batter_hits',
    'batter_total_bases',
  ]);
  const supportedNHLProjectionMarkets = new Set([
    'player_shots_on_goal',
    'goalie_saves',
  ]);
  const userBookKeys = getUserBookKeys();

  // Enrich props with team/position using roster lookup (best effort)
  const enrichedProps = await Promise.all(props.map(async (prop) => {
    try {
      const homePlayerId = await findPlayerId(prop.playerName, prop.homeTeam, sportKey);
      const awayPlayerId = homePlayerId ? null : await findPlayerId(prop.playerName, prop.awayTeam, sportKey);
      const playerId = homePlayerId ?? awayPlayerId;
      const lookupTeam = homePlayerId ? prop.homeTeam : awayPlayerId ? prop.awayTeam : '';
      if (playerId) {
        const profile = await getPlayerProfile(playerId, prop.playerName, lookupTeam, prop.position ?? '', sportKey);
        if (profile) {
          prop.team = profile.team;
          prop.position = profile.position;
        }
      }
    } catch { /* enrichment is best-effort */ }
    return prop;
  })).catch(() => props);

  // Build predictions for all props -- one entry per side using correct AggregatedProp fields
  // AggregatedProp has overBestLine/underBestLine/overConsensusLine, not .line/.side
  const propInputs: any[] = [];
  const coverageSummary: PropCoverageSummary | null = (sportKey === 'basketball_nba' || sportKey === 'baseball_mlb' || sportKey === 'icehockey_nhl')
    ? {
        eligible: 0,
        attached: 0,
        missingPlayer: 0,
        unsupportedMarket: 0,
        missingLine: 0,
        missingContext: 0,
      }
    : null;
  for (const p of enrichedProps) {
    if (!p.playerName) continue;
    const normalizedMarketKey = (p.marketKey ?? '').toLowerCase();
    const marketSupported = sportKey === 'basketball_nba'
      ? supportedNBAProjectionMarkets.has(normalizedMarketKey)
      : sportKey === 'baseball_mlb'
        ? supportedMLBProjectionMarkets.has(normalizedMarketKey)
        : sportKey === 'icehockey_nhl'
          ? supportedNHLProjectionMarkets.has(normalizedMarketKey)
        : true;
    const overUserOffers = p.overOffers
      .filter(o => userBookKeys.includes(o.bookmakerKey) && o.price !== null)
      .sort((a, b) => b.price - a.price);
    const underUserOffers = p.underOffers
      .filter(o => userBookKeys.includes(o.bookmakerKey) && o.price !== null)
      .sort((a, b) => b.price - a.price);
    const bestOverUserOffer = overUserOffers[0] ?? null;
    const bestUnderUserOffer = underUserOffers[0] ?? null;

    // Over side
    if (bestOverUserOffer && bestOverUserOffer.price !== null && bestOverUserOffer.price !== undefined) {
      const overLine = bestOverUserOffer.line ?? p.overConsensusLine ?? null;
      if (coverageSummary) {
        if (!marketSupported) {
          coverageSummary.unsupportedMarket++;
        } else if (overLine === null) {
          coverageSummary.missingLine++;
        } else {
          coverageSummary.eligible++;
        }
      }
      if (overLine === null || !marketSupported) {
        // Unsupported markets stay unsupported; missing-line props cannot project.
      } else {
      propInputs.push({
        playerName: p.playerName,
        team: p.team,
        position: p.position ?? 'G',
        statType: p.marketKey,
        marketKey: p.marketKey,
        postedLine: overLine,
        postedPrice: bestOverUserOffer.price ?? -110,
        side: 'over' as const,
        eventId: p.eventId,
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        gameTotal: p.gameTotal ?? null,
        gameSpread: (p as any).gameSpread ?? null,
      });
      }
    }

    // Under side
    if (bestUnderUserOffer && bestUnderUserOffer.price !== null && bestUnderUserOffer.price !== undefined) {
      const underLine = bestUnderUserOffer.line ?? p.overConsensusLine ?? null;
      if (coverageSummary) {
        if (!marketSupported) {
          coverageSummary.unsupportedMarket++;
        } else if (underLine === null) {
          coverageSummary.missingLine++;
        } else {
          coverageSummary.eligible++;
        }
      }
      if (underLine === null || !marketSupported) {
        // Unsupported markets stay unsupported; missing-line props cannot project.
      } else {
      propInputs.push({
        playerName: p.playerName,
        team: p.team,
        position: p.position ?? 'G',
        statType: p.marketKey,
        marketKey: p.marketKey,
        postedLine: underLine,
        postedPrice: bestUnderUserOffer.price ?? -110,
        side: 'under' as const,
        eventId: p.eventId,
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        gameTotal: p.gameTotal ?? null,
        gameSpread: (p as any).gameSpread ?? null,
      });
      }
    }
  }

  const predictionResult = await buildPropPredictions(propInputs, contextMap, sportKey, extraIntel)
    .catch(() => ({ predictions: new Map(), coverage: undefined }));
  const predictions = predictionResult.predictions;

  if (coverageSummary) {
    coverageSummary.attached = predictionResult.coverage?.attached ?? predictions.size;
    coverageSummary.missingPlayer = predictionResult.coverage?.missingPlayer ?? 0;
    coverageSummary.missingContext = predictionResult.coverage?.missingContext ?? 0;
    const coverageLabel = sportKey === 'baseball_mlb'
      ? 'MLB_PRED'
      : sportKey === 'icehockey_nhl'
        ? 'NHL_PRED'
        : 'NBA_PRED';
    console.log(
      `  [${coverageLabel}] eligible: ${coverageSummary.eligible} | attached: ${coverageSummary.attached} | ` +
      `missingPlayer: ${coverageSummary.missingPlayer} | unsupportedMarket: ${coverageSummary.unsupportedMarket} | ` +
      `missingLine: ${coverageSummary.missingLine} | missingContext: ${coverageSummary.missingContext}`
    );
  }

  // Score all props with intelligence adjustment (pass contextMap for B2B detection)
  const baseScored = scoreAllProps(props, windowHours, sportKey, contextMap);

  return baseScored.map(scored => {
    const normalizedSide = (sportKey === 'basketball_nba' || sportKey === 'baseball_mlb' || sportKey === 'icehockey_nhl')
      ? scored.side.toLowerCase()
      : scored.side;
    const key = `${scored.playerName}__${scored.statType}__${normalizedSide}`;
    const prediction = predictions.get(key);

    if (!prediction) return { ...scored, intelligenceScore: 0 };

    // Promote supported sport-specific non-market signals into signals[]
    // so downstream diversity logic can distinguish real context from
    // pure price structure without loosening thresholds.
    //
    // For baseball_mlb / icehockey_nhl: any prediction signal that is NOT pure book
    // comparison (PRICE_EDGE / LINE_GAP / JUICE_GAP / LINE_VS_CONSENSUS)
    // and has magnitude high/medium is pushed into signals[] so that
    // signalDiversityEngine.detectPriceOnly() correctly identifies
    // candidates that have real model backing beyond price structure.
    //
    // For unsupported sports: enrichedSignals === scored.signals (no-op).
    const nonMarketIntelSignals = (prediction.signals ?? [])
      .filter(s => !MARKET_STRUCTURE_SIGNALS.has(s.type))
      .filter(s => s.magnitude === 'high' || s.magnitude === 'medium')
      .map(s => s.type);
    const strongNonMarketSignalCount = (sportKey === 'basketball_nba'
      ? nonMarketIntelSignals.filter(type => NBA_PREDICTIVE_CONTEXT_SIGNALS.has(type))
      : sportKey === 'baseball_mlb'
        ? nonMarketIntelSignals.filter(type => MLB_PREDICTIVE_CONTEXT_SIGNALS.has(type))
        : sportKey === 'icehockey_nhl'
          ? nonMarketIntelSignals.filter(type => NHL_PREDICTIVE_CONTEXT_SIGNALS.has(type))
        : nonMarketIntelSignals
    ).length;

    const enrichedSignals =
      sportKey === 'basketball_nba' && nonMarketIntelSignals.length > 0
        ? [...new Set([...scored.signals, ...nonMarketIntelSignals])]
        : sportKey === 'baseball_mlb' && nonMarketIntelSignals.length > 0
          ? [...new Set([
            ...scored.signals,
            ...nonMarketIntelSignals.filter(type => MLB_PREDICTIVE_CONTEXT_SIGNALS.has(type)),
          ])]
        : sportKey === 'icehockey_nhl' && nonMarketIntelSignals.length > 0
          ? [...new Set([
            ...scored.signals,
            ...nonMarketIntelSignals.filter(type => NHL_PREDICTIVE_CONTEXT_SIGNALS.has(type)),
          ])]
        : scored.signals;

    // Apply intelligence score adjustment
    const intelligenceScore = Math.min(Math.max(prediction.scoreAdjustment, -30), 30);
    const adjustedScore = Math.max(0, Math.min(100, scored.score + intelligenceScore));

    // Add prediction signals to reasons
    const extraReasons = prediction.signals
      .filter((s: any) => s.magnitude === 'high' || s.magnitude === 'medium')
      .slice(0, 3)
      .map((s: any) => {
        const icon = s.side === 'over' ? '[^]' : s.side === 'under' ? '[v]' : '[~]';
        return `${icon} ${s.type}: ${s.detail}`;
      });

    // Build top 3-5 signals only -- sorted by absolute score contribution
    const allSignals = (prediction.signals ?? []) as any[];
    const rankedSignals = allSignals
      .filter((s: any) => s.side !== 'neutral')
      .sort((a: any, b: any) => Math.abs(b.scoreContribution) - Math.abs(a.scoreContribution))
      .slice(0, 5);

    const intelReasons: string[] = [];

    // Line 1: prediction summary (most important)
    if (prediction.predictedValue !== undefined && Math.abs(prediction.predictedEdge ?? 0) >= 1) {
      const edgeStr = (prediction.predictedEdge ?? 0) > 0 ? `+${prediction.predictedEdge}` : String(prediction.predictedEdge);
      intelReasons.push(`[AI] Model: ${prediction.predictedValue} predicted vs ${prediction.postedLine} line (edge ${edgeStr}) -- ${prediction.confidence.toUpperCase()} confidence`);
    }

    // Lines 2-5: top signals with clear labels
    for (const sig of rankedSignals.slice(0, 4)) {
      const icon = sig.side === 'over' ? '[^]' : sig.side === 'under' ? '[v]' : '[~]';
      const label = sig.type.replace(/_/g, ' ').toLowerCase();
      intelReasons.push(`${icon} ${label}: ${sig.detail}`);
    }

    // Only replace fullReasoning entirely -- no stacking old price-only reasons with new intel
    // Keep 1 price reason + up to 4 intel reasons = max 5 lines total
    const priceReason = (scored.fullReasoning ?? []).find((r: string) =>
      r.includes('better than market') || r.includes('better than consensus') || r.includes('line gap')
    );
    const cleanReasoning = [
      ...(priceReason ? [priceReason] : []),
      ...intelReasons,
    ].slice(0, 5);

    // Apply learned signal weights on top of intelligence adjustment
    const signalNames = (prediction.signals ?? []).map((s: any) => s.type);
    const weightedScore = applyLearnedWeights(adjustedScore, signalNames, learnedWeights);

    const projectedStat = prediction.projectedStat ?? prediction.predictedValue;
    const rawProjectionDelta = projectedStat !== undefined
      ? Math.round((projectedStat - scored.line) * 10) / 10
      : undefined;
    const projectionEdge = rawProjectionDelta !== undefined
      ? (sportKey === 'basketball_nba'
        ? getSideProjectionEdge(scored.side, rawProjectionDelta)
        : rawProjectionDelta)
      : undefined;
    const impliedProbability = americanToImpliedProbability(scored.bestUserPrice);
    const probability = scored.side === 'Over'
      ? prediction.probabilityOver
      : prediction.probabilityUnder;
    const trueEdge = probability !== undefined
      ? Math.round((probability - impliedProbability) * 1000) / 1000
      : undefined;
    const modelCompleteness = prediction.modelCompleteness ?? 0;
    const sideProjectionEdge = projectionEdge ?? 0;
    const edgeConfidence = computeEdgeConfidence(
      sideProjectionEdge,
      probability ?? 0,
      modelCompleteness,
      strongNonMarketSignalCount
    );
    const nbaMinutesStable = prediction.nbaMinutesStable;
    const nbaMinutesConfidence = prediction.nbaMinutesConfidence ?? 0;
    const nbaRoleStabilityScore = prediction.nbaRoleStabilityScore ?? 0.5;
    const supportedNBAProjection = prediction.supportedNBAProjection ?? false;
    const isThreeProp = scored.statType === 'player_threes';

    let finalScore = weightedScore;
    let finalTier = scored.tier;

    if (sportKey === 'basketball_nba') {
      finalScore = scoreNBAProjection(
        probability ?? 0,
        sideProjectionEdge,
        trueEdge ?? 0,
        modelCompleteness,
        intelligenceScore,
        nbaMinutesConfidence,
        isThreeProp,
        strongNonMarketSignalCount
      );
      finalTier = getTier(finalScore, enrichedSignals.length);

      if (!supportedNBAProjection) {
        finalScore = Math.min(finalScore, 15);
        finalTier = 'MONITOR';
      }

      if (nbaMinutesStable === false || nbaMinutesConfidence < (isThreeProp ? 0.74 : 0.70)) {
        finalScore = Math.min(finalScore, 15);
        finalTier = 'MONITOR';
      }

      if ((probability ?? 0) < 0.55 || sideProjectionEdge < 1.0 || (trueEdge ?? 0) < 0.03) {
        finalScore = Math.min(finalScore, 15);
        finalTier = 'MONITOR';
      } else if ((probability ?? 0) < 0.58 || sideProjectionEdge < 1.5 || (trueEdge ?? 0) < 0.05) {
        finalScore = Math.min(finalScore, 49);
        finalTier = 'MONITOR';
      }

      if (modelCompleteness < 0.65) {
        finalScore = Math.min(finalScore, 15);
        finalTier = 'MONITOR';
      } else if (modelCompleteness < 0.75) {
        finalScore = Math.min(finalScore, 49);
        finalTier = 'MONITOR';
      }

      const hasStrongSingleContextEscape =
        strongNonMarketSignalCount >= 1 &&
        sideProjectionEdge >= 1.5 &&
        (trueEdge ?? 0) >= 0.05;

      if (strongNonMarketSignalCount < 1) {
        finalScore = Math.min(finalScore, 15);
        finalTier = 'MONITOR';
      } else if (strongNonMarketSignalCount < 2 && !hasStrongSingleContextEscape) {
        finalScore = Math.min(finalScore, 49);
        finalTier = 'MONITOR';
      }

      if ((prediction.impliedProbability ?? impliedProbability) >= (probability ?? 0)) {
        finalScore = Math.min(finalScore, 20);
        finalTier = 'MONITOR';
      }

      if (edgeConfidence < 0.68) {
        finalScore = Math.min(finalScore, 69);
        if (finalTier === 'BET') finalTier = 'LEAN';
      }
    }

    const shouldSuppressNBAMismatch =
      sportKey === 'basketball_nba' &&
      projectedStat !== undefined &&
      projectionEdge !== undefined &&
      probability !== undefined &&
      trueEdge !== undefined &&
      (
        sideProjectionEdge <= -1.0 ||
        trueEdge <= -0.05 ||
        probability + 0.05 < impliedProbability
      );

    if (shouldSuppressNBAMismatch) {
      return null;
    }

    return {
      ...scored,
      score:        finalScore,
      grade:        scoreToGrade(finalScore),
      tier:         finalTier,
      prediction,
      intelligenceScore,
      projectedStat,
      projectionEdge,
      probability,
      impliedProbability,
      trueEdge,
      modelCompleteness,
      edgeConfidence,
      nbaMinutesStable,
      nbaMinutesConfidence,
      nbaRoleStabilityScore,
      strongNonMarketSignalCount,
      supportedNBAProjection,
      fullReasoning: cleanReasoning,
      // Write enriched signals back so signalDiversityEngine sees them.
      // signalCount is updated to match so downstream engines agree.
      signals:      enrichedSignals,
      signalCount:  enrichedSignals.length,
    };
  }).filter((p): p is ScoredProp => p !== null).sort((a, b) => b.score - a.score);
}

export function scoreAllProps(
  props: AggregatedProp[],
  windowHours = 24,
  sportKey: string = 'basketball_nba',
  contextMap?: Map<string, any>
): ScoredProp[] {
  const userBookKeys = getUserBookKeys();
  const scored: ScoredProp[] = [];

  for (const prop of props) {
    const hours = hoursUntil(prop.gameTime);
    // Exclude in-progress and already-started games
    if (hours < BET_FILTERS.MIN_HOURS_UNTIL_GAME_PROPS) continue;
    if (hours > windowHours) continue;
    if (prop.bookCount < 2) continue; // need at least 2 books

    // Process both Over and Under
    const sides: Array<'Over' | 'Under'> = ['Over', 'Under'];

    for (const side of sides) {
      const offers: PropOffer[] = side === 'Over' ? prop.overOffers : prop.underOffers;
      const consensusPrice = side === 'Over' ? prop.overConsensusPrice : prop.underConsensusPrice;
      const consensusLine = prop.overConsensusLine; // same line for both sides

      if (!consensusPrice) continue;

      // ── MLB hard filter (Step 1) ─────────────────────────────
      // Binary batter UNDERs at 0.5 are structurally unplayable:
      // a single hit, total base, or run negates the wager entirely.
      // These map to binary_hitter_under / one_event_kills_bet /
      // fragile_prop_type flags in sportIntelligenceEngine and must
      // never reach scoring regardless of price edge.
      if (sportKey === 'baseball_mlb' && side === 'Under') {
        const mk = (prop.marketKey ?? '').toLowerCase();
        const isBatterMarket =
          mk.includes('batter') ||
          mk.includes('total_bases') ||
          mk.includes('hits') ||
          mk.includes('runs_scored') ||
          mk.includes('rbi') ||
          mk.includes('home_run') ||
          mk.includes('stolen_base');
        if (isBatterMarket && !mk.includes('pitcher')) continue;
      }

      // Filter to user-accessible books only for recommendation
      const userOffers = offers.filter(o =>
        userBookKeys.includes(o.bookmakerKey) && o.price !== null
      ).sort((a, b) => b.price - a.price);

      if (userOffers.length === 0) continue;

      const bestOffer = userOffers[0];
      const altOffer = userOffers[1] ?? null;

      // Price filter
      if (bestOffer.price < PROP_CONFIG.MIN_PRICE || bestOffer.price > PROP_CONFIG.MAX_PRICE) continue;

      const priceDiff = bestOffer.price - consensusPrice;
      if (priceDiff <= 0) continue; // only flag if user book beats consensus

      // Line gap alert
      const lineGapAlert = prop.lineGap !== null &&
        prop.lineGap >= PROP_CONFIG.MIN_LINE_GAP;

      // Juice gap alert
      const juiceGapAlert = prop.juiceGap !== null &&
        prop.juiceGap >= PROP_CONFIG.MIN_JUICE_GAP;

      // Line diff vs consensus
      const lineDiffVsConsensus = consensusLine !== null && bestOffer.line !== null
        ? Math.round((bestOffer.line - consensusLine) * 10) / 10
        : null;

      // Build signals list
      const signals: string[] = [];
      if (priceDiff >= 5) signals.push('PRICE_EDGE');
      if (lineGapAlert) signals.push('LINE_GAP');
      if (juiceGapAlert) signals.push('JUICE_GAP');
      if (lineDiffVsConsensus !== null && Math.abs(lineDiffVsConsensus) >= 1.0)
        signals.push('LINE_VS_CONSENSUS');

      // Require at least 2 signals
      if (signals.length < 2) continue;

      // Check if either team in this game is on a back-to-back from context
      const ctx = contextMap?.get(prop.eventId ?? '');
      const isB2B = !!(ctx?.homeRest?.isBackToBack || ctx?.awayRest?.isBackToBack);

      const score = scoreProp(
        priceDiff, prop.lineGap, prop.juiceGap,
        prop.bookCount, isB2B && side === 'Over'
      );

      // Build reasoning
      const reasoning: string[] = [];

      if (priceDiff >= 10)
        reasoning.push(`[$] ${getBookmakerDisplayName(bestOffer.bookmakerKey)} is ${fmtPrice(priceDiff)} better than market avg -- strong juice value`);
      else if (priceDiff >= 5)
        reasoning.push(`[$] ${fmtPrice(priceDiff)} better than consensus at ${getBookmakerDisplayName(bestOffer.bookmakerKey)}`);

      if (lineGapAlert)
        reasoning.push(`? ${prop.lineGap} pt line gap across books -- always take the better number`);

      if (juiceGapAlert)
        reasoning.push(`[$] ${prop.juiceGap} pt juice gap -- significant price inefficiency`);

      if (lineDiffVsConsensus !== null && Math.abs(lineDiffVsConsensus) >= 1.0)
        reasoning.push(`[~] Line ${lineDiffVsConsensus > 0 ? 'higher' : 'lower'} than market consensus by ${Math.abs(lineDiffVsConsensus)} pts`);

      // Show all book lines for this prop
      if (prop.overOffers.length > 1) {
        const lineSpread = prop.overOffers.map(o =>
          `${getBookmakerDisplayName(o.bookmakerKey)}: ${o.line}`
        ).join(' | ');
        reasoning.push(`? All lines: ${lineSpread}`);
      }

      // Stale book warning
      if (prop.hasStaleBooks && prop.staleBooks.length > 0) {
        reasoning.push(`[!] STALE: ${prop.staleBooks.join(', ')} may not have updated in 6+ hrs -- verify line before betting`);
      }

      scored.push({
        intelligenceScore: 0,
        rank: 0,
        grade: scoreToGrade(score),
        score,
        tier: getTier(score, signals.length),
        matchup: prop.matchup,
        gameTime: prop.gameTime,
        hoursUntilGame: Math.round(hours * 10) / 10,
        sport: sportKey === 'basketball_nba' ? 'NBA'
                     : sportKey === 'americanfootball_nfl' ? 'NFL'
                     : sportKey === 'baseball_mlb' ? 'MLB'
                     : sportKey === 'icehockey_nhl' ? 'NHL'
                     : 'NBA',
        playerName: prop.playerName,
        team: prop.team ?? '',
        position: prop.position ?? '',
        sportKey,
        market: prop.marketLabel,
        statType: prop.marketKey,
        eventId: prop.eventId ?? '',
        side,
        line: bestOffer.line,
        bestUserBook: getBookmakerDisplayName(bestOffer.bookmakerKey),
        bestUserPrice: bestOffer.price,
        altUserBook: altOffer ? getBookmakerDisplayName(altOffer.bookmakerKey) : '',
        altUserPrice: altOffer?.price ?? null,
        consensusLine,
        consensusPrice,
        lineGap: prop.lineGap,
        juiceGap: prop.juiceGap,
        bookCount: prop.bookCount,
        priceDiff: Math.round(priceDiff),
        lineDiffVsConsensus,
        signals,
        signalCount: signals.length,
        lineGapAlert,
        juiceGapAlert,
        isBackToBack: isB2B,
        fullReasoning: reasoning,
      });
    }
  }

  // Sort by score, deduplicate same player same market (keep best side)
  scored.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const gameCount = new Map<string, number>();
  const deduped: ScoredProp[] = [];
  const maxPerGame = (PROP_CONFIG as any).MAX_PROPS_PER_GAME ?? 2;

  for (const p of scored) {
    // Dedupe same player + market
    const key = `${p.playerName}__${p.market}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Per-game cap -- force slate diversity
    const gameKey = p.matchup;
    const count = gameCount.get(gameKey) ?? 0;
    if (count >= maxPerGame) continue;
    gameCount.set(gameKey, count + 1);

    deduped.push(p);
  }

  deduped.forEach((p, i) => { p.rank = i + 1; });
  return deduped;
}

// ------------------------------------
// Print prop Top 5
// ------------------------------------

export function printTopProps(props: ScoredProp[], sportKey = 'basketball_nba'): void {
  // Show intelligence-enhanced output
  const time = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  const sportLabel = sportKey === 'baseball_mlb'         ? 'MLB'
                   : sportKey === 'icehockey_nhl'        ? 'NHL'
                   : sportKey === 'americanfootball_nfl' ? 'NFL'
                   : 'NBA';

  console.log('\n');
  console.log('+==============================================================+');
  console.log(`|              ${sportLabel} PLAYER PROPS -- TOP EDGES                   |`);
  console.log(`|  ${time.padEnd(60)}|`);
  console.log('|  FanDuel + BetMGM only  |  Min 2 signals required           |');
  console.log('+==============================================================+');

  if (props.length === 0) {
    console.log('\n  No prop edges found meeting minimum signal requirements.');
    console.log('  Lines may be efficient -- check back closer to tip-off.\n');
    return;
  }

  const betTier   = props.filter(p => p.tier === 'BET');
  const leanTier  = props.filter(p => p.tier === 'LEAN');
  const monTier   = props.filter(p => p.tier === 'MONITOR');

  function printProp(p: ScoredProp) {
    const gradeBar =
      p.grade === 'A+' ? '[##########]' : p.grade === 'A'  ? '[#########-]' :
      p.grade === 'B+' ? '[#######---]' : p.grade === 'B'  ? '[######----]' :
      p.grade === 'C+' ? '[####------]' : '[###-------]';

    // Step 3: tier here is pre-risk (raw signal only).
    // [HOT] BET is reserved for the post-risk Final Card only.
    const tierIcon = p.tier === 'BET' ? '[SIG] BET' : p.tier === 'LEAN' ? '[OK] LEAN' : '[~] MONITOR';
    const hours = p.hoursUntilGame < 2 ? `~${Math.round(p.hoursUntilGame * 60)}min` : `~${Math.round(p.hoursUntilGame)}hrs`;

    console.log(`\n  +---------------------------------------------------------`);
    console.log(`  |  #${String(p.rank).padEnd(3)} ${tierIcon.padEnd(14)} ${p.matchup}`);
    console.log(`  |  [CLK] ${hours.padEnd(14)} Raw Score: ${p.grade}  ${gradeBar}  (${p.score}/100)`);
    // Show base signals + top intelligence signals
    const intelSigs = ((p as any).prediction?.signals ?? [])
      .filter((s: any) => s.magnitude === 'high' || s.magnitude === 'medium')
      .slice(0, 3)
      .map((s: any) => s.type);
    const allSigNames = [...new Set([...p.signals, ...intelSigs])];
    console.log(`  |  ${allSigNames.length} signals: ${allSigNames.slice(0,5).join(', ')}`);
    console.log(`  +---------------------------------------------------------`);
    const sportEmoji = p.sport === 'NFL' ? '[NFL]'
      : p.sport === 'MLB' ? '[MLB]'
      : p.sport === 'NHL' ? '[NHL]'
      : '[NBA]';
    const teamStr = (p as any).team ? ` (${(p as any).team})` : '';
    const posStr = (p as any).position ? ` -- ${(p as any).position}` : '';
    console.log(`  |  ${sportEmoji} ${p.playerName}${teamStr}${posStr}  --  ${p.market}`);
    console.log(`  |  [OK] Bet  : ${p.side.toUpperCase()} ${p.line}`);
    const predictionSignals = ((p as any).prediction?.signals ?? []) as Array<{ type: string; magnitude: string }>;
    const nonMarketSignalNames = [...new Set(
      predictionSignals
        .filter((s) => !MARKET_STRUCTURE_SIGNALS.has(s.type))
        .filter((s) => s.magnitude === 'high' || s.magnitude === 'medium')
        .map((s) => s.type)
    )];
    const contextSignalNames = p.sportKey === 'basketball_nba'
      ? nonMarketSignalNames.filter((name) => NBA_PREDICTIVE_CONTEXT_SIGNALS.has(name))
      : p.sportKey === 'baseball_mlb'
        ? nonMarketSignalNames.filter((name) => MLB_PREDICTIVE_CONTEXT_SIGNALS.has(name))
        : p.sportKey === 'icehockey_nhl'
          ? nonMarketSignalNames.filter((name) => NHL_PREDICTIVE_CONTEXT_SIGNALS.has(name))
        : [];
    if (
      p.sportKey === 'basketball_nba' &&
      p.projectedStat !== undefined &&
      p.projectionEdge !== undefined
    ) {
      const projectionEdge = p.projectionEdge > 0 ? `+${p.projectionEdge}` : `${p.projectionEdge}`;
      const probability = p.probability !== undefined ? `${(p.probability * 100).toFixed(1)}%` : 'n/a';
      const impliedProbability = p.impliedProbability !== undefined ? `${(p.impliedProbability * 100).toFixed(1)}%` : 'n/a';
      const trueEdge = p.trueEdge !== undefined
        ? `${p.trueEdge >= 0 ? '+' : ''}${(p.trueEdge * 100).toFixed(1)}%`
        : 'n/a';
      const edgeConfidence = p.edgeConfidence !== undefined
        ? `${(p.edgeConfidence * 100).toFixed(0)}%`
        : 'n/a';
      console.log(`  |  [AI] Projection: ${p.projectedStat} | Line: ${p.line} | Projection Edge: ${projectionEdge}`);
      console.log(`  |  [AI] Model Prob: ${probability} | Implied Prob: ${impliedProbability} | True Edge: ${trueEdge}`);
      console.log(`  |  [AI] Model completeness: ${((p.modelCompleteness ?? 0) * 100).toFixed(0)}% | Minutes confidence: ${((p.nbaMinutesConfidence ?? 0) * 100).toFixed(0)}% | Edge confidence: ${edgeConfidence}`);
      console.log(`  |  [AI] Non-market Signals: ${nonMarketSignalNames.length}${nonMarketSignalNames.length ? ` -> ${nonMarketSignalNames.join(', ')}` : ''}`);
      console.log(`  |  [AI] Context Signals: ${contextSignalNames.length}${contextSignalNames.length ? ` -> ${contextSignalNames.join(', ')}` : ''}`);
    } else if (p.sportKey === 'baseball_mlb') {
      console.log(`  |  [AI] Context Signals: ${contextSignalNames.length}${contextSignalNames.length ? ` -> ${contextSignalNames.join(', ')}` : ''}`);
    } else if (p.sportKey === 'icehockey_nhl') {
      console.log(`  |  [AI] Context Signals: ${contextSignalNames.length}${contextSignalNames.length ? ` -> ${contextSignalNames.join(', ')}` : ''}`);
    }
    const brProp = parseFloat(process.env.BANKROLL ?? '0');
    const kProp  = brProp > 0 ? `Kelly: 1.5% = $${Math.round(brProp * 0.015)}` : 'Kelly: 1-2% of bankroll';
    console.log(`  |  [$] ${kProp}`);
    console.log(`  |  [PIN] Best : ${p.bestUserBook.padEnd(10)}  ${fmtPrice(p.bestUserPrice)}`);
    if (p.altUserBook && p.altUserPrice !== null) {
      console.log(`  |  [PIN] Alt  : ${p.altUserBook.padEnd(10)}  ${fmtPrice(p.altUserPrice)}`);
    }
    if (p.lineGapAlert) {
      console.log(`  |  ? LINE GAP: ${p.lineGap} pts between books`);
    }
    console.log(`  |  [~] Consensus: ${p.consensusLine ?? 'N/A'}  |  ${p.bookCount} books  |  Edge: ${fmtPrice(p.priceDiff)}`);
    console.log(`  +---------------------------------------------------------`);
    for (const r of p.fullReasoning) console.log(`  |  ${r}`);
    // Kelly sizing
    const kelly = (p as any).prediction?.kelly;
    if (kelly?.isPositiveEV) {
      console.log(`  |  [$] KELLY: Bet ${kelly.recommendedBetPct}% of bankroll (${kelly.recommendedUnits}u) | EV: +$${kelly.evPerUnit}/100 | Edge: ${kelly.edge}%`);
    }
    console.log(`  +---------------------------------------------------------`);
  }

  // Step 6: Output sections — A) actionable signal, B) monitor, C) note
  // HOT BET label is post-risk only (Final Card). This is the raw signal scan.
  if (betTier.length > 0) {
    console.log(`\n  ── A) RAW SIGNAL BET (${betTier.length}) — pre-risk, see Final Card ──────────────`);
    betTier.forEach(printProp);
  }
  if (leanTier.length > 0) {
    console.log(`\n  ── A) RAW SIGNAL LEAN (${leanTier.length}) ─────────────────────────────────────`);
    leanTier.forEach(printProp);
  }
  if (monTier.length > 0) {
    console.log(`\n  ── B) MONITOR (${monTier.length}) ───────────────────────────────────────────────`);
    monTier.forEach(printProp);
  }

  console.log(`\n  RAW SIGNAL SCAN — analysis input only. Final Card below is the recommendation.`);
  console.log(`  Props: FanDuel + BetMGM  |  Min 2 signals  |  [BET/A] label only in Final Card`);
  console.log(`  NOTE: Always verify player status before placing prop bets\n`);
}
