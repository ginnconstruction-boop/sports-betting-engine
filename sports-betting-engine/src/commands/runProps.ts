// ============================================================
// runProps.ts -- Standalone NBA props with FULL intelligence
// Builds every intelligence map that sport scan uses
// so props get the same reasoning regardless of how run
// ============================================================
import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports }       from '../api/oddsApiClient';
import { PROP_CONFIG, propsEnabled } from '../config/propConfig';
import { normalizeEvents }           from '../services/normalizeOdds';
import { aggregateAllEvents }        from '../services/aggregateMarkets';
import { getEventMarkets }           from '../api/oddsApiClient';
import { normalizePropsFromEvent }    from '../services/propNormalizer';
import { aggregateProps }            from '../services/propNormalizer';
import { scoreAllPropsWithIntelligence, printTopProps } from '../services/propScorer';
import { savePropLineSnapshot, detectPropLineMovement } from '../services/propLineTracker';
import { getESPNInjuries }           from '../services/espnData';
import { buildAllContextPackages }   from '../services/contextIntelligence';
import { buildLineupMap }            from '../services/lineupConfirmation';
import { buildPublicBettingMap }     from '../services/publicBetting';
import { getTeamPowerRating, compareToLine } from '../services/powerRatings';
import { detectSteamMoves }          from '../services/steamDetector';
import { getATSSituation }           from '../services/atsDatabase';
import { getSessionQuota }           from '../api/oddsApiClient';
import { getSportByKey }             from '../config/sports';
import { EventSummary }              from '../types/odds';
import { scorePitcherProp, printPitcherPropReport } from '../services/mlbPitcherIntelligence';
import { loadSignalWeights } from '../services/retroAnalysis';
import { savePropPicks } from '../services/closingLineTracker';
// -- Decision layer --
import { mapAllToDecisionCandidates } from '../services/decisionTypes';
import { qualifyCandidates, printQualificationSummary } from '../services/qualificationEngine';
import { enrichWithProbability, printProbabilitySummary } from '../services/probabilityEngine';
import { applyRisk, printRiskSummary } from '../services/riskEngine';
import { applySportIntelligence, printIntelSummary } from '../services/sportIntelligenceEngine';
import { labelCandidates, printLabelSummary } from '../services/labelEngine';
import { selectSlate, printFinalCard } from '../services/slateSelector';
import { validateDataIntegrity, printValidationSummary } from '../services/dataIntegrityValidator';
import { applySignalDiversity, printSignalDiversitySummary } from '../services/signalDiversityEngine';
import { applyOutcomeSignals, printOutcomeSummary, OutcomeContext } from '../services/outcomeSignalEngine';
import { applySignalWeighting, printWeightingSummary } from '../services/signalWeightingEngine';
import { buildNBAContextForSlate } from '../services/nbaContextProvider';
import { buildMLBContextForSlate } from '../services/mlbContextProvider';
import { buildNHLContextForSlate } from '../services/nhlContextProvider';
import { buildCalibrationReport, decorateCandidatesWithCalibration, getCalibrationProgressForSport } from '../services/calibrationEngine';

function safeSync<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}
async function safeRun<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}
function hoursUntil(t: string) {
  return (new Date(t).getTime() - Date.now()) / 3600000;
}

function isEnabledFlag(value: string | undefined): boolean {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

export async function runProps(options: { forceRun?: boolean; sportKey?: string } = {}) {
  if (!propsEnabled() && !options.forceRun) {
    console.log('\n  Player props are disabled. Set PROPS_ENABLED=true in .env\n');
    return;
  }

  const sportKey = options.sportKey ?? 'basketball_nba';
  const sportLabel2 = sportKey === 'baseball_mlb' ? 'MLB'
    : sportKey === 'icehockey_nhl' ? 'NHL'
    : sportKey === 'americanfootball_nfl' ? 'NFL' : 'NBA';

  // Select the correct market list for the chosen sport
  const markets: string[] =
    sportKey === 'americanfootball_nfl' ? PROP_CONFIG.NFL_PROP_MARKETS :
    sportKey === 'baseball_mlb'         ? PROP_CONFIG.MLB_PROP_MARKETS :
    sportKey === 'icehockey_nhl'        ? PROP_CONFIG.NHL_PROP_MARKETS :
    PROP_CONFIG.NBA_PROP_MARKETS;

  console.log(`\n  Fetching ${sportLabel2} player props...`);
  console.log('  NOTE: Props use more API credits than game lines.');

  try {
    const quota = getSessionQuota();
    const windowHours = parseInt(process.env.WINDOW_HOURS_OVERRIDE ?? '24');

    // -- Step 1: Fetch game summaries (needed for intelligence) -
    console.log(`  Pulling markets: ${markets.join(', ')}`);
    const { results: rawBySport } = await getOddsForAllSports([sportKey], ['h2h','spreads','totals'], false);
    const allSummaries: EventSummary[] = [];
    for (const [key, events] of rawBySport) {
      allSummaries.push(...aggregateAllEvents(normalizeEvents(events, key)));
    }

    const allToday = allSummaries.filter(e => hoursUntil(e.startTime) <= windowHours);
    const inProgress = allToday.filter(e => hoursUntil(e.startTime) <= 0);
    const upcoming = allToday.filter(e => hoursUntil(e.startTime) > 0);
    if (inProgress.length > 0) {
      console.log(`  [SKIP] ${inProgress.length} game(s) already in progress -- excluded from props.`);
    }
    if (upcoming.length === 0) {
      console.log(`\n  No upcoming ${sportLabel2} games found today.\n`);
      return;
    }
    console.log(`  Found ${upcoming.length} ${sportLabel2} game(s). Building full intelligence suite...`);

    // -- Step 2: Build ALL intelligence maps --------------------

    // Injuries
    const injuryMap = new Map<string, any[]>();
    await safeRun(async () => {
      const injuries = await getESPNInjuries(sportKey);
      for (const [team, list] of injuries) {
        for (const event of upcoming) {
          const homeLast = event.homeTeam.split(' ').pop() ?? '';
          const awayLast = event.awayTeam.split(' ').pop() ?? '';
          if (team.includes(homeLast) || team.includes(awayLast)) {
            const existing = injuryMap.get(event.eventId) ?? [];
            injuryMap.set(event.eventId, [...existing, ...list]);
          }
        }
      }
    }, undefined);

    // Context: form, rest, travel, news
    const contextMap = await safeRun(
      () => buildAllContextPackages(upcoming.map(e => ({
        eventId: e.eventId, matchup: e.matchup, sportKey: e.sportKey,
        homeTeam: e.homeTeam, awayTeam: e.awayTeam, gameTime: e.startTime,
      }))),
      new Map()
    );

    // Lineup confirmation
    const lineupMap = await safeRun(() => buildLineupMap(upcoming.map(e => ({ eventId: e.eventId, homeTeam: e.homeTeam, awayTeam: e.awayTeam, sport: sportKey, startTime: e.startTime }))), new Map());

    // Public betting
    const publicBetting = await safeRun(
      async () => {
        const map = new Map<string, any>();
        const pb = await buildPublicBettingMap(upcoming.map(e => ({
          eventId: e.eventId, homeTeam: e.homeTeam, awayTeam: e.awayTeam,
          sport: sportKey,
        })));
        return pb;
      },
      new Map()
    );

    // Power ratings
    const powerRatings = new Map<string, any>();
    await safeRun(async () => {
      for (const event of upcoming) {
        const spreadMarket = event.aggregatedMarkets['spreads'];
        const spreadLine = spreadMarket?.sides[0]?.consensusLine ?? null;
        const [home, away] = await Promise.all([
          getTeamPowerRating(event.homeTeam, sportKey),
          getTeamPowerRating(event.awayTeam, sportKey),
        ]);
        if (home && away) {
          powerRatings.set(event.eventId, {
            home, away,
            comparison: compareToLine(home, away, spreadLine, sportKey),
          });
        }
      }
    }, undefined);

    // Steam moves (from snapshots)
    const { results: freshRaw } = await getOddsForAllSports([sportKey], ['h2h','spreads'], false).catch(() => ({ results: new Map() }));
    const freshSummaries: EventSummary[] = [];
    for (const [k, ev] of freshRaw) freshSummaries.push(...aggregateAllEvents(normalizeEvents(ev, k)));
    const steamMoves = safeSync(() => detectSteamMoves(freshSummaries), []);

    // ATS situations
    const atsSituations = new Map<string, any>();
    safeSync(() => {
      for (const event of upcoming) {
        const spreadMarket = event.aggregatedMarkets['spreads'];
        const spreadLine = spreadMarket?.sides[0]?.consensusLine ?? null;
        atsSituations.set(event.eventId, getATSSituation(sportKey, event.homeTeam, event.awayTeam, spreadLine));
      }
    }, undefined);

    const learnedWeights = safeSync(() => loadSignalWeights(), {});
    console.log('  [OK] Intelligence suite built. Fetching prop lines...');

    // -- Step 3: Fetch prop lines (same method as sport scan) ----
    const allRawProps: any[] = [];
    const maxGames = upcoming.length; // scan all games -- best 5 selected after scoring
    console.log(`\n  Found ${upcoming.length} ${sportLabel2} game(s). Fetching props for each...`);
    console.log(`  This will use ~${maxGames * 2} API credits.`);

    const nbaContextSnapshot = sportKey === 'basketball_nba'
      ? await safeRun(
        () => buildNBAContextForSlate(
          upcoming.slice(0, maxGames).map(event => ({
            eventId: event.eventId,
            homeTeam: event.homeTeam,
            awayTeam: event.awayTeam,
          }))
        ),
        null
      )
      : null;
    const mlbContextSnapshot = sportKey === 'baseball_mlb'
      ? await safeRun(
        () => buildMLBContextForSlate(
          upcoming.slice(0, maxGames).map(event => ({
            eventId: event.eventId,
            homeTeam: event.homeTeam,
            awayTeam: event.awayTeam,
            gameTime: event.startTime,
          }))
        ),
        null
      )
      : null;
    let nhlContextSnapshot = null as Awaited<ReturnType<typeof buildNHLContextForSlate>> | null;

    if (sportKey === 'basketball_nba') {
      if (nbaContextSnapshot) {
        console.log(
          `  [NBA_CTX] players: ${nbaContextSnapshot.meta.players} | teams: ${nbaContextSnapshot.meta.teams} | usage: ${nbaContextSnapshot.meta.usage} | matchup: ${nbaContextSnapshot.meta.matchup} | fallback: ${nbaContextSnapshot.meta.fallback}`
        );
        if (nbaContextSnapshot.meta.fallback > 0) {
          console.warn('  [NBA_CTX] partial NBA context fallback active -- continuing with existing profile/matchup inputs');
        }
      } else {
        console.warn('  [NBA_CTX] unavailable -- continuing with existing fallback context');
      }
    }
    if (sportKey === 'baseball_mlb') {
      if (mlbContextSnapshot) {
        console.log(
          `  [MLB_CTX] players: ${mlbContextSnapshot.meta.players} | pitchers: ${mlbContextSnapshot.meta.pitchers} | ` +
          `teams: ${mlbContextSnapshot.meta.teams} | lineup: ${mlbContextSnapshot.meta.lineup} | ` +
          `matchup: ${mlbContextSnapshot.meta.matchup} | fallback: ${mlbContextSnapshot.meta.fallback}`
        );
        console.log(
          `  [MLB_LINEUPS] confirmed: ${mlbContextSnapshot.meta.lineupConfirmed} | ` +
          `partial: ${mlbContextSnapshot.meta.lineupPartial} | missing: ${mlbContextSnapshot.meta.lineupMissing} | ` +
          `pitcherHand: ${mlbContextSnapshot.meta.pitcherHandResolved}/${mlbContextSnapshot.meta.pitcherHandTotal}`
        );
        if (mlbContextSnapshot.meta.fallback > 0) {
          console.warn('  [MLB_CTX] partial MLB context fallback active -- continuing with real-data-only coverage gates');
        }
        const firstPitchHours = upcoming.length > 0
          ? Math.min(...upcoming.map(event => hoursUntil(event.startTime)))
          : null;
        const mostlyMissingLineups =
          mlbContextSnapshot.meta.lineupMissing > (mlbContextSnapshot.meta.lineupConfirmed + mlbContextSnapshot.meta.lineupPartial);
        if (
          firstPitchHours !== null &&
          firstPitchHours > 3 &&
          mostlyMissingLineups
        ) {
          console.warn('  [MLB_TIMING] Lineups not widely available yet -- rerun closer to first pitch for stronger context.');
        } else if (
          firstPitchHours !== null &&
          firstPitchHours <= 1.5 &&
          mlbContextSnapshot.meta.lineupMissing > 0
        ) {
          console.warn('  [MLB_TIMING] Warning: lineups still missing near first pitch -- using team-average fallback.');
        }
        if (isEnabledFlag(process.env.MLB_LINEUP_DEBUG)) {
          for (const detail of mlbContextSnapshot.meta.lineupMissingDetails) {
            console.warn(
              `  [MLB_LINEUP_MISSING] ${detail.teamName} vs ${detail.opponentTeam} -- reason: ${detail.reason}`
            );
          }
        }
      } else {
        console.warn('  [MLB_CTX] unavailable -- continuing without MLB context attachment');
      }
    }

    let finalSlateRanked: ReturnType<typeof selectSlate>['ranked'] = [];

    for (const event of upcoming.slice(0, maxGames)) {
      try {
        const { event: eventWithProps } = await getEventMarkets(
          sportKey, event.eventId,
          markets as any[], undefined, 'american'
        );
        if (eventWithProps) {
          const rows = normalizePropsFromEvent(
            eventWithProps, markets as any[], new Date().toISOString()
          );
          allRawProps.push(...rows);
          console.log(`  + ${event.awayTeam} vs ${event.homeTeam} -- ${rows.length} prop lines`);
        }
      } catch { /* individual game fetch failure is non-fatal */ }
    }

    if (allRawProps.length === 0) {
      console.log('\n  No prop data returned. Books may not be posting props yet.\n');
      return;
    }

    // -- Step 4: Score with FULL intelligence -------------------
    const aggregated = aggregateProps(allRawProps);
    console.log(`\n  Aggregated ${aggregated.length} player prop markets`);

    if (sportKey === 'icehockey_nhl') {
      nhlContextSnapshot = await safeRun(
        () => buildNHLContextForSlate(
          upcoming.slice(0, maxGames).map(event => ({
            eventId: event.eventId,
            homeTeam: event.homeTeam,
            awayTeam: event.awayTeam,
            gameTime: event.startTime,
          })),
          aggregated.map(prop => ({
            playerName: prop.playerName,
            marketKey: prop.marketKey,
            team: prop.team,
            homeTeam: prop.homeTeam,
            awayTeam: prop.awayTeam,
          }))
        ),
        null
      );
      if (nhlContextSnapshot) {
        console.log(
          `  [NHL_CTX] players: ${nhlContextSnapshot.meta.players} | goalies: ${nhlContextSnapshot.meta.goalies} | ` +
          `teams: ${nhlContextSnapshot.meta.teams} | recent: ${nhlContextSnapshot.meta.recent} | ` +
          `starter: ${nhlContextSnapshot.meta.starterConfirmed}/${nhlContextSnapshot.meta.starterLikely}/${nhlContextSnapshot.meta.starterMissing} | ` +
          `opponent: ${nhlContextSnapshot.meta.opponent} | matchup: ${nhlContextSnapshot.meta.matchup} | fallback: ${nhlContextSnapshot.meta.fallback}`
        );
        console.log(
          `  [NHL_STARTERS] source: boxscore ${nhlContextSnapshot.meta.starterBoxscore} | ` +
          `recent_usage ${nhlContextSnapshot.meta.starterRecentUsage} | unknown ${nhlContextSnapshot.meta.starterMissing}`
        );
        if (nhlContextSnapshot.meta.fallback > 0) {
          console.warn('  [NHL_CTX] partial NHL context fallback active -- continuing with real-data-only coverage gates');
        }
        if (nhlContextSnapshot.meta.starterConfirmed === 0 && nhlContextSnapshot.meta.starterLikely > 0) {
          console.warn('  [NHL_STARTERS] No official starter confirmations posted yet -- using conservative recent-usage inference.');
        } else if (nhlContextSnapshot.meta.starterConfirmed === 0 && nhlContextSnapshot.meta.starterLikely === 0) {
          console.warn('  [NHL_STARTERS] Starter goalie status is still unknown for this slate -- goalie-save context may stay limited.');
        }
      } else {
        console.warn('  [NHL_CTX] unavailable -- continuing without NHL context attachment');
      }
    }

    const topProps = (await scoreAllPropsWithIntelligence(
      aggregated, windowHours, contextMap, sportKey,
      {
        injuryMap,
        lineupMap,
        publicBetting,
        powerRatings,
        steamMoves,
        atsSituations,
        nbaContextSnapshot: nbaContextSnapshot ?? undefined,
        mlbContextSnapshot: mlbContextSnapshot ?? undefined,
        nhlContextSnapshot: nhlContextSnapshot ?? undefined,
      },
      learnedWeights
    )).slice(0, PROP_CONFIG.TOP_N);

    // -- Step 5: Print ------------------------------------------
    // Save prop line snapshot for movement tracking
    savePropLineSnapshot(topProps as any[]);
    // Detect and show significant line movement
    const propMovements = detectPropLineMovement(topProps as any[]);
    if (propMovements.size > 0) {
      console.log('\n  -- PROP LINE MOVEMENT (sharp signal) ------------------');
      for (const [, mv] of propMovements) {
        if (mv.isSignificant) {
          const icon = mv.sharpSignal ? '[!SHARP]' : '[MOVE]';
          console.log(`  ${icon} ${mv.playerName} ${mv.market.replace('player_','')} -- ${mv.detail}`);
        }
      }
    }
    printTopProps(topProps, sportKey);

    // -- [DECISION LAYER] Outcome context (Phase C) --
    // Built once and shared across all decision-layer blocks below.
    // lineupMap uses the buildLineupMap result already computed above.
    const outcomeContext: OutcomeContext = {
      injuryMap,
      lineupMap,
      contextMap,
      powerRatings,
      gameSummaries: allSummaries.map(e => ({
        eventId: e.eventId, homeTeam: e.homeTeam, awayTeam: e.awayTeam, matchup: e.matchup,
      })),
    };

    // -- [DECISION LAYER] Qualification pass --
    // Appended after existing prop output; does not affect scores,
    // ranking, saves, or alerts.
    safeSync(() => {
      const decisionCandidates = mapAllToDecisionCandidates(topProps);
      const todayEvents = allSummaries.map(e => ({ matchup: e.matchup, homeTeam: e.homeTeam, awayTeam: e.awayTeam }));
      const validResult = validateDataIntegrity(decisionCandidates, todayEvents);
      printValidationSummary(validResult);
      const qualResult  = qualifyCandidates(validResult.valid);
      printQualificationSummary(qualResult);
    }, undefined);

    // -- [DECISION LAYER] Probability enrichment --
    // Independent block — remaps from topProps directly.
    safeSync(() => {
      const decisionCandidates = mapAllToDecisionCandidates(topProps);
      const enriched = enrichWithProbability(decisionCandidates);
      printProbabilitySummary(enriched);
    }, undefined);

    // -- [DECISION LAYER] Risk engine --
    // Independent block — does not filter; only adds risk fields and prints summary.
    safeSync(() => {
      const decisionCandidates = mapAllToDecisionCandidates(topProps);
      const enriched           = enrichWithProbability(decisionCandidates);
      const withOutcome        = applyOutcomeSignals(enriched, outcomeContext);
      printOutcomeSummary(withOutcome);
      const withIntel          = applySportIntelligence(withOutcome);
      printIntelSummary(withIntel);
      const withDiversity      = applySignalDiversity(withIntel);
      printSignalDiversitySummary(withDiversity);
      const withWeighting      = applySignalWeighting(withDiversity);
      printWeightingSummary(withWeighting);
      const withRisk           = applyRisk(withWeighting);
      printRiskSummary(withRisk);
    }, undefined);

    // -- [DECISION LAYER] Label engine --
    // Independent block — does not affect existing output, saves, or alerts.
    // qualifyCandidates is called here (not just in the qualify block above)
    // so that qualificationPassed is correctly set before labelCandidates runs.
    safeSync(() => {
      const decisionCandidates = mapAllToDecisionCandidates(topProps);
      const todayEvents        = allSummaries.map(e => ({ matchup: e.matchup, homeTeam: e.homeTeam, awayTeam: e.awayTeam }));
      const validResult        = validateDataIntegrity(decisionCandidates, todayEvents);
      const qualResult         = qualifyCandidates(validResult.valid);
      const allCandidates      = [...qualResult.qualified, ...qualResult.rejected];
      const enriched           = enrichWithProbability(allCandidates);
      const withOutcome        = applyOutcomeSignals(enriched, outcomeContext);
      const withIntel          = applySportIntelligence(withOutcome);
      const withDiversity      = applySignalDiversity(withIntel);
      const withWeighting      = applySignalWeighting(withDiversity);
      const withRisk           = applyRisk(withWeighting);
      const labeled            = labelCandidates(withRisk);
      printLabelSummary(labeled);
    }, undefined);

    // -- [DECISION LAYER] Slate selector --
    // Independent block — identifies best candidates and the single Best Bet
    // of the Slate.  Does NOT affect existing output, saves, or alerts.
    safeSync(() => {
      const decisionCandidates = mapAllToDecisionCandidates(topProps);
      const todayEvents        = allSummaries.map(e => ({ matchup: e.matchup, homeTeam: e.homeTeam, awayTeam: e.awayTeam }));
      const validResult        = validateDataIntegrity(decisionCandidates, todayEvents);
      const qualResult         = qualifyCandidates(validResult.valid);
      const allCandidates      = [...qualResult.qualified, ...qualResult.rejected];
      const enriched           = enrichWithProbability(allCandidates);
      const withOutcome        = applyOutcomeSignals(enriched, outcomeContext);
      const withIntel          = applySportIntelligence(withOutcome);
      const withDiversity      = applySignalDiversity(withIntel);
      const withWeighting      = applySignalWeighting(withDiversity);
      const withRisk           = applyRisk(withWeighting);
      const labeled            = labelCandidates(withRisk);
      const calibrationReport  = (sportKey === 'basketball_nba' || sportKey === 'baseball_mlb' || sportKey === 'icehockey_nhl')
        ? buildCalibrationReport()
        : undefined;
      if (sportKey === 'icehockey_nhl' && calibrationReport) {
        const progress = getCalibrationProgressForSport(sportKey, calibrationReport);
        console.log(
          `  [NHL_CAL] official graded sample: ${progress.graded}/${progress.displayThreshold} | ` +
          `tracked official: ${progress.tracked}`
        );
      }
      const withCalibration    = (sportKey === 'basketball_nba' || sportKey === 'baseball_mlb' || sportKey === 'icehockey_nhl')
        ? decorateCandidatesWithCalibration(labeled, calibrationReport)
        : labeled;
      const slateResult        = selectSlate(withCalibration);
      finalSlateRanked         = slateResult.ranked;
      printFinalCard(slateResult);
    }, undefined);

    // For MLB: run pitcher-specific analysis on top of standard scoring
    if (sportKey === 'baseball_mlb' && isEnabledFlag(process.env.MLB_LEGACY_PITCHER_INTEL)) {
      try {
        const pitcherInputs = topProps
          .filter((p: any) => p.market?.toLowerCase().includes('strikeout') ||
                               p.market?.toLowerCase().includes('pitcher') ||
                               (p as any).statType?.includes('pitcher'))
          .map((p: any) => ({
            playerName:      p.playerName,
            team:            (p as any).team ?? '',
            market:          (p as any).statType ?? p.market?.toLowerCase().replace(' ','_') ?? '',
            side:            p.side?.toLowerCase() as 'over' | 'under',
            line:            p.line ?? 0,
            bestUserPrice:   p.bestUserPrice ?? -110,
            bestUserBook:    p.bestUserBook ?? '',
            altUserPrice:    p.altUserPrice ?? null,
            altUserBook:     p.altUserBook ?? '',
            matchup:         p.matchup,
            gameTime:        p.gameTime,
            homeTeam:        p.matchup?.split(' @ ')[1]?.trim() ?? '',
            awayTeam:        p.matchup?.split(' @ ')[0]?.trim() ?? '',
            isPitcherHome:   false, // default -- refine from lineup
            weatherTemp:     null,
            weatherWind:     null,
            weatherCondition: 'clear',
          }));

        if (pitcherInputs.length > 0) {
          const pitcherScored = pitcherInputs
            .map((p: any) => scorePitcherProp(p))
            .filter(Boolean);
          if (pitcherScored.length > 0) {
            console.log('\n  -- MLB PITCHER INTEL (enhanced scoring) ----------');
            printPitcherPropReport(pitcherScored as any[]);
          }
        }
      } catch { /* pitcher intel is supplemental */ }
    }
    // Save all props to tracking log
    try {
      const rankedByKey = new Map(
        finalSlateRanked.map(candidate => [
          `${candidate.playerName ?? ''}__${candidate.market ?? ''}__${candidate.side}__${candidate.line ?? 'null'}`,
          candidate,
        ])
      );
      const effectiveLabel = (candidate: typeof finalSlateRanked[number]) => {
        if (candidate.forcedTierCap === 'MONITOR') return 'MONITOR' as const;
        if (candidate.forcedTierCap === 'LEAN' && candidate.finalDecisionLabel === 'BET') return 'LEAN' as const;
        return candidate.finalDecisionLabel;
      };
      const savedProps = topProps.filter(p => {
        const candidate = rankedByKey.get(`${p.playerName}__${p.market}__${p.side}__${p.line ?? 'null'}`);
        if (!candidate) return false;
        const label = effectiveLabel(candidate);
        return label !== 'PASS';
      });
      savePropPicks(savedProps.map(p => ({
        playerName: p.playerName,
        market: p.market,
        propType: p.statType ?? p.market,
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
        projectedStat: p.projectedStat,
        projectionEdge: p.projectionEdge,
        modelProbability: p.probability,
        trueEdge: p.trueEdge,
        edgeConfidence: p.edgeConfidence,
        minutesConfidence: p.nbaMinutesConfidence,
        modelCompleteness: p.modelCompleteness,
        riskGrade: rankedByKey.get(`${p.playerName}__${p.market}__${p.side}__${p.line ?? 'null'}`)?.riskGrade,
        finalDecisionLabel: rankedByKey.get(`${p.playerName}__${p.market}__${p.side}__${p.line ?? 'null'}`)?.finalDecisionLabel,
        recommendedLabel: rankedByKey.get(`${p.playerName}__${p.market}__${p.side}__${p.line ?? 'null'}`)
          ? effectiveLabel(rankedByKey.get(`${p.playerName}__${p.market}__${p.side}__${p.line ?? 'null'}`)!)
          : undefined,
        savedAsRecommendation: (() => {
          const candidate = rankedByKey.get(`${p.playerName}__${p.market}__${p.side}__${p.line ?? 'null'}`);
          const label = candidate ? effectiveLabel(candidate) : undefined;
          return label === 'BET' || label === 'LEAN';
        })(),
        nonMarketSignalCount: rankedByKey.get(`${p.playerName}__${p.market}__${p.side}__${p.line ?? 'null'}`)?.strongNonMarketSignalCount,
        signalTypes: rankedByKey.get(`${p.playerName}__${p.market}__${p.side}__${p.line ?? 'null'}`)?.signals,
      })));
    } catch { }


    console.log(`  API requests used  : ${quota.requestsMade}`);
    console.log(`  Credits remaining  : ${quota.remainingRequests ?? 'unknown'}\n`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  Props fetch failed: ${msg}\n`);
  }
}
