import { NflPaperPick, paperProfit } from './nflPaper';
import { NFL_CORE_STATS } from './nflResearch';

export const NFL_FORWARD_GATE_VERSION = 'nfl-forward-gate-v1-2026-09-06';

/** Frozen before the first 2026 regular-season result in this ledger.
 * These are research-promotion gates, not real-money approval criteria. */
export const NFL_FORWARD_GATE_POLICY = Object.freeze({
  minimumSettledPicks: 100,
  minimumDistinctGames: 50,
  minimumVerifiedCloses: 70,
  minimumBaselineMaeImprovement: 0.05,
  maximumBinaryBrier: 0.245,
  maximumCalibrationGap: 0.05,
  minimumCalibrationBinSize: 20,
  minimumMeanLineClv: 0,
  minimumPositiveLineClvRate: 0.5,
  requirePositiveGameClusterRoiLowerBound: true,
});

const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const round = (value: number | null, places = 4) => value === null ? null : Number(value.toFixed(places));
const implied = (price: number) => price < 0 ? Math.abs(price) / (Math.abs(price) + 100) : 100 / (price + 100);

export function nflObservedClv(pick: NflPaperPick) {
  const close = pick.closeWindow;
  if (!close || !Number.isFinite(pick.quote.price) || !Number.isFinite(close.price)) return null;
  const openingLine = pick.quote.line, closingLine = close.line;
  let lineClv: number | null = null;
  if (Number.isFinite(openingLine) && Number.isFinite(closingLine)) {
    if (pick.quote.market === 'spreads' || pick.quote.side === 'Over') lineClv = openingLine! - closingLine!;
    else if (pick.quote.side === 'Under') lineClv = closingLine! - openingLine!;
  }
  const priceClvProbability = openingLine === closingLine ? implied(close.price) - implied(pick.quote.price) : null;
  return { lineClv: round(lineClv), priceClvProbability: round(priceClvProbability), verified: close.method === 'verified_same_book_final_close',
    method: close.method, openingLine, closingLine, openingPrice: pick.quote.price, closingPrice: close.price };
}

function clusteredRoiInterval(rows: NflPaperPick[]) {
  const games = new Map<string, { profit: number; stake: number }>();
  for (const pick of rows) {
    const game = games.get(pick.event.id) ?? { profit: 0, stake: 0 };
    game.profit += paperProfit(pick.result, pick.quote.price); game.stake++; games.set(pick.event.id, game);
  }
  const values = [...games.values()];
  if (values.length < 10) return null;
  let seed = 20260906;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const simulations: number[] = [];
  for (let i = 0; i < 2000; i++) {
    let profit = 0, stake = 0;
    for (let j = 0; j < values.length; j++) { const game = values[Math.floor(random() * values.length)]; profit += game.profit; stake += game.stake; }
    simulations.push(profit / stake);
  }
  simulations.sort((a, b) => a - b);
  return [round(simulations[49]), round(simulations[1949])];
}

export function nflForwardGate(picks: NflPaperPick[]) {
  const markets = Object.keys(NFL_CORE_STATS).map(market => {
    const all = picks.filter(p => p.origin === 'model' && p.quote.market === market);
    const settled = all.filter(p => ['WIN', 'LOSS', 'PUSH'].includes(p.result));
    const nonPush = settled.filter(p => p.result !== 'PUSH' && Number.isFinite(p.modelProbability) && Number.isFinite(p.modelPushProbability)
      && p.modelProbability! >= 0 && p.modelPushProbability! >= 0 && p.modelProbability! + p.modelPushProbability! < 1);
    const scored = nonPush.map(p => ({ pick: p, probability: p.modelProbability! / (1 - p.modelPushProbability!) }));
    const binaryBrier = mean(scored.map(({ pick, probability }) => (probability - Number(pick.result === 'WIN')) ** 2));
    const calibration = [[.5,.55],[.55,.6],[.6,.65],[.65,.7],[.7,1.000001]].map(([from,to]) => {
      const rows = scored.filter(row => row.probability >= from && row.probability < to);
      const predicted = mean(rows.map(row => row.probability)), observed = mean(rows.map(row => Number(row.pick.result === 'WIN')));
      return { from, to: Math.min(1, to), count: rows.length, meanPredicted: round(predicted), observedWinRate: round(observed),
        gap: predicted === null || observed === null ? null : round(Math.abs(predicted - observed)) };
    });
    const eligibleBins = calibration.filter(bin => bin.count >= NFL_FORWARD_GATE_POLICY.minimumCalibrationBinSize);
    const maximumCalibrationGap = eligibleBins.length ? Math.max(...eligibleBins.map(bin => bin.gap!)) : null;
    const forecastRows = settled.filter(p => Number.isFinite(p.actual) && Number.isFinite(p.forecast?.point?.projection) && Number.isFinite(p.forecast?.point?.baseline));
    const modelMae = mean(forecastRows.map(p => Math.abs(p.actual! - p.forecast!.point!.projection)));
    const baselineMae = mean(forecastRows.map(p => Math.abs(p.actual! - p.forecast!.point!.baseline)));
    const improvement = modelMae !== null && baselineMae !== null && baselineMae > 0 ? (baselineMae - modelMae) / baselineMae : null;
    const closes = all.map(nflObservedClv).filter((row): row is NonNullable<ReturnType<typeof nflObservedClv>> => !!row);
    const verified = closes.filter(row => row.verified), verifiedLines = verified.filter(row => row.lineClv !== null);
    const meanLineClv = mean(verifiedLines.map(row => row.lineClv!));
    const positiveLineClvRate = verifiedLines.length ? verifiedLines.filter(row => row.lineClv! > 0).length / verifiedLines.length : null;
    const roiInterval = clusteredRoiInterval(settled);
    const distinctGames = new Set(settled.map(p => p.event.id)).size;
    const checks = [
      { id: 'settled_sample', pass: settled.length >= NFL_FORWARD_GATE_POLICY.minimumSettledPicks, value: settled.length, required: NFL_FORWARD_GATE_POLICY.minimumSettledPicks as number|string },
      { id: 'distinct_games', pass: distinctGames >= NFL_FORWARD_GATE_POLICY.minimumDistinctGames, value: distinctGames, required: NFL_FORWARD_GATE_POLICY.minimumDistinctGames as number|string },
      { id: 'baseline_improvement', pass: improvement !== null && improvement >= NFL_FORWARD_GATE_POLICY.minimumBaselineMaeImprovement, value: round(improvement), required: NFL_FORWARD_GATE_POLICY.minimumBaselineMaeImprovement as number|string },
      { id: 'binary_brier', pass: binaryBrier !== null && binaryBrier <= NFL_FORWARD_GATE_POLICY.maximumBinaryBrier, value: round(binaryBrier), required: NFL_FORWARD_GATE_POLICY.maximumBinaryBrier as number|string },
      { id: 'calibration', pass: maximumCalibrationGap !== null && maximumCalibrationGap <= NFL_FORWARD_GATE_POLICY.maximumCalibrationGap, value: round(maximumCalibrationGap), required: NFL_FORWARD_GATE_POLICY.maximumCalibrationGap as number|string },
      { id: 'verified_closes', pass: verified.length >= NFL_FORWARD_GATE_POLICY.minimumVerifiedCloses, value: verified.length, required: NFL_FORWARD_GATE_POLICY.minimumVerifiedCloses as number|string },
      { id: 'mean_line_clv', pass: meanLineClv !== null && meanLineClv > NFL_FORWARD_GATE_POLICY.minimumMeanLineClv, value: round(meanLineClv), required: `>${NFL_FORWARD_GATE_POLICY.minimumMeanLineClv}` },
      { id: 'positive_line_clv_rate', pass: positiveLineClvRate !== null && positiveLineClvRate > NFL_FORWARD_GATE_POLICY.minimumPositiveLineClvRate, value: round(positiveLineClvRate), required: `>${NFL_FORWARD_GATE_POLICY.minimumPositiveLineClvRate}` },
      { id: 'roi_uncertainty', pass: !!roiInterval && roiInterval[0]! > 0, value: roiInterval, required: 'game-cluster 95% lower bound > 0' },
    ];
    return { market, status: checks.every(check => check.pass) ? 'ELIGIBLE_FOR_SEPARATE_CALIBRATION_REVIEW' : 'COLLECTING_FORWARD_EVIDENCE',
      tracked: all.length, settled: settled.length, distinctGames, modelMae: round(modelMae), baselineMae: round(baselineMae),
      baselineMaeImprovement: round(improvement), binaryBrier: round(binaryBrier), calibration, observedCloseWindows: closes.length,
      verifiedCloses: verified.length, meanVerifiedLineClv: round(meanLineClv), positiveVerifiedLineClvRate: round(positiveLineClvRate),
      gameClusterRoiInterval: roiInterval, checks };
  });
  return { version: NFL_FORWARD_GATE_VERSION, policy: NFL_FORWARD_GATE_POLICY, markets, moneyBettingApproved: false, kellyEnabled: false,
    note: 'Frozen per-market forward gate. Passing it permits a separate calibration/model review only; it never enables real-money betting. Late observed quotes are reported but do not count as verified closing lines.' };
}
