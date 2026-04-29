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
  modelCompleteness?: number;
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
  line: number;
  minutes?: number;
  recentMinutesAvg?: number;
  seasonMinutesAvg?: number;
  usageRate?: number | null;
  teamPaceAdj?: number;
  statRate: number;
  baseline: number;
  minutesTrendPct?: number;
  recentGamesCount?: number;
  teamTotal?: number | null;
}

interface NBAProjectionResult {
  projectedStat: number;
  probabilityOver: number;
  probabilityUnder: number;
  modelCompleteness: number;
  signals: PropSignal[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function calcProbability(projectedStat: number, line: number, variance: number): number {
  const safeVariance = Math.max(0.75, variance);
  const z = (projectedStat - line) / safeVariance;
  const logistic = 1 / (1 + Math.exp(-1.702 * z));
  return Math.round(clamp01(logistic) * 1000) / 1000;
}

function computeCompleteness(ctx: NBAProjectionContext): number {
  let completeness = 0;

  if (ctx.baseline > 0) completeness += 0.25;
  if ((ctx.recentMinutesAvg ?? 0) > 0) completeness += 0.20;
  if ((ctx.seasonMinutesAvg ?? 0) > 0) completeness += 0.10;
  if (ctx.statRate > 0) completeness += 0.20;
  if (ctx.usageRate !== null && ctx.usageRate !== undefined) completeness += 0.10;
  if (ctx.teamPaceAdj !== undefined) completeness += 0.05;
  if ((ctx.recentGamesCount ?? 0) >= 5) completeness += 0.05;
  if (ctx.teamTotal !== null && ctx.teamTotal !== undefined) completeness += 0.05;

  return Math.round(Math.min(completeness, 1) * 100) / 100;
}

function deriveSignals(
  ctx: NBAProjectionContext,
  projectedStat: number,
  modelCompleteness: number
): PropSignal[] {
  const signals: PropSignal[] = [];
  const rawProjectionEdge = Math.round((projectedStat - ctx.line) * 10) / 10;
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

  const minutesDelta = (ctx.minutes ?? ctx.recentMinutesAvg ?? 0) - (ctx.seasonMinutesAvg ?? 0);
  if (Math.abs(minutesDelta) >= 2) {
    const risingMinutes = minutesDelta > 0;
    signals.push({
      type: 'MINUTES_PROJECTION',
      detail: `Projected minutes ${(ctx.minutes ?? ctx.recentMinutesAvg ?? 0).toFixed(1)} vs season ${(ctx.seasonMinutesAvg ?? 0).toFixed(1)} (${minutesDelta > 0 ? '+' : ''}${minutesDelta.toFixed(1)})`,
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

  return signals;
}

function buildNBAProjection(ctx: NBAProjectionContext): NBAProjectionResult {
  const minutes = ctx.minutes || ctx.recentMinutesAvg || 0;
  const usage = ctx.usageRate || 0.22;
  const pace = ctx.teamPaceAdj || 1;

  const rawProjection = (minutes * usage * pace * ctx.statRate) || ctx.baseline;
  const projectedStat = Math.round(rawProjection * 10) / 10;
  const variance = Math.max(0.75, projectedStat * 0.15);
  const probabilityOver = calcProbability(projectedStat, ctx.line, variance);
  const modelCompleteness = computeCompleteness(ctx);

  return {
    projectedStat,
    probabilityOver,
    probabilityUnder: Math.round((1 - probabilityOver) * 1000) / 1000,
    modelCompleteness,
    signals: deriveSignals(ctx, projectedStat, modelCompleteness),
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
  if (atsSituation && atsSituation.atsScoreBonus && Math.abs(atsSituation.atsScoreBonus) >= 5) {
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
  if (sportKey === 'basketball_nba') {
    const stats = profile ? getStatFromProfile(profile, statType) : null;
    const baseline = stats
      ? Math.round(((stats.season * 0.55) + (stats.l5 * 0.45)) * 10) / 10
      : postedLine;
    const recentMinutesAvg = profile?.l5MPG ?? 0;
    const seasonMinutesAvg = profile?.seasonMPG ?? recentMinutesAvg;
    const blendedMinutes = recentMinutesAvg > 0
      ? Math.round((((recentMinutesAvg * 0.65) + (seasonMinutesAvg * 0.35))) * 10) / 10
      : seasonMinutesAvg;
    const rawUsage = profile?.usageRate ?? null;
    const projectionUsage = rawUsage ?? 0.22;
    const paceMultiplier = matchup?.impliedPaceMultiplier
      ?? (teamTotal !== null
        ? 1 + (((teamTotal - leagueAvgTeamTotal) / leagueAvgTeamTotal) * 0.15)
        : 1);
    const denominator = Math.max(
      1,
      (blendedMinutes || recentMinutesAvg || seasonMinutesAvg || 1) *
      projectionUsage *
      Math.max(0.85, paceMultiplier)
    );
    const statRate = baseline > 0 ? baseline / denominator : 0;

    nbaProjection = buildNBAProjection({
      line: postedLine,
      minutes: blendedMinutes || recentMinutesAvg || seasonMinutesAvg || undefined,
      recentMinutesAvg: recentMinutesAvg || undefined,
      seasonMinutesAvg: seasonMinutesAvg || undefined,
      usageRate: rawUsage,
      teamPaceAdj: paceMultiplier,
      statRate,
      baseline,
      minutesTrendPct: profile?.minutesTrendPct,
      recentGamesCount: profile?.recentGames?.filter(g => !g.didNotPlay).length ?? 0,
      teamTotal,
    });

    predictedValue = nbaProjection.projectedStat;
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

  // Should bet only if prediction aligns with posted side AND confidence is medium+
  const shouldBet =
    confidence !== 'low' &&
    Math.abs(scoreAdjustment) >= 10 &&
    (dominantSide === side) &&
    Math.abs(predictedEdge) >= 1.5 &&
    (nbaProjection ? nbaProjection.modelCompleteness >= 0.6 : true);

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
      modelCompleteness: nbaProjection.modelCompleteness,
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
