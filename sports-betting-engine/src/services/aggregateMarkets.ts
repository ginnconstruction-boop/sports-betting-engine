// ============================================================
// src/services/aggregateMarkets.ts
// Aggregates normalized rows into event-level market summaries
// Works identically across all sports and all market types
// ============================================================

import {
  NormalizedOddsRow,
  AggregatedMarket,
  AggregatedSide,
  BookOffer,
  EventSummary,
  MarketKey,
  TradingFlag,
} from '../types/odds';
import {
  groupRowsByEvent,
  extractEventMetas,
  NormalizedEventMeta,
} from './normalizeOdds';
import { logger } from '../utils/logger';

// Threshold: if a book's last_update is older than this, flag as stale
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
// Disagreement threshold: if consensus line spread > this, flag
const DISAGREEMENT_LINE_THRESHOLD = 1.5;
const DISAGREEMENT_PRICE_THRESHOLD = 15; // in american odds points

// ------------------------------------
// Helpers
// ------------------------------------

/**
 * Convert american odds to implied probability.
 * Used for consensus price calculations.
 */
function americanToImplied(american: number): number {
  if (american >= 100) {
    return 100 / (american + 100);
  }
  return Math.abs(american) / (Math.abs(american) + 100);
}

/**
 * Convert implied probability back to american odds.
 */
function impliedToAmerican(implied: number): number {
  if (implied <= 0 || implied >= 1) return 0;
  if (implied >= 0.5) {
    return Math.round(-(implied / (1 - implied)) * 100);
  }
  return Math.round(((1 - implied) / implied) * 100);
}

/**
 * Best price for favorites: highest negative (least juice on dog), lowest negative for dog = most negative.
 * For american odds: higher number = better for bettor on both sides.
 * +150 > +130 (better underdog price)
 * -110 > -120 (better favorite price -- less juice)
 */
function isBetterPrice(candidate: number, current: number): boolean {
  return candidate > current;
}

function isBetterLine(marketKey: MarketKey, candidate: number, current: number, outcomeName: string): boolean {
  // For spreads: lower number is better for the favorite (team getting -X), higher is better for the dog
  // We store best line as the most favorable across books -- caller context matters
  // For totals: higher over line is worse, lower over line is better for "over" bettors
  // We compute best per side, so just track the line that corresponds to the best price
  return candidate !== current; // aggregation handles this per-side
}

function isStale(lastUpdate: string): boolean {
  if (!lastUpdate) return true;
  const updateTime = new Date(lastUpdate).getTime();
  return Date.now() - updateTime > STALE_THRESHOLD_MS;
}

// ------------------------------------
// Aggregate a single market across all books for one event
// ------------------------------------

function aggregateMarket(
  rows: NormalizedOddsRow[],
  marketKey: MarketKey
): AggregatedMarket | null {
  const marketRows = rows.filter((r) => r.marketKey === marketKey);
  if (marketRows.length === 0) return null;

  // Group by outcome name
  const outcomeMap = new Map<string, NormalizedOddsRow[]>();
  for (const row of marketRows) {
    const existing = outcomeMap.get(row.outcomeName) ?? [];
    existing.push(row);
    outcomeMap.set(row.outcomeName, existing);
  }

  const sides: AggregatedSide[] = [];
  const allPrices: number[] = [];

  for (const [outcomeName, outcomeRows] of outcomeMap) {
    const offers: BookOffer[] = outcomeRows.map((r) => ({
      bookmakerKey: r.bookmakerKey,
      bookmakerTitle: r.bookmakerTitle,
      line: r.line,
      price: r.price,
      lastUpdate: r.lastUpdate,
    }));

    const validPrices = offers
      .map((o) => o.price)
      .filter((p): p is number => p !== null && isFinite(p));

    const validLines = offers
      .map((o) => o.line)
      .filter((l): l is number => l !== null && isFinite(l));

    allPrices.push(...validPrices);

    // Best price = highest american odds number (best value for bettor)
    let bestPrice: number | null = null;
    let bestLine: number | null = null;
    let bestBook: string | null = null;

    for (const offer of offers) {
      if (offer.price === null) continue;
      if (bestPrice === null || isBetterPrice(offer.price, bestPrice)) {
        bestPrice = offer.price;
        bestLine = offer.line;
        bestBook = offer.bookmakerKey;
      }
    }

    // Consensus price = average implied probability -> back to american
    const consensusPrice =
      validPrices.length > 0
        ? impliedToAmerican(
            validPrices.reduce((sum, p) => sum + americanToImplied(p), 0) /
              validPrices.length
          )
        : null;

    // Consensus line = median
    const consensusLine =
      validLines.length > 0
        ? validLines.sort((a, b) => a - b)[Math.floor(validLines.length / 2)]
        : null;

    sides.push({
      outcomeName,
      bestPrice,
      bestLine,
      bestBook,
      consensusPrice,
      consensusLine,
      bookCount: offers.length,
      offers,
    });
  }

  // Unique book count for this market
  const uniqueBooks = new Set(marketRows.map((r) => r.bookmakerKey));
  const bookCount = uniqueBooks.size;

  // Disagreement score (0-1)
  let disagreementScore = 0;
  if (allPrices.length > 1) {
    const max = Math.max(...allPrices);
    const min = Math.min(...allPrices);
    const spread = Math.abs(max - min);
    disagreementScore = Math.min(spread / 100, 1); // normalize to 0-1 range
  }

  // Staleness check
  const lastUpdates = marketRows.map((r) => r.lastUpdate).filter(Boolean);
  const mostRecent = lastUpdates.sort().reverse()[0] ?? '';
  const stale = mostRecent ? isStale(mostRecent) : true;

  // Market availability score = bookCount / expected max (14 books mapped)
  const marketAvailabilityScore = Math.min(bookCount / 5, 1); // 5 priority books = 1.0

  return {
    marketKey,
    sides,
    bookCount,
    disagreementScore,
    isStale: stale,
    marketAvailabilityScore,
    lastUpdate: mostRecent,
  };
}

// ------------------------------------
// Build event summary from normalized rows
// ------------------------------------

function buildEventSummary(
  meta: NormalizedEventMeta,
  rows: NormalizedOddsRow[]
): EventSummary {
  // Discover which markets exist for this event
  const marketKeys = [...new Set(rows.map((r) => r.marketKey))] as MarketKey[];
  const aggregatedMarkets: Record<MarketKey, AggregatedMarket> = {};

  for (const mKey of marketKeys) {
    const agg = aggregateMarket(rows, mKey);
    if (agg) {
      aggregatedMarkets[mKey] = agg;
    }
  }

  // Data quality score: based on book coverage across markets
  const scores = Object.values(aggregatedMarkets).map(
    (m) => m.marketAvailabilityScore
  );
  const dataQualityScore =
    scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

  return {
    sport: meta.sport,
    sportKey: meta.sportKey,
    eventId: meta.eventId,
    matchup: `${meta.awayTeam} @ ${meta.homeTeam}`,
    homeTeam: meta.homeTeam,
    awayTeam: meta.awayTeam,
    startTime: meta.commenceTime,
    availableMarkets: marketKeys,
    aggregatedMarkets,
    dataQualityScore: Math.round(dataQualityScore * 100) / 100,
    fetchedAt: meta.fetchedAt,
  };
}

// ------------------------------------
// Public: Aggregate all events from normalized rows
// ------------------------------------

export function aggregateAllEvents(rows: NormalizedOddsRow[]): EventSummary[] {
  if (rows.length === 0) return [];

  const grouped = groupRowsByEvent(rows);
  const metas = extractEventMetas(rows);
  const summaries: EventSummary[] = [];

  for (const meta of metas) {
    const eventRows = grouped.get(meta.eventId) ?? [];
    try {
      const summary = buildEventSummary(meta, eventRows);
      summaries.push(summary);
    } catch (err) {
      logger.warn(`[AGGREGATE] Failed to build summary for ${meta.eventId}: ${String(err)}`);
    }
  }

  logger.info(`[AGGREGATE] Built ${summaries.length} event summaries`);
  return summaries;
}

// ------------------------------------
// Trading flag detection
// ------------------------------------

export function detectTradingFlags(summary: EventSummary): TradingFlag[] {
  const flags: TradingFlag[] = [];

  for (const [mKey, market] of Object.entries(summary.aggregatedMarkets)) {
    const marketKey = mKey as MarketKey;

    // Flag high disagreement
    if (market.disagreementScore > 0.3) {
      flags.push({
        type: 'BOOK_DISAGREEMENT',
        market: marketKey,
        detail: `Disagreement score ${(market.disagreementScore * 100).toFixed(0)}% across ${market.bookCount} books`,
        severity: market.disagreementScore > 0.6 ? 'high' : 'medium',
        isInferred: true,
      });
    }

    // Flag stale market
    if (market.isStale) {
      flags.push({
        type: 'STALE_BOOK',
        market: marketKey,
        detail: `Market data may be stale (last update: ${market.lastUpdate || 'unknown'})`,
        severity: 'low',
        isInferred: false,
      });
    }

    // Flag low data quality
    if (market.marketAvailabilityScore < 0.4) {
      flags.push({
        type: 'DATA_QUALITY_LOW',
        market: marketKey,
        detail: `Only ${market.bookCount} book(s) offering this market`,
        severity: 'low',
        isInferred: false,
      });
    }
  }

  return flags;
}

// ------------------------------------
// Compare two event summaries (prior vs current) for movement
// ------------------------------------

export function compareSnapshots(
  prior: EventSummary,
  current: EventSummary
): TradingFlag[] {
  const flags: TradingFlag[] = [];

  for (const mKey of current.availableMarkets) {
    const priorMarket = prior.aggregatedMarkets[mKey];
    const currentMarket = current.aggregatedMarkets[mKey];

    if (!priorMarket || !currentMarket) continue;

    for (const currentSide of currentMarket.sides) {
      const priorSide = priorMarket.sides.find(
        (s) => s.outcomeName === currentSide.outcomeName
      );

      if (!priorSide) continue;

      // Line movement detection
      if (
        priorSide.consensusLine !== null &&
        currentSide.consensusLine !== null &&
        Math.abs(priorSide.consensusLine - currentSide.consensusLine) >= 0.5
      ) {
        const direction = currentSide.consensusLine > priorSide.consensusLine ? 'up' : 'down';
        flags.push({
          type: 'LINE_MOVE',
          market: mKey,
          detail: `${currentSide.outcomeName} line moved ${direction}: ${priorSide.consensusLine} -> ${currentSide.consensusLine}`,
          severity: Math.abs(priorSide.consensusLine - currentSide.consensusLine) >= 2 ? 'high' : 'medium',
          isInferred: false,
        });
      }

      // Price movement detection
      if (
        priorSide.consensusPrice !== null &&
        currentSide.consensusPrice !== null &&
        Math.abs(priorSide.consensusPrice - currentSide.consensusPrice) >= DISAGREEMENT_PRICE_THRESHOLD
      ) {
        const direction = currentSide.consensusPrice > priorSide.consensusPrice ? 'up' : 'down';
        flags.push({
          type: 'PRICE_MOVE',
          market: mKey,
          detail: `${currentSide.outcomeName} price moved ${direction}: ${priorSide.consensusPrice} -> ${currentSide.consensusPrice}`,
          severity: 'medium',
          isInferred: false,
        });
      }
    }
  }

  return flags;
}
