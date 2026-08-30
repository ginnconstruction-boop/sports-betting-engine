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
 * Football starts in observation mode each season because the engine has no
 * graded NFL/NCAAF history yet. BETs are capped at LEAN until 20 comparable
 * results exist. Totals and player props stay MONITOR-only until their own
 * 20-pick bucket has positive ROI.
 */
export function applyFootballGuardrails(
  candidates: DecisionCandidate[],
  historyOverride?: FootballHistoryPick[],
): DecisionCandidate[] {
  const history = historyOverride ?? loadHistory();

  return candidates.map(candidate => {
    if (!isFootball(candidate) || !candidate.finalDecisionLabel) return candidate;

    const sportKey = normalizeSportKey(candidate);
    const marketType = candidate.marketType;
    const sportMarketHistory = history.filter(p =>
      normalizeSportKey(p) === sportKey && normalizeMarketType(p) === marketType && isGraded(p.gameResult)
    );
    const overallStats = calculateStats(sportMarketHistory);

    const isTotal = marketType === 'game_line' && String(candidate.betType ?? '').toLowerCase() === 'total';
    const fragileHistory = sportMarketHistory.filter(p =>
      marketType === 'player_prop' || String(p.betType ?? '').toLowerCase() === 'total'
    );
    const marketStats = calculateStats(fragileHistory);
    const lacksGeneralSample = overallStats.sampleSize < FOOTBALL_MIN_GRADED_SAMPLES;
    const lacksFragileEvidence = (isTotal || marketType === 'player_prop') &&
      (marketStats.sampleSize < FOOTBALL_MIN_GRADED_SAMPLES || marketStats.roi <= 0);

    let label = candidate.finalDecisionLabel;
    const reasons = [...(candidate.labelReasons ?? [])];

    if (lacksFragileEvidence && (label === 'BET' || label === 'LEAN')) {
      label = 'MONITOR';
      reasons.unshift(
        `football guardrail: ${marketStats.sampleSize}/${FOOTBALL_MIN_GRADED_SAMPLES} graded ${isTotal ? 'total' : 'prop'} samples, ROI ${marketStats.roi.toFixed(1)}%`,
        'observation only until this market has a positive evidence base',
      );
    } else if (lacksGeneralSample && label === 'BET') {
      label = 'LEAN';
      reasons.unshift(
        `early-season football guardrail: ${overallStats.sampleSize}/${FOOTBALL_MIN_GRADED_SAMPLES} graded ${marketType.replace('_', ' ')} samples`,
        'BET capped at LEAN while the football model builds a track record',
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

