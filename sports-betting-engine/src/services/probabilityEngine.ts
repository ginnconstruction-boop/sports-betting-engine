import { DecisionCandidate } from './decisionTypes';

/** Legacy scores are rankings, not calibrated probabilities. Price break-even
 * is descriptive; it is not an estimate of a team's chance of winning.
 * The separate NFL paper model does not use this legacy enrichment path. */
export function enrichWithProbability(candidates: DecisionCandidate[]): DecisionCandidate[] {
  return candidates.map(c => ({ ...c,
    winProbability: undefined, impliedEdge: undefined,
    adjustedWinProbability: undefined, adjustedEdge: undefined, weightedAdjustedEdge: undefined,
    impliedProbabilityFromBestPrice: Number.isFinite(c.bestPrice) && Math.abs(c.bestPrice) >= 100
      ? c.bestPrice > 0 ? 100 / (c.bestPrice + 100) : -c.bestPrice / (100 - c.bestPrice)
      : undefined,
  }));
}
export function printProbabilitySummary(candidates: DecisionCandidate[]): void {
  if (candidates.length) console.log('[PROB] Research rankings only; no calibrated win probabilities or betting edges.');
}
