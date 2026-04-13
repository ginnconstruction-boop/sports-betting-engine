import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getSessionQuota } from '../api/oddsApiClient';
import { normalizeEvents } from '../services/normalizeOdds';
import { aggregateAllEvents } from '../services/aggregateMarkets';
import { saveSnapshot, loadLatestSnapshot } from '../services/snapshotStore';
import { getTopBets, printTopTen } from '../services/topTenBets';
import { loadSignalWeights } from '../services/retroAnalysis';
import { buildAdvancedStatsMap } from '../services/advancedStats';
import { savePicksFromTopTen } from '../services/closingLineTracker';
import { analyzeSharpIntelligence } from '../services/sharpIntelligence';
import { getESPNInjuries } from '../services/espnData';
import { getGameWeather, isOutdoorSport } from '../services/weatherData';
import { buildAllContextPackages } from '../services/contextIntelligence';
import { checkSituationalAngles } from '../services/situationalAngles';
import { scoreAllMarketEfficiency } from '../services/marketEfficiency';
import { getAllCLVProjections } from '../services/clvProjection';
import { getGamePowerRatings, compareToLine } from '../services/powerRatings';
import { buildPublicBettingMap } from '../services/publicBetting';
import { buildGameImpactSummary } from '../services/playerImpact';
import { detectSteamMoves } from '../services/steamDetector';
import { getATSSituation } from '../services/atsDatabase';
import { compareToOpeningLines } from '../services/lineOpener';
import { buildCalibrationModel } from '../services/mlCalibration';
import { buildLineupMap } from '../services/lineupConfirmation';
import { getEnabledSports } from '../config/sports';
import { INITIAL_MARKETS, EventSummary } from '../types/odds';

async function safeRun<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}
function safeSync<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export async function runMiddayFinalCard(options: { forceRefresh?: boolean } = {}) {
  const sportKeys = getEnabledSports().map(s => s.key);

  const { results: rawBySport } = await getOddsForAllSports(sportKeys, INITIAL_MARKETS, options.forceRefresh ?? true);
  const allSummaries: EventSummary[] = [];
  for (const [sportKey, events] of rawBySport) {
    allSummaries.push(...aggregateAllEvents(normalizeEvents(events, sportKey)));
  }

  const priorSnapshot = loadLatestSnapshot('MORNING_SCAN');
  const priorSummaries = priorSnapshot?.eventSummaries ?? [];
  const sharpIntel = safeSync(() => analyzeSharpIntelligence(allSummaries, priorSummaries), new Map());

  const injuryMap = new Map<string, any[]>();
  for (const sportKey of sportKeys) {
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
  }

  const weatherMap = new Map<string, any>();
  for (const event of allSummaries) {
    if (isOutdoorSport(event.sportKey)) {
      await safeRun(async () => {
        const w = await getGameWeather(event.sportKey, '', event.homeTeam, event.startTime);
        if (w) weatherMap.set(event.eventId, w);
      }, undefined);
    }
  }

  console.log('\n  Pulling intelligence data...');

  const contextMap = await safeRun(() => buildAllContextPackages(
    allSummaries.map(e => ({ eventId: e.eventId, matchup: e.matchup, sportKey: e.sportKey, homeTeam: e.homeTeam, awayTeam: e.awayTeam, gameTime: e.startTime }))
  ), new Map());

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
  const hoursMap = new Map(allSummaries.map(e => [e.eventId, Math.max(0, (new Date(e.startTime).getTime() - Date.now()) / 3600000)]));
  const clvProjections = safeSync(() => getAllCLVProjections(allSummaries, priorSummaries, hoursMap), new Map());

  const powerRatings = new Map<string, any>();
  for (let i = 0; i < allSummaries.length; i += 4) {
    await Promise.allSettled(allSummaries.slice(i, i+4).map(async (event) => {
      await safeRun(async () => {
        const { home, away } = await getGamePowerRatings(event.sportKey, event.homeTeam, event.awayTeam);
        if (home && away) {
          const postedSpread = event.aggregatedMarkets['spreads']?.sides.find(s =>
            s.outcomeName.toLowerCase().includes(event.homeTeam.toLowerCase().split(' ').pop() ?? '')
          )?.consensusLine ?? 0;
          powerRatings.set(event.eventId, { home, away, comparison: compareToLine(home, away, postedSpread, event.sportKey) });
        }
      }, undefined);
    }));
  }

  const publicBetting = await safeRun(() => buildPublicBettingMap(
    allSummaries.map(e => ({ eventId: e.eventId, sportKey: e.sportKey, homeTeam: e.homeTeam, awayTeam: e.awayTeam }))
  ), new Map());

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
          event.sportKey, event.eventId, event.homeTeam, event.awayTeam,
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
      atsSituations.set(event.eventId, getATSSituation(event.sportKey, event.homeTeam, event.awayTeam, spreadLine));
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
  const lineupMap = await safeRun(() => buildLineupMap(
    allSummaries.map(e => ({ eventId: e.eventId, sportKey: e.sportKey, homeTeam: e.homeTeam, awayTeam: e.awayTeam, gameTime: e.startTime }))
  ), new Map());

  const quota = getSessionQuota();
  safeSync(() => saveSnapshot('MIDDAY_FINAL_CARD', allSummaries, quota, 0, []), undefined);

  const learnedWeights = (() => { try { return loadSignalWeights(); } catch { return {}; } })();
  const topBets = getTopBets(allSummaries, 20, {
    windowHours: 24,
    priorSummaries: priorSummaries.length > 0 ? priorSummaries : undefined,
    sharpIntel, weatherMap, injuryMap, contextMap,
    situationalAngles, marketEfficiency, clvProjections, powerRatings,
    publicBetting, playerImpacts, steamMoves, atsSituations, lineOpeners,
    calibrationModel, lineupMap, learnedWeights,
  }); // 20 candidates -- sport diversity logic ensures all sports represented
  printTopTen(topBets, 24);
  // Save picks to log
  try {
    savePicksFromTopTen(topBets.map(b => ({
      sport: b.sport, sportKey: (b as any).sportKey ?? '',
      eventId: (b as any).eventId ?? '', matchup: b.matchup,
      startTime: b.startTime, betType: b.betType, side: b.side,
      bestPrice: b.bestUserPrice, bestLine: b.bestUserLine ?? null,
      bestBook: b.bestUserBook, grade: b.grade, score: b.score,
    })));
  } catch { }

  console.log(`  API requests used  : ${quota.requestsMade}`);
  console.log(`  Credits remaining  : ${quota.remainingRequests ?? 'unknown'}`);
  console.log(priorSummaries.length > 0 ? `  Movement vs        : morning scan\n` : `  Tip: Run morning scan first\n`);
}
