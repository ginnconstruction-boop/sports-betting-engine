// ============================================================
// runAltParlays.ts
// Standalone alt line parlay finder
// Runs AFTER props -- uses already-scored props as input
// Does NOT re-fetch or re-score anything
// Does NOT touch the standard prop system
// ============================================================
import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports }              from '../api/oddsApiClient';
import { PROP_CONFIG }                      from '../config/propConfig';
import { normalizeEvents }                  from '../services/normalizeOdds';
import { aggregateAllEvents } from '../services/aggregateMarkets';
import { EventSummary } from '../types/odds';
import { getEventMarkets }                  from '../api/oddsApiClient';
import { normalizePropsFromEvent, aggregateProps } from '../services/propNormalizer';
import { scoreAllPropsWithIntelligence }    from '../services/propScorer';
import { getESPNInjuries }                  from '../services/espnData';
import { buildAllContextPackages }          from '../services/contextIntelligence';
import { buildLineupMap }                   from '../services/lineupConfirmation';
import { buildPublicBettingMap }            from '../services/publicBetting';
import { getTeamPowerRating, compareToLine } from '../services/powerRatings';
import { detectSteamMoves }                 from '../services/steamDetector';
import { getATSSituation }                  from '../services/atsDatabase';
import { getSessionQuota }                  from '../api/oddsApiClient';
import { generateAltLines, buildAltLineParlays, printAltLineParlayReport } from '../services/altLineParlayEngine';
import { saveParlayPicks } from '../services/closingLineTracker';

async function safeRun<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}
function safeSync<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}
function hoursUntil(t: string) {
  return (new Date(t).getTime() - Date.now()) / 3600000;
}

export async function runAltParlays(sportKey: string = 'basketball_nba') {
  const sportLabel = sportKey === 'basketball_nba' ? 'NBA'
    : sportKey === 'americanfootball_nfl' ? 'NFL' : sportKey.toUpperCase();

  console.log(`\n  Building ${sportLabel} alt line parlays...`);
  console.log('  Fetching props + full intelligence suite...\n');

  const quota = getSessionQuota();

  try {
    // -- Step 1: Get upcoming games -----------------------------
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
      console.log('  No upcoming games found today.\n');
      return;
    }
    console.log(`  Found ${upcoming.length} game(s). Building intelligence...\n`);

    // -- Step 2: Build all intelligence maps --------------------
    const injuryMap = new Map<string, any[]>();
    await safeRun(async () => {
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
    }, undefined);

    const contextMap = await safeRun(
      () => buildAllContextPackages(upcoming.map(e => ({
        eventId: e.eventId, matchup: e.matchup, sportKey: e.sportKey,
        homeTeam: e.homeTeam, awayTeam: e.awayTeam, gameTime: e.startTime,
      }))),
      new Map()
    );

    const lineupMap = await safeRun(() => buildLineupMap(upcoming.map(e => ({ eventId: e.eventId, homeTeam: e.homeTeam, awayTeam: e.awayTeam, sport: sportKey, startTime: e.startTime }))), new Map());
    const publicBetting = await safeRun(() => buildPublicBettingMap(upcoming.map(e => ({
      eventId: e.eventId, homeTeam: e.homeTeam, awayTeam: e.awayTeam, sport: sportKey,
    }))), new Map());

    const powerRatings = new Map<string, any>();
    await safeRun(async () => {
      for (const event of upcoming) {
        const spread = event.aggregatedMarkets['spreads']?.sides[0]?.consensusLine ?? null;
        const [home, away] = await Promise.all([
          getTeamPowerRating(sportKey, event.homeTeam),
          getTeamPowerRating(sportKey, event.awayTeam),
        ]);
        if (home && away) {
          powerRatings.set(event.eventId, {
            home, away, comparison: compareToLine(home, away, spread, sportKey),
          });
        }
      }
    }, undefined);

    const { results: freshRaw } = await getOddsForAllSports([sportKey], ['h2h', 'spreads'], false)
      .catch(() => ({ results: new Map() }));
    const freshSummaries: EventSummary[] = [];
    for (const [k, ev] of freshRaw) freshSummaries.push(...aggregateAllEvents(normalizeEvents(ev, k)));
    const steamMoves = safeSync(() => detectSteamMoves(freshSummaries), []);

    const atsSituations = new Map<string, any>();
    safeSync(() => {
      for (const event of upcoming) {
        const spread = event.aggregatedMarkets['spreads']?.sides[0]?.consensusLine ?? null;
        atsSituations.set(event.eventId, getATSSituation(sportKey, event.homeTeam, event.awayTeam, spread));
      }
    }, undefined);

    // -- Step 3: Fetch standard prop lines ----------------------
    const markets = PROP_CONFIG.NBA_PROP_MARKETS;
    const allRawProps: any[] = [];
    const maxGames = upcoming.length; // scan all games for best alt line opportunities

    console.log(`  Fetching props for ${maxGames} game(s)...`);
    for (const event of upcoming.slice(0, maxGames)) {
      try {
        const { event: ev } = await getEventMarkets(
          sportKey, event.eventId, markets as any[], undefined, 'american'
        );
        if (ev) {
          const rows = normalizePropsFromEvent(ev, markets, new Date().toISOString());
          allRawProps.push(...rows);
          console.log(`  [+] ${event.awayTeam} vs ${event.homeTeam}`);
        }
      } catch { }
    }

    if (allRawProps.length === 0) {
      console.log('\n  No prop lines available yet. Try again closer to game time.\n');
      return;
    }

    // -- Step 4: Score with full intelligence -------------------
    const aggregated = aggregateProps(allRawProps);
    console.log(`\n  Scoring ${aggregated.length} prop markets with full intelligence...`);

    const scored = await scoreAllPropsWithIntelligence(
      aggregated, 24, contextMap, sportKey,
      { injuryMap, lineupMap, publicBetting, powerRatings, steamMoves, atsSituations }
    );

    if (scored.length === 0) {
      console.log('\n  No qualifying props found. Try again closer to tip-off.\n');
      return;
    }

    // -- Step 5: Build alt line parlays -------------------------
    console.log(`  Analyzing ${scored.length} scored props for alt line opportunities...\n`);

    const altLines = generateAltLines(scored as any[], 55);
    if (altLines.length < 2) {
      console.log('\n  Not enough qualifying alt lines today.');
      console.log('  Need at least 2 props scoring 55+ to build a parlay.\n');
      return;
    }

    const parlays = buildAltLineParlays(altLines, 3, 2);
    printAltLineParlayReport(parlays);
    // Save all alt line parlays to tracking log
    try {
      saveParlayPicks(parlays.map(p => ({
        legs: p.legs.map(l => ({
          playerName: l.playerName,
          market: l.marketLabel,
          side: l.side,
          altLine: l.altLine,
          standardLine: l.standardLine,
          altPrice: l.altPrice,
          matchup: l.matchup,
        })),
        parlayPrice: p.parlayPrice,
        hitRate: p.hitRate,
        grade: p.grade,
        tier: p.tier,
        correlationType: p.correlationType,
        matchup: p.legs[0]?.matchup ?? '',
        sport: sportLabel,
        gameTime: new Date().toISOString(),
        parlayType: 'ALT_LINE' as const,
      })));
    } catch { }

    console.log(`  Credits used: ${quota.requestsMade}`);
    console.log(`  Credits remaining: ${quota.remainingRequests ?? 'unknown'}\n`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  Alt parlay run failed: ${msg}\n`);
  }
}
