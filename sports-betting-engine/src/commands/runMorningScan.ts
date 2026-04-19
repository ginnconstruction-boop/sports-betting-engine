// ============================================================
// src/commands/runMorningScan.ts
// Morning scan -- full elite model
// Every intelligence step is fully fault-tolerant
// A failed ESPN/weather/news call never blocks the Top 10
// ============================================================

import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getSessionQuota } from '../api/oddsApiClient';
import { normalizeEvents } from '../services/normalizeOdds';
import { aggregateAllEvents } from '../services/aggregateMarkets';
import { saveSnapshot, loadLatestSnapshot } from '../services/snapshotStore';
import { getTopBets, printTopTen } from '../services/topTenBets';
import { analyzeSharpIntelligence } from '../services/sharpIntelligence';
import { getESPNInjuries } from '../services/espnData';
import { getEnhancedInjuries } from '../services/directInjuryScraper';
import { getGameWeather, isOutdoorSport } from '../services/weatherData';
import { buildAllContextPackages } from '../services/contextIntelligence';
import { savePicksFromTopTen } from '../services/closingLineTracker';
import { checkSituationalAngles } from '../services/situationalAngles';
import { scoreAllMarketEfficiency } from '../services/marketEfficiency';
import { getAllCLVProjections } from '../services/clvProjection';
import { getGamePowerRatings, compareToLine } from '../services/powerRatings';
import { buildPublicBettingMap } from '../services/publicBetting';
import { buildAdvancedStatsMap } from '../services/advancedStats';
import { buildGameImpactSummary } from '../services/playerImpact';
import { detectSteamMoves } from '../services/steamDetector';
import { getATSSituation, updateATSFromPicks } from '../services/atsDatabase';
import { compareToOpeningLines, saveOpeningLines } from '../services/lineOpener';
import { buildCalibrationModel } from '../services/mlCalibration';
import { buildLineupMap } from '../services/lineupConfirmation';
import { buildHistoricalFromSnapshots } from '../services/historicalOdds';
import { autoGradePicks, buildRetroReport, printRetroReport, loadSignalWeights, buildCLVWeightReport, loadCLVWeights } from '../services/retroAnalysis';
import { getOfficialsReports } from '../services/officialsTendencies';
import { buildTravelFatigueMap } from '../services/travelFatigue';
import { buildMotivationMap } from '../services/motivationAngles';
import { buildH2HMap } from '../services/matchupHistory';
import { rebuildPNL } from '../services/winLossTracker';
import { generateDailyReport, printDailyReportPath } from '../services/dailyReport';
import { sendAlerts } from '../services/alertService';
import { getEnabledSports } from '../config/sports';
import { INITIAL_MARKETS, EventSummary } from '../types/odds';
// -- Decision layer --
import { mapAllToDecisionCandidates } from '../services/decisionTypes';
import { qualifyCandidates, printQualificationSummary } from '../services/qualificationEngine';
import { enrichWithProbability, printProbabilitySummary } from '../services/probabilityEngine';
import { applyRisk, printRiskSummary } from '../services/riskEngine';
import { labelCandidates, printLabelSummary } from '../services/labelEngine';
import { selectSlate, printSlateSummary } from '../services/slateSelector';

// Wrap a promise with a timeout so no single step can hang forever
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

async function safeRun<T>(label: string, fn: () => Promise<T>, fallback: T, timeoutMs = 30000): Promise<T> {
  try {
    return await withTimeout(fn(), timeoutMs, label);
  } catch (err: any) {
    // Intelligence failures are non-fatal -- just log and continue
    process.stderr.write(`  [skip] ${label}: ${err?.message ?? String(err)}\n`);
    return fallback;
  }
}

function safeRunSync<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err: any) {
    process.stderr.write(`  [skip] ${label}: ${err?.message ?? String(err)}\n`);
    return fallback;
  }
}

export async function runMorningScan(options: { forceRefresh?: boolean } = {}) {
  console.log('\n  Morning scan started — loading intelligence data...');
  const sportKeys = getEnabledSports().map(s => s.key);
  console.log(`  Sports in scope: ${sportKeys.join(', ')}`);

  // -- Step 0: Retrospective analysis ------------------------
  // Auto-grade yesterday's picks, identify what went wrong,
  // adjust signal weights for today's scoring
  console.log('\n  [0/22] Grading yesterday\'s picks from ESPN scores...');
  const newlyGraded = await safeRun('retro grading', () => autoGradePicks(), 0);
  if (newlyGraded > 0) {
    console.log(`  Auto-graded ${newlyGraded} pick(s) from yesterday.`);
    // Auto-write ESPN grades into P&L -- no manual entry needed
    safeRunSync('auto pnl update', () => rebuildPNL(), undefined);
    console.log('  P&L updated automatically from ESPN scores.');
  }
  const retroReport = safeRunSync('retro report', () => buildRetroReport(), null);
  const learnedWeights = safeRunSync('signal weights', () => loadSignalWeights(), {});
  if (retroReport && retroReport.picksAnalyzed >= 5) {
    printRetroReport(retroReport);
  }

  // MLB/NHL timing note -- morning scan runs at 7-8 AM but MLB/NHL lines
  // may not be fully posted yet. Best to run options 5 and 6 separately
  // at 11 AM (MLB) and noon (NHL) for full coverage.
  const _morningHour = new Date().getHours();
  if (_morningHour < 10) {
    console.log('  [NOTE] MLB and NHL lines may not be fully posted yet at this hour.');
    console.log('  Run option 5 (MLB) at 11 AM and option 6 (NHL) at noon for best coverage.\n');
  }

  // -- Step 1: Fetch odds (required -- this one can fail loudly) --
  console.log('  [1/22] Fetching odds from The Odds API...');
  const { results: rawBySport } = await getOddsForAllSports(
    sportKeys, INITIAL_MARKETS, options.forceRefresh ?? false
  );

  const allSummaries: EventSummary[] = [];
  for (const [sportKey, events] of rawBySport) {
    const rows = normalizeEvents(events, sportKey);
    allSummaries.push(...aggregateAllEvents(rows));
  }

  const priorSnapshot = loadLatestSnapshot('MORNING_SCAN');
  const priorSummaries = priorSnapshot?.eventSummaries ?? [];

  // -- Step 2: Save opening lines ------------------------------
  safeRunSync('opening lines', () => {
    saveOpeningLines(allSummaries.map(e => ({
      eventId: e.eventId, matchup: e.matchup, sportKey: e.sportKey,
      spread: e.aggregatedMarkets['spreads']?.sides[0]?.consensusLine ?? undefined,
      total: e.aggregatedMarkets['totals']?.sides[0]?.consensusLine ?? undefined,
      homeML: e.aggregatedMarkets['h2h']?.sides.find(s =>
        s.outcomeName.toLowerCase().includes(e.homeTeam.toLowerCase().split(' ').pop() ?? '')
      )?.consensusPrice ?? undefined,
    })));
  }, undefined);

  // -- Step 3: Sharp intelligence ------------------------------
  const sharpIntel = safeRunSync('sharp intel',
    () => analyzeSharpIntelligence(allSummaries, priorSummaries),
    new Map()
  );

  // -- Step 4: ESPN injuries -----------------------------------
  console.log('  [4/22] Fetching injury reports...');
  const injuryMap = new Map<string, any[]>();
  for (const sportKey of sportKeys) {
    await safeRun(`injuries ${sportKey}`, async () => {
      const espnInj = await getESPNInjuries(sportKey);
      const injuries = await getEnhancedInjuries(sportKey, espnInj);
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

  // -- Step 5: Weather -----------------------------------------
  const weatherMap = new Map<string, any>();
  for (const event of allSummaries) {
    if (isOutdoorSport(event.sportKey)) {
      await safeRun(`weather ${event.matchup}`, async () => {
        const weather = await getGameWeather(event.sportKey, '', event.homeTeam, event.startTime);
        if (weather) weatherMap.set(event.eventId, weather);
      }, undefined);
    }
  }

  console.log('\n  Pulling intelligence data...');

  // -- Step 6: Context intelligence ----------------------------
  const contextMap = await safeRun('context intelligence',
    () => buildAllContextPackages(allSummaries.map(e => ({
      eventId: e.eventId, matchup: e.matchup, sportKey: e.sportKey,
      homeTeam: e.homeTeam, awayTeam: e.awayTeam, gameTime: e.startTime,
    }))),
    new Map()
  );

  // -- Step 7: Situational angles ------------------------------
  const situationalAngles = new Map<string, any[]>();
  for (const event of allSummaries) {
    safeRunSync(`angles ${event.matchup}`, () => {
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

  // -- Step 8: Market efficiency -------------------------------
  const marketEfficiency = safeRunSync('market efficiency',
    () => scoreAllMarketEfficiency(allSummaries),
    new Map()
  );

  // -- Step 9: CLV projections ---------------------------------
  const hoursMap = new Map(allSummaries.map(e => [
    e.eventId,
    Math.max(0, (new Date(e.startTime).getTime() - Date.now()) / 3600000)
  ]));
  const clvProjections = safeRunSync('CLV projections',
    () => getAllCLVProjections(allSummaries, priorSummaries, hoursMap),
    new Map()
  );

  // -- Step 10: Power ratings ----------------------------------
  console.log('  [10/22] Computing power ratings...');
  const powerRatings = new Map<string, any>();
  for (let i = 0; i < allSummaries.length; i += 4) {
    await Promise.allSettled(allSummaries.slice(i, i + 4).map(async (event) => {
      await safeRun(`power ratings ${event.matchup}`, async () => {
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

  // -- Step 11: Public betting ---------------------------------
  const publicBetting = await safeRun('public betting',
    () => buildPublicBettingMap(allSummaries.map(e => ({
      eventId: e.eventId, sportKey: e.sportKey, homeTeam: e.homeTeam, awayTeam: e.awayTeam
    }))),
    new Map()
  );

  // -- Step 12: Advanced stats ---------------------------------
  await safeRun('advanced stats',
    () => buildAdvancedStatsMap(allSummaries.map(e => ({
      eventId: e.eventId, sportKey: e.sportKey, homeTeam: e.homeTeam, awayTeam: e.awayTeam
    }))),
    new Map()
  );

  // -- Step 13: Player impact ----------------------------------
  const playerImpacts = new Map<string, any>();
  for (const event of allSummaries) {
    await safeRun(`player impact ${event.matchup}`, async () => {
      const injuries = injuryMap.get(event.eventId) ?? [];
      const homeLast = event.homeTeam.split(' ').pop() ?? '';
      const awayLast = event.awayTeam.split(' ').pop() ?? '';
      const homeInj = injuries.filter((i: any) => (i.team ?? '').includes(homeLast));
      const awayInj = injuries.filter((i: any) => (i.team ?? '').includes(awayLast));
      if (homeInj.length > 0 || awayInj.length > 0) {
        const impact = await buildGameImpactSummary(
          event.sportKey, event.eventId, event.homeTeam, event.awayTeam,
          homeInj.map((i: any) => ({ playerName: i.playerName ?? '', position: i.position ?? '', status: i.status ?? '' })),
          awayInj.map((i: any) => ({ playerName: i.playerName ?? '', position: i.position ?? '', status: i.status ?? '' })),
        );
        playerImpacts.set(event.eventId, impact);
      }
    }, undefined);
  }

  // -- Step 14: Steam detection --------------------------------
  const steamMoves = safeRunSync('steam detection',
    () => detectSteamMoves(allSummaries),
    []
  );

  // -- Step 15: ATS database -----------------------------------
  safeRunSync('ATS update', () => updateATSFromPicks(), undefined);
  const atsSituations = new Map<string, any>();
  for (const event of allSummaries) {
    safeRunSync(`ATS ${event.matchup}`, () => {
      const spreadLine = event.aggregatedMarkets['spreads']?.sides[0]?.consensusLine ?? null;
      atsSituations.set(event.eventId, getATSSituation(event.sportKey, event.homeTeam, event.awayTeam, spreadLine));
    }, undefined);
  }

  // -- Step 16: Line openers -----------------------------------
  const lineOpeners = new Map<string, any>();
  for (const event of allSummaries) {
    safeRunSync(`opener ${event.matchup}`, () => {
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

  // -- Step 17: ML calibration ---------------------------------
  const calibrationModel = safeRunSync('ML calibration',
    () => buildCalibrationModel(),
    null
  );

  // -- Step 18: Lineup confirmation ----------------------------
  console.log('  [18/22] Confirming lineups...');
  const lineupMap = await safeRun('lineup confirmation',
    () => buildLineupMap(allSummaries.map(e => ({
      eventId: e.eventId, sportKey: e.sportKey,
      homeTeam: e.homeTeam, awayTeam: e.awayTeam, gameTime: e.startTime,
    }))),
    new Map(),
    60000  // 60s -- ESPN lineup calls can be slow
  );

  // -- Step 18b: Officials tendencies (MLB umpires / NBA refs) --
  console.log('  [18b] Fetching officials tendencies...');
  const officialsMap = new Map<string, any[]>();
  for (const sportKey of ['baseball_mlb', 'basketball_nba']) {
    if (sportKeys.includes(sportKey)) {
      const reports = await safeRun(`officials ${sportKey}`,
        () => getOfficialsReports(sportKey), new Map(), 20000);
      for (const [k, v] of reports) officialsMap.set(k, v);
    }
  }

  // -- Step 18c: Travel fatigue --
  console.log('  [18c] Computing travel fatigue...');
  const travelFatigueMap = await safeRun('travel fatigue',
    () => buildTravelFatigueMap(allSummaries.map(e => ({
      eventId: e.eventId, sportKey: e.sportKey, homeTeam: e.homeTeam, awayTeam: e.awayTeam
    }))),
    new Map(), 60000
  );

  // -- Step 18d: Motivation angles --
  console.log('  [18d] Analyzing motivation factors...');
  const motivationMap = await safeRun('motivation',
    () => buildMotivationMap(allSummaries.map(e => ({
      eventId: e.eventId, sportKey: e.sportKey,
      homeTeam: e.homeTeam, awayTeam: e.awayTeam, gameTime: e.startTime
    }))),
    new Map(), 30000
  );

  // -- Step 18e: H2H matchup history --
  console.log('  [18e] Loading H2H matchup history...');
  const h2hMap = await safeRun('h2h history',
    () => buildH2HMap(allSummaries.map(e => ({
      eventId: e.eventId, sportKey: e.sportKey, homeTeam: e.homeTeam, awayTeam: e.awayTeam
    }))),
    new Map(), 60000
  );

  // -- Step 18f: CLV weight report --
  const clvWeights = safeRunSync('clv weights', () => {
    buildCLVWeightReport();
    return loadCLVWeights();
  }, {} as Record<string, number>);

  // -- Step 19: Historical DB update ---------------------------
  safeRunSync('historical DB', () => buildHistoricalFromSnapshots(), 0);

  // -- Step 20: Save snapshot ----------------------------------
  const quota = getSessionQuota();
  safeRunSync('save snapshot', () => saveSnapshot('MORNING_SCAN', allSummaries, quota, 0, []), undefined);

  // -- Step 21: Top 10 -- full elite model ----------------------
  const topBets = getTopBets(allSummaries, 20, {
    windowHours: 24,
    priorSummaries: priorSummaries.length > 0 ? priorSummaries : undefined,
    sharpIntel, weatherMap, injuryMap, contextMap,
    situationalAngles, marketEfficiency, clvProjections, powerRatings,
    publicBetting, playerImpacts, steamMoves, atsSituations, lineOpeners,
    calibrationModel, lineupMap,
    learnedWeights: { ...learnedWeights, ...clvWeights }, // merge CLV weights into learned weights
    officialsMap,
    travelFatigueMap,
    motivationMap,
    h2hMap,
    clvWeights,
  }); // 20 candidates -- sport diversity logic ensures all sports represented
  printTopTen(topBets, 24);

  // -- [DECISION LAYER] Qualification pass --
  // Runs AFTER existing print so output is never disrupted.
  // Operates on the same topBets array; does not change scores,
  // ranking, saves, or alerts.
  safeRunSync('qualification pass', () => {
    const decisionCandidates = mapAllToDecisionCandidates(topBets);
    const qualResult = qualifyCandidates(decisionCandidates);
    printQualificationSummary(qualResult);
  }, undefined);

  // -- [DECISION LAYER] Probability enrichment --
  // Independently self-contained block — maps topBets fresh so it
  // can be removed without touching the qualification block above.
  safeRunSync('probability enrichment', () => {
    const decisionCandidates = mapAllToDecisionCandidates(topBets);
    const enriched = enrichWithProbability(decisionCandidates);
    printProbabilitySummary(enriched);
  }, undefined);

  // -- [DECISION LAYER] Risk engine --
  // Independent block — maps and enriches topBets from scratch.
  // Does NOT filter candidates; only adds risk fields and prints summary.
  safeRunSync('risk engine', () => {
    const decisionCandidates = mapAllToDecisionCandidates(topBets);
    const enriched           = enrichWithProbability(decisionCandidates);
    const withRisk           = applyRisk(enriched);
    printRiskSummary(withRisk);
  }, undefined);

  // -- [DECISION LAYER] Label engine --
  // Independent block — runs the full enrichment chain then labels.
  // Does NOT affect existing output, saves, or alerts.
  // qualifyCandidates is called here so qualificationPassed is set before
  // labelCandidates runs (the mapper initialises it to false by default).
  safeRunSync('label engine', () => {
    const decisionCandidates = mapAllToDecisionCandidates(topBets);
    const qualResult         = qualifyCandidates(decisionCandidates);
    const allCandidates      = [...qualResult.qualified, ...qualResult.rejected];
    const enriched           = enrichWithProbability(allCandidates);
    const withRisk           = applyRisk(enriched);
    const labeled            = labelCandidates(withRisk);
    printLabelSummary(labeled);
  }, undefined);

  // -- [DECISION LAYER] Slate selector --
  // Independent block — identifies best candidates and the single Best Bet
  // of the Slate.  Does NOT affect existing output, saves, or alerts.
  safeRunSync('slate selector', () => {
    const decisionCandidates = mapAllToDecisionCandidates(topBets);
    const qualResult         = qualifyCandidates(decisionCandidates);
    const allCandidates      = [...qualResult.qualified, ...qualResult.rejected];
    const enriched           = enrichWithProbability(allCandidates);
    const withRisk           = applyRisk(enriched);
    const labeled            = labelCandidates(withRisk);
    const slateResult        = selectSlate(labeled);
    printSlateSummary(slateResult);
  }, undefined);

  // -- Auto-generate daily HTML report (printable as PDF)
  safeRunSync('daily report', () => {
    const filepath = generateDailyReport(topBets, []);
    printDailyReportPath(filepath);
  }, undefined);

  // -- Send email/SMS alerts for A+ plays
  await safeRun('alerts', () => sendAlerts(
    topBets.map(b => ({
      sport: b.sport,
      matchup: b.matchup,
      betType: b.betType,
      side: b.side,
      bestUserBook: b.bestUserBook,
      bestUserPrice: b.bestUserPrice,
      grade: b.grade,
      score: b.score,
      tier: b.tier,
      hoursUntilGame: b.hoursUntilGame,
    })),
    'Morning Scan'
  ), undefined);

  // -- Step 22: Save picks for CLV tracking --------------------
  safeRunSync('save picks', () => savePicksFromTopTen(topBets), []);

  console.log(`  API requests used  : ${quota.requestsMade}`);
  console.log(`  Credits remaining  : ${quota.remainingRequests ?? 'unknown'}`);
  if (calibrationModel && !calibrationModel.isCalibrated) {
    console.log(`  ML calibration     : ${calibrationModel.recommendation}`);
  }
  console.log('');
}
