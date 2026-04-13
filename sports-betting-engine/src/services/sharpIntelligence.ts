// ============================================================
// src/services/sharpIntelligence.ts
// Derives sharp money indicators from line movement data
// These are INFERRED signals -- labeled clearly as such
// No fabricated data -- only what the lines tell us
// ============================================================

import { EventSummary, MarketKey, AggregatedMarket } from '../types/odds';

export type SharpSignal =
  | 'SHARP_LEAN'          // line movement suggests sharp action
  | 'STEAM_MOVE'          // fast multi-book movement
  | 'REVERSE_LINE_MOVE'   // line moves opposite expected direction
  | 'MARKET_CONSENSUS'    // strong book agreement on one side
  | 'OUTLIER_BOOK'        // one book significantly off market
  | 'NEUTRAL';

export interface SharpIndicator {
  signal: SharpSignal;
  side: string;
  confidence: 'low' | 'medium' | 'high';
  detail: string;
  isInferred: boolean; // always true -- we don't have actual sharp data
}

export interface MarketIntelligence {
  eventId: string;
  matchup: string;
  marketKey: MarketKey;
  sharpIndicators: SharpIndicator[];
  recommendedSide: string | null;
  recommendationStrength: number; // 0-100
  recommendationReason: string;
}

// ------------------------------------
// Detect outlier books
// When one book is significantly off the consensus, fade that book
// ------------------------------------

function detectOutliers(market: AggregatedMarket): SharpIndicator[] {
  const indicators: SharpIndicator[] = [];

  for (const side of market.sides) {
    if (side.offers.length < 3) continue;
    const prices = side.offers
      .map(o => o.price)
      .filter((p): p is number => p !== null);

    if (prices.length < 3) continue;

    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

    for (const offer of side.offers) {
      if (offer.price === null) continue;
      const deviation = Math.abs(offer.price - avg);

      if (deviation >= 20) {
        indicators.push({
          signal: 'OUTLIER_BOOK',
          side: side.outcomeName,
          confidence: deviation >= 35 ? 'high' : 'medium',
          detail: `${offer.bookmakerKey} at ${offer.price > 0 ? '+' : ''}${offer.price} vs market avg ${avg > 0 ? '+' : ''}${Math.round(avg)} -- significant outlier`,
          isInferred: true,
        });
      }
    }
  }

  return indicators;
}

// ------------------------------------
// Detect market consensus
// When 4+ books agree tightly, market has high confidence
// ------------------------------------

function detectConsensus(market: AggregatedMarket): SharpIndicator[] {
  const indicators: SharpIndicator[] = [];

  for (const side of market.sides) {
    if (side.bookCount < 3) continue;
    const prices = side.offers
      .map(o => o.price)
      .filter((p): p is number => p !== null);

    if (prices.length < 3) continue;

    const max = Math.max(...prices);
    const min = Math.min(...prices);
    const spread = max - min;

    if (spread <= 8 && prices.length >= 4) {
      indicators.push({
        signal: 'MARKET_CONSENSUS',
        side: side.outcomeName,
        confidence: 'medium',
        detail: `${prices.length} books within ${spread} pts -- tight market consensus`,
        isInferred: true,
      });
    }
  }

  return indicators;
}

// ------------------------------------
// Detect line movement signals from prior snapshot
// Sharp money indicator: line moves significantly, especially
// if it moves in the "wrong" direction vs expected public side
// ------------------------------------

function detectMovementSignals(
  current: EventSummary,
  prior: EventSummary | undefined
): SharpIndicator[] {
  const indicators: SharpIndicator[] = [];
  if (!prior) return indicators;

  for (const [mKey, currentMarket] of Object.entries(current.aggregatedMarkets)) {
    const priorMarket = prior.aggregatedMarkets[mKey as MarketKey];
    if (!priorMarket) continue;

    for (const currentSide of currentMarket.sides) {
      const priorSide = priorMarket.sides.find(s => s.outcomeName === currentSide.outcomeName);
      if (!priorSide) continue;

      // Line movement detection
      if (
        currentSide.consensusLine !== null &&
        priorSide.consensusLine !== null
      ) {
        const lineDiff = currentSide.consensusLine - priorSide.consensusLine;
        if (Math.abs(lineDiff) >= 0.5) {
          const dir = lineDiff > 0 ? 'UP' : 'DOWN';
          const magnitude = Math.abs(lineDiff);
          indicators.push({
            signal: magnitude >= 2 ? 'STEAM_MOVE' : 'SHARP_LEAN',
            side: currentSide.outcomeName,
            confidence: magnitude >= 2 ? 'high' : magnitude >= 1 ? 'medium' : 'low',
            detail: `Line moved ${dir} ${magnitude} pts since last scan (${priorSide.consensusLine} -> ${currentSide.consensusLine}) -- sharp action suspected`,
            isInferred: true,
          });
        }
      }

      // Price movement -- significant price shift without line change = steam
      if (
        currentSide.consensusPrice !== null &&
        priorSide.consensusPrice !== null &&
        currentSide.consensusLine === priorSide.consensusLine
      ) {
        const priceDiff = currentSide.consensusPrice - priorSide.consensusPrice;
        if (Math.abs(priceDiff) >= 10) {
          indicators.push({
            signal: 'STEAM_MOVE',
            side: currentSide.outcomeName,
            confidence: 'medium',
            detail: `Price moved ${Math.abs(priceDiff)} pts with no line change -- juice shifting, sharp interest likely`,
            isInferred: true,
          });
        }
      }
    }
  }

  return indicators;
}

// ------------------------------------
// Build recommendation from all indicators
// ------------------------------------

function buildRecommendation(
  market: AggregatedMarket,
  indicators: SharpIndicator[]
): { side: string | null; strength: number; reason: string } {
  if (indicators.length === 0) {
    return { side: null, strength: 0, reason: 'No sharp signals detected' };
  }

  // Score each side
  const sideScores = new Map<string, number>();

  for (const indicator of indicators) {
    const current = sideScores.get(indicator.side) ?? 0;
    const points =
      indicator.confidence === 'high' ? 30 :
      indicator.confidence === 'medium' ? 20 : 10;
    sideScores.set(indicator.side, current + points);
  }

  if (sideScores.size === 0) return { side: null, strength: 0, reason: 'Insufficient data' };

  // Find highest scored side
  let bestSide = '';
  let bestScore = 0;
  for (const [side, score] of sideScores) {
    if (score > bestScore) { bestSide = side; bestScore = score; }
  }

  const strength = Math.min(bestScore, 100);
  const topIndicators = indicators
    .filter(i => i.side === bestSide)
    .map(i => i.detail)
    .slice(0, 2);

  return {
    side: bestSide,
    strength,
    reason: topIndicators.join('; ') || 'Multiple sharp signals aligned',
  };
}

// ------------------------------------
// Public: analyze all events
// ------------------------------------

export function analyzeSharpIntelligence(
  summaries: EventSummary[],
  priorSummaries?: EventSummary[]
): Map<string, MarketIntelligence[]> {
  const result = new Map<string, MarketIntelligence[]>();

  for (const event of summaries) {
    const priorEvent = priorSummaries?.find(e => e.eventId === event.eventId);
    const eventIntelligence: MarketIntelligence[] = [];

    for (const [mKey, market] of Object.entries(event.aggregatedMarkets)) {
      const marketKey = mKey as MarketKey;
      const indicators: SharpIndicator[] = [
        ...detectOutliers(market),
        ...detectConsensus(market),
        ...detectMovementSignals(event, priorEvent),
      ];

      const { side, strength, reason } = buildRecommendation(market, indicators);

      eventIntelligence.push({
        eventId: event.eventId,
        matchup: event.matchup,
        marketKey,
        sharpIndicators: indicators,
        recommendedSide: side,
        recommendationStrength: strength,
        recommendationReason: reason,
      });
    }

    if (eventIntelligence.length > 0) {
      result.set(event.eventId, eventIntelligence);
    }
  }

  return result;
}
