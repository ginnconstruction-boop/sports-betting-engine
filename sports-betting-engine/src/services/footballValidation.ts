import type { NflPaperPick } from './nflPaper';
import { paperProfit } from './nflPaper';
export const VALIDATION_METHOD = 'paper-audit-v1-not-holdout';
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** Descriptive live paper evaluation, NOT a claim of unbiased backtesting.
 * Public logs can be revised; a frozen prospective cohort is still required.
 * Group same-game outcomes before drawdown and game-cluster resampling. */
export function footballPaperMetrics(picks: NflPaperPick[], now = Date.now()) {
  const groups = new Map<string, NflPaperPick[]>();
  for (const p of picks) {
    const key = [p.season, p.version, p.origin ?? 'manual', p.quote.market,p.collegeForecast?.safety?.classification??'legacy/manual'].join(' | ');
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups].map(([group, rows]) => {
    const settled = rows.filter(p => ['WIN','LOSS','PUSH'].includes(p.result) && Number.isFinite(p.quote.price) && Math.abs(p.quote.price) >= 100);
    const probabilistic = settled.filter(p => p.origin === 'model' && Number.isFinite(p.modelProbability)
      && Number.isFinite(p.modelPushProbability) && p.modelProbability >= 0 && p.modelPushProbability >= 0
      && p.modelProbability + p.modelPushProbability <= 1);
    const brier = mean(probabilistic.map(p => {
      const probabilities = [p.modelProbability, 1 - p.modelProbability - p.modelPushProbability, p.modelPushProbability];
      return probabilities.reduce((total, v, i) => total + (v - Number(['WIN','LOSS','PUSH'][i] === p.result)) ** 2, 0);
    }));
    const logLoss = mean(probabilistic.map(p => -Math.log(Math.max(1e-6,
      p.result === 'WIN' ? p.modelProbability : p.result === 'PUSH' ? p.modelPushProbability : 1 - p.modelProbability - p.modelPushProbability))));
    const bins = Array.from({ length: 5 }, (_, i) => {
      const xs = probabilistic.filter(p => p.result !== 'PUSH' && p.modelPushProbability < 1
        && Math.min(4, Math.floor(p.modelProbability / (1 - p.modelPushProbability) * 5)) === i);
      return { from: i / 5, to: (i + 1) / 5, count: xs.length,
        meanPredictedNonPush: mean(xs.map(p => p.modelProbability / (1 - p.modelPushProbability))),
        observedNonPushWinRate: mean(xs.map(p => Number(p.result === 'WIN'))) };
    });
    const games = new Map<string, { kickoff: string; profit: number; stake: number }>();
    for (const p of settled) {
      const g = games.get(p.event.id) ?? { kickoff: p.event.commenceTime, profit: 0, stake: 0 };
      g.profit += paperProfit(p.result, p.quote.price); g.stake++; games.set(p.event.id, g);
    }
    const gameRows = [...games.values()].sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
    let cumulative = 0, peak = 0, maxDrawdownUnits = 0;
    for (const g of gameRows) { cumulative += g.profit; peak = Math.max(peak, cumulative); maxDrawdownUnits = Math.max(maxDrawdownUnits, peak - cumulative); }
    // Fixed-seed cluster bootstrap; fewer than ten games is explicitly insufficient.
    let seed = 20260831;
    const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
    const simulations: number[] = [];
    if (gameRows.length >= 10) for (let i = 0; i < 1000; i++) {
      let profit = 0, stake = 0;
      for (let j = 0; j < gameRows.length; j++) { const g = gameRows[Math.floor(random() * gameRows.length)]; profit += g.profit; stake += g.stake; }
      simulations.push(profit / stake);
    }
    simulations.sort((a, b) => a - b);
    const started = rows.filter(p => Date.parse(p.event.commenceTime) <= now);
    return { group, tracked: rows.length, settled: settled.length, distinctSettledGames: gameRows.length,
      unresolved: rows.filter(p => p.result === 'PENDING' || p.result === 'REVIEW').length,
      probabilityScored: probabilistic.length, multiclassBrier: brier, logLoss, calibration: bins,
      profitUnits: cumulative, roi: settled.length ? cumulative / settled.length : null, maxDrawdownUnits,
      approximateGameClusterRoiInterval: simulations.length ? [simulations[24], simulations[974]] : null,
      closeWindowCaptured: started.filter(p => !!p.closeWindow).length,
      closeWindowMissed: started.filter(p => !p.closeWindow).length,
      settlementRevisions: rows.reduce((sum, p) => sum + (p.gradingAudit ?? []).filter((a, i, all) =>
        i > 0 && (a.result !== all[i - 1].result || a.actual !== all[i - 1].actual)).length, 0),
      note: 'Descriptive paper record, not holdout validation. Multiclass Brier uses win/loss/push; log loss clipped at 1e-6. Calibration excludes pushes. Drawdown groups same-game results. Cluster interval needs 10 games and assumes games are exchangeable; season/model dependence remains. Close-window observations are not verified final closing quotes.' };
  });
}
