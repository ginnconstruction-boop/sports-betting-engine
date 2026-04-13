// ============================================================
// src/services/clvProjection.ts
// Closing Line Value projection
// Projects where the line will close based on movement patterns
// If we're getting a better number than projected close = real edge
// ============================================================

import { EventSummary, MarketKey } from '../types/odds';

export interface CLVProjection {
  marketKey: MarketKey;
  outcomeName: string;
  currentConsensusLine: number | null;
  currentConsensusPrice: number | null;
  projectedClosingLine: number | null;
  projectedClosingPrice: number | null;
  ourLine: number | null;
  ourPrice: number | null;
  projectedCLV: number | null;       // ourPrice - projectedClose (positive = beating close)
  projectedLineCLV: number | null;   // ourLine vs projectedClose line
  confidence: 'high' | 'medium' | 'low';
  detail: string;
  isBeatingProjectedClose: boolean;
}

// ------------------------------------
// Project closing line from movement history
// ------------------------------------

export function projectClosingLine(
  current: EventSummary,
  prior: EventSummary | null,
  hoursUntilGame: number
): CLVProjection[] {
  const projections: CLVProjection[] = [];

  for (const [mKey, currentMarket] of Object.entries(current.aggregatedMarkets)) {
    const marketKey = mKey as MarketKey;
    const priorMarket = prior?.aggregatedMarkets[marketKey];

    for (const currentSide of currentMarket.sides) {
      const priorSide = priorMarket?.sides.find(s => s.outcomeName === currentSide.outcomeName);

      // Calculate movement rate
      let lineMoveRate = 0;   // points per hour
      let priceMoveRate = 0;  // price points per hour

      if (priorSide && prior) {
        const timeDiff = 4; // assume ~4 hours between morning and midday scans

        if (currentSide.consensusLine !== null && priorSide.consensusLine !== null) {
          lineMoveRate = (currentSide.consensusLine - priorSide.consensusLine) / timeDiff;
        }
        if (currentSide.consensusPrice !== null && priorSide.consensusPrice !== null) {
          priceMoveRate = (currentSide.consensusPrice - priorSide.consensusPrice) / timeDiff;
        }
      }

      // Project closing line = current + (rate * hours remaining)
      // Apply dampening factor -- lines don't always keep moving at same rate
      const dampeningFactor = hoursUntilGame > 6 ? 0.5 : 0.3;

      const projectedLine = currentSide.consensusLine !== null
        ? Math.round((currentSide.consensusLine + lineMoveRate * hoursUntilGame * dampeningFactor) * 2) / 2
        : null;

      const projectedPrice = currentSide.consensusPrice !== null
        ? Math.round(currentSide.consensusPrice + priceMoveRate * hoursUntilGame * dampeningFactor)
        : null;

      // Our best accessible line
      const ourLine = currentSide.bestLine;
      const ourPrice = currentSide.bestPrice;

      // CLV = our price vs projected closing price
      const projectedCLV = ourPrice !== null && projectedPrice !== null
        ? ourPrice - projectedPrice
        : null;

      const projectedLineCLV = ourLine !== null && projectedLine !== null
        ? ourLine - projectedLine
        : null;

      const isBeatingProjectedClose = (projectedCLV !== null && projectedCLV > 0) ||
        (projectedLineCLV !== null && Math.abs(projectedLineCLV) >= 0.5);

      // Confidence based on whether we have prior data
      const confidence: CLVProjection['confidence'] = priorSide
        ? (Math.abs(lineMoveRate) >= 0.1 || Math.abs(priceMoveRate) >= 2 ? 'high' : 'medium')
        : 'low';

      let detail = '';
      if (projectedCLV !== null && projectedCLV > 2) {
        detail = `Projected to beat closing price by ${projectedCLV} pts -- line likely closing at ${projectedPrice}`;
      } else if (projectedLineCLV !== null && Math.abs(projectedLineCLV) >= 0.5) {
        detail = `Getting ${projectedLineCLV > 0 ? 'better' : 'worse'} number than projected close`;
      } else if (prior) {
        detail = `Line stable -- no significant movement projected`;
      } else {
        detail = `First scan -- no movement history yet`;
      }

      projections.push({
        marketKey,
        outcomeName: currentSide.outcomeName,
        currentConsensusLine: currentSide.consensusLine,
        currentConsensusPrice: currentSide.consensusPrice,
        projectedClosingLine: projectedLine,
        projectedClosingPrice: projectedPrice,
        ourLine,
        ourPrice,
        projectedCLV,
        projectedLineCLV,
        confidence,
        detail,
        isBeatingProjectedClose,
      });
    }
  }

  return projections;
}

// ------------------------------------
// Get CLV projections for all events
// ------------------------------------

export function getAllCLVProjections(
  currentSummaries: EventSummary[],
  priorSummaries: EventSummary[],
  hoursUntilGameMap: Map<string, number>
): Map<string, CLVProjection[]> {
  const result = new Map<string, CLVProjection[]>();
  const priorMap = new Map(priorSummaries.map(e => [e.eventId, e]));

  for (const event of currentSummaries) {
    const prior = priorMap.get(event.eventId) ?? null;
    const hours = hoursUntilGameMap.get(event.eventId) ?? 12;
    const projections = projectClosingLine(event, prior, hours);
    if (projections.length > 0) {
      result.set(event.eventId, projections);
    }
  }

  return result;
}
