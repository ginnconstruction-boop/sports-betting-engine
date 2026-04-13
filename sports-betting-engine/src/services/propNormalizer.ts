// ============================================================
// src/services/propNormalizer.ts
// Normalizes raw player prop data from Odds API
// Props use a different structure than game lines --
// outcome.description = player name, outcome.name = Over/Under
// ============================================================

import { RawEvent } from '../types/odds';

export interface NormalizedProp {
  eventId: string;
  matchup: string;
  homeTeam: string;
  awayTeam: string;
  gameTime: string;
  sportKey: string;
  marketKey: string;
  marketLabel: string;
  playerName: string;
  side: 'Over' | 'Under';
  // Per book
  bookmakerKey: string;
  bookmakerTitle: string;
  line: number;
  price: number;
  lastUpdate: string;
  fetchedAt: string;
}

export interface PropOffer {
  bookmakerKey: string;
  bookmakerTitle: string;
  line: number;
  price: number;
  lastUpdate: string;
}

export interface AggregatedProp {
  eventId: string;
  matchup: string;
  homeTeam: string;
  awayTeam: string;
  gameTime: string;
  sportKey: string;
  marketKey: string;
  marketLabel: string;
  playerName: string;
  team: string;           // derived from roster lookup
  position: string;       // derived from roster lookup
  gameTotal: number | null;  // current posted game total
  // Over side
  overOffers: PropOffer[];
  overBestPrice: number | null;
  overBestLine: number | null;
  overBestBook: string | null;
  overConsensusLine: number | null;
  overConsensusPrice: number | null;
  // Under side
  underOffers: PropOffer[];
  underBestPrice: number | null;
  underBestLine: number | null;
  underBestBook: string | null;
  underConsensusPrice: number | null;
  // Line gap between books
  lineGap: number | null;         // max line difference across books
  juiceGap: number | null;        // difference in over juice across books
  bookCount: number;
  fetchedAt: string;
}

const MARKET_LABELS: Record<string, string> = {
  player_points:                    'Points',
  player_rebounds:                  'Rebounds',
  player_assists:                   'Assists',
  player_points_rebounds_assists:   'Pts+Reb+Ast',
  player_threes:                    '3-Pointers Made',
  player_blocks:                    'Blocks',
  player_steals:                    'Steals',
  player_turnovers:                 'Turnovers',
  player_points_rebounds:           'Pts+Rebounds',
  player_points_assists:            'Pts+Assists',
};

function marketLabel(key: string): string {
  return MARKET_LABELS[key] ?? key.replace('player_', '').replace(/_/g, ' ');
}

// ------------------------------------
// Normalize raw event prop data into flat rows
// ------------------------------------

export function normalizePropsFromEvent(
  event: RawEvent,
  propMarkets: string[],
  fetchedAt: string
): NormalizedProp[] {
  const rows: NormalizedProp[] = [];
  const matchup = `${event.away_team} @ ${event.home_team}`;

  for (const bookmaker of event.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      if (!propMarkets.includes(market.key)) continue;

      for (const outcome of market.outcomes ?? []) {
        // Props: outcome.description = player name, outcome.name = Over/Under
        const playerName = (outcome as any).description ?? outcome.name;
        const side = outcome.name as 'Over' | 'Under';
        if (!['Over', 'Under'].includes(side)) continue;
        if (typeof outcome.point !== 'number') continue;
        if (typeof outcome.price !== 'number') continue;

        rows.push({
          eventId: event.id,
          matchup,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          gameTime: event.commence_time,
          sportKey: event.sport_key,
          marketKey: market.key,
          marketLabel: marketLabel(market.key),
          playerName: playerName.trim(),
          side,
          bookmakerKey: bookmaker.key,
          bookmakerTitle: bookmaker.title,
          line: outcome.point,
          price: outcome.price,
          lastUpdate: market.last_update ?? bookmaker.last_update ?? '',
          fetchedAt,
        });
      }
    }
  }

  return rows;
}

// ------------------------------------
// Aggregate prop rows into per-player per-market summaries
// ------------------------------------

export function aggregateProps(rows: NormalizedProp[]): AggregatedProp[] {
  // Group by eventId + marketKey + playerName
  const groups = new Map<string, NormalizedProp[]>();

  for (const row of rows) {
    const key = `${row.eventId}__${row.marketKey}__${row.playerName}`;
    const existing = groups.get(key) ?? [];
    existing.push(row);
    groups.set(key, existing);
  }

  const aggregated: AggregatedProp[] = [];

  for (const [, propRows] of groups) {
    if (propRows.length === 0) continue;
    const sample = propRows[0];

    const overRows = propRows.filter(r => r.side === 'Over');
    const underRows = propRows.filter(r => r.side === 'Under');

    if (overRows.length === 0) continue;

    // Over side -- dedupe to ONE offer per bookmaker (keep best price)
    // BetOnline and BetRivers post every alt line separately -- without dedup
    // this creates fake line gaps of 4+ pts and juice gaps of 1000+ pts
    const overByBook = new Map<string, PropOffer>();
    for (const r of overRows) {
      const existing = overByBook.get(r.bookmakerKey);
      if (!existing || r.price > existing.price) {
        overByBook.set(r.bookmakerKey, {
          bookmakerKey: r.bookmakerKey,
          bookmakerTitle: r.bookmakerTitle,
          line: r.line,
          price: r.price,
          lastUpdate: r.lastUpdate,
        });
      }
    }
    const overOffers: PropOffer[] = [...overByBook.values()]
      .sort((a, b) => b.price - a.price);

    // Under side -- same dedupe
    const underByBook = new Map<string, PropOffer>();
    for (const r of underRows) {
      const existing = underByBook.get(r.bookmakerKey);
      if (!existing || r.price > existing.price) {
        underByBook.set(r.bookmakerKey, {
          bookmakerKey: r.bookmakerKey,
          bookmakerTitle: r.bookmakerTitle,
          line: r.line,
          price: r.price,
          lastUpdate: r.lastUpdate,
        });
      }
    }
    const underOffers: PropOffer[] = [...underByBook.values()]
      .sort((a, b) => b.price - a.price);

    // Best over price (highest number = best for bettor)
    const overBestOffer = overOffers[0] ?? null;
    const underBestOffer = underOffers[0] ?? null;

    // Consensus over line (median)
    const overLines = overOffers.map(o => o.line).sort((a, b) => a - b);
    const overConsensusLine = overLines.length > 0
      ? overLines[Math.floor(overLines.length / 2)]
      : null;

    // Consensus prices
    function avgPrice(offers: PropOffer[]): number | null {
      if (offers.length === 0) return null;
      return Math.round(offers.reduce((s, o) => s + o.price, 0) / offers.length);
    }

    // Line gap -- max difference between books on the over line
    const lineGap = overLines.length > 1
      ? Math.round((Math.max(...overLines) - Math.min(...overLines)) * 10) / 10
      : null;

    // Juice gap -- spread in over prices across books
    const overPrices = overOffers.map(o => o.price);
    const juiceGap = overPrices.length > 1
      ? Math.abs(Math.max(...overPrices) - Math.min(...overPrices))
      : null;

    const uniqueBooks = new Set(propRows.map(r => r.bookmakerKey));

    aggregated.push({
      eventId: sample.eventId,
      matchup: sample.matchup,
      homeTeam: sample.homeTeam,
      awayTeam: sample.awayTeam,
      gameTime: sample.gameTime,
      sportKey: sample.sportKey,
      marketKey: sample.marketKey,
      marketLabel: sample.marketLabel,
      playerName: sample.playerName,
      team: '',           // populated by propScorer via roster lookup
      position: '',       // populated by propScorer via roster lookup
      gameTotal: null,    // populated by propScorer from game totals
      overOffers,
      overBestPrice: overBestOffer?.price ?? null,
      overBestLine: overBestOffer?.line ?? null,
      overBestBook: overBestOffer?.bookmakerKey ?? null,
      overConsensusLine,
      overConsensusPrice: avgPrice(overOffers),
      underOffers,
      underBestPrice: underBestOffer?.price ?? null,
      underBestLine: underBestOffer?.line ?? null,
      underBestBook: underBestOffer?.bookmakerKey ?? null,
      underConsensusPrice: avgPrice(underOffers),
      lineGap,
      juiceGap,
      bookCount: uniqueBooks.size,
      fetchedAt: sample.fetchedAt,
    });
  }

  return aggregated;
}
