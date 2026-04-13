// ============================================================
// src/commands/runFirstScorer.ts
// First Basket (NBA) and First TD (NFL) prop scanner
// These are soft markets -- books price them loosely
// Usage rate + lineup confirmation = primary edge
// ============================================================
import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getEventMarkets, getSessionQuota } from '../api/oddsApiClient';
import { normalizeEvents }                   from '../services/normalizeOdds';
import { aggregateAllEvents }                from '../services/aggregateMarkets';
import { EventSummary }                      from '../types/odds';
import { buildLineupMap }                    from '../services/lineupConfirmation';
import { scoreFirstScorerProps, printFirstScorerReport } from '../services/firstScorerIntelligence';
import { savePropPicks }                     from '../services/closingLineTracker';
import { getUserBookKeys, getBookmakerDisplayName } from '../config/bookmakers';

function hoursUntil(t: string): number {
  return (new Date(t).getTime() - Date.now()) / 3600000;
}

async function safeRun<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// First scorer market keys per sport
const FIRST_SCORER_MARKETS: Record<string, string[]> = {
  basketball_nba:       ['player_first_basket'],
  americanfootball_nfl: ['player_first_touchdown', 'player_anytime_td'],
};

export async function runFirstScorer(
  sportKey: string = 'basketball_nba'
): Promise<void> {
  const sportLabel = sportKey.includes('nfl') ? 'NFL' : 'NBA';
  const markets = FIRST_SCORER_MARKETS[sportKey] ?? ['player_first_basket'];
  const quota = getSessionQuota();
  const userBookKeys = getUserBookKeys();

  console.log(`\n  ${sportLabel} First Scorer Props`);
  console.log('  Scanning for first basket / first TD value...\n');

  try {
    // Get upcoming games
    const { results: rawBySport } = await getOddsForAllSports(
      [sportKey], ['h2h', 'spreads', 'totals'], false
    );
    const allSummaries: EventSummary[] = [];
    for (const [key, events] of rawBySport) {
      allSummaries.push(...aggregateAllEvents(normalizeEvents(events, key)));
    }

    const upcoming = allSummaries.filter(e => {
      const h = hoursUntil(e.startTime);
      return h >= 0.5 && h <= 24;
    });

    if (upcoming.length === 0) {
      console.log('  No upcoming games found.\n');
      return;
    }

    console.log(`  Found ${upcoming.length} game(s). Fetching first scorer markets...`);

    // Build lineup map for confirmation signal
    const lineupMap = await safeRun(
      () => buildLineupMap(upcoming.map(e => ({
        eventId: e.eventId, homeTeam: e.homeTeam, awayTeam: e.awayTeam,
        sport: sportKey, startTime: e.startTime,
      }))),
      new Map()
    );

    // Fetch first scorer props for each game
    const rawProps: any[] = [];

    for (const event of upcoming) {
      const gameTotal  = event.aggregatedMarkets['totals']?.sides[0]?.consensusLine ?? null;
      const gameSpread = event.aggregatedMarkets['spreads']?.sides[0]?.consensusLine ?? null;
      const lineupData = lineupMap.get(event.eventId);

      for (const market of markets) {
        try {
          const { event: ev } = await getEventMarkets(
            sportKey, event.eventId, [market] as any[], undefined, 'american'
          );
          if (!ev) continue;

          // Parse first scorer offers -- these come back as h2h-style
          // Each player has a YES price
          const eventBookmakers = (ev as any).bookmakers ?? [];

          // Build player price map across books
          const playerPrices = new Map<string, { book: string; price: number }[]>();

          for (const bk of eventBookmakers) {
            for (const mkt of (bk.markets ?? [])) {
              if (mkt.key !== market) continue;
              for (const outcome of (mkt.outcomes ?? [])) {
                const name  = outcome.name ?? '';
                const price = outcome.price ?? 0;
                if (price <= 0) continue; // skip negative prices (not a real first scorer market)
                const existing = playerPrices.get(name) ?? [];
                existing.push({ book: bk.key, price });
                playerPrices.set(name, existing);
              }
            }
          }

          // Build raw props from player prices
          for (const [playerName, offers] of playerPrices) {
            if (offers.length < 2) continue; // need at least 2 books

            // Sort by best price (highest plus-money)
            const userOffers = offers
              .filter(o => userBookKeys.includes(o.book))
              .sort((a, b) => b.price - a.price);

            if (userOffers.length === 0) continue;

            const best = userOffers[0];
            const alt  = userOffers[1] ?? null;

            // Determine team from lineup or matchup
            const homeTeam = event.homeTeam;
            const awayTeam = event.awayTeam;
            const lineupHome = lineupData?.home?.confirmedStarters ?? [];
            const lineupAway = lineupData?.away?.confirmedStarters ?? [];
            const isOnHome = lineupHome.some((p: any) =>
              (p.name ?? '').toLowerCase().includes(playerName.toLowerCase().split(' ').pop() ?? '')
            );
            const team = isOnHome ? homeTeam : awayTeam;
            const isHome = isOnHome;

            // Check if player is confirmed starter
            const allStarters = [...lineupHome, ...lineupAway];
            const lineupConfirmed = allStarters.some((p: any) =>
              (p.name ?? '').toLowerCase().includes(playerName.toLowerCase().split(' ').pop() ?? '')
            );

            rawProps.push({
              playerName,
              team,
              sport: sportLabel as 'NBA' | 'NFL',
              marketKey: market,
              matchup: event.matchup,
              gameTime: event.startTime,
              bestBook:  getBookmakerDisplayName(best.book),
              bestPrice: best.price,
              altBook:   alt ? getBookmakerDisplayName(alt.book) : '',
              altPrice:  alt?.price ?? null,
              lineupConfirmed,
              gameTotal,
              gameSpread,
              isHome,
            });
          }

          console.log(`  [+] ${event.awayTeam} vs ${event.homeTeam} -- ${market}`);
        } catch { /* market not available */ }
      }
    }

    if (rawProps.length === 0) {
      console.log('\n  No first scorer lines available yet.');
      console.log('  Books typically post these 2-3 hours before tip.\n');
      return;
    }

    console.log(`\n  Scoring ${rawProps.length} first scorer props...`);

    // Score all props
    const scored = scoreFirstScorerProps(rawProps);

    // Print report
    printFirstScorerReport(scored);

    // Save to tracking log
    if (scored.length > 0) {
      try {
        savePropPicks(scored.map(p => ({
          playerName:   p.playerName,
          market:       p.marketLabel,
          side:         'YES',
          line:         null,
          bestUserPrice: p.bestPrice,
          bestUserBook: p.bestBook,
          matchup:      p.matchup,
          gameTime:     p.gameTime,
          sport:        p.sport,
          score:        p.score,
          grade:        p.grade,
          eventId:      '',
        })));
      } catch { }
    }

    console.log(`  Credits used: ${quota.requestsMade}`);
    console.log(`  Credits remaining: ${quota.remainingRequests ?? 'unknown'}\n`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  First scorer scan failed: ${msg}\n`);
  }
}
