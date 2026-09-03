import * as fs from 'fs';
import * as path from 'path';
import { DecisionCandidate } from './decisionTypes';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const PICKS_FILE = path.join(SNAPSHOT_DIR, 'picks_log.json');

export const FOOTBALL_MIN_GRADED_SAMPLES = 20;

interface FootballHistoryPick {
  sport?: string;
  sportKey?: string;
  marketType?: string;
  betType?: string;
  pickedPrice?: number;
  gameResult?: string;
  gameTime?: string;
  propType?: string;
}

interface SampleStats {
  sampleSize: number;
  roi: number;
}

function normalizeSportKey(value: Partial<FootballHistoryPick> | DecisionCandidate): string {
  const key = String(value.sportKey ?? '').toLowerCase();
  if (key) return key;
  const sport = String(value.sport ?? '').toLowerCase();
  if (sport === 'nfl') return 'americanfootball_nfl';
  if (sport === 'ncaaf') return 'americanfootball_ncaaf';
  return sport;
}

function normalizeMarketType(pick: Partial<FootballHistoryPick>): 'game_line' | 'player_prop' {
  if (pick.marketType === 'player_prop' || String(pick.betType ?? '').toLowerCase() === 'player prop') {
    return 'player_prop';
  }
  return 'game_line';
}

function isGraded(result?: string): result is 'WIN' | 'LOSS' | 'PUSH' {
  return result === 'WIN' || result === 'LOSS' || result === 'PUSH';
}

function calculateStats(picks: FootballHistoryPick[]): SampleStats {
  let profitUnits = 0;
  for (const pick of picks) {
    const result = pick.gameResult;
    if (!isGraded(result)) continue;
    const price = typeof pick.pickedPrice === 'number' && Number.isFinite(pick.pickedPrice)
      ? pick.pickedPrice
      : -110;
    if (result === 'WIN') profitUnits += price > 0 ? price / 100 : 100 / Math.abs(price);
    else if (result === 'LOSS') profitUnits -= 1;
  }
  const sampleSize = picks.filter(p => isGraded(p.gameResult)).length;
  return {
    sampleSize,
    roi: sampleSize > 0 ? Math.round((profitUnits / sampleSize) * 10000) / 100 : 0,
  };
}

function loadHistory(): FootballHistoryPick[] {
  try {
    if (!fs.existsSync(PICKS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(PICKS_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function finalGradeFor(label: DecisionCandidate['finalDecisionLabel'], adjustedEdge: number): string {
  if (label === 'BET') return adjustedEdge >= 0.10 ? 'A+' : 'A';
  if (label === 'LEAN') return adjustedEdge >= 0.07 ? 'B+' : 'B';
  if (label === 'MONITOR') return 'C';
  if (label === 'BEST_PRICE_ONLY') return 'C+';
  return 'D';
}

function isFootball(c: DecisionCandidate): boolean {
  const key = normalizeSportKey(c);
  return key === 'americanfootball_nfl' || key === 'americanfootball_ncaaf';
}

/**
 * Football remains in observation mode pending explicit model validation.
 * A small positive historical bucket never automatically promotes a model.
 * The 20-result count is diagnostic, not a production approval threshold.
 */
export function applyFootballGuardrails(
  candidates: DecisionCandidate[],
  historyOverride?: FootballHistoryPick[],
): DecisionCandidate[] {
  const history = historyOverride ?? loadHistory();
  const today = new Date();
  const season = today.getUTCFullYear() - (today.getUTCMonth() < 7 ? 1 : 0);
  const marketKey = (value: string) => ({ spreads: 'spread', totals: 'total', h2h: 'moneyline' }[String(value ?? '').toLowerCase()] ?? String(value ?? '').toLowerCase());

  return candidates.map(candidate => {
    if(normalizeSportKey(candidate)==='americanfootball_ncaaf')return {...candidate,score:0,grade:'PAPER PASS',finalGrade:'PAPER PASS',
      tier:'MONITOR' as const,finalDecisionLabel:'PASS' as const,kellyPct:undefined,winProbability:undefined,adjustedWinProbability:undefined,
      trueEdge:undefined,adjustedEdge:undefined,footballGuardrailActive:true,
      labelReasons:['Legacy college ranking disabled; use the audited college paper/context workflow. No reliable edge, stake or real-money recommendation.']};
    if (!isFootball(candidate) || !candidate.finalDecisionLabel) return candidate;

    const sportKey = normalizeSportKey(candidate);
    const marketType = candidate.marketType;
    const sportMarketHistory = history.filter(p =>
      normalizeSportKey(p) === sportKey && normalizeMarketType(p) === marketType && isGraded(p.gameResult)
      && p.marketType !== 'parlay' && Number.isFinite(p.pickedPrice) && Math.abs(p.pickedPrice) >= 100
      && Number.isFinite(Date.parse(p.gameTime ?? '')) && Date.parse(p.gameTime) < Date.now()
      && (new Date(p.gameTime).getUTCFullYear() - (new Date(p.gameTime).getUTCMonth() < 7 ? 1 : 0)) === season
      && marketKey(p.betType) === marketKey(candidate.betType)
      && (marketType !== 'player_prop' || (!!candidate.market && p.propType === candidate.market))
    );
    const overallStats = calculateStats(sportMarketHistory);

    const isTotal = marketType === 'game_line' && marketKey(candidate.betType) === 'total';
    const fragileHistory = sportMarketHistory.filter(p =>
      marketType === 'player_prop' || marketKey(p.betType) === 'total'
    );
    const marketStats = calculateStats(fragileHistory);
    const lacksFragileEvidence = isTotal || marketType === 'player_prop';

    let label = candidate.finalDecisionLabel;
    const reasons = [...(candidate.labelReasons ?? [])];

    if (lacksFragileEvidence && (label === 'BET' || label === 'LEAN')) {
      label = 'MONITOR';
      reasons.unshift(
        `football guardrail: ${marketStats.sampleSize}/${FOOTBALL_MIN_GRADED_SAMPLES} graded ${isTotal ? 'total' : 'prop'} samples, ROI ${marketStats.roi.toFixed(1)}%`,
        'research only: model validation required; sample count or positive ROI does not unlock betting',
      );
    } else if (label === 'BET') {
      label = 'LEAN';
      reasons.unshift(
        `early-season football guardrail: ${overallStats.sampleSize}/${FOOTBALL_MIN_GRADED_SAMPLES} graded ${marketType.replace('_', ' ')} samples`,
        'BET capped at LEAN pending explicit football model validation',
      );
    }

    const active = label !== candidate.finalDecisionLabel;
    return {
      ...candidate,
      finalDecisionLabel: label,
      finalGrade: finalGradeFor(label, candidate.adjustedEdge ?? 0),
      labelReasons: reasons.slice(0, 4),
      footballHistorySampleSize: overallStats.sampleSize,
      footballMarketSampleSize: marketStats.sampleSize,
      footballGuardrailActive: active,
    };
  });
}
