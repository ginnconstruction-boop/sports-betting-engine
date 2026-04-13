// ============================================================
// src/services/normalizeOdds.ts
// Converts raw Odds API responses -> normalized flat rows
// Works identically across all sports -- no sport-specific logic
// ============================================================

import {
  RawEvent,
  RawBookmaker,
  RawMarket,
  RawOutcome,
  NormalizedOddsRow,
} from '../types/odds';
import { getBookmakerDisplayName } from '../config/bookmakers';
import { getSportByKey } from '../config/sports';
import { logger } from '../utils/logger';

// ------------------------------------
// Team name normalization
// Minimal -- preserves API names but trims whitespace and fixes encoding
// ------------------------------------

function normalizeTeamName(raw: string | null | undefined): string {
  if (!raw) return 'Unknown';
  return raw.trim().replace(/\s+/g, ' ');
}

// ------------------------------------
// Normalize a single outcome row
// ------------------------------------

function normalizeOutcome(
  event: RawEvent,
  bookmaker: RawBookmaker,
  market: RawMarket,
  outcome: RawOutcome,
  fetchedAt: string
): NormalizedOddsRow | null {
  // Safely extract price
  const price =
    typeof outcome.price === 'number' && isFinite(outcome.price)
      ? outcome.price
      : null;

  // Safely extract line (point spread or total)
  const line =
    typeof outcome.point === 'number' && isFinite(outcome.point)
      ? outcome.point
      : null;

  if (price === null) {
    logger.debug(
      `Skipping outcome with null price: ${event.id} / ${bookmaker.key} / ${market.key} / ${outcome.name}`
    );
    return null;
  }

  const sportConfig = getSportByKey(event.sport_key);

  return {
    sport: sportConfig?.name ?? event.sport_title ?? event.sport_key,
    sportKey: event.sport_key,
    eventId: event.id,
    commenceTime: event.commence_time ?? '',
    homeTeam: normalizeTeamName(event.home_team),
    awayTeam: normalizeTeamName(event.away_team),
    bookmakerKey: bookmaker.key,
    bookmakerTitle: getBookmakerDisplayName(bookmaker.key),
    marketKey: market.key,
    outcomeName: normalizeTeamName(outcome.name),
    line,
    price,
    lastUpdate: market.last_update ?? bookmaker.last_update ?? '',
    fetchedAt,
  };
}

// ------------------------------------
// Normalize a single event
// ------------------------------------

export function normalizeEvent(
  event: RawEvent,
  fetchedAt: string
): NormalizedOddsRow[] {
  const rows: NormalizedOddsRow[] = [];

  if (!event || !event.id) {
    logger.warn('Received null or invalid event, skipping');
    return rows;
  }

  const bookmakers = event.bookmakers ?? [];

  if (bookmakers.length === 0) {
    logger.debug(`No bookmakers for event ${event.id} (${event.home_team} vs ${event.away_team})`);
    return rows;
  }

  for (const bookmaker of bookmakers) {
    if (!bookmaker?.key) continue;

    const markets = bookmaker.markets ?? [];

    for (const market of markets) {
      if (!market?.key) continue;

      const outcomes = market.outcomes ?? [];

      for (const outcome of outcomes) {
        const row = normalizeOutcome(event, bookmaker, market, outcome, fetchedAt);
        if (row !== null) {
          rows.push(row);
        }
      }
    }
  }

  return rows;
}

// ------------------------------------
// Normalize a full array of events
// ------------------------------------

export function normalizeEvents(
  events: RawEvent[],
  sportKey: string
): NormalizedOddsRow[] {
  const fetchedAt = new Date().toISOString();
  const rows: NormalizedOddsRow[] = [];
  let skipped = 0;

  if (!Array.isArray(events) || events.length === 0) {
    logger.info(`[NORMALIZE] ${sportKey} -- no events to normalize`);
    return rows;
  }

  for (const event of events) {
    try {
      const eventRows = normalizeEvent(event, fetchedAt);
      rows.push(...eventRows);
    } catch (err) {
      skipped++;
      logger.warn(`[NORMALIZE] Failed to normalize event ${event?.id ?? 'unknown'}: ${String(err)}`);
    }
  }

  logger.info(
    `[NORMALIZE] ${sportKey} -- ${events.length} events -> ${rows.length} rows` +
    (skipped > 0 ? ` (${skipped} events skipped due to errors)` : '')
  );

  return rows;
}

// ------------------------------------
// Group normalized rows by eventId
// Useful for aggregation layer
// ------------------------------------

export function groupRowsByEvent(
  rows: NormalizedOddsRow[]
): Map<string, NormalizedOddsRow[]> {
  const grouped = new Map<string, NormalizedOddsRow[]>();

  for (const row of rows) {
    const existing = grouped.get(row.eventId) ?? [];
    existing.push(row);
    grouped.set(row.eventId, existing);
  }

  return grouped;
}

// ------------------------------------
// Extract unique events from normalized rows
// ------------------------------------

export interface NormalizedEventMeta {
  eventId: string;
  sport: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  fetchedAt: string;
}

export function extractEventMetas(
  rows: NormalizedOddsRow[]
): NormalizedEventMeta[] {
  const seen = new Map<string, NormalizedEventMeta>();

  for (const row of rows) {
    if (!seen.has(row.eventId)) {
      seen.set(row.eventId, {
        eventId: row.eventId,
        sport: row.sport,
        sportKey: row.sportKey,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        commenceTime: row.commenceTime,
        fetchedAt: row.fetchedAt,
      });
    }
  }

  return Array.from(seen.values());
}
