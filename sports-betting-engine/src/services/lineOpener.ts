// ============================================================
// src/services/lineOpener.ts
// Opening line vs current line comparison
// Opening line = purest number before public money hits
// The further from the open = more info priced in
// Uses Pinnacle open as the sharp benchmark
// ============================================================

import https from 'https';
import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const OPENER_FILE = path.join(SNAPSHOT_DIR, 'opening_lines.json');

export interface OpeningLine {
  eventId: string;
  matchup: string;
  sportKey: string;
  fetchedAt: string;
  markets: {
    h2h?: { home: number; away: number };
    spreads?: { line: number; homePrice: number; awayPrice: number };
    totals?: { line: number; overPrice: number; underPrice: number };
  };
}

export interface LineOpenerComparison {
  eventId: string;
  matchup: string;
  hasOpeningLine: boolean;
  openingLine: OpeningLine | null;
  // Movement from open
  spreadMoveFromOpen: number | null;
  totalMoveFromOpen: number | null;
  mlMoveFromOpen: number | null;
  // Direction
  spreadMovedToward: 'home' | 'away' | 'none';
  totalMovedToward: 'over' | 'under' | 'none';
  // Signals
  isLargeMove: boolean;           // 2+ pts from open = significant
  openingLineDetail: string;
}

// ------------------------------------
// Save opening lines (first scan of the day)
// ------------------------------------

function loadOpeners(): Record<string, OpeningLine> {
  if (!fs.existsSync(OPENER_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(OPENER_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveOpeners(openers: Record<string, OpeningLine>): void {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(OPENER_FILE, JSON.stringify(openers, null, 2));
  } catch { }
}

export function saveOpeningLines(
  events: Array<{
    eventId: string;
    matchup: string;
    sportKey: string;
    homeML?: number;
    awayML?: number;
    spread?: number;
    homeSpreadPrice?: number;
    awaySpreadPrice?: number;
    total?: number;
    overPrice?: number;
    underPrice?: number;
  }>
): void {
  const openers = loadOpeners();
  const today = new Date().toISOString().split('T')[0];

  for (const event of events) {
    const key = `${event.eventId}__${today}`;
    // Only save if we don't have today's opener yet
    if (openers[key]) continue;

    openers[key] = {
      eventId: event.eventId,
      matchup: event.matchup,
      sportKey: event.sportKey,
      fetchedAt: new Date().toISOString(),
      markets: {
        ...(event.homeML ? { h2h: { home: event.homeML, away: event.awayML ?? 0 } } : {}),
        ...(event.spread ? {
          spreads: {
            line: event.spread,
            homePrice: event.homeSpreadPrice ?? -110,
            awayPrice: event.awaySpreadPrice ?? -110,
          }
        } : {}),
        ...(event.total ? {
          totals: {
            line: event.total,
            overPrice: event.overPrice ?? -110,
            underPrice: event.underPrice ?? -110,
          }
        } : {}),
      },
    };
  }

  saveOpeners(openers);
}

// ------------------------------------
// Compare current lines to opening lines
// ------------------------------------

export function compareToOpeningLines(
  eventId: string,
  matchup: string,
  currentSpread: number | null,
  currentTotal: number | null,
  currentHomeML: number | null
): LineOpenerComparison {
  const openers = loadOpeners();
  const today = new Date().toISOString().split('T')[0];
  const key = `${eventId}__${today}`;
  const opener = openers[key] ?? null;

  if (!opener) {
    return {
      eventId, matchup,
      hasOpeningLine: false,
      openingLine: null,
      spreadMoveFromOpen: null,
      totalMoveFromOpen: null,
      mlMoveFromOpen: null,
      spreadMovedToward: 'none',
      totalMovedToward: 'none',
      isLargeMove: false,
      openingLineDetail: 'No opening line data -- run morning scan first',
    };
  }

  const spreadMoveFromOpen = currentSpread !== null && opener.markets.spreads
    ? Math.round((currentSpread - opener.markets.spreads.line) * 10) / 10
    : null;

  const totalMoveFromOpen = currentTotal !== null && opener.markets.totals
    ? Math.round((currentTotal - opener.markets.totals.line) * 10) / 10
    : null;

  const mlMoveFromOpen = currentHomeML !== null && opener.markets.h2h
    ? currentHomeML - opener.markets.h2h.home
    : null;

  const spreadMovedToward: LineOpenerComparison['spreadMovedToward'] =
    spreadMoveFromOpen === null ? 'none'
    : spreadMoveFromOpen < 0 ? 'home'
    : spreadMoveFromOpen > 0 ? 'away'
    : 'none';

  const totalMovedToward: LineOpenerComparison['totalMovedToward'] =
    totalMoveFromOpen === null ? 'none'
    : totalMoveFromOpen > 0 ? 'over'
    : totalMoveFromOpen < 0 ? 'under'
    : 'none';

  const isLargeMove = (spreadMoveFromOpen !== null && Math.abs(spreadMoveFromOpen) >= 2) ||
                      (totalMoveFromOpen !== null && Math.abs(totalMoveFromOpen) >= 1.5);

  const parts: string[] = [];
  if (spreadMoveFromOpen !== null && opener.markets.spreads) {
    parts.push(`Spread: opened ${opener.markets.spreads.line > 0 ? '+' : ''}${opener.markets.spreads.line}, now ${currentSpread !== null ? (currentSpread > 0 ? '+' : '') + currentSpread : 'N/A'} (${spreadMoveFromOpen > 0 ? '+' : ''}${spreadMoveFromOpen})`);
  }
  if (totalMoveFromOpen !== null && opener.markets.totals) {
    parts.push(`Total: opened ${opener.markets.totals.line}, now ${currentTotal} (${totalMoveFromOpen > 0 ? '+' : ''}${totalMoveFromOpen})`);
  }

  return {
    eventId, matchup,
    hasOpeningLine: true,
    openingLine: opener,
    spreadMoveFromOpen,
    totalMoveFromOpen,
    mlMoveFromOpen,
    spreadMovedToward,
    totalMovedToward,
    isLargeMove,
    openingLineDetail: parts.join(' | ') || 'Lines stable from open',
  };
}
