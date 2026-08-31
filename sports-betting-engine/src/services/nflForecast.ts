import { createHash } from 'crypto';
import { UpcomingEvent } from '../api/oddsApiClient';
import { MarketQuote } from './nflMarketBoard';
import { NFL_CORE_STATS, NflObservation, NflPlayer, nflName, nflSeason } from './nflResearch';

export const NFL_FORECAST_VERSION = 'nfl-workload-residual-v1';
export const NFL_FORECAST_POLICY = Object.freeze({ minTraining: 8, maxTraining: 20, recentGames: 5,
  minErrors: 8, maxAgeDays: 400, minEstimatedEV: 0.05, minConditionalProbability: 0.55 });
export interface NflForecastInput {
  player: NflPlayer; observations: NflObservation[]; asOf: string;
  depth: { rows: Array<{ formation: string; position: string; listedOrder: number }>; sourceTimestamp: string | null; source: string };
  sources: Array<{ url: string; fetchedAt: string; season: number }>;
}
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// Fixed research specification, not optimized against the evaluation games.
// Workload: 60% last-five mean + 40% last-twenty mean.
// Efficiency: 40% last-five pooled rate + 60% last-twenty pooled rate.
export function nflPointForecast(history: NflObservation[]) {
  const rows = [...history].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).slice(-NFL_FORECAST_POLICY.maxTraining);
  if (rows.length < NFL_FORECAST_POLICY.minTraining) return null;
  if (rows.some(r => !Number.isFinite(r.value) || !Number.isFinite(r.opportunity) || r.opportunity < 0)) return null;
  const recent = rows.slice(-NFL_FORECAST_POLICY.recentGames);
  const allOpps = sum(rows.map(r => r.opportunity)), recentOpps = sum(recent.map(r => r.opportunity));
  if (allOpps <= 0 || recentOpps <= 0) return null;
  const longWorkload = mean(rows.map(r => r.opportunity)), recentWorkload = mean(recent.map(r => r.opportunity));
  const workload = recentWorkload * 0.6 + longWorkload * 0.4;
  const efficiency = sum(recent.map(r => r.value)) / recentOpps * 0.4 + sum(rows.map(r => r.value)) / allOpps * 0.6;
  return { projection: workload * efficiency, baseline: mean(rows.map(r => r.value)), workload, efficiency,
    workloadRatio: recentWorkload / longWorkload, trainingGames: rows.length };
}

export function eligibleNflHistory(observations: NflObservation[], teamId: string, cutoff: number, market: string) {
  const seen = new Map<string, NflObservation>(); let excluded = 0;
  for (const row of observations) {
    const date = Date.parse(row.date);
    if (!row.eventId || row.teamId !== teamId || !Number.isFinite(date) || date >= cutoff
      || cutoff - date > 732 * 86400_000 || !Number.isInteger(row.value)
      || !Number.isInteger(row.opportunity) || row.opportunity < 0
      || (row.opportunity === 0 && row.value !== 0)
      || (market === 'player_receptions' && (row.value < 0 || row.value > row.opportunity))) { excluded++; continue; }
    const old = seen.get(row.eventId);
    if (old && (old.date !== row.date || old.value !== row.value || old.opportunity !== row.opportunity))
      throw new Error('Conflicting duplicate NFL game observations.');
    seen.set(row.eventId, row);
  }
  return { rows: [...seen.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)), excluded };
}

export function evaluateNflWalkForward(rows: NflObservation[]) {
  rows = [...rows].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const tests: Array<{ eventId: string; date: string; trainingThrough: string; prediction: number;
    baseline: number; actual: number; error: number }> = [];
  for (const target of rows) {
    // Filter by time, not just array position: a same-time/late-added observation
    // must never become a predictor of the target game.
    const history = rows.filter(r => Date.parse(r.date) < Date.parse(target.date) && r.teamId === target.teamId);
    const prediction = nflPointForecast(history);
    if (!prediction) continue;
    tests.push({ eventId: target.eventId, date: target.date, trainingThrough: history[history.length - 1].date,
      prediction: prediction.projection, baseline: prediction.baseline, actual: target.value,
      error: target.value - prediction.projection });
  }
  return { games: tests.length, mae: mean(tests.map(t => Math.abs(t.error))),
    baselineMae: mean(tests.map(t => Math.abs(t.actual - t.baseline))),
    rmse: tests.length ? Math.sqrt(mean(tests.map(t => t.error ** 2))) : null, tests,
    note: 'Rolling stat-forecast diagnostic using earlier recorded games only. Revised public game logs are not point-in-time archives. No historical odds, archived injuries or betting ROI were used; this is not a validated betting backtest.' };
}

export function nflResidualDistribution(projection: number, errors: number[], market: string, line: number) {
  const values = errors.map(e => market === 'player_receptions' ? Math.max(0, Math.round(projection + e)) : Math.round(projection + e));
  const over = values.filter(v => v > line).length, under = values.filter(v => v < line).length;
  const pushes = values.length - over - under;
  // One pseudocount per possible outcome prevents a small sample claiming 0/100%.
  // Integer stats cannot push at a half line.
  const canPush = Number.isInteger(line), total = values.length + (canPush ? 3 : 2);
  return { over: (over + 1) / total, under: (under + 1) / total, push: canPush ? (pushes + 1) / total : 0,
    samples: values.length, method: 'smoothed rolling-error empirical distribution; uncalibrated' };
}

export function buildNflForecast(input: NflForecastInput, event: UpcomingEvent, market: string, now = Date.now()) {
  const reasons: string[] = [], warnings = [
    'Experimental paper-only forecast; not a validated betting recommendation or calibrated probability.',
    'Opponent strength, weather, snap share and confirmed game-day availability are not modeled.',
    'Missing game-log rows may omit zero-opportunity appearances. Injuries and role changes can invalidate historical rates.',
  ];
  if (!NFL_CORE_STATS[market]) throw new Error('Unsupported NFL forecast market.');
  const cutoff = Math.min(now, Date.parse(event.commenceTime), Date.parse(input.asOf));
  if (!Number.isFinite(cutoff)) throw new Error('Invalid forecast cutoff.');
  if (Date.parse(event.commenceTime) <= now) reasons.push('Kickoff has passed.');
  if (event.sportKey !== 'americanfootball_nfl' || ![event.homeTeam, event.awayTeam].some(t => nflName(t) === nflName(input.player.team)))
    reasons.push('Player team does not match this NFL game.');
  if (now - Date.parse(input.asOf) > 5 * 60_000 || Date.parse(input.asOf) > now + 60_000) reasons.push('Forecast input snapshot is stale.');
  const { rows, excluded } = eligibleNflHistory(input.observations, input.player.teamId, cutoff, market);
  const point = nflPointForecast(rows);
  const evaluation = evaluateNflWalkForward(rows);
  const errors = evaluation.tests.slice(-20).map(t => t.error);
  if (!point) reasons.push(`Need at least ${NFL_FORECAST_POLICY.minTraining} complete same-team workload games with positive opportunities.`);
  if (errors.length < NFL_FORECAST_POLICY.minErrors) reasons.push(`Need ${NFL_FORECAST_POLICY.minErrors} rolling forecast errors; found ${errors.length}.`);
  if (point && (point.workloadRatio < 0.65 || point.workloadRatio > 1.35)) reasons.push('Recent workload differs materially from the longer-term role.');
  const latest = rows[rows.length - 1];
  if (!latest || cutoff - Date.parse(latest.date) > NFL_FORECAST_POLICY.maxAgeDays * 86400_000) reasons.push('Recent same-team history is unavailable.');
  if (evaluation.games >= NFL_FORECAST_POLICY.minErrors && evaluation.mae >= evaluation.baselineMae)
    reasons.push('Workload model did not beat the trailing-average baseline on this rolling diagnostic.');
  if (input.player.rosterStatus.toLowerCase() !== 'active') reasons.push(`Roster status is ${input.player.rosterStatus}.`);
  if (input.player.injuries.length) reasons.push('Roster injury flag requires review; no automatic recommendation.');
  if (!Number.isFinite(Date.parse(input.player.fetchedAt)) || now - Date.parse(input.player.fetchedAt) > 10 * 60_000
    || Date.parse(input.player.fetchedAt) > now + 60_000) reasons.push('Roster snapshot is stale or unverified.');
  const depthTime = Date.parse(input.depth.sourceTimestamp ?? '');
  if (!Number.isFinite(depthTime) || now - depthTime > 24 * 3600_000 || depthTime > now + 60_000)
    reasons.push('Depth-chart timestamp is stale or unknown.');
  if (!input.depth.rows.some(d => d.listedOrder === 1)) reasons.push('No first-listed depth-chart role; verify workload manually.');
  const currentGames = rows.filter(r => nflSeason(r.date) === nflSeason(event.commenceTime)).length;
  if (currentGames < 3) warnings.push('Fewer than three current-season games: heavy prior-season reliance and offseason role uncertainty.');
  const dataHash = createHash('sha256').update(JSON.stringify({ market, player: input.player.id, rows, asOf: input.asOf })).digest('hex');
  return { version: NFL_FORECAST_VERSION, mode: 'experimental_paper' as const, market, player: input.player,
    asOf: input.asOf, dataHash, sources: input.sources, depth: input.depth, observations: rows,
    usableGames: rows.length, excludedGames: excluded, currentSeasonGames: currentGames,
    point, evaluation, errors, reasons, warnings };
}
export type NflForecast = ReturnType<typeof buildNflForecast>;

export function assessNflQuote(forecast: NflForecast, quote: MarketQuote, allowedBooks: string[], now = Date.now()) {
  const reasons = [...forecast.reasons];
  if (quote.market !== forecast.market || nflName(quote.participant) !== nflName(forecast.player.name)) reasons.push('Quote identity does not match the forecast.');
  if (!allowedBooks.includes(quote.bookKey)) reasons.push('Sportsbook is not in your configured accessible books.');
  const age = now - Date.parse(quote.updatedAt ?? '');
  if (!Number.isFinite(age) || age > 15 * 60_000 || age < -60_000) reasons.push('Quote is stale or has no verified timestamp.');
  if (!Number.isFinite(quote.line) || !Number.isFinite(quote.price) || Math.abs(quote.price) < 100 || !['Over', 'Under'].includes(quote.side))
    return { quote, reasons: [...reasons, 'Invalid exact line, odds or side.'], probability: null, pushProbability: null,
      conditionalProbability: null, breakEvenProbability: null, estimatedEV: null, eligible: false };
  if (!forecast.point || forecast.errors.length < NFL_FORECAST_POLICY.minErrors) return { quote, reasons, probability: null,
    pushProbability: null, conditionalProbability: null, breakEvenProbability: null, estimatedEV: null, eligible: false };
  const dist = nflResidualDistribution(forecast.point.projection, forecast.errors, quote.market, quote.line);
  const probability = quote.side === 'Over' ? dist.over : dist.under;
  const lossProbability = quote.side === 'Over' ? dist.under : dist.over;
  const payout = quote.price > 0 ? quote.price / 100 : 100 / Math.abs(quote.price);
  const estimatedEV = probability * payout - lossProbability;
  const conditionalProbability = probability / (1 - dist.push);
  if (estimatedEV < NFL_FORECAST_POLICY.minEstimatedEV) reasons.push('Estimated paper EV is below the fixed 5% research threshold.');
  if (conditionalProbability < NFL_FORECAST_POLICY.minConditionalProbability) reasons.push('Estimated non-push probability is below the fixed 55% research threshold.');
  return { quote, probability, pushProbability: dist.push, conditionalProbability,
    breakEvenProbability: 1 / (1 + payout), estimatedEV, eligible: reasons.length === 0, reasons };
}
