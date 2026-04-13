// ============================================================
// src/services/marketEfficiency.ts
// Market efficiency scoring
// Not all betting markets are equal
// High volume = efficient = edge is rare and small
// Low volume = inefficient = edge is more common and larger
// ============================================================

import { EventSummary, MarketKey } from '../types/odds';

export interface MarketEfficiencyScore {
  eventId: string;
  marketKey: MarketKey;
  efficiencyScore: number;    // 0-100, higher = more efficient
  volumeEstimate: 'very_high' | 'high' | 'medium' | 'low' | 'very_low';
  edgePotential: 'low' | 'medium' | 'high' | 'very_high';
  bookCount: number;
  lineSpread: number;         // max line difference across books
  juiceSpread: number;        // max juice difference across books
  detail: string;
  edgeMultiplier: number;     // multiply raw score by this (higher for inefficient markets)
}

// Sport-level base efficiency (higher = more efficient, harder to beat)
const SPORT_BASE_EFFICIENCY: Record<string, number> = {
  americanfootball_nfl:    90,   // most efficient -- massive public volume
  basketball_nba:          80,   // very efficient -- high volume
  baseball_mlb:            70,   // fairly efficient -- sharp action
  icehockey_nhl:           60,   // moderate -- less public interest
  americanfootball_ncaaf:  55,   // less efficient -- harder to price
  basketball_ncaab:        45,   // inefficient -- too many teams to price well
  baseball_ncaa:           35,   // very inefficient -- limited sharp action
};

// Day of week efficiency adjustment
function getDayEfficiency(): number {
  const day = new Date().getDay();
  // Sunday NFL = peak efficiency
  if (day === 0) return +10;
  // Monday Night = still high
  if (day === 1) return +5;
  // Saturday NCAAB slate = moderate
  if (day === 6) return 0;
  // Weekday = generally less efficient
  return -5;
}

// Market type efficiency
const MARKET_EFFICIENCY: Record<string, number> = {
  h2h:          +5,    // moneyline -- most bet market
  spreads:      0,     // spread -- standard
  totals:       -5,    // totals -- slightly less efficient
  team_totals:  -15,   // team totals -- softest
  h2h_h1:       -10,   // halftime -- much less efficient
  h2h_q1:       -15,   // quarter lines -- very soft
};

export function scoreMarketEfficiency(
  event: EventSummary,
  marketKey: MarketKey
): MarketEfficiencyScore {
  const market = event.aggregatedMarkets[marketKey];
  if (!market) {
    return {
      eventId: event.eventId,
      marketKey,
      efficiencyScore: 50,
      volumeEstimate: 'medium',
      edgePotential: 'medium',
      bookCount: 0,
      lineSpread: 0,
      juiceSpread: 0,
      detail: 'No market data',
      edgeMultiplier: 1.0,
    };
  }

  // Base efficiency from sport
  let efficiency = SPORT_BASE_EFFICIENCY[event.sportKey] ?? 60;

  // Market type adjustment
  efficiency += MARKET_EFFICIENCY[marketKey] ?? 0;

  // Day of week adjustment
  efficiency += getDayEfficiency();

  // Book count adjustment -- more books = more efficient
  const bookAdj = market.bookCount >= 8 ? +10
    : market.bookCount >= 5 ? +5
    : market.bookCount >= 3 ? 0
    : -10;
  efficiency += bookAdj;

  // Disagreement adjustment -- high disagreement = inefficient
  const disagreementAdj = market.disagreementScore >= 0.5 ? -15
    : market.disagreementScore >= 0.3 ? -8
    : 0;
  efficiency += disagreementAdj;

  efficiency = Math.max(0, Math.min(100, efficiency));

  // Line and juice spreads
  let lineSpread = 0, juiceSpread = 0;
  for (const side of market.sides) {
    const prices = side.offers.map(o => o.price).filter((p): p is number => p !== null);
    const lines = side.offers.map(o => o.line).filter((l): l is number => l !== null);
    if (prices.length > 1) juiceSpread = Math.max(juiceSpread, Math.max(...prices) - Math.min(...prices));
    if (lines.length > 1) lineSpread = Math.max(lineSpread, Math.max(...lines) - Math.min(...lines));
  }

  // Volume estimate
  const volumeEstimate: MarketEfficiencyScore['volumeEstimate'] =
    efficiency >= 85 ? 'very_high'
    : efficiency >= 70 ? 'high'
    : efficiency >= 55 ? 'medium'
    : efficiency >= 40 ? 'low'
    : 'very_low';

  // Edge potential (inverse of efficiency)
  const edgePotential: MarketEfficiencyScore['edgePotential'] =
    efficiency <= 40 ? 'very_high'
    : efficiency <= 55 ? 'high'
    : efficiency <= 70 ? 'medium'
    : 'low';

  // Edge multiplier -- inefficient markets get a boost
  const edgeMultiplier = efficiency <= 40 ? 1.3
    : efficiency <= 55 ? 1.15
    : efficiency <= 70 ? 1.0
    : 0.9;

  const detail = `${event.sport} ${marketKey} -- ${market.bookCount} books, efficiency: ${efficiency}/100 (${edgePotential} edge potential)`;

  return {
    eventId: event.eventId,
    marketKey,
    efficiencyScore: Math.round(efficiency),
    volumeEstimate,
    edgePotential,
    bookCount: market.bookCount,
    lineSpread: Math.round(lineSpread * 10) / 10,
    juiceSpread: Math.round(juiceSpread),
    detail,
    edgeMultiplier,
  };
}

// ------------------------------------
// Score all markets for a set of events
// ------------------------------------

export function scoreAllMarketEfficiency(
  summaries: EventSummary[]
): Map<string, Map<MarketKey, MarketEfficiencyScore>> {
  const result = new Map<string, Map<MarketKey, MarketEfficiencyScore>>();

  for (const event of summaries) {
    const eventMap = new Map<MarketKey, MarketEfficiencyScore>();
    for (const mKey of event.availableMarkets) {
      eventMap.set(mKey, scoreMarketEfficiency(event, mKey));
    }
    result.set(event.eventId, eventMap);
  }

  return result;
}
