// ============================================================
// src/types/odds.ts
// Core type definitions for the sports betting engine
// ============================================================

// ------------------------------------
// SPORTS CONFIG
// ------------------------------------

export interface SportConfig {
  key: string;
  name: string;
  enabled: boolean;
  inSeason?: boolean; // optional override for out-of-season sports
}

// ------------------------------------
// RAW API TYPES (Odds API v4 response shapes)
// ------------------------------------

export interface RawOutcome {
  name: string;
  price: number;
  point?: number;
  description?: string; // used in player props
}

export interface RawMarket {
  key: string;
  last_update: string;
  outcomes: RawOutcome[];
}

export interface RawBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: RawMarket[];
}

export interface RawEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: RawBookmaker[];
}

export interface RawApiResponse {
  events: RawEvent[];
  remainingRequests?: number;
  usedRequests?: number;
}

// ------------------------------------
// NORMALIZED ROW (flat, DB-ready)
// ------------------------------------

export interface NormalizedOddsRow {
  sport: string;
  sportKey: string;
  eventId: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakerKey: string;
  bookmakerTitle: string;
  marketKey: string;
  outcomeName: string;
  line: number | null;        // point spread or total line
  price: number | null;       // american odds price
  lastUpdate: string;
  fetchedAt: string;
}

// ------------------------------------
// MARKET MARKET TYPES
// ------------------------------------

export type MarketKey =
  | 'h2h'           // moneyline
  | 'spreads'       // spread / run line / puck line
  | 'totals'        // game totals
  | 'team_totals'   // team totals (phase 2)
  | 'h2h_h1'        // first half
  | 'h2h_q1'        // first quarter
  | 'h2h_p1'        // first period
  | 'spreads_h1'    // first half spread
  | 'totals_h1'     // first half total
  | 'totals_q1'     // first quarter total
  | string;         // extensible for props and alternates

export const INITIAL_MARKETS: MarketKey[] = ['h2h', 'spreads', 'totals'];
export const EXTENDED_MARKETS: MarketKey[] = ['h2h', 'spreads', 'totals', 'h2h_h1', 'spreads_h1', 'totals_h1', 'team_totals'];

// Player props -- NOT fetched unless explicitly enabled
export const PROP_MARKETS: MarketKey[] = [
  'player_pass_tds',
  'player_pass_yds',
  'player_rush_yds',
  'player_receptions',
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_hits',
  'player_total_bases',
  'player_strikeouts',
  // extend as needed
];

// ------------------------------------
// AGGREGATED MARKET DATA
// ------------------------------------

export interface BookOffer {
  bookmakerKey: string;
  bookmakerTitle: string;
  line: number | null;
  price: number | null;
  lastUpdate: string;
}

export interface AggregatedSide {
  outcomeName: string;
  bestPrice: number | null;
  bestLine: number | null;
  bestBook: string | null;
  consensusPrice: number | null;
  consensusLine: number | null;
  bookCount: number;
  offers: BookOffer[];
}

export interface AggregatedMarket {
  marketKey: MarketKey;
  sides: AggregatedSide[];
  bookCount: number;
  disagreementScore: number;   // 0-1, higher = more disagreement
  isStale: boolean;
  marketAvailabilityScore: number; // 0-1 based on book coverage
  lastUpdate: string;
}

// ------------------------------------
// EVENT SUMMARY (output-ready)
// ------------------------------------

export interface EventSummary {
  sport: string;
  sportKey: string;
  eventId: string;
  matchup: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  availableMarkets: MarketKey[];
  aggregatedMarkets: Record<MarketKey, AggregatedMarket>;
  dataQualityScore: number; // 0-1
  fetchedAt: string;
}

// ------------------------------------
// MOVEMENT / TRADING FLAGS
// ------------------------------------

export type TradingFlagType =
  | 'LINE_MOVE'
  | 'PRICE_MOVE'
  | 'STEAM_SUSPECT'
  | 'STALE_BOOK'
  | 'REVERSE_LINE_MOVE_CANDIDATE'
  | 'BOOK_DISAGREEMENT'
  | 'MARKET_SHIFT'
  | 'DATA_QUALITY_LOW';

export interface TradingFlag {
  type: TradingFlagType;
  market: MarketKey;
  detail: string;
  severity: 'low' | 'medium' | 'high';
  isInferred: boolean; // true = derived proxy, not direct data
}

export interface MovementSummary {
  hasLineMovement: boolean;
  hasPriceMovement: boolean;
  lineMovements: Array<{
    marketKey: MarketKey;
    outcomeName: string;
    previousLine: number | null;
    currentLine: number | null;
    direction: 'up' | 'down' | 'none';
  }>;
  priceMovements: Array<{
    marketKey: MarketKey;
    outcomeName: string;
    previousPrice: number | null;
    currentPrice: number | null;
    direction: 'up' | 'down' | 'none';
  }>;
}

// ------------------------------------
// SNAPSHOT TYPES
// ------------------------------------

export interface SnapshotMetadata {
  snapshotId: string;
  runType: RunType;
  runTimestamp: string;
  sportsProcessed: string[];
  eventsProcessed: number;
  marketsProcessed: number;
  quotaUsage: QuotaUsage;
  durationMs: number;
}

export interface Snapshot {
  metadata: SnapshotMetadata;
  eventSummaries: EventSummary[];
}

// ------------------------------------
// RUN TYPES
// ------------------------------------

export type RunType =
  | 'MORNING_SCAN'
  | 'MIDDAY_FINAL_CARD'
  | 'LIVE_CHECK'
  | 'SPORT_SCAN'
  | 'FULL_SCAN';

// ------------------------------------
// RUN SUMMARY (final output per run)
// ------------------------------------

export interface RunSummary {
  runType: RunType;
  runTimestamp: string;
  sportsProcessed: string[];
  eventsProcessed: number;
  marketsProcessed: number;
  quotaUsage: QuotaUsage;
  durationMs: number;
  topMovementFlags: Array<{ matchup: string; flags: TradingFlag[] }>;
  eventSummaries: EventSummary[];
  errors: RunError[];
}

export interface RunError {
  sportKey: string;
  error: string;
  timestamp: string;
}

// ------------------------------------
// QUOTA / USAGE TRACKING
// ------------------------------------

export interface QuotaUsage {
  requestsMade: number;
  remainingRequests: number | null;
  usedRequests: number | null;
}

// ------------------------------------
// CACHE
// ------------------------------------

export interface CacheEntry {
  data: RawEvent[];
  fetchedAt: number; // epoch ms
  sportKey: string;
}
