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
import { EXTENDED_MARKETS, EventSummary } from '../types/odds';
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
import { loadSignalWeights }               from '../services/retroAnalysis';
import { getSessionQuota }                  from '../api/oddsApiClient';
import { AltLine, generateAltLines, buildAltLineParlays, printAltLineParlayReport } from '../services/altLineParlayEngine';
import { saveParlayPicks } from '../services/closingLineTracker';
import { getBookmakerDisplayName, getUserBookKeys } from '../config/bookmakers';

async function safeRun<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}
function safeSync<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}
function hoursUntil(t: string) {
  return (new Date(t).getTime() - Date.now()) / 3600000;
}

function impliedProb(american: number): number {
  return american > 0
    ? 100 / (american + 100)
    : Math.abs(american) / (Math.abs(american) + 100);
}

function getAltParlayPropMarkets(sportKey: string): string[] {
  if (sportKey === 'americanfootball_nfl') {
    return [
      'player_pass_yds',
      'player_pass_tds',
      'player_pass_completions',
      'player_rush_yds',
      'player_rush_attempts',
      'player_reception_yds',
      'player_receptions',
    ];
  }
  return PROP_CONFIG.NBA_PROP_MARKETS;
}

function getBaseMarkets(sportKey: string) {
  return sportKey === 'americanfootball_nfl'
    ? EXTENDED_MARKETS
    : ['h2h', 'spreads', 'totals'] as const;
}

function buildTotalAltCandidates(event: EventSummary, sportLabel: string): any[] {
  const candidates: any[] = [];
  const totalMarket = event.aggregatedMarkets['totals'];

  if (totalMarket) {
    for (const side of totalMarket.sides) {
      const sideName = side.outcomeName.toLowerCase();
      if (!sideName.includes('over') && !sideName.includes('under')) continue;
      const line = side.bestLine ?? side.consensusLine;
      const price = side.bestPrice ?? side.consensusPrice;
      if (line === null || price === null) continue;

      candidates.push({
        playerName: `${event.awayTeam} @ ${event.homeTeam}`,
        team: '',
        market: 'totals',
        marketKey: 'totals',
        marketLabel: 'Game Total',
        line,
        side: sideName.includes('under') ? 'Under' : 'Over',
        bestUserPrice: price,
        bestUserBook: side.bestBook ?? 'consensus',
        score: Math.min(76, 58 + totalMarket.bookCount * 3 + Math.round(totalMarket.disagreementScore * 10)),
        sport: sportLabel,
        eventId: event.eventId,
        matchup: event.matchup,
        fullReasoning: [],
        prediction: { confidence: 'medium' },
      });
    }
  }

  const teamTotalMarket = event.aggregatedMarkets['team_totals'];
  if (teamTotalMarket) {
    for (const side of teamTotalMarket.sides) {
      const match = side.outcomeName.match(/^(.*)\s+(Over|Under)$/i);
      if (!match) continue;
      const teamLabel = match[1].trim();
      const betSide = match[2];
      const line = side.bestLine ?? side.consensusLine;
      const price = side.bestPrice ?? side.consensusPrice;
      if (line === null || price === null) continue;

      candidates.push({
        playerName: `${teamLabel} Team Total`,
        team: teamLabel,
        market: 'team_totals',
        marketKey: 'team_totals',
        marketLabel: 'Team Total',
        line,
        side: betSide,
        bestUserPrice: price,
        bestUserBook: side.bestBook ?? 'consensus',
        score: Math.min(78, 60 + teamTotalMarket.bookCount * 3 + Math.round(teamTotalMarket.disagreementScore * 12)),
        sport: sportLabel,
        eventId: event.eventId,
        matchup: event.matchup,
        fullReasoning: [],
        prediction: { confidence: 'medium' },
      });
    }
  }

  return candidates;
}

async function buildAnytimeTdAltLegs(
  sportKey: string,
  upcoming: EventSummary[],
  playerTeamMap: Map<string, string>
): Promise<AltLine[]> {
  if (sportKey !== 'americanfootball_nfl') return [];

  const userBookKeys = getUserBookKeys();
  const legs: AltLine[] = [];

  for (const event of upcoming) {
    try {
      const { event: ev } = await getEventMarkets(
        sportKey, event.eventId, ['player_anytime_td'] as any[], undefined, 'american'
      );
      if (!ev) continue;

      const playerPrices = new Map<string, { book: string; price: number }[]>();

      for (const bk of (ev as any).bookmakers ?? []) {
        for (const mkt of (bk.markets ?? [])) {
          if (mkt.key !== 'player_anytime_td') continue;
          for (const outcome of (mkt.outcomes ?? [])) {
            const name = outcome.name ?? '';
            const price = outcome.price ?? 0;
            if (!name || typeof price !== 'number') continue;
            const existing = playerPrices.get(name) ?? [];
            existing.push({ book: bk.key, price });
            playerPrices.set(name, existing);
          }
        }
      }

      for (const [playerName, offers] of playerPrices) {
        if (offers.length < 2) continue;

        const userOffers = offers
          .filter(o => userBookKeys.includes(o.book))
          .sort((a, b) => b.price - a.price);
        if (userOffers.length === 0) continue;

        const best = userOffers[0];
        const alt = userOffers[1] ?? offers.sort((a, b) => b.price - a.price)[1];
        const bestDisplay = getBookmakerDisplayName(best.book);
        const bestImplied = impliedProb(best.price);
        const altImplied = alt ? impliedProb(alt.price) : bestImplied;
        const bookGapBoost = Math.max(0, bestImplied - altImplied) * 0.5;
        const estimatedHitRate = Math.round(Math.min(0.78, bestImplied + bookGapBoost) * 1000) / 10;

        if (estimatedHitRate < 40) continue;

        legs.push({
          playerName,
          team: playerTeamMap.get(playerName.toLowerCase()) ?? `unknown:${playerName.toLowerCase()}`,
          market: 'player_anytime_td',
          marketLabel: 'Anytime TD',
          standardLine: 0.5,
          altLine: 0.5,
          lineReduction: 0,
          side: 'over',
          standardPrice: best.price,
          altPrice: best.price,
          estimatedHitRate,
          modelScore: Math.min(75, 54 + Math.round((bestImplied + bookGapBoost) * 30)),
          hasBlowoutRisk: false,
          isB2B: false,
          predictedValue: null,
          confidence: 'medium',
          sport: 'NFL',
          eventId: event.eventId,
          matchup: event.matchup,
          isBinary: true,
        });
      }
    } catch { /* market not available */ }
  }

  return legs
    .sort((a, b) => (b.modelScore - a.modelScore) || (b.estimatedHitRate - a.estimatedHitRate))
    .slice(0, 6);
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
      [sportKey], getBaseMarkets(sportKey) as any[], false
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

    const lineupMap = await safeRun(() => buildLineupMap(upcoming.map(e => ({
      eventId: e.eventId,
      sportKey,
      homeTeam: e.homeTeam,
      awayTeam: e.awayTeam,
      gameTime: e.startTime,
    }))), new Map());
    const publicBetting = await safeRun(() => buildPublicBettingMap(upcoming.map(e => ({
      eventId: e.eventId, homeTeam: e.homeTeam, awayTeam: e.awayTeam, sportKey,
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
    const markets = getAltParlayPropMarkets(sportKey);
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

    const learnedWeights = (() => { try { return loadSignalWeights(); } catch { return {}; } })();
    const scored = await scoreAllPropsWithIntelligence(
      aggregated, 24, contextMap, sportKey,
      { injuryMap, lineupMap, publicBetting, powerRatings, steamMoves, atsSituations },
      learnedWeights
    );

    if (scored.length === 0) {
      console.log('\n  No qualifying props found. Try again closer to tip-off.\n');
      return;
    }

    // -- Step 5: Build alt line parlays -------------------------
    console.log(`  Analyzing ${scored.length} scored props for alt line opportunities...\n`);

    const playerTeamMap = new Map<string, string>();
    for (const prop of scored as any[]) {
      const playerName = String(prop.playerName ?? '').toLowerCase().trim();
      const team = String(prop.team ?? '').trim();
      if (playerName && team && !playerTeamMap.has(playerName)) {
        playerTeamMap.set(playerName, team);
      }
    }

    const totalCandidates = sportKey === 'americanfootball_nfl'
      ? upcoming.flatMap(event => buildTotalAltCandidates(event, sportLabel))
      : [];
    const anytimeTdLegs = await buildAnytimeTdAltLegs(sportKey, upcoming, playerTeamMap);

    const altLines = [
      ...generateAltLines([...(scored as any[]), ...totalCandidates], 55),
      ...anytimeTdLegs,
    ].sort((a, b) => (b.modelScore - a.modelScore) || (b.estimatedHitRate - a.estimatedHitRate));
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
          side: l.market === 'player_anytime_td' ? 'YES' : l.side,
          altLine: l.market === 'player_anytime_td' ? undefined : l.altLine,
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
