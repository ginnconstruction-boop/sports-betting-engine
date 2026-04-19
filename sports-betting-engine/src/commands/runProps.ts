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
// -- Decision layer --
import { mapAllToDecisionCandidates } from '../services/decisionTypes';
import { qualifyCandidates, printQualificationSummary } from '../services/qualificationEngine';
import { enrichWithProbability, printProbabilitySummary } from '../services/probabilityEngine';

function safeSync<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}
async function safeRun<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}
function hoursUntil(t: string) {
  return (new Date(t).getTime() - Date.now()) / 3600000;
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

    const topProps = (await scoreAllPropsWithIntelligence(
      aggregated, windowHours, contextMap, sportKey,
      {
        injuryMap,
        lineupMap,
        publicBetting,
        powerRatings,
        steamMoves,
        atsSituations,
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
    printTopProps(topProps);

    // -- [DECISION LAYER] Qualification pass --
    // Appended after existing prop output; does not affect scores,
    // ranking, saves, or alerts.
    safeSync(() => {
      const decisionCandidates = mapAllToDecisionCandidates(topProps);
      const qualResult = qualifyCandidates(decisionCandidates);
      printQualificationSummary(qualResult);
    }, undefined);

    // -- [DECISION LAYER] Probability enrichment --
    // Independent block — remaps from topProps directly.
    safeSync(() => {
      const decisionCandidates = mapAllToDecisionCandidates(topProps);
      const enriched = enrichWithProbability(decisionCandidates);
      printProbabilitySummary(enriched);
    }, undefined);

    // For MLB: run pitcher-specific analysis on top of standard scoring
    if (sportKey === 'baseball_mlb') {
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
      savePropPicks(topProps.map(p => ({
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


    console.log(`  API requests used  : ${quota.requestsMade}`);
    console.log(`  Credits remaining  : ${quota.remainingRequests ?? 'unknown'}\n`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  Props fetch failed: ${msg}\n`);
  }
}
