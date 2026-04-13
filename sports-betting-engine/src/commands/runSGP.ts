// ============================================================
// src/commands/runSGP.ts
// Standalone SGP correlation engine
// Fetches ALL prop markets across ALL games
// Groups by game, finds correlated leg combinations
// Completely separate from option 4 sport scan
// ============================================================
import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getEventMarkets, getSessionQuota } from '../api/oddsApiClient';
import { PROP_CONFIG }                      from '../config/propConfig';
import { normalizeEvents }                  from '../services/normalizeOdds';
import { aggregateAllEvents } from '../services/aggregateMarkets';
import { EventSummary } from '../types/odds';
import { normalizePropsFromEvent, aggregateProps } from '../services/propNormalizer';
import { scoreAllPropsWithIntelligence }    from '../services/propScorer';
import { getESPNInjuries }                  from '../services/espnData';
import { buildAllContextPackages }          from '../services/contextIntelligence';
import { buildLineupMap }                   from '../services/lineupConfirmation';
import { buildPublicBettingMap }            from '../services/publicBetting';
import { getTeamPowerRating, compareToLine } from '../services/powerRatings';
import { detectSteamMoves }                 from '../services/steamDetector';
import { getATSSituation }                  from '../services/atsDatabase';
import { findCorrelatedParlays, printSGPReport, SGPLeg } from '../services/sgpCorrelation';
import { saveParlayPicks }                  from '../services/closingLineTracker';


function hoursUntil(t: string): number {
  return (new Date(t).getTime() - Date.now()) / 3600000;
}
async function safeRun<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ALL prop markets needed for SGP correlation patterns
// Points + Rebounds + Assists = STAR_PTS_REB_AST_STACK
// Assists + Totals = PG_ASSISTS_TEAM_SCORE
// Points + Points = BLOWOUT_UNDER_STACK
const SGP_MARKETS_NBA = [
  'player_points', 'player_rebounds', 'player_assists',
  'player_threes', 'player_blocks', 'player_steals',
  'player_points_rebounds_assists', 'player_points_rebounds',
  'player_points_assists',
];
const SGP_MARKETS_NFL = [
  'player_pass_yds', 'player_rush_yds', 'player_reception_yds',
  'player_receptions', 'player_anytime_td', 'player_pass_tds',
];

export async function runSGP(sportKey: string = 'basketball_nba') {
  const sportLabel = sportKey.includes('nfl') ? 'NFL' : 'NBA';
  const markets = sportKey.includes('nfl') ? SGP_MARKETS_NFL : SGP_MARKETS_NBA;
  const quota = getSessionQuota();

  console.log(`\n  SGP Correlation Engine -- ${sportLabel}`);
  console.log('  Fetching all prop markets for correlation analysis...\n');

  try {
    // Step 1: Get all upcoming games
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

    console.log(`  Found ${upcoming.length} game(s). Fetching ALL prop markets...`);
    console.log(`  Markets: ${markets.join(', ')}\n`);

    // Step 2: Build intelligence suite for scoring
    const injuryMap = new Map<string, any[]>();
    await (async () => {
      try {
        const injuries = await getESPNInjuries(sportKey);
        for (const [team, list] of injuries) {
          for (const event of upcoming) {
            const hl = event.homeTeam.split(' ').pop() ?? '';
            const al = event.awayTeam.split(' ').pop() ?? '';
            if (team.includes(hl) || team.includes(al)) {
              const existing = injuryMap.get(event.eventId) ?? [];
              injuryMap.set(event.eventId, [...existing, ...list]);
            }
          }
        }
      } catch { }
    })();

    const contextMap = await (async () => {
      try {
        return await buildAllContextPackages(upcoming.map(e => ({
          eventId: e.eventId, matchup: e.matchup, sportKey: e.sportKey,
          homeTeam: e.homeTeam, awayTeam: e.awayTeam, gameTime: e.startTime,
        })));
      } catch { return new Map(); }
    })();

    const lineupMap = await (async () => {
      try {
        return await buildLineupMap(upcoming.map(e => ({
          eventId: e.eventId, homeTeam: e.homeTeam, awayTeam: e.awayTeam,
          sport: sportKey, startTime: e.startTime,
        })));
      } catch { return new Map(); }
    })();

    const publicBetting = await (async () => {
      try {
        return await buildPublicBettingMap(upcoming.map(e => ({
          eventId: e.eventId, homeTeam: e.homeTeam, awayTeam: e.awayTeam, sport: sportKey,
        })));
      } catch { return new Map(); }
    })();

    const steamMoves = (() => { try { return detectSteamMoves(allSummaries); } catch { return []; } })();

    const atsSituations = new Map<string, any>();
    for (const event of upcoming) {
      try {
        const spread = event.aggregatedMarkets['spreads']?.sides[0]?.consensusLine ?? null;
        atsSituations.set(event.eventId, getATSSituation(sportKey, event.homeTeam, event.awayTeam, spread));
      } catch { }
    }

    // Step 3: Fetch ALL prop markets for EVERY game
    // Group raw props by eventId for SGP analysis
    const propsByEvent = new Map<string, any[]>();

    for (const event of upcoming) {
      const rows: any[] = [];
      for (const market of markets) {
        try {
          const { event: ev } = await getEventMarkets(
            sportKey, event.eventId, [market] as any[], undefined, 'american'
          );
          if (ev) {
            const normalized = normalizePropsFromEvent(ev, [market], new Date().toISOString());
            rows.push(...normalized);
          }
        } catch { /* market not available for this game */ }
      }
      if (rows.length > 0) {
        propsByEvent.set(event.eventId, rows);
        console.log(`  [+] ${event.awayTeam} vs ${event.homeTeam} -- ${rows.length} prop lines`);
      }
    }

    if (propsByEvent.size === 0) {
      console.log('\n  No prop lines available yet. Try again closer to game time.\n');
      return;
    }

    // Step 3: Build SGP legs per game and run correlation engine
    let totalParlays = 0;
    const allCorrelated: any[] = [];

    for (const [eventId, rawProps] of propsByEvent) {
      const event = upcoming.find(e => e.eventId === eventId);
      if (!event) continue;

      // Aggregate and score props with full intelligence
      const aggregated = aggregateProps(rawProps);

      // Score with full intelligence suite
      let scoredProps: any[] = [];
      try {
        scoredProps = await scoreAllPropsWithIntelligence(
          aggregated, 24, contextMap, sportKey,
          { injuryMap, lineupMap, publicBetting, steamMoves, atsSituations }
        );
      } catch {
        scoredProps = [];
      }

      // Build SGP legs from scored props -- use intelligence score to rank
      const legs: SGPLeg[] = [];

      for (const prop of scoredProps) {
        if (!prop.playerName || !prop.line) continue;
        const sideNorm = (prop.side ?? '').toLowerCase();

        legs.push({
          playerName: prop.playerName,
          team: (prop as any).team ?? '',
          market: (prop as any).statType ?? prop.market ?? '',
          line: prop.line,
          side: sideNorm as 'over' | 'under',
          price: prop.bestUserPrice ?? -110,
          sport: sportKey,
          eventId: (prop as any).eventId ?? eventId,
        });
      }

      if (legs.length < 2) continue;

      // Get game context
      const gameTotal  = event.aggregatedMarkets['totals']?.sides[0]?.consensusLine ?? null;
      const gameSpread = event.aggregatedMarkets['spreads']?.sides[0]?.consensusLine ?? null;

      // Run correlation engine
      const correlated = findCorrelatedParlays(legs, gameTotal, gameSpread);

      if (correlated.length > 0) {
        console.log(`\n  ${event.awayTeam} @ ${event.homeTeam}`);
        printSGPReport(correlated, sportKey);
        allCorrelated.push(...correlated.map(p => ({
          ...p,
          matchup: `${event.awayTeam} @ ${event.homeTeam}`,
          gameTime: event.startTime,
        })));
        totalParlays += correlated.length;
      }
    }

    if (totalParlays === 0) {
      console.log('\n  No correlated parlays found today.');
      console.log('  Correlation patterns need specific market combos:');
      console.log('  NBA: Points + Rebounds + Assists (star stack)');
      console.log('        PG Assists + Team Total Over (pace play)');
      console.log('        Both stars under points (blowout)');
      console.log('  Try again at 4:30 PM when all books have posted full lines.\n');
    } else {
      // Save to tracking log
      try {
        saveParlayPicks(allCorrelated.map((p: any) => ({
          legs: p.legs.map((l: any) => ({
            playerName: l.playerName,
            market: l.market,
            side: l.side,
            standardLine: l.line,
            altPrice: l.price,
          })),
          parlayPrice: p.combinedPrice,
          hitRate: p.correlationScore,
          grade: p.grade,
          tier: p.confidence,
          correlationType: p.correlationType,
          matchup: p.matchup ?? '',
          sport: sportLabel,
          gameTime: p.gameTime ?? new Date().toISOString(),
          parlayType: 'SGP' as const,
        })));
      } catch { }
    }

    console.log(`\n  Credits used this run: ${quota.requestsMade}`);
    console.log(`  Credits remaining: ${quota.remainingRequests ?? 'unknown'}\n`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  SGP run failed: ${msg}\n`);
  }
}
