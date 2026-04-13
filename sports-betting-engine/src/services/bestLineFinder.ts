// ============================================================
// src/services/bestLineFinder.ts
// Priority #1 feature -- finds the best available line
// across all books for every market and every side
// ============================================================

import { EventSummary, AggregatedSide, MarketKey } from '../types/odds';
import { getBookmakerDisplayName } from '../config/bookmakers';

export interface BestLineResult {
  matchup: string;
  sport: string;
  startTime: string;
  markets: BestLineMarket[];
}

export interface BestLineMarket {
  marketKey: MarketKey;
  marketLabel: string;
  sides: BestLineSide[];
  lineDiscrepancy: boolean;   // true if books disagree on the line number
  discrepancyDetail: string;
}

export interface BestLineSide {
  outcomeName: string;
  bestPrice: number;
  bestBook: string;
  bestBookDisplay: string;
  bestLine: number | null;
  consensusPrice: number;
  consensusLine: number | null;
  priceDiffVsConsensus: number;  // how much better best price is vs consensus
  allOffers: Array<{
    book: string;
    line: number | null;
    price: number;
  }>;
}

// ------------------------------------
// Helpers
// ------------------------------------

function marketLabel(key: MarketKey): string {
  const labels: Record<string, string> = {
    h2h: 'Moneyline',
    spreads: 'Spread / Run Line / Puck Line',
    totals: 'Total (Over/Under)',
    team_totals: 'Team Totals',
    h2h_h1: 'First Half ML',
    h2h_q1: 'First Quarter ML',
    h2h_p1: 'First Period ML',
  };
  return labels[key] ?? key.toUpperCase().replace(/_/g, ' ');
}

function formatPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

// ------------------------------------
// Build best line result for one event
// ------------------------------------

export function findBestLines(summary: EventSummary): BestLineResult {
  const markets: BestLineMarket[] = [];

  for (const [mKey, market] of Object.entries(summary.aggregatedMarkets)) {
    const sides: BestLineSide[] = [];

    for (const side of market.sides) {
      if (side.bestPrice === null || side.bestBook === null) continue;
      if (side.consensusPrice === null) continue;

      const allOffers = side.offers
        .filter(o => o.price !== null)
        .map(o => ({
          book: getBookmakerDisplayName(o.bookmakerKey),
          line: o.line,
          price: o.price as number,
        }))
        .sort((a, b) => b.price - a.price); // best price first

      const priceDiff = side.bestPrice - side.consensusPrice;

      sides.push({
        outcomeName: side.outcomeName,
        bestPrice: side.bestPrice,
        bestBook: side.bestBook,
        bestBookDisplay: getBookmakerDisplayName(side.bestBook),
        bestLine: side.bestLine,
        consensusPrice: side.consensusPrice,
        consensusLine: side.consensusLine,
        priceDiffVsConsensus: Math.round(priceDiff),
        allOffers,
      });
    }

    // Detect line discrepancy -- books disagree on the spread/total number
    let lineDiscrepancy = false;
    let discrepancyDetail = '';
    const allLines = market.sides
      .flatMap(s => s.offers.map(o => o.line))
      .filter((l): l is number => l !== null);
    if (allLines.length > 1) {
      const uniqueLines = [...new Set(allLines)];
      if (uniqueLines.length > 1) {
        lineDiscrepancy = true;
        discrepancyDetail = `Books split: ${uniqueLines.sort((a,b) => a-b).join(' vs ')}`;
      }
    }

    markets.push({
      marketKey: mKey as MarketKey,
      marketLabel: marketLabel(mKey as MarketKey),
      sides,
      lineDiscrepancy,
      discrepancyDetail,
    });
  }

  return {
    matchup: summary.matchup,
    sport: summary.sport,
    startTime: summary.startTime,
    markets,
  };
}

// ------------------------------------
// Run best line finder across all events
// ------------------------------------

export function findAllBestLines(summaries: EventSummary[]): BestLineResult[] {
  return summaries.map(findBestLines);
}

// ------------------------------------
// Console printer for best lines
// ------------------------------------

export function printBestLines(results: BestLineResult[]): void {

  // Group by sport
  const bySport = new Map<string, BestLineResult[]>();
  for (const r of results) {
    const list = bySport.get(r.sport) ?? [];
    list.push(r);
    bySport.set(r.sport, list);
  }

  for (const [sport, games] of bySport) {
    console.log(`\n${'='.repeat(62)}`);
    console.log(`  ? ${sport} -- Best Lines`);
    console.log(`${'='.repeat(62)}`);

    for (const game of games) {
      const time = new Date(game.startTime).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });

      console.log(`\n  ? ${game.matchup}`);
      console.log(`     ${time}`);

      for (const market of game.markets) {
        console.log(`\n  +- ${market.marketLabel}`);

        if (market.lineDiscrepancy) {
          console.log(`  |  [!]?  LINE SPLIT: ${market.discrepancyDetail}`);
        }

        for (const side of market.sides) {
          const lineStr = side.bestLine !== null
            ? ` (${side.bestLine > 0 ? '+' : ''}${side.bestLine})`
            : '';

          const diffStr = side.priceDiffVsConsensus !== 0
            ? ` [${side.priceDiffVsConsensus > 0 ? '+' : ''}${side.priceDiffVsConsensus} vs consensus]`
            : '';

          console.log(`  |`);
          console.log(`  |  ${side.outcomeName}`);
          console.log(`  |    ? Best : ${formatPrice(side.bestPrice)}${lineStr} @ ${side.bestBookDisplay}${diffStr}`);
          console.log(`  |    [~] Consensus: ${formatPrice(side.consensusPrice)}${side.consensusLine !== null ? ` (${side.consensusLine > 0 ? '+' : ''}${side.consensusLine})` : ''}`);

          if (side.allOffers.length > 1) {
            console.log(`  |    ? All books:`);
            for (const offer of side.allOffers) {
              const lineDisp = offer.line !== null ? ` (${offer.line > 0 ? '+' : ''}${offer.line})` : '';
              const isBest = offer.price === side.bestPrice ? ' ? BEST' : '';
              console.log(`  |       ${offer.book.padEnd(18)} ${formatPrice(offer.price).padStart(6)}${lineDisp}${isBest}`);
            }
          }
        }
        console.log(`  +${'-'.repeat(50)}`);
      }
    }
  }
}
