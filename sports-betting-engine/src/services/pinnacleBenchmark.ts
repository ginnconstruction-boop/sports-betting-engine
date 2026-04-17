// ============================================================
// src/services/pinnacleBenchmark.ts
// Pinnacle Benchmark -- sharpest book as true market signal
// When available books differ from Pinnacle, that's an edge
// ============================================================

import { EventSummary, MarketKey } from '../types/odds';

// ------------------------------------
// Types
// ------------------------------------

export interface PinnacleEdge {
  eventId: string;
  marketKey: MarketKey;
  sideName: string;
  pinnaclePrice: number | null;
  pinnacleIsSharp: boolean;  // true if Pinnacle differs from consensus by >= threshold
  priceDelta: number | null; // user best price vs Pinnacle (positive = you have better price)
  lineDelta: number | null;  // line difference vs Pinnacle
  edgeDirection: 'with_sharp' | 'against_sharp' | 'neutral';
  sharpScore: number;        // 0-20 bonus (or negative penalty)
  detail: string;
}

// ------------------------------------
// Main extractor
// ------------------------------------

export function extractPinnacleEdges(
  summaries: EventSummary[],
  userBookKeys: string[]
): Map<string, PinnacleEdge[]> {
  const result = new Map<string, PinnacleEdge[]>();
  const PINNACLE_KEY = 'pinnacle';
  const SHARP_THRESHOLD = 8; // Pinnacle diverging from consensus by this much = sharp

  for (const summary of summaries) {
    const edges: PinnacleEdge[] = [];

    for (const [mKey, market] of Object.entries(summary.aggregatedMarkets)) {
      const marketKey = mKey as MarketKey;

      for (const side of market.sides) {
        // Find Pinnacle's offer
        const pinnacleOffer = side.offers.find(o => o.bookmakerKey === PINNACLE_KEY);
        if (!pinnacleOffer || pinnacleOffer.price === null) continue;

        const pinnaclePrice = pinnacleOffer.price;
        const consensusPrice = side.consensusPrice;

        if (consensusPrice === null) continue;

        // Find user's best price for same side
        const userOffers = side.offers
          .filter(o => userBookKeys.includes(o.bookmakerKey) && o.price !== null)
          .sort((a, b) => (b.price ?? -999) - (a.price ?? -999));

        const userBestPrice = userOffers[0]?.price ?? null;

        const priceDelta = userBestPrice !== null ? userBestPrice - pinnaclePrice : null;
        const pinnacleLine = pinnacleOffer.line;
        const consensusLine = side.consensusLine;
        const lineDelta = (pinnacleLine !== null && consensusLine !== null)
          ? pinnacleLine - consensusLine
          : null;

        // Is Pinnacle sharply diverging from consensus?
        const pinnacleIsSharp = Math.abs(pinnaclePrice - consensusPrice) >= SHARP_THRESHOLD;

        // Edge direction: is Pinnacle backing this side or fading it?
        // If Pinnacle price is BETTER than consensus (less negative = smaller favorite price
        // or more positive = better dog price) for this side -> Pinnacle is backing this side
        let edgeDirection: 'with_sharp' | 'against_sharp' | 'neutral';
        if (pinnaclePrice > consensusPrice) {
          // Pinnacle is offering a better price for this side -> backing it
          edgeDirection = 'with_sharp';
        } else if (pinnaclePrice < consensusPrice - 3) {
          // Pinnacle is offering a worse price -> fading this side
          edgeDirection = 'against_sharp';
        } else {
          edgeDirection = 'neutral';
        }

        // Sharp score
        let sharpScore = 0;
        if (edgeDirection === 'with_sharp' && pinnacleIsSharp) {
          sharpScore = 18;
        } else if (edgeDirection === 'with_sharp' && priceDelta !== null && Math.abs(priceDelta) >= 5) {
          sharpScore = 10;
        } else if (edgeDirection === 'against_sharp' && pinnacleIsSharp) {
          sharpScore = -15; // penalty
        }
        // neutral = 0

        // Build detail string
        let detail: string;
        const priceDiff = pinnaclePrice - consensusPrice;
        if (edgeDirection === 'with_sharp') {
          detail = `Pinnacle ${pinnaclePrice > 0 ? '+' : ''}${pinnaclePrice} vs consensus ${consensusPrice > 0 ? '+' : ''}${consensusPrice} — sharp money on this side (${priceDiff > 0 ? '+' : ''}${priceDiff} pts)`;
        } else if (edgeDirection === 'against_sharp') {
          detail = `Pinnacle fading this side — ${pinnaclePrice > 0 ? '+' : ''}${pinnaclePrice} vs consensus ${consensusPrice > 0 ? '+' : ''}${consensusPrice} (sharp fade: ${priceDiff > 0 ? '+' : ''}${priceDiff} pts)`;
        } else {
          detail = `Pinnacle in line with consensus — no sharp divergence`;
        }

        edges.push({
          eventId: summary.eventId,
          marketKey,
          sideName: side.outcomeName,
          pinnaclePrice,
          pinnacleIsSharp,
          priceDelta,
          lineDelta,
          edgeDirection,
          sharpScore,
          detail,
        });
      }
    }

    if (edges.length > 0) {
      result.set(summary.eventId, edges);
    }
  }

  return result;
}
