// ============================================================
// src/services/propIntelligence.ts
// Full prop prediction engine
// Combines: player form, usage, matchups, pace, B2B, lineup
// Produces an actual prediction vs the posted line
// ============================================================

import { PlayerProfile, findPlayerId, getPlayerProfile } from './playerStats';
import { buildMatchupPackage, GameMatchupPackage } from './propMatchups';
import {
  assessBlowoutRisk,
  getMarketEfficiencyForProp,
  assessPublicStarBias,
  assessFoulTroubleRisk,
  assessOvertimeRisk,
  calculateKelly,
  scoreToProbability,
  BlowoutRisk, MarketEfficiencyByPropType, PublicStarBias,
  FoulTroubleRisk, OvertimeRisk, KellyCriterion,
} from './propEdgeFactors';

export interface PropPrediction {
  playerName: string;
  team: string;
  position: string;
  statType: string;
  sport?: string;
  homeTeam?: string;
  awayTeam?: string;
  // Posted line
  postedLine: number;
  side: 'over' | 'under';
  // Our prediction
  predictedValue: number;       // what we think will happen
  predictedEdge: number;        // predicted - posted (positive = lean over)
  confidence: 'high' | 'medium' | 'low';
  // Individual signals
  signals: PropSignal[];
  // Net score adjustment (added to base prop score)
  scoreAdjustment: number;
  // Summary
  summary: string;
  shouldBet: boolean;
  // Kelly sizing (populated when americanOdds is provided)
  kelly?: KellyCriterion;
  // Projection fields (NBA props only)
  projectedStat?: number;
  probabilityOver?: number;
  probabilityUnder?: number;
  impliedProbability?: number;
  modelCompleteness?: number;
  nbaMinutesStable?: boolean;
  nbaMinutesConfidence?: number;
  nbaRoleStabilityScore?: number;
  supportedNBAProjection?: boolean;
}

export interface PropSignal {
  type: string;
  detail: string;
  impact: 'positive' | 'negative' | 'neutral';
  magnitude: 'high' | 'medium' | 'low';
  side: 'over' | 'under' | 'neutral';
  scoreContribution: number;   // points added to final score
}

// ------------------------------------
// Map prop stat types to player profile fields
// ------------------------------------

function getStatFromProfile(profile: PlayerProfile, statType: string): {
  l5: number; season: number; l10: number;
} {
  const t = statType.toLowerCase();
  if (t.includes('point') || t === 'pts') {
    return { l5: profile.l5PPG, season: profile.seasonPPG, l10: profile.l10PPG };
  }
  if (t.includes('rebound') || t === 'reb') {
    return { l5: profile.l5RPG, season: profile.seasonRPG, l10: profile.seasonRPG };
  }
  if (t.includes('assist') || t === 'ast') {
    return { l5: profile.l5APG, season: profile.seasonAPG, l10: profile.seasonAPG };
  }
  if (t.includes('three') || t === '3pm' || t === 'threes') {
    return { l5: profile.l5_3PG, season: profile.season3PG, l10: profile.season3PG };
  }
  // PRA (points + rebounds + assists)
  if (t.includes('pra') || t.includes('points+')) {
    const seasonPRA = profile.seasonPPG + profile.seasonRPG + profile.seasonAPG;
    return {
      l5: profile.l5PPG + profile.l5RPG + profile.l5APG,
      season: seasonPRA,
      l10: seasonPRA,
    };
  }
  return { l5: profile.l5PPG, season: profile.seasonPPG, l10: profile.l10PPG };
}

interface NBAProjectionContext {
  statKey: 'points' | 'rebounds' | 'assists' | 'threes';
  line: number;
  projectedMinutes: number;
  seasonMinutesAvg?: number;
  last10MinutesAvg?: number;
  last5MinutesAvg?: number;
  last3MinutesAvg?: number;
  usageRate?: number | null;
  weightedStatPerMinute: number;
  seasonStatPerMinute?: number;
  last10StatPerMinute?: number;
  last5StatPerMinute?: number;
  teamPaceAdj: number;
  usageOrRoleAdjustment: number;
  matchupAdjustment: number;
  restAdjustment: number;
  homeAwayAdjustment: number;
  teammateShotMakingAdjustment?: number;
  stdDevInput?: number;
  impliedProbability?: number;
  projectedFromRecentBaseline?: boolean;
  threeVarianceBoost?: number;
  minutesTrendPct?: number;
  minutesTrend?: 'rising' | 'falling' | 'stable';
  recentGamesCount?: number;
  recentShotAttemptsPerMinute?: number;
  seasonShotAttemptsPerMinute?: number;
  minutesVolatility?: number;
  minutesStable?: boolean;
  minutesConfidence?: number;
  roleStabilityScore?: number;
  roleAdjustment?: number;
  atsConfidenceDelta?: number;
}

interface NBAProjectionResult {
  projectedStat: number;
  probabilityOver: number;
  probabilityUnder: number;
  impliedProbability: number;
  modelCompleteness: number;
  signals: PropSignal[];
  minutesStable: boolean;
  minutesConfidence: number;
  roleStabilityScore: number;
  supportedMarket: boolean;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedAverage(weightedValues: Array<{ value: number; weight: number }>): number {
  const valid = weightedValues.filter(entry => Number.isFinite(entry.value) && entry.value > 0 && entry.weight > 0);
  if (valid.length === 0) return 0;
  const totalWeight = valid.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return 0;
  return valid.reduce((sum, entry) => sum + (entry.value * entry.weight), 0) / totalWeight;
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = avg(values);
  const variance = avg(values.map(value => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function roundToTenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundToThousandths(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeNBAProjectionStatType(statType: string): 'points' | 'rebounds' | 'assists' | 'threes' | null {
  const t = statType.toLowerCase();
  if (t === 'player_points' || t === 'points' || t === 'pts') return 'points';
  if (t === 'player_rebounds' || t === 'rebounds' || t === 'reb') return 'rebounds';
  if (t === 'player_assists' || t === 'assists' || t === 'ast') return 'assists';
  if (t === 'player_threes' || t === 'threes' || t === '3pm' || t === '3-pointers made') return 'threes';
  return null;
}

function isSupportedNBAProjectionMarket(statType: string): boolean {
  return normalizeNBAProjectionStatType(statType) !== null;
}

function getStatValue(game: PlayerProfile['recentGames'][number], statKey: 'points' | 'rebounds' | 'assists' | 'threes'): number {
  if (statKey === 'points') return game.points;
  if (statKey === 'rebounds') return game.rebounds;
  if (statKey === 'assists') return game.assists;
  return game.threes;
}

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCDF(z: number): number {
  return clamp01(0.5 * (1 + erf(z / Math.sqrt(2))));
}

function calcProbability(projectedStat: number, line: number, standardDeviation: number): number {
  const safeStdDev = Math.max(0.75, standardDeviation);
  const z = (line - projectedStat) / safeStdDev;
  return roundToThousandths(1 - normalCDF(z));
}

function computeCompleteness(ctx: NBAProjectionContext): number {
  let completeness = 0;

  if (ctx.projectedMinutes > 0) completeness += 0.25;
  if (ctx.weightedStatPerMinute > 0) completeness += 0.20;
  if ((ctx.seasonStatPerMinute ?? 0) > 0) completeness += 0.15;
  if (ctx.usageRate !== null && ctx.usageRate !== undefined) completeness += 0.15;
  if (ctx.matchupAdjustment !== 1) completeness += 0.10;
  if ((ctx.teamPaceAdj ?? 1) !== 1) completeness += 0.05;
  if ((ctx.restAdjustment ?? 1) !== 1 || (ctx.homeAwayAdjustment ?? 1) !== 1) completeness += 0.05;
  if ((ctx.stdDevInput ?? 0) > 0) completeness += 0.05;
  if (ctx.minutesStable === false) completeness -= 0.15;
  if ((ctx.minutesConfidence ?? 0) < 0.7) completeness -= 0.05;

  return roundToThousandths(clampRange(completeness, 0, 1));
}

function deriveSignals(
  ctx: NBAProjectionContext,
  projectedStat: number,
  modelCompleteness: number
): PropSignal[] {
  const signals: PropSignal[] = [];
  const rawProjectionEdge = roundToTenths(projectedStat - ctx.line);
  const projectionMagnitude = Math.abs(rawProjectionEdge);
  const projectionSide: 'over' | 'under' = rawProjectionEdge >= 0 ? 'over' : 'under';

  if (projectionMagnitude >= 1.0) {
    signals.push({
      type: 'NBA_PROJECTION_EDGE',
      detail: `Projection ${projectedStat} vs line ${ctx.line} (${rawProjectionEdge > 0 ? '+' : ''}${rawProjectionEdge})`,
      impact: 'positive',
      magnitude: projectionMagnitude >= 2.5 ? 'high' : 'medium',
      side: projectionSide,
      scoreContribution: projectionMagnitude >= 2.5 ? 16 : 10,
    });
  }

  const paceDelta = (ctx.teamPaceAdj ?? 1) - 1;
  if (Math.abs(paceDelta) >= 0.05) {
    const fasterGame = paceDelta > 0;
    signals.push({
      type: 'PACE_PROJECTION',
      detail: `Pace adjustment ${(ctx.teamPaceAdj ?? 1).toFixed(2)}x (${fasterGame ? '+' : ''}${(paceDelta * 100).toFixed(0)}%)`,
      impact: fasterGame ? 'positive' : 'negative',
      magnitude: Math.abs(paceDelta) >= 0.08 ? 'high' : 'medium',
      side: fasterGame ? 'over' : 'under',
      scoreContribution: fasterGame ? 8 : -8,
    });
  }

  const minutesDelta = ctx.projectedMinutes - (ctx.seasonMinutesAvg ?? 0);
  if (Math.abs(minutesDelta) >= 2) {
    const risingMinutes = minutesDelta > 0;
    signals.push({
      type: 'MINUTES_PROJECTION',
      detail: `Projected minutes ${ctx.projectedMinutes.toFixed(1)} vs season ${(ctx.seasonMinutesAvg ?? 0).toFixed(1)} (${minutesDelta > 0 ? '+' : ''}${minutesDelta.toFixed(1)})`,
      impact: risingMinutes ? 'positive' : 'negative',
      magnitude: Math.abs(minutesDelta) >= 4 ? 'high' : 'medium',
      side: risingMinutes ? 'over' : 'under',
      scoreContribution: risingMinutes ? 8 : -8,
    });
  }

  if (modelCompleteness >= 0.75) {
    signals.push({
      type: 'PROJECTION_COMPLETE',
      detail: `Projection completeness ${(modelCompleteness * 100).toFixed(0)}%`,
      impact: 'positive',
      magnitude: 'medium',
      side: 'neutral',
      scoreContribution: 4,
    });
  }

  if ((ctx.usageOrRoleAdjustment ?? 1) >= 1.05 || (ctx.recentShotAttemptsPerMinute ?? 0) > (ctx.seasonShotAttemptsPerMinute ?? 0)) {
    signals.push({
      type: 'USAGE_SHOT_VOLUME',
      detail: `Usage/role adjustment ${(ctx.usageOrRoleAdjustment ?? 1).toFixed(2)}x with recent shot volume ${(ctx.recentShotAttemptsPerMinute ?? 0).toFixed(2)}/min`,
      impact: 'positive',
      magnitude: (ctx.usageOrRoleAdjustment ?? 1) >= 1.08 ? 'high' : 'medium',
      side: 'over',
      scoreContribution: (ctx.usageOrRoleAdjustment ?? 1) >= 1.08 ? 10 : 6,
    });
  }

  if ((ctx.minutesStable ?? true) === false) {
    signals.push({
      type: 'MINUTES_VOLATILITY',
      detail: `Minutes volatility ${(ctx.minutesVolatility ?? 0).toFixed(1)} with ${ctx.minutesTrend ?? 'unknown'} role trend`,
      impact: 'negative',
      magnitude: (ctx.minutesVolatility ?? 0) >= 5 ? 'high' : 'medium',
      side: 'neutral',
      scoreContribution: (ctx.minutesVolatility ?? 0) >= 5 ? -14 : -9,
    });
  } else if ((ctx.minutesConfidence ?? 0) >= 0.7) {
    signals.push({
      type: 'ROLE_STABILITY',
      detail: `Stable role profile with ${Math.round((ctx.minutesConfidence ?? 0) * 100)}% minutes confidence`,
      impact: 'positive',
      magnitude: (ctx.roleStabilityScore ?? 0) >= 0.8 ? 'high' : 'medium',
      side: 'neutral',
      scoreContribution: (ctx.roleStabilityScore ?? 0) >= 0.8 ? 8 : 5,
    });
  }

  if (Math.abs((ctx.atsConfidenceDelta ?? 0)) >= 0.005) {
    signals.push({
      type: 'ATS_NOTE',
      detail: `ATS context note ${(ctx.atsConfidenceDelta ?? 0) > 0 ? '+' : ''}${((ctx.atsConfidenceDelta ?? 0) * 100).toFixed(1)}% confidence`,
      impact: (ctx.atsConfidenceDelta ?? 0) > 0 ? 'positive' : 'negative',
      magnitude: 'low',
      side: 'neutral',
      scoreContribution: 0,
    });
  }

  return signals;
}

function buildNBAProjection(ctx: NBAProjectionContext): NBAProjectionResult {
  const rawProjection =
    ctx.projectedMinutes *
    ctx.weightedStatPerMinute *
    ctx.teamPaceAdj *
    ctx.usageOrRoleAdjustment *
    ctx.matchupAdjustment *
    ctx.restAdjustment *
    ctx.homeAwayAdjustment *
    (ctx.teammateShotMakingAdjustment ?? 1);
  const projectedStat = roundToTenths(rawProjection);
  const stdDevBase = Math.max(2.5, projectedStat * 0.18);
  const adjustedStdDev = Math.max(
    ctx.statKey === 'threes' ? 1.4 : 0.75,
    (ctx.stdDevInput ?? stdDevBase) * (ctx.threeVarianceBoost ?? 1)
  );
  const probabilityOver = calcProbability(projectedStat, ctx.line, adjustedStdDev);
  const modelCompleteness = computeCompleteness(ctx);
  const impliedProbability = roundToThousandths(ctx.impliedProbability ?? 0.524);

  return {
    projectedStat,
    probabilityOver,
    probabilityUnder: roundToThousandths(1 - probabilityOver),
    impliedProbability,
    modelCompleteness,
    signals: deriveSignals(
      ctx,
      projectedStat,
      modelCompleteness
    ),
    minutesStable: ctx.minutesStable ?? true,
    minutesConfidence: roundToThousandths(ctx.minutesConfidence ?? 0.5),
    roleStabilityScore: roundToThousandths(ctx.roleStabilityScore ?? 0.5),
    supportedMarket: true,
  };
}

// ------------------------------------
// Generate prediction for one prop
// ------------------------------------

export function generatePropPrediction(
  playerName: string,
  team: string,
  position: string,
  statType: string,
  postedLine: number,
  side: 'over' | 'under',
  profile: PlayerProfile | null,
  matchup: GameMatchupPackage | null,
  isBackToBack: boolean = false,
  isHome: boolean = false,
  keyTeammateOut: boolean = false,
  isCrossCountryTravel: boolean = false,
  powerComparison: any = null,
  weather: any = null,
  teamTotal: number | null = null,
  leagueAvgTeamTotal: number = 113.5,
  gameSpread: number | null = null,        // for blowout + OT risk
  gameTotal: number | null = null,         // for OT risk
  marketKey: string = '',                  // for market efficiency
  americanOdds: number = -110,            // for Kelly sizing
  sportKey: string = 'basketball_nba',    // for blowout/market/foul/OT signals
  homeTeam: string = '',                  // for blowout risk
  awayTeam: string = '',                  // for blowout risk
  hasSharpSteam: boolean = false,         // signal 16
  atsSituation: any = null,              // signal 17
  playerTeamBetPct: number | null = null // signal 18
): PropPrediction {
  const signals: PropSignal[] = [];
  let scoreAdjustment = 0;
  let predictedValue = postedLine; // default = line, no edge
  let nbaProjection: NBAProjectionResult | undefined;

  // -- Signal 1: Recent form vs season average -----------------
  if (profile) {
    const stats = getStatFromProfile(profile, statType);
    predictedValue = stats.l5 > 0 ? stats.l5 : stats.season;

    const formDiff = stats.l5 - stats.season;
    const formDiffVsLine = stats.l5 - postedLine;

    if (Math.abs(formDiff) >= 2) {
      const isHot = formDiff > 0;
      signals.push({
        type: 'RECENT_FORM',
        detail: `L5 avg: ${stats.l5} vs season avg: ${stats.season} (${formDiff > 0 ? '+' : ''}${Math.round(formDiff * 10) / 10})`,
        impact: isHot ? 'positive' : 'negative',
        magnitude: Math.abs(formDiff) >= 4 ? 'high' : 'medium',
        side: isHot ? 'over' : 'under',
        scoreContribution: isHot ? (Math.abs(formDiff) >= 4 ? 15 : 8) : (Math.abs(formDiff) >= 4 ? -12 : -6),
      });
      scoreAdjustment += signals[signals.length - 1].scoreContribution;
    }

    // L5 vs posted line is the key signal
    if (Math.abs(formDiffVsLine) >= 2.5) {
      const leanOver = formDiffVsLine > 0;
      signals.push({
        type: 'FORM_VS_LINE',
        detail: `L5 avg ${stats.l5} vs posted line ${postedLine} -- gap: ${formDiffVsLine > 0 ? '+' : ''}${Math.round(formDiffVsLine * 10) / 10}`,
        impact: leanOver ? 'positive' : 'negative',
        magnitude: Math.abs(formDiffVsLine) >= 5 ? 'high' : 'medium',
        side: leanOver ? 'over' : 'under',
        scoreContribution: leanOver ? (Math.abs(formDiffVsLine) >= 5 ? 20 : 12) : (Math.abs(formDiffVsLine) >= 5 ? -18 : -10),
      });
      scoreAdjustment += signals[signals.length - 1].scoreContribution;
    }

    // -- Signal 2: Minutes trend -----------------------------
    if (profile.minutesTrend !== 'stable' && Math.abs(profile.minutesTrendPct) >= 10) {
      const isRising = profile.minutesTrend === 'rising';
      signals.push({
        type: 'MINUTES_TREND',
        detail: `Minutes ${isRising ? 'up' : 'down'} ${Math.abs(profile.minutesTrendPct)}% in L5 vs prior 5 (${profile.l5MPG} vs ${profile.l10MPG})`,
        impact: isRising ? 'positive' : 'negative',
        magnitude: Math.abs(profile.minutesTrendPct) >= 20 ? 'high' : 'medium',
        side: isRising ? 'over' : 'under',
        scoreContribution: isRising ? 10 : -10,
      });
      scoreAdjustment += signals[signals.length - 1].scoreContribution;
      // Adjust prediction
      const minutesAdj = (profile.minutesTrendPct / 100) * predictedValue * 0.5;
      predictedValue = Math.round((predictedValue + minutesAdj) * 10) / 10;
    }

    // -- Signal 3: Home/away split --------------------------
    if (isHome && profile.homePPG !== null) {
      const homeDiff = profile.homePPG - profile.seasonPPG;
      if (Math.abs(homeDiff) >= 2) {
        signals.push({
          type: 'HOME_SPLIT',
          detail: `${playerName} averages ${profile.homePPG} at home vs ${profile.seasonPPG} overall (${homeDiff > 0 ? '+' : ''}${Math.round(homeDiff * 10) / 10})`,
          impact: homeDiff > 0 ? 'positive' : 'negative',
          magnitude: 'low',
          side: homeDiff > 0 ? 'over' : 'under',
          scoreContribution: homeDiff > 0 ? 5 : -5,
        });
        scoreAdjustment += signals[signals.length - 1].scoreContribution;
      }
    } else if (!isHome && profile.awayPPG !== null) {
      const awayDiff = profile.awayPPG - profile.seasonPPG;
      if (Math.abs(awayDiff) >= 2) {
        signals.push({
          type: 'AWAY_SPLIT',
          detail: `${playerName} averages ${profile.awayPPG} on road vs ${profile.seasonPPG} overall`,
          impact: awayDiff > 0 ? 'positive' : 'negative',
          magnitude: 'low',
          side: awayDiff > 0 ? 'over' : 'under',
          scoreContribution: awayDiff > 0 ? 5 : -5,
        });
        scoreAdjustment += signals[signals.length - 1].scoreContribution;
      }
    }
  }

  // -- Signal 4: Matchup quality ---------------------------
  if (matchup) {
    const playerMatchups = matchup.matchups.get(playerName) ?? [];
    for (const m of playerMatchups) {
      if (m.overEdge || m.underEdge) {
        signals.push({
          type: 'MATCHUP',
          detail: m.edgeDetail,
          impact: m.overEdge ? 'positive' : 'negative',
          magnitude: (m.matchupGrade === 'elite' || m.matchupGrade === 'terrible') ? 'high' : 'medium',
          side: m.overEdge ? 'over' : 'under',
          scoreContribution: m.overEdge
            ? (m.matchupGrade === 'elite' ? 15 : 8)
            : (m.matchupGrade === 'terrible' ? -12 : -7),
        });
        scoreAdjustment += signals[signals.length - 1].scoreContribution;
      }
    }

    // -- Signal 5: Pace / game total ------------------------
    if (matchup.gameTotalVsLeagueAvg !== null && Math.abs(matchup.gameTotalVsLeagueAvg) >= 5) {
      const isHighPace = matchup.gameTotalVsLeagueAvg > 0;
      const gameTotalStr = matchup.gameTotal ? `Game total: ${matchup.gameTotal}` : '';
      signals.push({
        type: 'PACE_CORRELATION',
        detail: `${gameTotalStr} -- ${isHighPace ? 'high' : 'low'} pace game (${matchup.gameTotalVsLeagueAvg > 0 ? '+' : ''}${Math.round(matchup.gameTotalVsLeagueAvg)} vs avg) -- ${isHighPace ? 'lean over counting stats' : 'lean under counting stats'}`,
        impact: isHighPace ? 'positive' : 'negative',
        magnitude: Math.abs(matchup.gameTotalVsLeagueAvg) >= 10 ? 'high' : 'medium',
        side: isHighPace ? 'over' : 'under',
        scoreContribution: isHighPace ? 8 : -8,
      });
      scoreAdjustment += signals[signals.length - 1].scoreContribution;
      // Adjust prediction for pace
      predictedValue = Math.round(predictedValue * matchup.impliedPaceMultiplier * 10) / 10;
    }
  }

  // -- Signal 6: Back-to-back fatigue ------------------------
  if (isBackToBack) {
    signals.push({
      type: 'BACK_TO_BACK',
      detail: `Player on B2B -- fatigue typically reduces output 1-3 pts`,
      impact: 'negative',
      magnitude: 'medium',
      side: 'under',
      scoreContribution: -10,
    });
    scoreAdjustment += -10;
    predictedValue = Math.max(0, predictedValue - 2);
  }

  // -- Signal 6b: Prop streak --------------------------------
  if (profile?.propStreaks) {
    const statKey = statType.toLowerCase().replace('player_', '').replace('points', 'points').replace('rebounds', 'rebounds').replace('assists', 'assists').replace('threes', 'threes').replace('3-pointers made', 'threes');
    const streak = profile.propStreaks[statKey] ?? 0;
    if (Math.abs(streak) >= 3) {
      const isHotStreak = streak > 0;
      signals.push({
        type: 'PROP_STREAK',
        detail: `${playerName} has gone ${isHotStreak ? 'over' : 'under'} in ${Math.abs(streak)} of last ${Math.min(Math.abs(streak), 10)} games for ${statType}`,
        impact: isHotStreak ? 'positive' : 'negative',
        magnitude: Math.abs(streak) >= 5 ? 'high' : 'medium',
        side: isHotStreak ? 'over' : 'under',
        scoreContribution: isHotStreak ? (Math.abs(streak) >= 5 ? 15 : 10) : (Math.abs(streak) >= 5 ? -12 : -8),
      });
      scoreAdjustment += signals[signals.length - 1].scoreContribution;
    }
  }

  // -- Signal 6c: Team total (implied team scoring) -----------
  if (teamTotal !== null) {
    const teamTotalVsAvg = teamTotal - leagueAvgTeamTotal;
    if (Math.abs(teamTotalVsAvg) >= 4) {
      const isHighScoring = teamTotalVsAvg > 0;
      signals.push({
        type: 'TEAM_TOTAL',
        detail: `${team} implied team total ${teamTotal} (${teamTotalVsAvg > 0 ? '+' : ''}${Math.round(teamTotalVsAvg)} vs avg) -- ${isHighScoring ? 'high scoring environment' : 'low scoring environment'}`,
        impact: isHighScoring ? 'positive' : 'negative',
        magnitude: Math.abs(teamTotalVsAvg) >= 8 ? 'high' : 'medium',
        side: isHighScoring ? 'over' : 'under',
        scoreContribution: isHighScoring ? 10 : -10,
      });
      scoreAdjustment += signals[signals.length - 1].scoreContribution;
      predictedValue = Math.round((predictedValue * (1 + teamTotalVsAvg / leagueAvgTeamTotal * 0.3)) * 10) / 10;
    }
  }

  // -- Signal 7: Key teammate out -- usage shift --------------
  if (keyTeammateOut) {
    signals.push({
      type: 'USAGE_SHIFT',
      detail: `Key teammate out -- ${playerName} likely to see increased usage`,
      impact: 'positive',
      magnitude: 'medium',
      side: 'over',
      scoreContribution: 8,
    });
    scoreAdjustment += 8;
    predictedValue = Math.round((predictedValue + 2) * 10) / 10;
  }

  // -- Signal 8: Cross-country travel fatigue ----------------
  if (isCrossCountryTravel) {
    signals.push({
      type: 'TRAVEL_FATIGUE',
      detail: `Team traveled cross-country -- fatigue reduces output`,
      impact: 'negative',
      magnitude: 'low',
      side: 'under',
      scoreContribution: -5,
    });
    scoreAdjustment += -5;
    predictedValue = Math.max(0, predictedValue - 1);
  }

  // -- Signal 9: Power rating alignment ---------------------
  if (powerComparison && powerComparison.recommendation) {
    const teamFavored = powerComparison.recommendation === (statType.includes('point') ? 'home' : 'none');
    if (powerComparison.confidence === 'high') {
      signals.push({
        type: 'POWER_RATING',
        detail: `Power ratings: ${powerComparison.detail}`,
        impact: teamFavored ? 'positive' : 'neutral',
        magnitude: 'low',
        side: 'neutral',
        scoreContribution: teamFavored ? 4 : 0,
      });
      if (teamFavored) scoreAdjustment += 4;
    }
  }

  // -- Signal 10: Weather (outdoor sports only) --------------
  if (weather && weather.weatherImpact && weather.weatherImpact !== 'none') {
    const isNegative = weather.weatherImpact === 'wind' || weather.weatherImpact === 'rain';
    signals.push({
      type: 'WEATHER',
      detail: `Weather: ${weather.description ?? weather.weatherImpact} -- impacts passing/scoring`,
      impact: isNegative ? 'negative' : 'neutral',
      magnitude: 'medium',
      side: isNegative ? 'under' : 'neutral',
      scoreContribution: isNegative ? -8 : 0,
    });
    if (isNegative) scoreAdjustment += -8;
  }

  // -- Signal 11: Blowout risk -------------------------------
  const blowout = assessBlowoutRisk(
    sportKey ?? 'basketball_nba', team, homeTeam ?? team, awayTeam ?? team,
    gameSpread, statType
  );
  if (blowout.isHighRisk && blowout.scorePenalty < 0) {
    const isCountingStat = ['point', 'rebound', 'assist', 'rush', 'pass', 'reception']
      .some(s => statType.toLowerCase().includes(s));
    if (isCountingStat && side === 'over') {
      signals.push({
        type: 'BLOWOUT_RISK',
        detail: blowout.detail,
        impact: 'negative',
        magnitude: blowout.blowoutProbability >= 0.5 ? 'high' : 'medium',
        side: 'under',
        scoreContribution: blowout.scorePenalty,
      });
      scoreAdjustment += blowout.scorePenalty;
    }
  }

  // -- Signal 12: Market efficiency (prop type) ---------------
  const marketEff = getMarketEfficiencyForProp(sportKey ?? 'basketball_nba', marketKey);
  if (marketEff.volumeCategory === 'very_low' || marketEff.volumeCategory === 'low') {
    signals.push({
      type: 'MARKET_INEFFICIENCY',
      detail: marketEff.detail,
      impact: 'positive',
      magnitude: marketEff.volumeCategory === 'very_low' ? 'high' : 'medium',
      side: 'neutral',
      scoreContribution: marketEff.volumeCategory === 'very_low' ? 12 : 6,
    });
    scoreAdjustment += signals[signals.length - 1].scoreContribution;
    predictedValue = Math.round(predictedValue * marketEff.edgeMultiplier * 10) / 10;
  }

  // -- Signal 13: Public star bias ----------------------------
  const starBias = assessPublicStarBias(
    playerName, sportKey ?? 'basketball_nba',
    profile?.seasonPPG ?? null, statType, side
  );
  if (starBias.scoreAdjustment !== 0) {
    signals.push({
      type: 'STAR_BIAS',
      detail: starBias.detail,
      impact: starBias.shouldFadeOver ? 'negative' : 'positive',
      magnitude: starBias.isStarPlayer ? 'high' : 'medium',
      side: starBias.shouldFadeOver ? 'under' : 'over',
      scoreContribution: starBias.scoreAdjustment,
    });
    scoreAdjustment += starBias.scoreAdjustment;
  }

  // -- Signal 14: Foul trouble risk (NBA) ---------------------
  const foulRisk = assessFoulTroubleRisk(
    playerName, sportKey ?? 'basketball_nba', position, profile
  );
  if (foulRisk.foulTroubleRisk === 'high' && foulRisk.scorePenalty < 0) {
    const foulImpacts = foulRisk.impactedProps.some(p => statType.toLowerCase().includes(p.replace('player_', '')));
    if (foulImpacts && side === 'over') {
      signals.push({
        type: 'FOUL_TROUBLE',
        detail: foulRisk.detail,
        impact: 'negative',
        magnitude: 'medium',
        side: 'under',
        scoreContribution: foulRisk.scorePenalty,
      });
      scoreAdjustment += foulRisk.scorePenalty;
    }
  }

  // -- Signal 15: Overtime risk --------------------------------
  const otRisk = assessOvertimeRisk(
    sportKey ?? 'basketball_nba', gameSpread, gameTotal ?? null, statType, side
  );
  if (otRisk.isHighOTRisk && otRisk.scoreAdjustment !== 0) {
    signals.push({
      type: 'OVERTIME_RISK',
      detail: otRisk.detail,
      impact: otRisk.scoreAdjustment < 0 ? 'negative' : 'positive',
      magnitude: otRisk.otProbability >= 0.20 ? 'high' : 'medium',
      side: otRisk.affectedSide === 'none' ? 'neutral' : otRisk.affectedSide,
      scoreContribution: otRisk.scoreAdjustment,
    });
    scoreAdjustment += otRisk.scoreAdjustment;
  }

  // -- Signal 16: Sharp steam on this game --------------
  if (hasSharpSteam) {
    signals.push({
      type: 'SHARP_STEAM',
      detail: 'Sharp coordinated money detected on this game -- line moving against public, smart money active',
      impact: 'positive',
      magnitude: 'medium',
      side: 'neutral',
      scoreContribution: 8,
    });
    scoreAdjustment += 8;
  }

  // -- Signal 17: ATS situation context ------------------
  if (
    atsSituation &&
    atsSituation.atsScoreBonus &&
    Math.abs(atsSituation.atsScoreBonus) >= 5 &&
    sportKey !== 'basketball_nba'
  ) {
    const isPositive = atsSituation.atsScoreBonus > 0;
    signals.push({
      type: 'ATS_HISTORY',
      detail: atsSituation.description ?? `ATS historical edge: ${isPositive ? 'favorable' : 'unfavorable'} situation (${atsSituation.atsScoreBonus > 0 ? '+' : ''}${atsSituation.atsScoreBonus} pts)`,
      impact: isPositive ? 'positive' : 'negative',
      magnitude: Math.abs(atsSituation.atsScoreBonus) >= 8 ? 'high' : 'medium',
      side: 'neutral',
      scoreContribution: Math.min(Math.max(atsSituation.atsScoreBonus, -10), 10),
    });
    scoreAdjustment += signals[signals.length - 1].scoreContribution;
  }

  // -- Signal 18: Public betting bias (fade the public) --
  if (playerTeamBetPct !== null) {
    const isHeavilyPublic = playerTeamBetPct >= 70;
    const isContrarian = playerTeamBetPct <= 30;
    if (isHeavilyPublic && side === 'over') {
      signals.push({
        type: 'PUBLIC_FADE',
        detail: `${Math.round(playerTeamBetPct)}% of bets on this team -- public over bias, line likely inflated`,
        impact: 'negative',
        magnitude: 'medium',
        side: 'under',
        scoreContribution: -6,
      });
      scoreAdjustment += -6;
    } else if (isContrarian && side === 'over') {
      signals.push({
        type: 'CONTRARIAN_VALUE',
        detail: `Only ${Math.round(playerTeamBetPct)}% of bets on this team -- public fading creates contrarian value`,
        impact: 'positive',
        magnitude: 'medium',
        side: 'over',
        scoreContribution: 6,
      });
      scoreAdjustment += 6;
    }
  }

  // -- Final assessment --------------------------------------
  if (sportKey === 'basketball_nba' && isSupportedNBAProjectionMarket(statType)) {
    const statKey = normalizeNBAProjectionStatType(statType)!;
    const recentGames = profile?.recentGames?.filter(g => !g.didNotPlay && g.minutes > 0) ?? [];
    const recentThreeGames = recentGames.slice(0, 3);
    const recentFiveGames = recentGames.slice(0, 5);
    const recentTenGames = recentGames.slice(0, 10);
    const last3MinutesAvg = recentThreeGames.length > 0
      ? avg(recentThreeGames.map(g => g.minutes))
      : (profile?.l5MPG ?? 0);
    const last5MinutesAvg = recentFiveGames.length > 0
      ? avg(recentFiveGames.map(g => g.minutes))
      : (profile?.l5MPG ?? 0);
    const last10MinutesAvg = recentTenGames.length > 0
      ? avg(recentTenGames.map(g => g.minutes))
      : (profile?.l10MPG ?? last5MinutesAvg);
    const seasonMinutesAvg = profile?.seasonMPG ?? last5MinutesAvg;
    const projectedMinutes = roundToTenths(weightedAverage([
      { value: seasonMinutesAvg, weight: 0.20 },
      { value: last10MinutesAvg, weight: 0.35 },
      { value: last5MinutesAvg, weight: 0.30 },
      { value: last3MinutesAvg, weight: 0.15 },
    ])) || seasonMinutesAvg;
    const minutesVolatility = recentFiveGames.length > 1
      ? stdDev(recentFiveGames.map(g => g.minutes))
      : 0;
    const minutesTrendPct = profile?.minutesTrendPct ?? 0;
    const roleTrend = profile?.minutesTrend ?? 'stable';
    const baseMinutesConfidence =
      0.8 -
      clampRange(minutesVolatility / 12, 0, 0.35) -
      (roleTrend === 'falling' ? 0.18 : 0) -
      (Math.abs(minutesTrendPct) >= 15 ? 0.10 : 0) +
      (roleTrend === 'stable' ? 0.08 : 0) +
      (roleTrend === 'rising' && Math.abs(minutesTrendPct) <= 12 ? 0.05 : 0);
    const minutesConfidence = roundToThousandths(clampRange(
      statKey === 'threes' ? baseMinutesConfidence - 0.03 : baseMinutesConfidence,
      0.1,
      0.95
    ));
    const minutesStable = minutesConfidence >= (statKey === 'threes' ? 0.74 : 0.70);
    const roleStabilityScore = roundToThousandths(clampRange(
      0.55 +
      (roleTrend === 'stable' ? 0.12 : roleTrend === 'rising' ? 0.06 : -0.12) +
      (projectedMinutes >= 32 ? 0.10 : projectedMinutes >= 26 ? 0.05 : -0.08) -
      clampRange((minutesVolatility - 3) * 0.06, 0, 0.22),
      0.1,
      0.95
    ));

    const seasonStat = profile
      ? statKey === 'points' ? profile.seasonPPG
      : statKey === 'rebounds' ? profile.seasonRPG
      : statKey === 'assists' ? profile.seasonAPG
      : profile.season3PG
      : postedLine;
    const last10Stat = recentTenGames.length > 0
      ? avg(recentTenGames.map(g => getStatValue(g, statKey)))
      : seasonStat;
    const last5Stat = recentFiveGames.length > 0
      ? avg(recentFiveGames.map(g => getStatValue(g, statKey)))
      : last10Stat;
    const seasonStatPerMinute = seasonMinutesAvg > 0 ? seasonStat / seasonMinutesAvg : 0;
    const last10StatPerMinute = last10MinutesAvg > 0 ? last10Stat / last10MinutesAvg : seasonStatPerMinute;
    const last5StatPerMinute = last5MinutesAvg > 0 ? last5Stat / last5MinutesAvg : last10StatPerMinute;
    const weightedStatPerMinute = weightedAverage([
      { value: seasonStatPerMinute, weight: 0.35 },
      { value: last10StatPerMinute, weight: 0.40 },
      { value: last5StatPerMinute, weight: 0.25 },
    ]);

    const rawUsage = profile?.usageRate ?? null;
    const usageAdjustment = clampRange(1 + (((rawUsage ?? 0.22) - 0.22) * 1.0), 0.90, 1.12);
    const recentShotAttemptsPerMinute = recentFiveGames.length > 0
      ? avg(recentFiveGames.map(g => g.fieldGoalAttempts / Math.max(g.minutes, 1)))
      : 0;
    const seasonShotAttemptsPerMinute = recentTenGames.length > 0
      ? avg(recentTenGames.map(g => g.fieldGoalAttempts / Math.max(g.minutes, 1)))
      : recentShotAttemptsPerMinute;
    const shotVolumePulse = seasonShotAttemptsPerMinute > 0
      ? (recentShotAttemptsPerMinute - seasonShotAttemptsPerMinute) / seasonShotAttemptsPerMinute
      : 0;
    const shotVolumeAdjustment = clampRange(1 + (shotVolumePulse * 0.30), 0.90, 1.10);
    const playerMatchup = matchup?.matchups.get(playerName)?.find(m => normalizeNBAProjectionStatType(m.statType ?? '') === statKey)
      ?? matchup?.matchups.get(playerName)?.[0];
    const matchupVsLeagueAvg = typeof playerMatchup?.vsLeagueAvg === 'number'
      ? playerMatchup.vsLeagueAvg
      : 0;
    const paceAdjustment = clampRange(matchup?.impliedPaceMultiplier ?? 1, 0.94, 1.06);
    const matchupAdjustment = clampRange(
      1 + (
        statKey === 'points' ? matchupVsLeagueAvg * 0.020 :
        statKey === 'rebounds' ? matchupVsLeagueAvg * 0.018 :
        statKey === 'assists' ? matchupVsLeagueAvg * 0.022 :
        matchupVsLeagueAvg * 0.020
      ),
      0.92,
      1.08
    );
    const restAdjustment = clampRange(
      isBackToBack ? 0.96 : isCrossCountryTravel ? 0.97 : 1.01,
      0.94,
      1.03
    );
    const homeAwaySplit = profile
      ? statKey === 'points' ? (isHome ? profile.homePPG : profile.awayPPG)
      : statKey === 'rebounds' ? null
      : statKey === 'assists' ? null
      : null
      : null;
    const homeAwayBaseline = profile
      ? statKey === 'points' ? profile.seasonPPG
      : statKey === 'rebounds' ? profile.seasonRPG
      : statKey === 'assists' ? profile.seasonAPG
      : profile.season3PG
      : null;
    const homeAwayAdjustment = clampRange(
      homeAwaySplit !== null && homeAwayBaseline && homeAwayBaseline > 0
        ? 1 + (((homeAwaySplit - homeAwayBaseline) / homeAwayBaseline) * 0.25)
        : 1,
      0.97,
      1.03
    );
    const roleAdjustment = clampRange(0.90 + (roleStabilityScore * 0.20), 0.90, 1.08);
    const usageOrRoleAdjustment = clampRange(
      statKey === 'points'
        ? usageAdjustment * shotVolumeAdjustment
        : statKey === 'rebounds'
          ? roleAdjustment
          : statKey === 'assists'
            ? clampRange((usageAdjustment * 0.55) + (shotVolumeAdjustment * 0.45), 0.90, 1.12)
            : clampRange(shotVolumeAdjustment, 0.92, 1.08),
      0.90,
      1.12
    );
    const teammateShotMakingAdjustment = statKey === 'assists'
      ? clampRange(keyTeammateOut ? 0.97 : 1.01, 0.97, 1.03)
      : 1;
    const statResults = recentTenGames.map(g => getStatValue(g, statKey));
    const measuredStdDev = statResults.length > 1 ? stdDev(statResults) : 0;
    const varianceFloor = statKey === 'threes' ? Math.max(1.4, postedLine * 0.35) : Math.max(2.5, postedLine * 0.18);
    const standardDeviation = Math.max(varianceFloor, measuredStdDev);
    const atsConfidenceDelta = atsSituation?.atsScoreBonus
      ? clampRange(atsSituation.atsScoreBonus / 1000, -0.01, 0.01)
      : 0;
    const weightedThreeMadePerMinute = weightedStatPerMinute;
    const weightedThreeEfficiency = recentFiveGames.length > 0
      ? clampRange(avg(recentFiveGames.map(g => g.fieldGoalAttempts > 0 ? g.threes / g.fieldGoalAttempts : 0.12)) / 0.12, 0.92, 1.08)
      : 1;
    const adjustedWeightedStatPerMinute = statKey === 'threes'
      ? weightedThreeMadePerMinute * weightedThreeEfficiency
      : weightedStatPerMinute;

    nbaProjection = buildNBAProjection({
      statKey,
      line: postedLine,
      projectedMinutes: projectedMinutes || seasonMinutesAvg || postedLine,
      seasonMinutesAvg: seasonMinutesAvg || undefined,
      last10MinutesAvg: last10MinutesAvg || undefined,
      last5MinutesAvg: last5MinutesAvg || undefined,
      last3MinutesAvg: last3MinutesAvg || undefined,
      usageRate: rawUsage,
      weightedStatPerMinute: adjustedWeightedStatPerMinute,
      seasonStatPerMinute: seasonStatPerMinute || undefined,
      last10StatPerMinute: last10StatPerMinute || undefined,
      last5StatPerMinute: last5StatPerMinute || undefined,
      teamPaceAdj: paceAdjustment,
      usageOrRoleAdjustment,
      matchupAdjustment,
      restAdjustment,
      homeAwayAdjustment,
      teammateShotMakingAdjustment,
      stdDevInput: standardDeviation,
      impliedProbability: roundToThousandths(americanOdds >= 0
        ? 100 / (americanOdds + 100)
        : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)),
      projectedFromRecentBaseline: recentGames.length >= 5,
      threeVarianceBoost: statKey === 'threes' ? 1.15 : 1,
      minutesTrendPct,
      minutesTrend: roleTrend,
      recentGamesCount: recentGames.length,
      recentShotAttemptsPerMinute,
      seasonShotAttemptsPerMinute,
      minutesVolatility,
      minutesStable,
      minutesConfidence,
      roleStabilityScore,
      roleAdjustment,
      atsConfidenceDelta,
    });

    predictedValue = nbaProjection.projectedStat;
    if (atsConfidenceDelta !== 0) {
      if (side === 'over') {
        nbaProjection.probabilityOver = roundToThousandths(clampRange(nbaProjection.probabilityOver + atsConfidenceDelta, 0.01, 0.99));
        nbaProjection.probabilityUnder = roundToThousandths(1 - nbaProjection.probabilityOver);
      } else {
        nbaProjection.probabilityUnder = roundToThousandths(clampRange(nbaProjection.probabilityUnder + atsConfidenceDelta, 0.01, 0.99));
        nbaProjection.probabilityOver = roundToThousandths(1 - nbaProjection.probabilityUnder);
      }
    }
    for (const signal of nbaProjection.signals) {
      signals.push(signal);
      scoreAdjustment += signal.scoreContribution;
    }
  }

  const predictedEdge = Math.round((predictedValue - postedLine) * 10) / 10;

  // Align predicted side with signals
  const overSignals = signals.filter(s => s.side === 'over').length;
  const underSignals = signals.filter(s => s.side === 'under').length;
  const dominantSide: 'over' | 'under' = overSignals >= underSignals ? 'over' : 'under';

  // Confidence based on signal alignment
  const alignedSignals = signals.filter(s => s.side === dominantSide).length;
  const totalSignals = signals.length;
  let confidence: PropPrediction['confidence'] =
    alignedSignals >= 3 && totalSignals >= 3 ? 'high'
    : alignedSignals >= 2 ? 'medium'
    : 'low';

  if (nbaProjection && nbaProjection.modelCompleteness < 0.6) {
    confidence = 'low';
  } else if (nbaProjection && nbaProjection.modelCompleteness < 0.75 && confidence === 'high') {
    confidence = 'medium';
  }

  const sideAdjustedProjectionEdge = side === 'over'
    ? predictedEdge
    : -predictedEdge;
  const modelProbability = nbaProjection
    ? (side === 'over' ? nbaProjection.probabilityOver : nbaProjection.probabilityUnder)
    : undefined;
  const modelTrueEdge = nbaProjection
    ? roundToThousandths((modelProbability ?? 0) - nbaProjection.impliedProbability)
    : undefined;

  const shouldBet = nbaProjection
    ? (
      confidence !== 'low' &&
      sideAdjustedProjectionEdge >= 1.5 &&
      (modelProbability ?? 0) >= 0.58 &&
      (modelTrueEdge ?? 0) >= 0.05 &&
      nbaProjection.modelCompleteness >= 0.75 &&
      nbaProjection.minutesConfidence >= 0.70
    )
    : (
      confidence !== 'low' &&
      Math.abs(scoreAdjustment) >= 10 &&
      (dominantSide === side) &&
      Math.abs(predictedEdge) >= 1.5
    );

  // Build summary
  const highSignals = signals.filter(s => s.magnitude === 'high');
  const summaryParts = highSignals.slice(0, 2).map(s => s.detail);
  const summary = summaryParts.length > 0
    ? summaryParts.join(' | ')
    : `Predicted ${predictedValue} vs line ${postedLine} -- edge: ${predictedEdge > 0 ? '+' : ''}${predictedEdge}`;

  // -- Kelly Criterion bet sizing -----------------------------
  const winProb = scoreToProbability(
    Math.max(0, Math.min(100, 50 + scoreAdjustment))
  );
  const kelly = calculateKelly(winProb, americanOdds);

  return {
    playerName, team, position, statType,
    sport: sportKey, homeTeam, awayTeam,
    postedLine, side,
    predictedValue,
    predictedEdge,
    confidence,
    signals,
    scoreAdjustment,
    summary,
    shouldBet,
    kelly,
    ...(nbaProjection ? {
      projectedStat: nbaProjection.projectedStat,
      probabilityOver: nbaProjection.probabilityOver,
      probabilityUnder: nbaProjection.probabilityUnder,
      impliedProbability: nbaProjection.impliedProbability,
      modelCompleteness: nbaProjection.modelCompleteness,
      nbaMinutesStable: nbaProjection.minutesStable,
      nbaMinutesConfidence: nbaProjection.minutesConfidence,
      nbaRoleStabilityScore: nbaProjection.roleStabilityScore,
      supportedNBAProjection: nbaProjection.supportedMarket,
    } : {}),
  };
}

// ============================================================
// MLB-specific signal injection
//
// Runs AFTER generatePropPrediction() so it never touches NBA/NHL
// logic. Fires only when sport = baseball AND the relevant data
// is present in context/matchup/static tables.
//
// Signal types added here:
//   PARK_FACTOR_EDGE        — static park factor lookup by homeTeam
//   INNINGS_PROJECTION_EDGE — ctx.pitcherProjection data when present
//   PITCHER_K_MATCHUP       — matchup detail contains K/strikeout/whiff
//   OPP_CONTACT_WEAKNESS    — matchup detail contains contact/weak/whiff
// ============================================================

/**
 * Park factors by OddsAPI home team name.
 * Values > 1.0 = hitter-friendly; < 1.0 = pitcher-friendly.
 * Source: multi-year park factor data (5+ seasons).
 */
const MLB_PARK_FACTORS: Record<string, number> = {
  'Colorado Rockies':     1.15,   // Coors — high altitude
  'Boston Red Sox':       1.08,   // Fenway — short wall, porch
  'Cincinnati Reds':      1.06,   // GABP
  'Texas Rangers':        1.05,   // Globe Life — warm, open roof
  'New York Yankees':     1.04,   // Yankee Stadium — short RF
  'Chicago Cubs':         1.03,   // Wrigley — wind-dependent
  'Toronto Blue Jays':    1.02,   // Rogers Centre
  'Atlanta Braves':       0.97,   // Truist Park
  'Los Angeles Dodgers':  0.97,   // Dodger Stadium — spacious
  'New York Mets':        0.96,   // Citi Field
  'Seattle Mariners':     0.94,   // T-Mobile Park
  'Oakland Athletics':    0.94,   // Oakland Coliseum
  'San Francisco Giants': 0.93,   // Oracle Park — marine layer
  'San Diego Padres':     0.93,   // Petco Park
  'Miami Marlins':        0.92,   // loanDepot — spacious
};

/**
 * Injects MLB-specific PropSignals into an existing prediction.
 * Returns the original prediction object unchanged when no signals fire
 * (no data present, or park factor does not align with bet direction).
 */
function injectMLBSignals(
  prediction:  PropPrediction,
  prop: {
    marketKey?: string;
    playerName: string;
    team:       string;
    side:       'over' | 'under';
  },
  homeTeam:   string,
  _awayTeam:  string,
  ctx:        any,
  matchupPkg: any | null,
): PropPrediction {
  const mlbSignals: PropSignal[] = [];
  let   mlbAdj     = 0;
  const mk         = (prop.marketKey ?? '').toLowerCase();

  const isPitcherProp =
    mk.includes('pitcher') || mk.includes('strikeout') || mk.includes('outs_recorded');
  const isBatterProp  =
    mk.includes('batter')      || mk.includes('total_bases') ||
    mk.includes('hits')        || mk.includes('runs_scored') ||
    mk.includes('rbi')         || mk.includes('home_run');

  // ── PARK_FACTOR_EDGE ────────────────────────────────────────
  // Static lookup.  A hitter-friendly park supports batter OVER props
  // and pitcher UNDER props (harder to go deep); pitcher-friendly parks
  // support pitcher OVER props and batter UNDER props.
  const pf = MLB_PARK_FACTORS[homeTeam] ?? null;
  if (pf !== null && Math.abs(pf - 1.0) >= 0.05) {
    const hitterPark = pf > 1.0;
    const aligned =
      (isBatterProp  && prop.side === 'over'  &&  hitterPark) ||
      (isBatterProp  && prop.side === 'under' && !hitterPark) ||
      (isPitcherProp && prop.side === 'over'  && !hitterPark) ||
      (isPitcherProp && prop.side === 'under' &&  hitterPark);
    if (aligned) {
      const contribution = Math.abs(pf - 1.0) >= 0.10 ? 10 : 6;
      mlbSignals.push({
        type:              'PARK_FACTOR_EDGE',
        detail:            `${homeTeam} park factor ${pf.toFixed(2)}x — ${hitterPark ? 'hitter-friendly' : 'pitcher-friendly'}, aligns with ${prop.side}`,
        impact:            'positive',
        magnitude:         Math.abs(pf - 1.0) >= 0.10 ? 'high' : 'medium',
        side:              prop.side,
        scoreContribution: contribution,
      });
      mlbAdj += contribution;
    }
  }

  // ── INNINGS_PROJECTION_EDGE ──────────────────────────────────
  // Fires only when game context carries pitcher projection data.
  // Deep start (>5 IP projected) benefits pitcher OVER Ks; short
  // outing (<4.5 IP) benefits pitcher UNDER.
  if (isPitcherProp) {
    const projInnings: number | null =
      ctx?.pitcherProjection?.projectedInnings ??
      ctx?.startingPitcher?.projectedInnings   ??
      ctx?.pitcherLines?.projectedInnings      ??
      null;
    if (projInnings !== null) {
      const avgInnings = 5.0;
      const diff       = projInnings - avgInnings;
      if (Math.abs(diff) >= 0.5) {
        const deepStart = diff > 0;
        const aligned   = (deepStart && prop.side === 'over') || (!deepStart && prop.side === 'under');
        if (aligned) {
          const contribution = Math.abs(diff) >= 1.5 ? 12 : 8;
          mlbSignals.push({
            type:              'INNINGS_PROJECTION_EDGE',
            detail:            `Pitcher projected ${projInnings} IP (${diff > 0 ? '+' : ''}${diff.toFixed(1)} vs avg ${avgInnings}) — ${deepStart ? 'deep start, more K opportunities' : 'short outing expected, fewer Ks'}`,
            impact:            'positive',
            magnitude:         Math.abs(diff) >= 1.5 ? 'high' : 'medium',
            side:              prop.side,
            scoreContribution: contribution,
          });
          mlbAdj += contribution;
        }
      }
    }
  }

  // ── PITCHER_K_MATCHUP ────────────────────────────────────────
  // Walks the matchup package looking for any entry whose edgeDetail
  // references strikeout / K-rate / whiff data.  Fires once (best match).
  if (isPitcherProp && matchupPkg) {
    outer: for (const [, matchupArr] of matchupPkg.matchups as Map<string, any[]>) {
      for (const m of matchupArr) {
        const detail = (m.edgeDetail ?? m.detail ?? '').toLowerCase();
        const hasKData =
          detail.includes('strikeout') || detail.includes(' k ') ||
          detail.includes('k rate')    || detail.includes('whiff');
        if (hasKData && (m.overEdge || m.underEdge)) {
          const aligned =
            (m.overEdge  && prop.side === 'over') ||
            (m.underEdge && prop.side === 'under');
          if (aligned) {
            const contribution = m.matchupGrade === 'elite' ? 12 : 8;
            mlbSignals.push({
              type:              'PITCHER_K_MATCHUP',
              detail:            m.edgeDetail ?? m.detail ?? `Favorable pitcher K matchup`,
              impact:            'positive',
              magnitude:         m.matchupGrade === 'elite' ? 'high' : 'medium',
              side:              prop.side,
              scoreContribution: contribution,
            });
            mlbAdj += contribution;
            break outer;
          }
        }
      }
    }
  }

  // ── OPP_CONTACT_WEAKNESS ────────────────────────────────────
  // Fires when the player-level matchup entry for this batter references
  // contact / weakness / whiff data that aligns with the bet direction.
  if (isBatterProp && matchupPkg) {
    const playerMatchups: any[] = matchupPkg.matchups.get(prop.playerName) ?? [];
    for (const m of playerMatchups) {
      const detail = (m.edgeDetail ?? m.detail ?? '').toLowerCase();
      const hasContactData =
        detail.includes('contact') || detail.includes('weak') || detail.includes('whiff');
      if (hasContactData && (m.overEdge || m.underEdge)) {
        const aligned =
          (m.overEdge  && prop.side === 'over') ||
          (m.underEdge && prop.side === 'under');
        if (aligned) {
          const contribution =
            (m.matchupGrade === 'elite' || m.matchupGrade === 'terrible') ? 10 : 7;
          mlbSignals.push({
            type:              'OPP_CONTACT_WEAKNESS',
            detail:            m.edgeDetail ?? m.detail ?? `Opponent has contact weakness`,
            impact:            'positive',
            magnitude:         (m.matchupGrade === 'elite' || m.matchupGrade === 'terrible') ? 'high' : 'medium',
            side:              prop.side,
            scoreContribution: contribution,
          });
          mlbAdj += contribution;
          break;
        }
      }
    }
  }

  // Return original prediction unchanged when nothing fired
  if (mlbSignals.length === 0) return prediction;

  return {
    ...prediction,
    signals:         [...prediction.signals, ...mlbSignals],
    scoreAdjustment: prediction.scoreAdjustment + mlbAdj,
  };
}

// ------------------------------------
// Batch: generate predictions for multiple props
// ------------------------------------

export async function buildPropPredictions(
  props: Array<{
    playerName: string;
    team: string;
    position: string;
    statType: string;
    postedLine: number;
    postedPrice?: number;       // american odds at time of pick (for Kelly sizing)
    side: 'over' | 'under';
    eventId: string;
    homeTeam: string;
    awayTeam: string;
    gameTotal?: number | null;
    gameSpread?: number | null; // game spread for blowout / OT risk signals
    marketKey?: string;         // odds-api market key (for market efficiency signal)
  }>,
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
  }
): Promise<Map<string, PropPrediction>> {
  const results = new Map<string, PropPrediction>();

  // Group by game to build matchup packages once per game
  const gameGroups = new Map<string, typeof props>();
  for (const prop of props) {
    const existing = gameGroups.get(prop.eventId) ?? [];
    existing.push(prop);
    gameGroups.set(prop.eventId, existing);
  }

  for (const [eventId, gameProps] of gameGroups) {
    const { homeTeam, awayTeam, gameTotal } = gameProps[0];

    // Build matchup package for this game
    const matchupPkg = await (async () => {
      try {
        return await buildMatchupPackage(
          homeTeam, awayTeam, gameTotal ?? null,
          gameProps.map(p => ({ name: p.playerName, team: p.team, position: p.position, statType: p.statType })),
          sportKey
        );
      } catch { return null; }
    })();

    const ctx = contextMap.get(eventId);
    const gameIsBackToBack = ctx?.homeRest?.isBackToBack || ctx?.awayRest?.isBackToBack;

    // Pull ALL available intel for this game
    const gameInjuries = extraIntel?.injuryMap?.get(eventId) ?? [];
    const gameLineup = extraIntel?.lineupMap?.get(eventId);
    const gamePubBetting = extraIntel?.publicBetting?.get(eventId);
    const gamePowerRatings = extraIntel?.powerRatings?.get(eventId);
    const gameWeather = extraIntel?.weatherMap?.get(eventId);
    const gameATS = extraIntel?.atsSituations?.get(eventId);
    const gameSteam = (extraIntel?.steamMoves ?? []).filter((s: any) => s.eventId === eventId);
    const hasSharpSteam = gameSteam.some((s: any) => s.isSteam);
    // Public betting -- is this game heavily bet on one side?
    const homeBetPct = gamePubBetting?.homeBetPct ?? null;
    const awayBetPct = gamePubBetting?.awayBetPct ?? null;

    // Process each player -- max 6 per game
    for (const prop of gameProps.slice(0, 6)) {
      try {
        // Get player profile
        const playerId = await findPlayerId(prop.playerName, prop.team, sportKey);
        let profile: any = null;
        if (playerId) {
          profile = await getPlayerProfile(playerId, prop.playerName, prop.team, prop.position, sportKey);
        }

        const isHome = prop.team === homeTeam;
        const isB2B = gameIsBackToBack && (
          (isHome && ctx?.homeRest?.isBackToBack) ||
          (!isHome && ctx?.awayRest?.isBackToBack)
        );

        // Check if key teammate is out -- use lineup confirmation if available
        const teamLineSide = isHome ? gameLineup?.home : gameLineup?.away;
        const keyTeammateOut = (teamLineSide?.keyPlayersOut?.length ?? 0) > 0 ||
                               ctx?.homeLineup?.keyPlayersOut?.length > 0 ||
                               ctx?.awayLineup?.keyPlayersOut?.length > 0;

        // Check team rest/travel from context
        const playerTeamRest = isHome ? ctx?.homeRest : ctx?.awayRest;
        const isCrossCountryTravel = playerTeamRest?.crossCountryTravel ?? false;

        // Power rating edge -- if our model shows team much stronger/weaker
        const powerComparison = gamePowerRatings?.comparison;
        const hasPowerEdge = powerComparison?.confidence === 'high' || powerComparison?.confidence === 'medium';

        // Derive team total from game total (approx: each team = half the game total)
        const teamTotalEstimate = prop.gameTotal ? Math.round(prop.gameTotal / 2 * 10) / 10 : null;

        // Get best available price for Kelly calc
        const bestPrice = isHome
          ? (gameProps[0] as any).overBestPrice ?? (gameProps[0] as any).underBestPrice ?? -110
          : (gameProps[0] as any).overBestPrice ?? -110;

        const prediction = generatePropPrediction(
          prop.playerName, prop.team, prop.position, prop.statType,
          prop.postedLine, prop.side, profile, matchupPkg,
          isB2B ?? false, isHome, keyTeammateOut ?? false,
          isCrossCountryTravel, hasPowerEdge ? powerComparison : null,
          gameWeather, teamTotalEstimate, 113.5,
          prop.gameSpread ?? null,
          prop.gameTotal ?? null,
          prop.marketKey ?? '',
          prop.postedPrice ?? -110,
          sportKey,
          homeTeam,
          awayTeam,
          hasSharpSteam,
          gameATS,
          isHome ? homeBetPct : awayBetPct
        );

        const key = `${prop.playerName}__${prop.statType}__${prop.side}`;

        // Inject MLB-specific signals AFTER the base prediction so that
        // NBA/NHL props are never touched.  injectMLBSignals returns the
        // original object unchanged when no MLB context data is present.
        const finalPrediction = sportKey.includes('baseball')
          ? injectMLBSignals(prediction, prop, homeTeam, awayTeam, ctx, matchupPkg)
          : prediction;

        results.set(key, finalPrediction);
      } catch { /* individual player errors are non-fatal */ }
    }
  }

  return results;
}
