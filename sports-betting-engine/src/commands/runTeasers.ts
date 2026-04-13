// ============================================================
// src/commands/runTeasers.ts
// NFL Teaser Engine -- finds key number crossings
// Run via: npm run teasers  or  index.ts teasers
// Best used on NFL game days (Sunday / Thursday / Monday)
// ============================================================
import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getSessionQuota } from '../api/oddsApiClient';
import { normalizeEvents }                       from '../services/normalizeOdds';
import { aggregateAllEvents }                    from '../services/aggregateMarkets';
import { analyzeSharpIntelligence }              from '../services/sharpIntelligence';
import { buildAllContextPackages }               from '../services/contextIntelligence';
import { getATSSituation }                       from '../services/atsDatabase';
import {
  buildTeaserLegs,
  buildTeaserCombinations,
  printTeaserReport,
  TEASER_SIZES,
  TeaserSize,
} from '../services/teaserEngine';
import { EventSummary } from '../types/odds';

function hoursUntil(t: string): number {
  return (new Date(t).getTime() - Date.now()) / 3600000;
}

function safeSync<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

async function safeRun<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export async function runTeasers(options: { forceRefresh?: boolean } = {}) {
  const quota = getSessionQuota();
  const windowHours = parseInt(process.env.WINDOW_HOURS_OVERRIDE ?? '24');

  console.log('\n  NFL Teaser Engine -- Key Number Analysis');
  console.log('  Fetching NFL spreads and totals...\n');

  try {
    // -- Step 1: Fetch NFL odds ----------------------------------
    const { results: rawBySport } = await getOddsForAllSports(
      ['americanfootball_nfl', 'americanfootball_ncaaf'],
      ['spreads', 'totals', 'h2h'],
      options.forceRefresh ?? false
    );

    const allSummaries: EventSummary[] = [];
    for (const [key, events] of rawBySport) {
      allSummaries.push(...aggregateAllEvents(normalizeEvents(events, key)));
    }

    const upcoming = allSummaries.filter(e => {
      const h = hoursUntil(e.startTime);
      return h > 0 && h <= windowHours;
    });

    if (upcoming.length === 0) {
      console.log('  No upcoming NFL/NCAAF games found in the next 24 hours.');
      console.log('  Teasers are most useful Sunday (NFL) and Saturday (NCAAF).\n');
      return;
    }

    console.log(`  Found ${upcoming.length} game(s). Running key number analysis...`);

    // -- Step 2: Build intelligence context ----------------------
    const priorSummaries: EventSummary[] = [];
    const sharpIntel = safeSync(
      () => analyzeSharpIntelligence(upcoming, priorSummaries),
      new Map()
    );

    const contextMap = await safeRun(
      () => buildAllContextPackages(upcoming.map(e => ({
        eventId: e.eventId, matchup: e.matchup, sportKey: e.sportKey,
        homeTeam: e.homeTeam, awayTeam: e.awayTeam, gameTime: e.startTime,
      }))),
      new Map()
    );

    // -- Step 3: Build event inputs for teaser engine ------------
    const eventInputs = upcoming.map(event => {
      const spreadMarket = event.aggregatedMarkets['spreads'];
      const totalMarket  = event.aggregatedMarkets['totals'];

      // Home spread line -- negative = home is favorite
      const homeSpreadSide = spreadMarket?.sides?.find(s =>
        s.outcomeName.toLowerCase().includes(event.homeTeam.toLowerCase().split(' ').pop() ?? '')
      );
      const spreadLine = homeSpreadSide?.consensusLine ?? null;
      const totalLine  = totalMarket?.sides?.[0]?.consensusLine ?? null;

      // Base score -- use sharp intel + context to score the game quality
      const sharpList = sharpIntel.get(event.eventId) ?? [];
      const ctx = contextMap.get(event.eventId);

      let score = 65; // base
      if (sharpList.length > 0) score += 8;
      if (ctx?.homeRest?.daysOfRest >= 2 || ctx?.awayRest?.daysOfRest >= 2) score += 5;
      if (spreadMarket?.bookCount >= 5) score += 5;
      if (spreadMarket?.bookCount >= 8) score += 5;

      // ATS situation bonus
      const ats = safeSync(() => getATSSituation(
        event.sportKey, event.homeTeam, event.awayTeam, spreadLine
      ), null);
      if (ats?.atsScoreBonus && ats.atsScoreBonus >= 5) score += 5;

      const signals: string[] = [];
      if (sharpList.length > 0) signals.push('SHARP_STEAM');
      if (ctx?.homeRest?.isBackToBack) signals.push('B2B_HOME');
      if (ctx?.awayRest?.isBackToBack) signals.push('B2B_AWAY');

      return {
        eventId: event.eventId,
        matchup: event.matchup,
        gameTime: event.startTime,
        sportKey: event.sportKey,
        spreadLine,
        totalLine,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        score: Math.min(100, score),
        signals,
      };
    }).filter(e => e.spreadLine !== null || e.totalLine !== null);

    if (eventInputs.length === 0) {
      console.log('  No spread or total lines available yet for NFL games.');
      console.log('  Lines typically post Tuesday-Wednesday for the upcoming week.\n');
      return;
    }

    // -- Step 4: Build legs and combinations for each teaser size
    const allResults: Array<{ size: TeaserSize; combos: ReturnType<typeof buildTeaserCombinations> }> = [];

    for (const size of TEASER_SIZES) {
      const legs = buildTeaserLegs(eventInputs, size);
      const combos = buildTeaserCombinations(legs, size, 5);
      allResults.push({ size, combos });

      if (legs.length > 0) {
        console.log(`  ${size}pt teaser: ${legs.length} qualifying legs, ${combos.length} combo(s)`);
      }
    }

    // -- Step 5: Print report -----------------------------------
    printTeaserReport(allResults);

    console.log(`  API requests used  : ${quota.requestsMade}`);
    console.log(`  Credits remaining  : ${quota.remainingRequests ?? 'unknown'}\n`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  Teaser engine failed: ${msg}\n`);
  }
}
