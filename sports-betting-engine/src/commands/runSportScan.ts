// ============================================================
// src/commands/runSportScan.ts
// Single sport scan -- game lines + props in ONE unified Top 10
// Best plays across all markets: ML, spread, total, props
// Props only for NBA and NFL
// ============================================================

import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getSessionQuota } from '../api/oddsApiClient';
import { normalizeEvents } from '../services/normalizeOdds';
import { aggregateAllEvents } from '../services/aggregateMarkets';
import { getTopBets, printTopTen, ScoredBet } from '../services/topTenBets';
import { analyzeSharpIntelligence } from '../services/sharpIntelligence';
import { getESPNInjuries } from '../services/espnData';
import { getEnhancedInjuries } from '../services/directInjuryScraper';
import { getGameWeather, isOutdoorSport } from '../services/weatherData';
import { buildAllContextPackages } from '../services/contextIntelligence';
import { checkSituationalAngles } from '../services/situationalAngles';
import { scoreAllMarketEfficiency } from '../services/marketEfficiency';
import { getAllCLVProjections } from '../services/clvProjection';
import { getGamePowerRatings, compareToLine } from '../services/powerRatings';
import { buildPublicBettingMap } from '../services/publicBetting';
import { buildGameImpactSummary } from '../services/playerImpact';
import { detectSteamMoves } from '../services/steamDetector';
import { loadSignalWeights } from '../services/retroAnalysis';
import { getATSSituation } from '../services/atsDatabase';
import { compareToOpeningLines } from '../services/lineOpener';
import { buildCalibrationModel } from '../services/mlCalibration';
import { buildLineupMap } from '../services/lineupConfirmation';
import { getSportByKey } from '../config/sports';
import { PROP_CONFIG } from '../config/propConfig';
import { INITIAL_MARKETS, EXTENDED_MARKETS, EventSummary } from '../types/odds';
// Prop imports
import { getOddsBySport } from '../api/oddsApiClient';
import { normalizePropsFromEvent, aggregateProps } from '../services/propNormalizer';
import { scoreAllPropsWithIntelligence, printTopProps, ScoredProp } from '../services/propScorer';
import { detectPropCorrelation } from '../services/propEdgeFactors';
import { savePicksFromTopTen, savePropPicks, saveParlayPicks } from '../services/closingLineTracker';
import { findCorrelatedParlays, printSGPReport, SGPLeg } from '../services/sgpCorrelation';

async function safeRun<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}
function safeSync<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export async function runSportScan(
  sportKey: string,
  options: { forceRefresh?: boolean } = {}
) {
  const sport = getSportByKey(sportKey);
  if (!sport) throw new Error(`Unknown sport key: "${sportKey}"`);

  // Timing reminders for thin markets
  const _hour = new Date().getHours();
  if (sportKey === 'baseball_mlb' && _hour < 10) {
    console.log('\n  [TIMING TIP] MLB lines are typically not fully posted before 10 AM CT.');
    console.log('  For best results run MLB scan at 11 AM CT or later.');
    console.log('  Lines posted now may have fewer than 2 books -- some games may not qualify.\n');
  }
  if (sportKey === 'icehockey_nhl' && _hour < 11) {
    console.log('\n  [TIMING TIP] NHL lines are typically not fully posted before 11 AM CT.');
    console.log('  For best results run NHL scan at noon CT or later.');
    console.log('  Lines posted now may have fewer than 2 books -- some games may not qualify.\n');
  }

  // -- Fetch game line odds ---------------------------------
  const { results: rawBySport } = await getOddsForAllSports(
    [sportKey], INITIAL_MARKETS, options.forceRefresh ?? false
  );

  const allSummaries: EventSummary[] = [];
  for (const [key, events] of rawBySport) {
    allSummaries.push(...aggregateAllEvents(normalizeEvents(events, key)));
  }

  // -- Intelligence suite -----------------------------------
  const sharpIntel = safeSync(() => analyzeSharpIntelligence(allSummaries), new Map());

  const injuryMap = new Map<string, any[]>();
  await safeRun(async () => {
    const injuries = await getESPNInjuries(sportKey);
    for (const [team, list] of injuries) {
      for (const event of allSummaries) {
        const homeLast = event.homeTeam.split(' ').pop() ?? '';
        const awayLast = event.awayTeam.split(' ').pop() ?? '';
        if (team.includes(homeLast) || team.includes(awayLast)) {
          const existing = injuryMap.get(event.eventId) ?? [];
          injuryMap.set(event.eventId, [...existing, ...list]);
        }
      }
    }
  }, undefined);

  const weatherMap = new Map<string, any>();
  if (isOutdoorSport(sportKey)) {
    for (const event of allSummaries) {
      await safeRun(async () => {
        const w = await getGameWeather(sportKey, '', event.homeTeam, event.startTime);
        if (w) weatherMap.set(event.eventId, w);
      }, undefined);
    }
  }

  const contextMap = await safeRun(
    () => buildAllContextPackages(allSummaries.map(e => ({
      eventId: e.eventId, matchup: e.matchup, sportKey: e.sportKey,
      homeTeam: e.homeTeam, awayTeam: e.awayTeam, gameTime: e.startTime,
    }))),
    new Map()
  );

  const situationalAngles = new Map<string, any[]>();
  for (const event of allSummaries) {
    safeSync(() => {
      const ctx = contextMap.get(event.eventId);
      const angles = checkSituationalAngles(
        event.sportKey, event.homeTeam, event.awayTeam,
        ctx?.homeForm ?? null, ctx?.awayForm ?? null,
        ctx?.homeRest ?? null, ctx?.awayRest ?? null,
        event.aggregatedMarkets['spreads']?.sides[0]?.consensusLine ?? null,
        event.aggregatedMarkets['totals']?.sides[0]?.consensusLine ?? null,
      );
      if (angles.length > 0) situationalAngles.set(event.eventId, angles);
    }, undefined);
  }

  const marketEfficiency = safeSync(() => scoreAllMarketEfficiency(allSummaries), new Map());
  const hoursMap = new Map(allSummaries.map(e => [
    e.eventId, Math.max(0, (new Date(e.startTime).getTime() - Date.now()) / 3600000)
  ]));
  const clvProjections = safeSync(
    () => getAllCLVProjections(allSummaries, [], hoursMap), new Map()
  );

  const powerRatings = new Map<string, any>();
  for (let i = 0; i < allSummaries.length; i += 4) {
    await Promise.allSettled(allSummaries.slice(i, i+4).map(async (event) => {
      await safeRun(async () => {
        const { home, away } = await getGamePowerRatings(sportKey, event.homeTeam, event.awayTeam);
        if (home && away) {
          const postedSpread = event.aggregatedMarkets['spreads']?.sides.find(s =>
            s.outcomeName.toLowerCase().includes(event.homeTeam.toLowerCase().split(' ').pop() ?? '')
          )?.consensusLine ?? 0;
          powerRatings.set(event.eventId, { home, away, comparison: compareToLine(home, away, postedSpread, sportKey) });
        }
      }, undefined);
    }));
  }

  const publicBetting = await safeRun(
    () => buildPublicBettingMap(allSummaries.map(e => ({
      eventId: e.eventId, sportKey: e.sportKey, homeTeam: e.homeTeam, awayTeam: e.awayTeam
    }))),
    new Map()
  );

  const playerImpacts = new Map<string, any>();
  for (const event of allSummaries) {
    await safeRun(async () => {
      const injuries = injuryMap.get(event.eventId) ?? [];
      const homeLast = event.homeTeam.split(' ').pop() ?? '';
      const awayLast = event.awayTeam.split(' ').pop() ?? '';
      const hi = injuries.filter((i: any) => (i.team ?? '').includes(homeLast));
      const ai = injuries.filter((i: any) => (i.team ?? '').includes(awayLast));
      if (hi.length > 0 || ai.length > 0) {
        const impact = await buildGameImpactSummary(
          sportKey, event.eventId, event.homeTeam, event.awayTeam,
          hi.map((i: any) => ({ playerName: i.playerName ?? '', position: i.position ?? '', status: i.status ?? '' })),
          ai.map((i: any) => ({ playerName: i.playerName ?? '', position: i.position ?? '', status: i.status ?? '' })),
        );
        playerImpacts.set(event.eventId, impact);
      }
    }, undefined);
  }

  const steamMoves = safeSync(() => detectSteamMoves(allSummaries), []);

  const atsSituations = new Map<string, any>();
  for (const event of allSummaries) {
    safeSync(() => {
      const spreadLine = event.aggregatedMarkets['spreads']?.sides[0]?.consensusLine ?? null;
      atsSituations.set(event.eventId, getATSSituation(sportKey, event.homeTeam, event.awayTeam, spreadLine));
    }, undefined);
  }

  const lineOpeners = new Map<string, any>();
  for (const event of allSummaries) {
    safeSync(() => {
      const comp = compareToOpeningLines(
        event.eventId, event.matchup,
        event.aggregatedMarkets['spreads']?.sides[0]?.consensusLine ?? null,
        event.aggregatedMarkets['totals']?.sides[0]?.consensusLine ?? null,
        event.aggregatedMarkets['h2h']?.sides.find(s =>
          s.outcomeName.toLowerCase().includes(event.homeTeam.toLowerCase().split(' ').pop() ?? '')
        )?.consensusPrice ?? null,
      );
      lineOpeners.set(event.eventId, comp);
    }, undefined);
  }

  const calibrationModel = safeSync(() => buildCalibrationModel(), null);
  const lineupMap = await safeRun(
    () => buildLineupMap(allSummaries.map(e => ({
      eventId: e.eventId, sportKey: e.sportKey,
      homeTeam: e.homeTeam, awayTeam: e.awayTeam, gameTime: e.startTime,
    }))),
    new Map()
  );

  // -- Score game line bets ---------------------------------
  const learnedWeights = (() => { try { return loadSignalWeights(); } catch { return {}; } })();
  const gameLineBets = getTopBets(allSummaries, 20, {
    windowHours: parseInt(process.env.WINDOW_HOURS_OVERRIDE ?? '24'),
    singleSport: true,  // allow 2 per game, 5 BET + 5 LEAN
    sharpIntel, weatherMap, injuryMap, contextMap,
    situationalAngles, marketEfficiency, clvProjections, powerRatings,
    publicBetting, playerImpacts, steamMoves, atsSituations, lineOpeners,
    calibrationModel, lineupMap, learnedWeights,
  });

  // -- Fetch and score props (NBA + NFL only) ---------------
  let propBets: ScoredProp[] = [];
  const propsAllowed = PROP_CONFIG.ENABLED_SPORTS.includes(sportKey);

  if (propsAllowed) {
    propBets = await safeRun(async () => {
      const now = Date.now();
      const upcomingEvents = allSummaries.filter(e => {
        const hours = (new Date(e.startTime).getTime() - now) / 3600000;
        return hours >= 1 && hours <= 24;
      });

      const allRawProps: any[] = [];
      for (const event of upcomingEvents) { // scan ALL games -- best 5 selected after scoring
        try {
          const sportMarkets = sportKey === 'americanfootball_nfl'
              ? PROP_CONFIG.NFL_PROP_MARKETS
              : sportKey === 'baseball_mlb'
              ? (PROP_CONFIG as any).MLB_PROP_MARKETS ?? PROP_CONFIG.NBA_PROP_MARKETS
              : sportKey === 'icehockey_nhl'
              ? (PROP_CONFIG as any).NHL_PROP_MARKETS ?? PROP_CONFIG.NBA_PROP_MARKETS
              : PROP_CONFIG.NBA_PROP_MARKETS;
        const { event: eventWithProps } = await (await import('../api/oddsApiClient')).getEventMarkets(
            sportKey, event.eventId,
            sportMarkets as any[], undefined, 'american'
          );
          if (eventWithProps) {
            const rows = normalizePropsFromEvent(
              eventWithProps, sportMarkets as any[], new Date().toISOString()
            );
            allRawProps.push(...rows);
          }
        } catch { }
      }

      if (allRawProps.length === 0) return [];
      const aggregated = aggregateProps(allRawProps);
      const scored = await scoreAllPropsWithIntelligence(aggregated, 24, contextMap, sportKey, {
        injuryMap,
        lineupMap,
        publicBetting,
        powerRatings,
        steamMoves,
        atsSituations,
        weatherMap,
      }, learnedWeights);
      return scored.slice(0, PROP_CONFIG.TOP_N);
    }, []);
  }

  // -- Same-game parlay correlation engine -----------------
  if (propBets.length >= 2 && propsAllowed) {
    try {
      // Convert scored props to SGP legs
      const sgpLegs: SGPLeg[] = propBets
        .filter(p => p.line !== null && p.bestUserPrice !== null)
        .slice(0, 10)
        .map(p => ({
          playerName: p.playerName,
          team: (p as any).team ?? '',
          market: (p as any).statType ?? p.market ?? '',
          line: p.line!,
          side: p.side as 'over' | 'under',
          price: p.bestUserPrice!,
          sport: sportKey,
          eventId: (p as any).eventId ?? allSummaries[0]?.eventId ?? '',
        }));

      // Get game context from first event
      const firstEvent = allSummaries[0];
      const gameTotal = firstEvent?.aggregatedMarkets['totals']?.sides[0]?.consensusLine ?? null;
      const gameSpread = firstEvent?.aggregatedMarkets['spreads']?.sides[0]?.consensusLine ?? null;

      const correlated = findCorrelatedParlays(sgpLegs, gameTotal, gameSpread);
      if (correlated.length > 0) {
        printSGPReport(correlated, sportKey);
        // Save SGP parlays to tracking log
        try {
          saveParlayPicks(correlated.map(p => ({
            legs: p.legs.map(l => ({
              playerName: l.playerName,
              market: l.market,
              side: l.side,
              standardLine: l.line,
              altPrice: l.price,
              matchup: `${l.team}`,
            })),
            parlayPrice: p.combinedPrice,
            hitRate: p.correlationScore,
            grade: p.grade,
            tier: p.confidence,
            correlationType: p.correlationType,
            matchup: p.legs.map(l => l.team).filter((v,i,a) => a.indexOf(v) === i).join(' vs '),
            sport: sportKey.includes('nfl') ? 'NFL' : 'NBA',
            gameTime: new Date().toISOString(),
            parlayType: 'SGP' as const,
          })));
        } catch { }
      }
    } catch { /* SGP is supplemental */ }
  }

  // -- Correlation check across top props ------------------
  if (propBets.length >= 2) {
    const correlationWarnings: string[] = [];
    for (let i = 0; i < Math.min(propBets.length, 5); i++) {
      for (let j = i + 1; j < Math.min(propBets.length, 5); j++) {
        const p1 = propBets[i];
        const p2 = propBets[j];
        const sameTeam = (p1 as any).team === (p2 as any).team;
        const corr = detectPropCorrelation(
          p1.playerName, p1.market ?? '', p1.side,
          p2.playerName, p2.market ?? '', p2.side,
          sameTeam, sportKey
        );
        if (corr.correlationType !== 'none' && corr.warning) {
          correlationWarnings.push(corr.warning);
        }
      }
    }
    if (correlationWarnings.length > 0) {
      console.log('\n  -- CORRELATION ALERTS -----------------------------------');
      correlationWarnings.forEach(w => console.log(`  ${w}`));
    }
  }

  // -- Save picks to log ------------------------------------
  if (gameLineBets.length > 0) {
    try {
      savePicksFromTopTen(gameLineBets.map(b => ({
        sport: b.sport,
        sportKey: sportKey,
        eventId: (b as any).eventId ?? '',
        matchup: b.matchup,
        startTime: b.startTime,
        betType: b.betType,
        side: b.side,
        bestPrice: b.bestUserPrice,
        bestLine: b.bestUserLine ?? null,
        bestBook: b.bestUserBook,
        grade: b.grade,
        score: b.score,
        kellyPct: b.kellyPct,
      })));
    } catch { }
  }

  // -- Unified output ---------------------------------------
  const quota = getSessionQuota();
  const totalPlays = gameLineBets.length + propBets.length;

  // Print unified header
  console.log('\n');
  console.log('+==============================================================+');
  console.log(`|  ${sport.name} -- TOP PLAYS (Game Lines + Props)              `);
  console.log(`|  Best plays across ALL markets: ML, Spread, Total, Props     `);
  console.log('+==============================================================+');

  // Print game lines section
  if (gameLineBets.length > 0) {
    console.log('\n  -- GAME LINES --------------------------------------------');
    printTopTen(gameLineBets, 24);
  } else {
    // Diagnostic -- tell user exactly why no plays qualified
    const isMLBd = sportKey.includes('baseball_mlb');
    const isNHLd = sportKey.includes('nhl');
    console.log('\n  No qualifying plays found today.');
    console.log(`  Games scanned: ${allSummaries.length}`);
    if (allSummaries.length === 0) {
      console.log('  -- No games scheduled in the next 24 hours for this sport.');
    } else {
      console.log(`  -- ${allSummaries.length} game(s) found but none cleared the signal minimum.`);
      if (isMLBd) {
        console.log('  TIP: MLB lines may not be fully posted yet.');
        console.log('  Best time to run MLB: 11 AM CT or later.');
      } else if (isNHLd) {
        console.log('  TIP: NHL lines may not be fully posted yet.');
        console.log('  Best time to run NHL: noon CT or later.');
      } else {
        console.log('  All games have efficient lines today -- no detectable edge.');
      }
    }
    console.log('');
  }

  // Print props section (NBA/NFL only)
  if (propsAllowed) {
    if (propBets.length > 0) {
      console.log('\n  -- PLAYER PROPS ------------------------------------------');
      printTopProps(propBets);
      // Save prop picks to tracking log
      try {
        savePropPicks(propBets.map(p => ({
          playerName: p.playerName,
          market: p.market,
          side: p.side,
          line: p.line,
          bestUserPrice: p.bestUserPrice,
          bestUserBook: p.bestUserBook,
          matchup: p.matchup,
          gameTime: p.gameTime,
          sport: p.sport,
          score: p.score,
          grade: p.grade,
          eventId: (p as any).eventId ?? '',
        })));
      } catch { }

    } else {
      const isNHL = sportKey.includes('nhl');
      const isMLB = sportKey.includes('mlb');
      if (isNHL || isMLB) {
        console.log(`\n  -- PLAYER PROPS ------------------------------------------`);
        console.log(`\n  No ${sport.name} prop edges found today.`);
        console.log('  This is normal -- prop markets for NHL/MLB require:');
        console.log('  1. At least 2 books posting the same market');
        console.log('  2. A price edge at FanDuel or BetMGM vs consensus');
        console.log('  3. At least 2 qualifying signals');
        console.log('  Try running at 2-3 PM CT when more books have posted.\n');
      } else {
        console.log('\n  No qualifying prop plays found (books may not be posted yet).\n');
      }
    }
  }

  console.log(`  API requests used  : ${quota.requestsMade}`);
  console.log(`  Credits remaining  : ${quota.remainingRequests ?? 'unknown'}`);
  console.log(`  Total plays shown  : ${totalPlays}\n`);
}
