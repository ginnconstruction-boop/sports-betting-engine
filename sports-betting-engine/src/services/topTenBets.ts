// ============================================================
// src/services/topTenBets.ts
// Full-picture Top 10 scorer -- all 10 improvements applied
//
// #1  Min 2 signals required
// #2  Recent movement weighted heavier
// #3  Price range filter (-250 to +200)
// #4  Tiered output: BET / LEAN / MONITOR
// #5  FanDuel vs BetMGM gap alert
// #6  Min 1 hour until game
// #7  Book depth confidence weighting
// #8  Auto-save to dated text file
// #9  Fade the public flag
// #10 Weekly summary hook (data collected here)
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { EventSummary, MarketKey } from '../types/odds';
import { getBookmakerDisplayName, getUserBookKeys } from '../config/bookmakers';
import { TriggeredAngle } from './situationalAngles';
import { PublicBettingData } from './publicBetting';
import { GameImpactSummary } from './playerImpact';
import { SteamMove } from './steamDetector';
import { ATSSituation } from './atsDatabase';
import { LineOpenerComparison } from './lineOpener';
import { CalibrationModel, applyCalibration } from './mlCalibration';
import { applyLearnedWeights } from './retroAnalysis';
import { ConfirmedLineup, LineupNews } from './lineupConfirmation';
import { MarketEfficiencyScore } from './marketEfficiency';
import { CLVProjection } from './clvProjection';
import { BET_FILTERS } from '../config/betFilters';
import { calculateKelly, scoreToProbability } from './propEdgeFactors';
import { MarketIntelligence } from './sharpIntelligence';
import { GameWeather } from './weatherData';
import { ESPNInjury } from './espnData';
import { OfficialsReport } from './officialsTendencies';
import { TravelFatigueReport } from './travelFatigue';
import { PinnacleEdge, extractPinnacleEdges } from './pinnacleBenchmark';
import { MotivationReport } from './motivationAngles';
import { H2HReport } from './matchupHistory';

// ------------------------------------
// Types
// ------------------------------------

export interface ScoredBet {
  rank: number;
  tier: 'BET' | 'LEAN' | 'MONITOR';
  grade: string;
  score: number;
  priceScore: number;
  lineScore: number;
  sharpScore: number;
  signalCount: number;
  sport: string;
  matchup: string;
  startTime: string;
  hoursUntilGame: number;
  betType: string;
  side: string;
  bestUserBook: string;
  bestUserPrice: number;
  bestUserLine: number | null;
  altUserBook: string;
  altUserPrice: number | null;
  altUserLine: number | null;
  userBookGap: number | null;       // #5 gap between FD and MGM
  userBookGapAlert: boolean;
  consensusPrice: number;
  consensusLine: number | null;
  priceDiff: number;
  marketBestPrice: number;
  marketBestBook: string;
  lineDiff: number | null;
  bookCount: number;
  bookConfidence: 'high' | 'medium' | 'low';  // #7
  sharpSignal: string;
  recommendation: string;
  fadePublicFlag: boolean;          // #9
  fadePublicDetail: string;
  weatherAlert: string;
  injuryFlags: string[];
  lineMovementAlert: boolean;
  lineMovementDetail: string;
  priceMovementAlert: boolean;
  priceMovementDetail: string;
  isRecentMovement: boolean;        // #2
  fullReasoning: string[];
  kellyPct: number;                 // quarter-Kelly % of bankroll
}

export interface TopTenOptions {
  windowHours?: number;
  singleSport?: boolean;  // true for options 4-10 -- uses higher per-game caps
  priorSummaries?: EventSummary[];
  sharpIntel?: Map<string, MarketIntelligence[]>;
  weatherMap?: Map<string, GameWeather>;
  injuryMap?: Map<string, ESPNInjury[]>;
  contextMap?: Map<string, any>;
  situationalAngles?: Map<string, TriggeredAngle[]>;
  marketEfficiency?: Map<string, Map<string, MarketEfficiencyScore>>;
  clvProjections?: Map<string, CLVProjection[]>;
  powerRatings?: Map<string, any>;
  publicBetting?: Map<string, PublicBettingData>;
  playerImpacts?: Map<string, GameImpactSummary>;
  steamMoves?: SteamMove[];
  atsSituations?: Map<string, ATSSituation>;
  lineOpeners?: Map<string, LineOpenerComparison>;
  calibrationModel?: CalibrationModel | null;
  lineupMap?: Map<string, any>;
  learnedWeights?: Record<string, number>;  // from retroAnalysis
  officialsMap?: Map<string, OfficialsReport[]>;
  travelFatigueMap?: Map<string, TravelFatigueReport>;
  motivationMap?: Map<string, MotivationReport>;
  h2hMap?: Map<string, H2HReport>;
  clvWeights?: Record<string, number>;
}

// ------------------------------------
// Helpers
// ------------------------------------

function fmtPrice(p: number): string { return p > 0 ? `+${p}` : `${p}`; }
function fmtLine(l: number | null | undefined): string {
  if (l === null || l === undefined) return '';
  return l > 0 ? ` (+${l})` : ` (${l})`;
}
function scoreToGrade(score: number): string {
  if (score >= 88) return 'A+';
  if (score >= 78) return 'A';
  if (score >= 68) return 'B+';
  if (score >= 55) return 'B';
  if (score >= 42) return 'C+';
  if (score >= 30) return 'C';
  return 'D';
}
function getTier(score: number, signalCount: number, sportKey?: string): 'BET' | 'LEAN' | 'MONITOR' {
  // Sport-specific thresholds -- MLB/NHL score lower due to thinner markets
  const isMLB = sportKey?.includes('baseball') || sportKey?.includes('mlb');
  const isNHL = sportKey?.includes('hockey') || sportKey?.includes('nhl');

  const betMin     = isMLB ? ((BET_FILTERS as any).SCORE_BET_MIN_MLB ?? 72)
                   : isNHL ? ((BET_FILTERS as any).SCORE_BET_MIN_NHL ?? 72)
                   : BET_FILTERS.SCORE_BET_MIN;
  const leanMin    = isMLB ? ((BET_FILTERS as any).SCORE_LEAN_MIN_MLB ?? 65)
                   : isNHL ? ((BET_FILTERS as any).SCORE_LEAN_MIN_NHL ?? 65)
                   : BET_FILTERS.SCORE_LEAN_MIN;
  const monitorMin = isMLB ? ((BET_FILTERS as any).SCORE_MONITOR_MIN_MLB ?? 60)
                   : isNHL ? ((BET_FILTERS as any).SCORE_MONITOR_MIN_NHL ?? 60)
                   : BET_FILTERS.SCORE_MONITOR_MIN;

  if (score >= betMin     && signalCount >= 3) return 'BET';
  if (score >= leanMin    && signalCount >= 2) return 'LEAN';
  if (score >= monitorMin)                     return 'MONITOR';
  return 'MONITOR';
}
function marketLabel(key: MarketKey): string {
  if (key === 'h2h') return 'Moneyline';
  if (key === 'spreads') return 'Spread';
  if (key === 'totals') return 'Total';
  return key.toUpperCase().replace(/_/g, ' ');
}
function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3600000;
}
function fmtHours(h: number): string {
  if (h < 1) return 'Starting soon';
  if (h < 2) return `~1 hr`;
  return `~${Math.round(h)} hrs`;
}
function bookConfidence(count: number): 'high' | 'medium' | 'low' {
  if (count >= 6) return 'high';
  if (count >= BET_FILTERS.MIN_BOOKS_FOR_CONSENSUS) return 'medium';
  return 'low';
}

// #2 -- is this movement recent (last 2 hours)?
function isRecentMovement(lastUpdate: string): boolean {
  if (!lastUpdate) return false;
  const ageHours = (Date.now() - new Date(lastUpdate).getTime()) / 3600000;
  return ageHours <= BET_FILTERS.RECENT_MOVEMENT_HOURS;
}

// ------------------------------------
// Movement detection
// ------------------------------------

function detectMovement(
  eventId: string, marketKey: MarketKey, sideName: string,
  currentLine: number | null, currentPrice: number | null,
  priorSummaries?: EventSummary[]
): { lineAlert: boolean; lineDetail: string; priceAlert: boolean; priceDetail: string } {
  if (!priorSummaries?.length) return { lineAlert: false, lineDetail: '', priceAlert: false, priceDetail: '' };
  const prior = priorSummaries.find(e => e.eventId === eventId);
  if (!prior) return { lineAlert: false, lineDetail: '', priceAlert: false, priceDetail: '' };
  const pm = prior.aggregatedMarkets[marketKey];
  if (!pm) return { lineAlert: false, lineDetail: '', priceAlert: false, priceDetail: '' };
  const ps = pm.sides.find(s => s.outcomeName === sideName);
  if (!ps) return { lineAlert: false, lineDetail: '', priceAlert: false, priceDetail: '' };

  let lineAlert = false, lineDetail = '', priceAlert = false, priceDetail = '';
  if (currentLine !== null && ps.consensusLine !== null && Math.abs(currentLine - ps.consensusLine) >= 0.5) {
    const diff = currentLine - ps.consensusLine;
    lineAlert = true;
    lineDetail = `Line moved ${diff > 0 ? '?' : '?'} ${Math.abs(diff)} pts: ${ps.consensusLine} -> ${currentLine}`;
  }
  if (currentPrice !== null && ps.consensusPrice !== null && Math.abs(currentPrice - ps.consensusPrice) >= 5) {
    const diff = currentPrice - ps.consensusPrice;
    priceAlert = true;
    priceDetail = `Price moved ${diff > 0 ? '?' : '?'} ${Math.abs(diff)} pts: ${fmtPrice(ps.consensusPrice)} -> ${fmtPrice(currentPrice)}`;
  }
  return { lineAlert, lineDetail, priceAlert, priceDetail };
}

// ------------------------------------
// #9 -- Fade the public detection
// ------------------------------------

function detectFadePublic(
  event: EventSummary,
  marketKey: MarketKey,
  sideName: string,
  priorSummaries?: EventSummary[]
): { flag: boolean; detail: string } {
  if (!priorSummaries?.length) return { flag: false, detail: '' };
  const prior = priorSummaries.find(e => e.eventId === event.eventId);
  if (!prior) return { flag: false, detail: '' };

  const currentMarket = event.aggregatedMarkets[marketKey];
  const priorMarket = prior.aggregatedMarkets[marketKey];
  if (!currentMarket || !priorMarket) return { flag: false, detail: '' };

  // Find the favorite side (most negative consensus price)
  const favSide = currentMarket.sides.reduce((a, b) =>
    (a.consensusPrice ?? 0) < (b.consensusPrice ?? 0) ? a : b
  );
  const dogSide = currentMarket.sides.find(s => s.outcomeName !== favSide.outcomeName);
  if (!dogSide) return { flag: false, detail: '' };

  // If we're looking at the dog side AND the line moved toward the favorite
  if (sideName !== dogSide.outcomeName) return { flag: false, detail: '' };

  const priorFav = priorMarket.sides.find(s => s.outcomeName === favSide.outcomeName);
  if (!priorFav?.consensusLine || !favSide.consensusLine) return { flag: false, detail: '' };

  const lineDiff = Math.abs(favSide.consensusLine) - Math.abs(priorFav.consensusLine);
  if (lineDiff >= BET_FILTERS.FADE_PUBLIC_LINE_THRESHOLD) {
    return {
      flag: true,
      detail: `Public betting favorite ${favSide.outcomeName} -- line moved ${lineDiff} pts toward them. Fading with ${dogSide.outcomeName} is contrarian value`,
    };
  }
  return { flag: false, detail: '' };
}

// ------------------------------------
// Count signals for a bet
// ------------------------------------

function countSignals(
  priceDiff: number,
  lineDiff: number | null,
  lineAlert: boolean,
  priceAlert: boolean,
  sharpStrength: number,
  fadeFlag: boolean
): number {
  let count = 0;
  if (priceDiff >= 5) count++;              // price edge
  if (lineDiff !== null && lineDiff >= 0.5) count++; // line discrepancy
  if (lineAlert || priceAlert) count++;     // movement since last scan
  if (sharpStrength >= 20) count++;         // sharp signal
  if (fadeFlag) count++;                    // fade the public
  return count;
}

// ------------------------------------
// Score a bet
// ------------------------------------

function scoreBet(
  priceDiff: number, lineDiff: number | null, bookCount: number,
  sharpStrength: number, hasMovement: boolean, isRecent: boolean,
  weatherImpact: string, hasKeyInjuries: boolean
): { total: number; priceScore: number; lineScore: number; sharpScore: number } {
  const priceScore = priceDiff > 0 ? Math.min((priceDiff / 25) * 40, 40) : 0;
  const lineScore = lineDiff != null && lineDiff > 0 ? Math.min((lineDiff / 2.0) * 25, 25) : 0;

  // #2 recent movement weighted heavier
  const baseSharp = Math.min((sharpStrength / 100) * 30, 30);
  const sharpScore = hasMovement && isRecent
    ? Math.min(baseSharp + BET_FILTERS.RECENT_MOVEMENT_BONUS, 40)
    : baseSharp;

  // #7 book depth confidence
  const coverageBonus = bookCount >= 6 ? 5 : bookCount >= 3 ? 3 : 1;

  const weatherPenalty = weatherImpact === 'high' ? -10 : weatherImpact === 'medium' ? -5 : 0;
  const injuryPenalty = hasKeyInjuries ? -5 : 0;

  const total = Math.round(Math.max(0, Math.min(
    priceScore + lineScore + sharpScore + coverageBonus + weatherPenalty + injuryPenalty,
    100
  )));
  return { total, priceScore: Math.round(priceScore), lineScore: Math.round(lineScore), sharpScore: Math.round(sharpScore) };
}

// ------------------------------------
// Build reasoning
// ------------------------------------

function buildReasoning(bet: {
  priceDiff: number; lineDiff: number | null; bestUserBook: string;
  altUserBook: string; altUserPrice: number | null;
  userBookGap: number | null; userBookGapAlert: boolean;
  bookCount: number; sharpDetail: string; weatherAlert: string;
  injuryFlags: string[]; lineMovementDetail: string; priceMovementDetail: string;
  marketBestBook: string; marketBestPrice: number; bestUserPrice: number;
  fadePublicFlag: boolean; fadePublicDetail: string; isRecentMovement: boolean;
}): string[] {
  const r: string[] = [];

  if (bet.priceDiff >= 15)
    r.push(`[$] ${bet.bestUserBook} is ${fmtPrice(bet.priceDiff)} better than market -- strong price value`);
  else if (bet.priceDiff >= 7)
    r.push(`[$] ${bet.bestUserBook} is ${fmtPrice(bet.priceDiff)} better than consensus -- solid value`);
  else if (bet.priceDiff >= 3)
    r.push(`[$] Slight edge: ${fmtPrice(bet.priceDiff)} better at ${bet.bestUserBook}`);

  // #5 -- gap alert between user's two books
  if (bet.userBookGapAlert && bet.altUserBook && bet.altUserPrice !== null) {
    r.push(`? LINE SHOP: ${bet.bestUserBook} vs ${bet.altUserBook} gap is ${bet.userBookGap} pts -- always use ${bet.bestUserBook}`);
  }

  // Show market best if inaccessible book is better
  if (bet.marketBestPrice > bet.bestUserPrice) {
    const gap = bet.marketBestPrice - bet.bestUserPrice;
    r.push(`? Market best: ${fmtPrice(bet.marketBestPrice)} @ ${bet.marketBestBook} (not your book) -- gap: ${fmtPrice(gap)}`);
  }

  if (bet.lineDiff !== null && bet.lineDiff >= 1.0)
    r.push(`? Books split ${bet.lineDiff} pts on the line -- exploitable`);
  else if (bet.lineDiff !== null && bet.lineDiff >= 0.5)
    r.push(`? Half-point line gap exists across books`);

  if (bet.sharpDetail && bet.sharpDetail !== 'No sharp signals detected')
    r.push(`[TGT] ${bet.sharpDetail}`);

  if (bet.lineMovementDetail) {
    const tag = bet.isRecentMovement ? ' [RECENT -- last 2hrs]' : '';
    r.push(`[^] ${bet.lineMovementDetail}${tag}`);
  }
  if (bet.priceMovementDetail) r.push(`? ${bet.priceMovementDetail}`);

  // #9 fade the public
  if (bet.fadePublicFlag) r.push(`? FADE THE PUBLIC: ${bet.fadePublicDetail}`);

  if (bet.weatherAlert) r.push(`?? ${bet.weatherAlert}`);
  for (const inj of bet.injuryFlags.slice(0, 2)) r.push(`? ${inj}`);
  if (bet.bookCount <= 2) r.push(`[!]?  Only ${bet.bookCount} book(s) -- limited market, check for news`);

  return r;
}

// ------------------------------------
// Main scorer
// ------------------------------------

export function scoreAllBets(
  summaries: EventSummary[],
  options: TopTenOptions = {}
): ScoredBet[] {
  const windowHours = options.windowHours ?? BET_FILTERS.WINDOW_HOURS_DEFAULT;
  const userBookKeys = getUserBookKeys();
  const gameEntryCount = new Map<string, number>();
  const candidates: ScoredBet[] = [];

  // Extract Pinnacle edges upfront (sync, no network call)
  const pinnacleEdgeMap = extractPinnacleEdges(summaries, userBookKeys);

  for (const event of summaries) {
    const hours = hoursUntil(event.startTime);

    // #6 -- filter games too close or too far
    if (hours < BET_FILTERS.MIN_HOURS_UNTIL_GAME) continue;
    if (hours > windowHours) continue;

    const sharpIntelList = options.sharpIntel?.get(event.eventId) ?? [];
    const weather = options.weatherMap?.get(event.eventId);

    // Lineup data -- event level (shared across all markets for this event)
    const lineupData = options.lineupMap?.get(event.eventId);
    const homeLineup = lineupData?.home ?? null;
    const awayLineup = lineupData?.away ?? null;
    const breakingNews = lineupData?.breakingNews ?? [];
    const weatherAlert = weather?.weatherImpact !== 'none' && weather
      ? `${weather.condition} -- ${weather.weatherImpact} impact` : '';
    const injuries = options.injuryMap?.get(event.eventId) ?? [];
    const keyInjuries = injuries.filter(i =>
      ['Out', 'Doubtful'].includes(i.status) && ['QB', 'SP', 'C', 'PG'].includes(i.position)
    );
    const injuryFlags = keyInjuries.map(i => `${i.playerName} (${i.position}) ${i.status} -- ${i.team}`);

    for (const [mKey, market] of Object.entries(event.aggregatedMarkets)) {
      const marketKey = mKey as MarketKey;
      const marketIntel = sharpIntelList.find(m => m.marketKey === marketKey);
      const sharpStrength = marketIntel?.recommendationStrength ?? 0;
      const sharpReason = marketIntel?.recommendationReason ?? '';

      // #7 -- skip markets with insufficient book depth
      if (market.bookCount < BET_FILTERS.MIN_BOOKS_FOR_CONSENSUS) continue;

      // -- Event+market level lookups (once per market, shared across sides) --
      const contextPkg = options.contextMap?.get(event.eventId);
      const contextSignals = contextPkg?.contextSignals ?? [];
      const situationalList = options.situationalAngles?.get(event.eventId) ?? [];
      const angleBonus = situationalList.length > 0
        ? Math.min(situationalList.reduce((s: number, a: any) => s + a.scoreBonus, 0), 20) : 0;
      const efficiencyData = options.marketEfficiency?.get(event.eventId)?.get(marketKey);
      const efficiencyMultiplier = efficiencyData?.edgeMultiplier ?? 1.0;
      const clvProjList = options.clvProjections?.get(event.eventId) ?? [];
      const pubBet = options.publicBetting?.get(event.eventId);
      const isConfirmedRLM = pubBet?.reverseLineMovement === true;
      const pubSharpSide = pubBet?.sharpSide ?? 'none';
      const pubPublicSide = pubBet?.publicSide ?? 'none';
      const rlmBonus = isConfirmedRLM ? 15 : 0;
      const playerImpact = options.playerImpacts?.get(event.eventId);
      const playerImpactBonus = playerImpact?.significantImpact ? 8 : 0;
      const atsSituation = options.atsSituations?.get(event.eventId);
      const atsBonus = Math.min(atsSituation?.atsScoreBonus ?? 0, 10);
      const openerComparison = options.lineOpeners?.get(event.eventId);
      const openerBonus = openerComparison?.isLargeMove ? 6 : 0;
      const powerData = options.powerRatings?.get(event.eventId);
      const powerComparison = powerData?.comparison;
      const powerBonus = powerComparison?.isBeatPinnacle ? 10
        : powerComparison?.confidence === 'high' ? 6
        : powerComparison?.confidence === 'medium' ? 3 : 0;

      // Officials tendencies (MLB umpire / NBA refs)
      const officialsReports = options.officialsMap?.get(event.eventId) ?? [];
      const officialsBonus = officialsReports.length > 0
        ? Math.min(officialsReports.reduce((s, r) => s + r.ouEdge, 0), 12) : 0;

      // Travel fatigue
      const fatigueReport = options.travelFatigueMap?.get(event.eventId);
      const fatigueBonus = fatigueReport?.fatigueEdge !== 'neutral' ? fatigueReport?.fatigueScoreBonus ?? 0 : 0;

      // Motivation
      const motivationReport = options.motivationMap?.get(event.eventId);
      const motivationBonus = Math.min(Math.abs(motivationReport?.netBonus ?? 0), 12);

      // H2H
      const h2hReport = options.h2hMap?.get(event.eventId);
      const h2hBonus = h2hReport?.scoreBonus ?? 0;

      // Pinnacle sharp edge (pre-built map, per-event lookup)
      const pinnacleEdge = pinnacleEdgeMap.get(event.eventId);

      let maxLineDiff: number | null = null;
      for (const side of market.sides) {
        const lines = side.offers.map(o => o.line).filter((l): l is number => l !== null);
        if (lines.length > 1) {
          const diff = Math.max(...lines) - Math.min(...lines);
          if (maxLineDiff === null || diff > maxLineDiff) maxLineDiff = Math.round(diff * 10) / 10;
        }
      }

      // Score both sides, pick winner
      interface SC {
        side: typeof market.sides[0];
        score: number; priceScore: number; lineScore: number; sharpScore: number;
        priceDiff: number; bestUserBook: string; bestUserPrice: number;
        bestUserLine: number | null; altUserBook: string; altUserPrice: number | null; altUserLine: number | null;
        userBookGap: number | null; userBookGapAlert: boolean;
        steamForSide: any[]; clvProj: any; contextAdj: number; contextReasons: string[];
        marketBestPrice: number; marketBestBook: string;
        signalCount: number; movement: ReturnType<typeof detectMovement>;
        recentMove: boolean; fadeFlag: boolean; fadeDetail: string;
      }

      const sideCandidates: SC[] = [];

      for (const side of market.sides) {
        if (!side.consensusPrice) continue;

        // User book offers only
        // Filter to user books with valid prices
        // Also filter out offers whose price sign contradicts the consensus
        // e.g. if consensus is -145 (favorite), reject any offer showing +145 (underdog)
        // A 200+ point gap between two user books = one book has wrong side
        const allUserOffers = side.offers
          .filter(o => userBookKeys.includes(o.bookmakerKey) && o.price !== null)
          .sort((a, b) => (b.price ?? -999) - (a.price ?? -999));

        if (allUserOffers.length === 0) continue;

        // Detect price sign conflict: if two user books differ by 200+ pts AND
        // have opposite signs, they're on different sides -- only keep the best
        const userOffers = allUserOffers.filter((o, idx) => {
          if (idx === 0) return true; // always keep best
          const best = allUserOffers[0].price ?? 0;
          const this_ = o.price ?? 0;
          // If signs differ (one + one -) AND gap > 150 -> opposite sides, skip
          if (Math.sign(best) !== Math.sign(this_) && Math.abs(best - this_) > 150) return false;
          return true;
        });

        const bestUserPrice = userOffers[0].price as number;

        // #3 -- price range filter
        if (bestUserPrice < BET_FILTERS.MIN_PRICE || bestUserPrice > BET_FILTERS.MAX_PRICE) continue;

        // MLB run line -- penalize heavily, prefer ML expression
        const isMLBRunLine = event.sportKey === 'baseball_mlb' && marketKey === 'spreads';
        // For MLB, if ML market exists for same team, skip the run line
        // Let the moneyline version of the same pick surface instead
        if (isMLBRunLine && BET_FILTERS.MLB_PREFER_ML_OVER_RUNLINE) {
          const mlMarket = event.aggregatedMarkets['h2h'];
          if (mlMarket && mlMarket.bookCount >= BET_FILTERS.MIN_BOOKS_FOR_CONSENSUS) {
            continue; // skip run line -- ML version will surface instead
          }
        }

        // Filter out suspiciously large edge gaps -- likely stale/low-liquidity
        const priceDiffRaw = bestUserPrice - (side.consensusPrice ?? bestUserPrice);
        if (priceDiffRaw > BET_FILTERS.MAX_CREDIBLE_EDGE) continue;

        const altOffer = userOffers[1] ?? null;

        // Validate line sign matches the outcome (dog gets +, favorite gets -)
        // The API stores line relative to each team -- we verify it matches
        // by checking that the line on the best offer belongs to this side's outcome

        // #5 -- gap between user's two books
        const userBookGap = altOffer?.price != null
          ? Math.abs(bestUserPrice - (altOffer.price as number)) : null;
        const userBookGapAlert = userBookGap !== null &&
          userBookGap >= BET_FILTERS.USER_BOOK_GAP_ALERT_THRESHOLD;

        // Market best (all books)
        const allOffers = side.offers.filter(o => o.price !== null)
          .sort((a, b) => (b.price ?? -999) - (a.price ?? -999));
        const marketBest = allOffers[0];
        const marketBestPrice = marketBest?.price ?? bestUserPrice;

        const priceDiff = bestUserPrice - side.consensusPrice;
        if (priceDiff < -5) continue; // allow plays where books are at or near consensus

        const movement = detectMovement(
          event.eventId, marketKey, side.outcomeName,
          side.consensusLine, side.consensusPrice, options.priorSummaries
        );

        const recentMove = isRecentMovement(market.lastUpdate);
        const fadeResult = detectFadePublic(event, marketKey, side.outcomeName, options.priorSummaries);

        const signalCount = countSignals(
          priceDiff, maxLineDiff,
          movement.lineAlert, movement.priceAlert,
          sharpStrength, fadeResult.flag
        );

        // #1 -- minimum signals gate
        if (signalCount < BET_FILTERS.MIN_SIGNALS_REQUIRED) continue;

        // Signal alignment -- HARD DROP if contradicting signals
        const contextSigs = contextSignals as any[];
        const homeSigs = contextSigs.filter((s: any) => s.side === 'home').length;
        const awaySigs = contextSigs.filter((s: any) => s.side === 'away').length;
        const hasContradiction = homeSigs >= 1 && awaySigs >= 1;
        // DROP the play entirely if signals contradict each other
        if (hasContradiction && BET_FILTERS.DROP_ON_CONTRADICTION) continue;

        // Calculate context score adjustment
        let contextAdj = 0;
        const contextReasons: string[] = [];
        for (const sig of contextSignals) {
          // Only apply signal if it favors this side
          const sideIsHome = side.outcomeName.toLowerCase().includes(event.homeTeam.toLowerCase().split(' ').pop()?.toLowerCase() ?? '___');
          const sideIsAway = side.outcomeName.toLowerCase().includes(event.awayTeam.toLowerCase().split(' ').pop()?.toLowerCase() ?? '___');
          const sigFavorsUs = (sig.side === 'home' && sideIsHome) ||
                              (sig.side === 'away' && sideIsAway) ||
                              sig.side === 'none';

          if (!sigFavorsUs) {
            // Signal goes AGAINST this side -- apply penalty
            if (sig.type === 'KEY_PLAYER_OUT') { contextAdj -= 15; contextReasons.push(`? ${sig.detail}`); }
            else if (sig.type === 'BACK_TO_BACK') { contextAdj -= 10; contextReasons.push(`? ${sig.detail}`); }
            else if (sig.type === 'NEWS_INJURY' || sig.type === 'NEWS_SUSPENSION') { contextAdj -= 10; contextReasons.push(`[NEWS] ${sig.detail}`); }
            else if (sig.type === 'COLD_STREAK') { contextAdj -= 5; contextReasons.push(`[v] ${sig.detail}`); }
          } else {
            // Signal favors this side -- apply bonus
            if (sig.type === 'REST_ADVANTAGE') { contextAdj += 8; contextReasons.push(`[ZZ] ${sig.detail}`); }
            else if (sig.type === 'FORM_ADVANTAGE') { contextAdj += 8; contextReasons.push(`[~] ${sig.detail}`); }
            else if (sig.type === 'HOT_STREAK') { contextAdj += 5; contextReasons.push(`[HOT] ${sig.detail}`); }
          }
        }

        const { total: rawTotal, priceScore, lineScore, sharpScore } = scoreBet(
          priceDiff, maxLineDiff, side.bookCount, sharpStrength,
          movement.lineAlert || movement.priceAlert, recentMove,
          weather?.weatherImpact ?? 'none', keyInjuries.length > 0
        );

        // Steam and CLV are side-specific -- must be declared before tier bonuses
        const steamForSide = options.steamMoves?.filter(s =>
          s.eventId === event.eventId &&
          s.marketKey === marketKey &&
          s.outcomeName === side.outcomeName
        ) ?? [];
        const hasSteam = steamForSide.some((s: any) => s.isSteam);
        const steamBonus = hasSteam ? 12 : 0;

        const clvProj = clvProjList.find((p: any) =>
          p.marketKey === marketKey && p.outcomeName === side.outcomeName
        );
        const clvBonus = clvProj?.isBeatingProjectedClose ? 8 : 0;

        // Pinnacle edge for this specific side
        const pinnacleEdgesForEvent = pinnacleEdgeMap.get(event.eventId) ?? [];
        const pinnacleEdge = pinnacleEdgesForEvent.find(
          pe => pe.marketKey === marketKey && pe.sideName === side.outcomeName
        );
        const pinnacleSharpScore = pinnacleEdge?.sharpScore ?? 0;

        // MLB run line penalty
        const mlbRunLinePenalty = isMLBRunLine ? -BET_FILTERS.MLB_RUN_LINE_PENALTY : 0;

        // Apply all bonuses: Tier 1 + Tier 2/3 + New intelligence modules
        const tier1Bonus = angleBonus + clvBonus + powerBonus;
        const tier2Bonus = rlmBonus + playerImpactBonus + steamBonus + atsBonus + openerBonus;
        const tier3Bonus = officialsBonus + fatigueBonus + motivationBonus + h2hBonus + pinnacleSharpScore;
        const allBonuses = contextAdj + tier1Bonus + tier2Bonus + tier3Bonus + mlbRunLinePenalty;
        const preMultiplier = Math.max(0, Math.min(rawTotal + allBonuses, 100));
        const preCalibration = Math.max(0, Math.min(Math.round(preMultiplier * efficiencyMultiplier), 100));

        // Apply learned weights from retrospective analysis
        const preLearnedWeights = applyCalibration(
          preCalibration,
          event.sport,
          marketLabel(marketKey),
          options.calibrationModel ?? null
        );
        const total = applyLearnedWeights(
          preLearnedWeights,
          [...contextSignals.map((s: any) => s.type), ...(situationalList.map((a: any) => a.name))],
          options.learnedWeights ?? {}
        );

        // Fix: use the line that matches this side's sign (dog=+, fav=-)
        // The API stores each team's line with the correct sign for that team.
        // We find the offer whose line sign matches the consensus for this side.
        const correctLine = (() => {
          if (side.consensusLine === null) return userOffers[0].line;
          const matched = userOffers.find(o =>
            o.line !== null && Math.sign(o.line) === Math.sign(side.consensusLine!)
          );
          return matched?.line ?? side.consensusLine;
        })();

        sideCandidates.push({
          side, score: total, priceScore, lineScore, sharpScore,
          priceDiff: Math.round(priceDiff),
          bestUserBook: getBookmakerDisplayName(userOffers[0].bookmakerKey),
          bestUserPrice,
          bestUserLine: correctLine,
          altUserBook: altOffer ? getBookmakerDisplayName(altOffer.bookmakerKey) : '',
          altUserPrice: altOffer?.price ?? null,
          altUserLine: altOffer?.line ?? null,
          userBookGap, userBookGapAlert,
          marketBestPrice,
          marketBestBook: getBookmakerDisplayName(marketBest?.bookmakerKey ?? ''),
          signalCount, movement, recentMove,
          fadeFlag: fadeResult.flag, fadeDetail: fadeResult.detail,
          steamForSide, clvProj: clvProj ?? null,
          contextAdj, contextReasons: [...contextReasons],
        });
      }

      if (sideCandidates.length === 0) continue;

      // #1 -- drop if both sides too close (no clear edge)
      if (sideCandidates.length === 2) {
        const diff = Math.abs(sideCandidates[0].score - sideCandidates[1].score);
        if (diff <= BET_FILTERS.SPLIT_MARKET_SCORE_DIFF) continue;
      }

      sideCandidates.sort((a, b) => b.score - a.score);
      const best = sideCandidates[0];
      const { side } = best;

      const fullReasoning = buildReasoning({
        priceDiff: best.priceDiff,
        lineDiff: maxLineDiff,
        bestUserBook: best.bestUserBook,
        altUserBook: best.altUserBook,
        altUserPrice: best.altUserPrice,
        altUserLine: best.altUserLine ?? null,
        userBookGap: best.userBookGap,
        userBookGapAlert: best.userBookGapAlert,
        bookCount: side.bookCount,
        sharpDetail: sharpReason,
        weatherAlert,
        injuryFlags,
        lineMovementDetail: best.movement.lineDetail,
        priceMovementDetail: best.movement.priceDetail,
        marketBestBook: best.marketBestBook,
        marketBestPrice: best.marketBestPrice,
        bestUserPrice: best.bestUserPrice,
        fadePublicFlag: best.fadeFlag,
        fadePublicDetail: best.fadeDetail,
        isRecentMovement: best.recentMove,
      });

      // Lineup confirmation
      if (homeLineup?.lineupConfirmed && homeLineup.scratchedPlayers.length > 0) {
        for (const s of homeLineup.scratchedPlayers.filter(p => p.isKeyPlayer || p.status === 'Out').slice(0,2)) {
          fullReasoning.push(`? LINEUP: ${s.playerName} (${event.homeTeam}) ${s.status} -- ~${s.pointsImpact}pt impact`);
        }
      }
      if (awayLineup?.lineupConfirmed && awayLineup.scratchedPlayers.length > 0) {
        for (const s of awayLineup.scratchedPlayers.filter(p => p.isKeyPlayer || p.status === 'Out').slice(0,2)) {
          fullReasoning.push(`? LINEUP: ${s.playerName} (${event.awayTeam}) ${s.status} -- ~${s.pointsImpact}pt impact`);
        }
      }
      // Breaking news -- STRICT filter: must directly name this team
      // Last word of team name (e.g. "Yankees", "Pirates") must appear in headline
      const homeTeamLast = event.homeTeam.split(' ').pop()?.toLowerCase() ?? '';
      const awayTeamLast = event.awayTeam.split(' ').pop()?.toLowerCase() ?? '';

      for (const news of (breakingNews as any[]).filter((n: any) => {
        if (!n.isBreaking) return false;
        const hl = n.headline.toLowerCase();
        // Must contain the SPECIFIC team name -- not just any team in the same sport
        return hl.includes(homeTeamLast) || hl.includes(awayTeamLast);
      }).slice(0, 1)) {  // max 1 news item per pick
        fullReasoning.push(`? BREAKING: ${news.headline}`);
      }

      // Tier 2/3: Public betting data
      if (isConfirmedRLM && pubBet?.rlmDetail) {
        fullReasoning.push(`? CONFIRMED RLM: ${pubBet.rlmDetail} -- verified sharp vs public split`);
      } else if (pubBet && (pubBet.homeBetPct ?? 0) >= 65) {
        fullReasoning.push(`[~] PUBLIC: ${pubBet.homeBetPct}% of bets on ${event.homeTeam} -- public side`);
      } else if (pubBet && (pubBet.awayBetPct ?? 0) >= 65) {
        fullReasoning.push(`[~] PUBLIC: ${pubBet.awayBetPct}% of bets on ${event.awayTeam} -- public side`);
      }

      // Tier 2/3: Steam moves
      for (const steam of (best.steamForSide ?? []).filter((s: any) => s.isSteam).slice(0,1)) {
        fullReasoning.push(`? STEAM: ${steam.detail}`);
      }

      // Tier 2/3: Player impact
      if (playerImpact?.significantImpact) {
        fullReasoning.push(`? IMPACT: ${playerImpact.impactSummary}`);
      }

      // Tier 2/3: ATS records
      for (const sig of (atsSituation?.atsSignals ?? []).slice(0,2)) {
        fullReasoning.push(`[CLP] ATS: ${sig}`);
      }

      // Tier 2/3: Opening line movement
      if (openerComparison?.isLargeMove && openerComparison.openingLineDetail) {
        fullReasoning.push(`? FROM OPEN: ${openerComparison.openingLineDetail}`);
      }

      // Tier 1: Situational angles
      for (const angle of situationalList.slice(0, 3)) {
        fullReasoning.push(`? ANGLE [${angle.name}]: ${angle.detail} (${angle.historicalEdge})`);
      }

      // Tier 1: CLV projection
      if (best.clvProj?.isBeatingProjectedClose && best.clvProj.detail) {
        fullReasoning.push(`[v] CLV PROJ: ${best.clvProj.detail}`);
      }

      // Tier 1: Power ratings
      if (powerComparison?.confidence !== 'low' && powerComparison?.detail) {
        fullReasoning.push(`? POWER: ${powerComparison.detail}`);
      }

      // Tier 1: Market efficiency
      if (efficiencyData?.edgePotential === 'very_high' || efficiencyData?.edgePotential === 'high') {
        fullReasoning.push(`[~] MARKET: ${efficiencyData.detail}`);
      }

      // New intelligence modules
      if (officialsReports.length > 0) {
        for (const r of officialsReports) {
          if (r.ouEdge >= 4) fullReasoning.push(`[REF] ${r.detail}`);
        }
      }
      if (fatigueReport && fatigueReport.fatigueEdge !== 'neutral') {
        fullReasoning.push(`[TRAVEL] ${fatigueReport.detail}`);
      }
      if (motivationReport && Math.abs(motivationReport.netBonus) >= 5) {
        fullReasoning.push(`[MOTIV] ${motivationReport.summary}`);
      }
      if (h2hReport && h2hReport.scoreBonus >= 6) {
        fullReasoning.push(`[H2H] ${h2hReport.detail}`);
      }
      if (pinnacleEdge && Math.abs(pinnacleEdge.sharpScore) >= 10) {
        fullReasoning.push(`[PINNACLE] ${pinnacleEdge.detail}`);
      }

      // Append context signals and news to fullReasoning
      if ((best.contextReasons ?? []).length > 0) {
        fullReasoning.push(...(best.contextReasons ?? []));
      }
      if (contextPkg?.relevantNews) {
        for (const item of (contextPkg.relevantNews as any[]).filter((n: any) => n.relevance === 'high').slice(0, 2)) {
          fullReasoning.push(`[NEWS] NEWS: ${item.headline}`);
        }
      }

      const tier = getTier(best.score, best.signalCount, (event as any).sportKey);
      const tierIcon = tier === 'BET' ? '[HOT] BET' : tier === 'LEAN' ? '[OK] LEAN' : '? MONITOR';

      const winProb = scoreToProbability(best.score);
      const kellyResult = calculateKelly(winProb, best.bestUserPrice > 0 ? best.bestUserPrice : (best.consensusPrice ?? -110));
      candidates.push({
        rank: 0, tier, grade: scoreToGrade(best.score), score: best.score,
        priceScore: best.priceScore, lineScore: best.lineScore, sharpScore: best.sharpScore,
        signalCount: best.signalCount,
        sport: event.sport, matchup: event.matchup, startTime: event.startTime,
        hoursUntilGame: Math.round(hours * 10) / 10,
        betType: marketLabel(marketKey), side: side.outcomeName,
        bestUserBook: best.bestUserBook, bestUserPrice: best.bestUserPrice,
        bestUserLine: best.bestUserLine,
        altUserBook: best.altUserBook, altUserPrice: best.altUserPrice,
        userBookGap: best.userBookGap, userBookGapAlert: best.userBookGapAlert,
        consensusPrice: side.consensusPrice ?? 0, consensusLine: side.consensusLine,
        priceDiff: best.priceDiff, marketBestPrice: best.marketBestPrice,
        marketBestBook: best.marketBestBook, lineDiff: maxLineDiff,
        bookCount: side.bookCount, bookConfidence: bookConfidence(side.bookCount),
        sharpSignal: marketIntel?.sharpIndicators.map(i => i.signal).join(', ') ?? '',
        recommendation: tierIcon, fadePublicFlag: best.fadeFlag,
        fadePublicDetail: best.fadeDetail, weatherAlert, injuryFlags,
        lineMovementAlert: best.movement.lineAlert, lineMovementDetail: best.movement.lineDetail,
        priceMovementAlert: best.movement.priceAlert, priceMovementDetail: best.movement.priceDetail,
        isRecentMovement: best.recentMove, fullReasoning,
        kellyPct: kellyResult.recommendedBetPct,
      });
    }
  }

  // Filter out sub-minimum scores, then sort
  const candidates_sorted = candidates
    .filter(b => {
      const sk = (b as any).sportKey ?? '';
      const isMLB2 = sk.includes('baseball') || sk.includes('mlb');
      const isNHL2 = sk.includes('hockey') || sk.includes('nhl');
      const min = isMLB2 ? ((BET_FILTERS as any).SCORE_MONITOR_MIN_MLB ?? 60)
                : isNHL2 ? ((BET_FILTERS as any).SCORE_MONITOR_MIN_NHL ?? 60)
                : BET_FILTERS.SCORE_MONITOR_MIN;
      return b.score >= min;
    })
    .sort((a, b) => b.score - a.score);

  // Enforce max 1 per game + tier caps
  // singleSport mode: higher caps for options 4-10
  const isSingle = options.singleSport ?? false;
  const maxPerGame = isSingle
    ? (BET_FILTERS as any).MAX_ENTRIES_PER_GAME_SINGLE ?? 2
    : BET_FILTERS.MAX_ENTRIES_PER_GAME;
  const maxBet  = isSingle
    ? (BET_FILTERS as any).MAX_BET_TIER_PLAYS_SINGLE ?? 5
    : BET_FILTERS.MAX_BET_TIER_PLAYS;
  const maxLean = isSingle
    ? (BET_FILTERS as any).MAX_LEAN_TIER_PLAYS_SINGLE ?? 5
    : BET_FILTERS.MAX_LEAN_TIER_PLAYS;

  const final: ScoredBet[] = [];
  let betCount = 0, leanCount = 0, monitorCount = 0;

  // First pass: take best play per sport (ensures sport diversity)
  const sportBest = new Map<string, ScoredBet>();
  for (const bet of candidates_sorted) {
    if (!sportBest.has(bet.sport)) {
      sportBest.set(bet.sport, bet);
    }
  }
  // Add sport-best plays first
  for (const [, bet] of sportBest) {
    const count = gameEntryCount.get(bet.matchup) ?? 0;
    gameEntryCount.set(bet.matchup, count + 1);
    if (bet.tier === 'BET') betCount++;
    else if (bet.tier === 'LEAN') leanCount++;
    else monitorCount++;
    final.push(bet);
  }

  // Second pass: fill remaining slots from full ranked list
  for (const bet of candidates_sorted) {
    if (final.includes(bet)) continue; // already added
    // Max 1 entry per game
    const count = gameEntryCount.get(bet.matchup) ?? 0;
    if (count >= BET_FILTERS.MAX_ENTRIES_PER_GAME) continue;
    gameEntryCount.set(bet.matchup, count + 1);

    // Tier caps -- prevents grade inflation (applied on second pass)
    if (bet.tier === 'BET' && betCount >= maxBet) {
      bet.tier = 'LEAN'; // downgrade overflow BETs to LEAN
    }
    if (bet.tier === 'LEAN' && leanCount >= BET_FILTERS.MAX_LEAN_TIER_PLAYS) {
      bet.tier = 'MONITOR';
    }

    if (bet.tier === 'BET') betCount++;
    else if (bet.tier === 'LEAN') leanCount++;
    else monitorCount++;

    final.push(bet);
    if (final.length >= 50) break;
  }

  final.forEach((b, i) => { b.rank = i + 1; });
  return final;
}

export function getTopBets(
  summaries: EventSummary[], n = 10, options: TopTenOptions = {}
): ScoredBet[] {
  return scoreAllBets(summaries, options).slice(0, n);
}

// ------------------------------------
// #8 -- Auto-save to dated text file
// ------------------------------------

function saveToDatedFile(output: string): void {
  try {
    const snapshotDir = process.env.SNAPSHOT_DIR ?? './snapshots';
    const picksDir = path.join(snapshotDir, 'daily_picks');
    if (!fs.existsSync(picksDir)) fs.mkdirSync(picksDir, { recursive: true });
    const dateStr = new Date().toLocaleDateString('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).replace(/\//g, '-');
    const timeStr = new Date().toLocaleTimeString('en-US', {
      timeZone: 'America/Chicago',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).replace(':', '');
    const filename = `top10_${dateStr}_${timeStr}.txt`;
    fs.writeFileSync(path.join(picksDir, filename), output);
    console.log(`  ? Saved -> snapshots/daily_picks/${filename}`);
  } catch { /* never block on file save */ }
}

// ------------------------------------
// #4 -- Tiered print output
// ------------------------------------

// Build 2-line plain-English explanation of why this bet scored well
function buildScoreExplanation(bet: ScoredBet): string[] {
  const reasons: string[] = [];

  // Price edge
  if (bet.priceScore >= 25) reasons.push(`Strong price edge +${bet.priceDiff}pts vs market`);
  else if (bet.priceScore >= 15) reasons.push(`Price edge +${bet.priceDiff}pts at ${bet.bestUserBook}`);

  // Sharp signal
  if (bet.sharpScore >= 20) reasons.push('Sharp money confirmed moving this line');
  else if (bet.lineMovementAlert) reasons.push(`Line moved: ${bet.lineMovementDetail}`);
  else if (bet.priceMovementAlert) reasons.push(`Price moved: ${bet.priceMovementDetail}`);

  // Fade public
  if (bet.fadePublicFlag) reasons.push(bet.fadePublicDetail || 'Reverse line movement vs public');

  // Line gap
  if (bet.lineScore >= 15) reasons.push(`Line gap advantage (${bet.lineDiff} pts better than consensus)`);

  // Weather
  if (bet.weatherAlert) reasons.push(bet.weatherAlert);

  // Injury
  if (bet.injuryFlags && bet.injuryFlags.length > 0) reasons.push(bet.injuryFlags[0]);

  // Full reasoning fallback -- use first 2 lines if we have no other reasons
  if (reasons.length === 0 && bet.fullReasoning && bet.fullReasoning.length > 0) {
    return bet.fullReasoning.slice(0, 2).map(r => r.replace(/^\s*[^\w]+\s*/, ''));
  }

  return reasons.slice(0, 2);
}

export function printTopTen(bets: ScoredBet[], windowHours = 24): void {
  const time = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  const lines: string[] = [];
  const p = (s: string) => { lines.push(s); };

  p('\n');
  const betTierCount = bets.filter(b => b.tier === 'BET').length;
  const leanTierCount = bets.filter(b => b.tier === 'LEAN').length;
  const monTierCount = bets.filter(b => b.tier === 'MONITOR').length;

  p('+==============================================================+');
  p('|                   TOP PLAYS -- FILTERED                      |');
  p(`|  ${time.padEnd(60)}|`);
  p(`|  [HOT] BET: ${String(betTierCount).padEnd(3)} | [OK] LEAN: ${String(leanTierCount).padEnd(3)} | ? MONITOR: ${String(monTierCount).padEnd(3)} | Next ${windowHours}hrs          |`);
  p(`|  Min ${BET_FILTERS.MIN_SIGNALS_REQUIRED} aligned signals | FanDuel + BetMGM only              |`);
  p('+==============================================================+');

  if (bets.length === 0) {
    p(`\n  No bets cleared the ${BET_FILTERS.MIN_SIGNALS_REQUIRED}-signal minimum in the next ${windowHours} hours.`);
    p(`  Lines may be efficient right now -- check back closer to game time.\n`);
    lines.forEach(l => console.log(l));
    return;
  }

  // #4 -- Group by tier
  const betTier   = bets.filter(b => b.tier === 'BET');
  const leanTier  = bets.filter(b => b.tier === 'LEAN');
  const monTier   = bets.filter(b => b.tier === 'MONITOR');

  // Show sport coverage summary
  const sportsSeen = [...new Set(bets.map(b => b.sport))].sort();
  if (sportsSeen.length > 1) {
    p(`|  Sports covered: ${sportsSeen.join(', ').padEnd(44)}|`);
    p(`+==============================================================+`);
  }

  function printBet(bet: ScoredBet) {
    const gradeBar =
      bet.grade === 'A+' ? '[##########]' : bet.grade === 'A'  ? '[#########-]' :
      bet.grade === 'B+' ? '[#######---]' : bet.grade === 'B'  ? '[######----]' :
      bet.grade === 'C+' ? '[####------]' : bet.grade === 'C'  ? '[###-------]' : '[##--------]';

    const userPriceStr = fmtPrice(bet.bestUserPrice);
    const userLineStr = fmtLine(bet.bestUserLine);
    const consensusLineStr = fmtLine(bet.consensusLine);
    const confIcon = bet.bookConfidence === 'high' ? '[G]' : bet.bookConfidence === 'medium' ? '[Y]' : '[R]';
    const signalStr = `${bet.signalCount} signal${bet.signalCount !== 1 ? 's' : ''}`;

    p(`\n  +---------------------------------------------------------`);
    p(`  |  #${String(bet.rank).padEnd(3)} ${bet.recommendation.padEnd(14)} ${bet.sport} -- ${bet.matchup}`);
    p(`  |  [CLK] ${fmtHours(bet.hoursUntilGame).padEnd(14)} Grade: ${bet.grade}  ${gradeBar}  (${bet.score}/100)`);
    p(`  |  ${signalStr}  |  ${confIcon} ${bet.bookCount} books  |  Price:${bet.priceScore} Line:${bet.lineScore} Sharp:${bet.sharpScore}`);
    const scoreFactors = buildScoreExplanation(bet);
    if (scoreFactors.length > 0) {
      p(`  |  WHY: ${scoreFactors.slice(0,2).join('  +  ')}`);
    }
    p(`  +---------------------------------------------------------`);
    p(`  |  ${bet.betType.padEnd(12)}  [OK] BET: ${bet.side}`);
    // Proper quarter-Kelly sizing using model win probability vs implied probability
    const bankroll = parseFloat(process.env.BANKROLL ?? '0');
    const kPct = bet.kellyPct > 0 ? bet.kellyPct : 0.5;
    const bankrollLine = bankroll > 0
      ? `  |  [$] Kelly: ${kPct.toFixed(1)}% of $${bankroll.toFixed(0)} = $${Math.round(bankroll * kPct / 100)} suggested`
      : `  |  [$] Kelly: ${kPct.toFixed(1)}% of bankroll (set BANKROLL=<amount> in .env for $ sizing)`;
    p(bankrollLine);
    p(`  |  [PIN] Best   : ${bet.bestUserBook.padEnd(10)}  ${userPriceStr}${userLineStr}`);
    if (bet.altUserBook && bet.altUserPrice !== null) {
      // Show alt book's own line if it differs from best, otherwise same
      const altLineStr = (bet.altUserLine !== null && bet.altUserLine !== undefined && bet.altUserLine !== bet.bestUserLine)
        ? fmtLine(bet.altUserLine)
        : (bet.bestUserLine !== null ? userLineStr : consensusLineStr);
      p(`  |  [PIN] Alt    : ${bet.altUserBook.padEnd(10)}  ${fmtPrice(bet.altUserPrice)}${altLineStr}`);
    }
    if (bet.userBookGapAlert) {
      p(`  |  ? GAP ALERT: ${bet.bestUserBook} vs ${bet.altUserBook} differ by ${bet.userBookGap} pts`);
    }
    // Sanity check: would this be worth betting at consensus price?
    const worthAtConsensus = bet.bestUserPrice > bet.consensusPrice;
    p(`  |  [~] Market : Consensus ${fmtPrice(bet.consensusPrice)}${consensusLineStr}  |  ${bet.bookCount} books  |  Edge: ${fmtPrice(bet.priceDiff)}`);
    p(`  |  [+]?  Worth at consensus? ${worthAtConsensus ? 'YES -- price advantage is real' : 'NO -- only value is the gap'}`);
    p(`  +---------------------------------------------------------`);
    for (const reason of bet.fullReasoning) p(`  |  ${reason}`);
    p(`  +---------------------------------------------------------`);
  }

  if (betTier.length > 0) {
    p(`\n  ????????????????  [HOT] BET  (${betTier.length})  ?????????????????????????`);
    p(`  Strongest edge -- multiple signals aligned`);
    betTier.forEach(printBet);
  }

  if (leanTier.length > 0) {
    p(`\n  ????????????????  [OK] LEAN  (${leanTier.length})  ????????????????????????`);
    p(`  Solid value -- good spots, slightly less conviction`);
    leanTier.forEach(printBet);
  }

  if (monTier.length > 0) {
    p(`\n  ????????????????  ? MONITOR  (${monTier.length})  ??????????????????????`);
    p(`  Worth watching -- run midday scan to confirm`);
    monTier.forEach(printBet);
  }

  p(`\n  ---------------------------------------------------------`);
  p(`  Score: 85+ = BET (rare) | 78-84 = LEAN | 72-77 = MONITOR | <72 = filtered`);
  p(`  [HOT] BET = all signals aligned | MLB run lines excluded (ML preferred)`);
  p(`  ? line shop | ? fade public | [^] line moved | [+]? passes consensus test`);
  p(`  FanDuel + BetMGM only | Contradicting signals = play dropped\n`);

  // Print to console
  lines.forEach(l => console.log(l));

  // #8 -- Auto-save to file
  saveToDatedFile(lines.join('\n'));
}
