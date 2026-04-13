// ============================================================
// src/services/propScorer.ts
// Enhanced with full prop intelligence layer
// NBA player prop edge scorer
// Criteria: line gap, juice gap, implied vs posted,
//           form window, back-to-back, matchup, movement
// ============================================================

import { AggregatedProp, PropOffer } from './propNormalizer';
import { PROP_CONFIG } from '../config/propConfig';
import { getUserBookKeys, getBookmakerDisplayName } from '../config/bookmakers';

export interface ScoredProp {
  prediction?: any;          // PropPrediction from intelligence layer
  intelligenceScore: number; // score contribution from player context
  rank: number;
  grade: string;
  score: number;
  tier: 'BET' | 'LEAN' | 'MONITOR';
  // Game
  matchup: string;
  gameTime: string;
  hoursUntilGame: number;
  sport: string;
  // Prop
  playerName: string;
  team?: string;
  position?: string;
  statType?: string;
  eventId?: string;
  market: string;
  side: 'Over' | 'Under';
  line: number;
  // Best accessible book
  bestUserBook: string;
  bestUserPrice: number;
  altUserBook: string;
  altUserPrice: number | null;
  // Market context
  consensusLine: number | null;
  consensusPrice: number | null;
  lineGap: number | null;
  juiceGap: number | null;
  bookCount: number;
  priceDiff: number;        // user best vs consensus price
  lineDiffVsConsensus: number | null; // line vs consensus
  // Signals
  signals: string[];
  signalCount: number;
  // Flags
  lineGapAlert: boolean;
  juiceGapAlert: boolean;
  isBackToBack: boolean;
  // Full reasoning
  fullReasoning: string[];
}

// ------------------------------------
// Helpers
// ------------------------------------

function fmtPrice(p: number): string { return p > 0 ? `+${p}` : `${p}`; }
function scoreToGrade(s: number): string {
  if (s >= 88) return 'A+';
  if (s >= 78) return 'A';
  if (s >= 68) return 'B+';
  if (s >= 55) return 'B';
  if (s >= 42) return 'C+';
  if (s >= 30) return 'C';
  return 'D';
}
function getTier(score: number, signals: number): 'BET' | 'LEAN' | 'MONITOR' {
  if (score >= 70 && signals >= 3) return 'BET';
  if (score >= 50 && signals >= 2) return 'LEAN';
  return 'MONITOR';
}
function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3600000;
}

// ------------------------------------
// Score a single prop
// ------------------------------------

function scoreProp(
  priceDiff: number,
  lineGap: number | null,
  juiceGap: number | null,
  bookCount: number,
  isBackToBack: boolean
): number {
  // Price edge vs consensus: 0-40 pts
  const priceScore = priceDiff > 0 ? Math.min((priceDiff / 20) * 40, 40) : 0;

  // Line gap between books: 0-35 pts
  // 1.5+ gap is excellent, 3.0+ is exceptional
  const lineScore = lineGap !== null && lineGap > 0
    ? Math.min((lineGap / 3.0) * 35, 35) : 0;

  // Juice gap: 0-15 pts
  const juiceScore = juiceGap !== null && juiceGap > 0
    ? Math.min((juiceGap / 20) * 15, 15) : 0;

  // Book coverage: 0-5 pts
  const coverageScore = Math.min((bookCount / 4) * 5, 5);

  // Back-to-back penalty: -10 pts on overs
  const b2bPenalty = isBackToBack ? -10 : 0;

  return Math.round(Math.max(0, Math.min(
    priceScore + lineScore + juiceScore + coverageScore + b2bPenalty,
    100
  )));
}

// ------------------------------------
// Score all props -- only use user-accessible books for recommendations
// ------------------------------------

import { buildPropPredictions } from './propIntelligence';
import { findPlayerId, getPlayerProfile } from './playerStats';
import { applyLearnedWeights } from './retroAnalysis';

export async function scoreAllPropsWithIntelligence(
  props: AggregatedProp[],
  windowHours: number,
  contextMap: Map<string, any>,
  sportKey: string = 'basketball_nba',
  extraIntel?: {
    injuryMap?: Map<string, any[]>;
    lineupMap?: Map<string, any>;
    publicBetting?: Map<string, any>;
    powerRatings?: Map<string, any>;
    steamMoves?: any[];
    atsSituations?: Map<string, any>;
    weatherMap?: Map<string, any>;
  },
  learnedWeights: Record<string, number> = {}
): Promise<ScoredProp[]> {
  // Enrich props with team/position using roster lookup (best effort)
  const enrichedProps = await Promise.all(props.map(async (prop) => {
    try {
      const playerId = await findPlayerId(prop.playerName, prop.homeTeam, sportKey)
        ?? await findPlayerId(prop.playerName, prop.awayTeam, sportKey);
      if (playerId) {
        const profile = await getPlayerProfile(playerId, prop.playerName, prop.homeTeam, prop.position ?? '', sportKey);
        if (profile) {
          prop.team = profile.team;
          prop.position = profile.position;
        }
      }
    } catch { /* enrichment is best-effort */ }
    return prop;
  })).catch(() => props);

  // Build predictions for all props -- one entry per side using correct AggregatedProp fields
  // AggregatedProp has overBestLine/underBestLine/overConsensusLine, not .line/.side
  const propInputs: any[] = [];
  for (const p of enrichedProps) {
    if (!p.playerName) continue;
    const consensusLine = p.overConsensusLine ?? null;
    if (consensusLine === null) continue; // need at least one line

    // Over side
    if (p.overBestPrice !== null && p.overBestPrice !== undefined) {
      propInputs.push({
        playerName: p.playerName,
        team: p.team,
        position: p.position ?? 'G',
        statType: p.marketKey,
        marketKey: p.marketKey,
        postedLine: p.overBestLine ?? consensusLine,
        postedPrice: p.overBestPrice ?? -110,
        side: 'over' as const,
        eventId: p.eventId,
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        gameTotal: p.gameTotal ?? null,
        gameSpread: (p as any).gameSpread ?? null,
      });
    }

    // Under side
    if (p.underBestPrice !== null && p.underBestPrice !== undefined) {
      propInputs.push({
        playerName: p.playerName,
        team: p.team,
        position: p.position ?? 'G',
        statType: p.marketKey,
        marketKey: p.marketKey,
        postedLine: p.underBestLine ?? consensusLine,
        postedPrice: p.underBestPrice ?? -110,
        side: 'under' as const,
        eventId: p.eventId,
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        gameTotal: p.gameTotal ?? null,
        gameSpread: (p as any).gameSpread ?? null,
      });
    }
  }

  const predictions = await buildPropPredictions(propInputs, contextMap, sportKey, extraIntel)
    .catch(() => new Map());

  // Score all props with intelligence adjustment (pass contextMap for B2B detection)
  const baseScored = scoreAllProps(props, windowHours, sportKey, contextMap);

  return baseScored.map(scored => {
    const key = `${scored.playerName}__${scored.statType}__${scored.side}`;
    const prediction = predictions.get(key);

    if (!prediction) return { ...scored, intelligenceScore: 0 };

    // Apply intelligence score adjustment
    const intelligenceScore = Math.min(Math.max(prediction.scoreAdjustment, -30), 30);
    const adjustedScore = Math.max(0, Math.min(100, scored.score + intelligenceScore));

    // Add prediction signals to reasons
    const extraReasons = prediction.signals
      .filter((s: any) => s.magnitude === 'high' || s.magnitude === 'medium')
      .slice(0, 3)
      .map((s: any) => {
        const icon = s.side === 'over' ? '[^]' : s.side === 'under' ? '[v]' : '[~]';
        return `${icon} ${s.type}: ${s.detail}`;
      });

    // Build top 3-5 signals only -- sorted by absolute score contribution
    const allSignals = (prediction.signals ?? []) as any[];
    const rankedSignals = allSignals
      .filter((s: any) => s.side !== 'neutral')
      .sort((a: any, b: any) => Math.abs(b.scoreContribution) - Math.abs(a.scoreContribution))
      .slice(0, 5);

    const intelReasons: string[] = [];

    // Line 1: prediction summary (most important)
    if (prediction.predictedValue !== undefined && Math.abs(prediction.predictedEdge ?? 0) >= 1) {
      const edgeStr = (prediction.predictedEdge ?? 0) > 0 ? `+${prediction.predictedEdge}` : String(prediction.predictedEdge);
      intelReasons.push(`[AI] Model: ${prediction.predictedValue} predicted vs ${prediction.postedLine} line (edge ${edgeStr}) -- ${prediction.confidence.toUpperCase()} confidence`);
    }

    // Lines 2-5: top signals with clear labels
    for (const sig of rankedSignals.slice(0, 4)) {
      const icon = sig.side === 'over' ? '[^]' : sig.side === 'under' ? '[v]' : '[~]';
      const label = sig.type.replace(/_/g, ' ').toLowerCase();
      intelReasons.push(`${icon} ${label}: ${sig.detail}`);
    }

    // Only replace fullReasoning entirely -- no stacking old price-only reasons with new intel
    // Keep 1 price reason + up to 4 intel reasons = max 5 lines total
    const priceReason = (scored.fullReasoning ?? []).find((r: string) =>
      r.includes('better than market') || r.includes('better than consensus') || r.includes('line gap')
    );
    const cleanReasoning = [
      ...(priceReason ? [priceReason] : []),
      ...intelReasons,
    ].slice(0, 5);

    // Apply learned signal weights on top of intelligence adjustment
    const signalNames = (prediction.signals ?? []).map((s: any) => s.type);
    const weightedScore = applyLearnedWeights(adjustedScore, signalNames, learnedWeights);

    return {
      ...scored,
      score: weightedScore,
      prediction,
      intelligenceScore,
      fullReasoning: cleanReasoning,
    };
  }).sort((a, b) => b.score - a.score);
}

export function scoreAllProps(
  props: AggregatedProp[],
  windowHours = 24,
  sportKey: string = 'basketball_nba',
  contextMap?: Map<string, any>
): ScoredProp[] {
  const userBookKeys = getUserBookKeys();
  const scored: ScoredProp[] = [];

  for (const prop of props) {
    const hours = hoursUntil(prop.gameTime);
    if (hours < 1 || hours > windowHours) continue;
    if (prop.bookCount < 2) continue; // need at least 2 books

    // Process both Over and Under
    const sides: Array<'Over' | 'Under'> = ['Over', 'Under'];

    for (const side of sides) {
      const offers: PropOffer[] = side === 'Over' ? prop.overOffers : prop.underOffers;
      const consensusPrice = side === 'Over' ? prop.overConsensusPrice : prop.underConsensusPrice;
      const consensusLine = prop.overConsensusLine; // same line for both sides

      if (!consensusPrice) continue;

      // Filter to user-accessible books only for recommendation
      const userOffers = offers.filter(o =>
        userBookKeys.includes(o.bookmakerKey) && o.price !== null
      ).sort((a, b) => b.price - a.price);

      if (userOffers.length === 0) continue;

      const bestOffer = userOffers[0];
      const altOffer = userOffers[1] ?? null;

      // Price filter
      if (bestOffer.price < PROP_CONFIG.MIN_PRICE || bestOffer.price > PROP_CONFIG.MAX_PRICE) continue;

      const priceDiff = bestOffer.price - consensusPrice;
      if (priceDiff <= 0) continue; // only flag if user book beats consensus

      // Line gap alert
      const lineGapAlert = prop.lineGap !== null &&
        prop.lineGap >= PROP_CONFIG.MIN_LINE_GAP;

      // Juice gap alert
      const juiceGapAlert = prop.juiceGap !== null &&
        prop.juiceGap >= PROP_CONFIG.MIN_JUICE_GAP;

      // Line diff vs consensus
      const lineDiffVsConsensus = consensusLine !== null && bestOffer.line !== null
        ? Math.round((bestOffer.line - consensusLine) * 10) / 10
        : null;

      // Build signals list
      const signals: string[] = [];
      if (priceDiff >= 5) signals.push('PRICE_EDGE');
      if (lineGapAlert) signals.push('LINE_GAP');
      if (juiceGapAlert) signals.push('JUICE_GAP');
      if (lineDiffVsConsensus !== null && Math.abs(lineDiffVsConsensus) >= 1.0)
        signals.push('LINE_VS_CONSENSUS');

      // Require at least 2 signals
      if (signals.length < 2) continue;

      // Check if either team in this game is on a back-to-back from context
      const ctx = contextMap?.get(prop.eventId ?? '');
      const isB2B = !!(ctx?.homeRest?.isBackToBack || ctx?.awayRest?.isBackToBack);

      const score = scoreProp(
        priceDiff, prop.lineGap, prop.juiceGap,
        prop.bookCount, isB2B && side === 'Over'
      );

      // Build reasoning
      const reasoning: string[] = [];

      if (priceDiff >= 10)
        reasoning.push(`[$] ${getBookmakerDisplayName(bestOffer.bookmakerKey)} is ${fmtPrice(priceDiff)} better than market avg -- strong juice value`);
      else if (priceDiff >= 5)
        reasoning.push(`[$] ${fmtPrice(priceDiff)} better than consensus at ${getBookmakerDisplayName(bestOffer.bookmakerKey)}`);

      if (lineGapAlert)
        reasoning.push(`? ${prop.lineGap} pt line gap across books -- always take the better number`);

      if (juiceGapAlert)
        reasoning.push(`[$] ${prop.juiceGap} pt juice gap -- significant price inefficiency`);

      if (lineDiffVsConsensus !== null && Math.abs(lineDiffVsConsensus) >= 1.0)
        reasoning.push(`[~] Line ${lineDiffVsConsensus > 0 ? 'higher' : 'lower'} than market consensus by ${Math.abs(lineDiffVsConsensus)} pts`);

      // Show all book lines for this prop
      if (prop.overOffers.length > 1) {
        const lineSpread = prop.overOffers.map(o =>
          `${getBookmakerDisplayName(o.bookmakerKey)}: ${o.line}`
        ).join(' | ');
        reasoning.push(`? All lines: ${lineSpread}`);
      }

      scored.push({
        rank: 0,
        grade: scoreToGrade(score),
        score,
        tier: getTier(score, signals.length),
        matchup: prop.matchup,
        gameTime: prop.gameTime,
        hoursUntilGame: Math.round(hours * 10) / 10,
        sport: sportKey === 'basketball_nba' ? 'NBA'
                     : sportKey === 'americanfootball_nfl' ? 'NFL'
                     : sportKey === 'baseball_mlb' ? 'MLB'
                     : sportKey === 'icehockey_nhl' ? 'NHL'
                     : 'NBA',
        playerName: prop.playerName,
        team: prop.team ?? '',
        position: prop.position ?? '',
        market: prop.marketLabel,
        statType: prop.marketKey,
        eventId: prop.eventId ?? '',
        side,
        line: bestOffer.line,
        bestUserBook: getBookmakerDisplayName(bestOffer.bookmakerKey),
        bestUserPrice: bestOffer.price,
        altUserBook: altOffer ? getBookmakerDisplayName(altOffer.bookmakerKey) : '',
        altUserPrice: altOffer?.price ?? null,
        consensusLine,
        consensusPrice,
        lineGap: prop.lineGap,
        juiceGap: prop.juiceGap,
        bookCount: prop.bookCount,
        priceDiff: Math.round(priceDiff),
        lineDiffVsConsensus,
        signals,
        signalCount: signals.length,
        lineGapAlert,
        juiceGapAlert,
        isBackToBack: isB2B,
        fullReasoning: reasoning,
      });
    }
  }

  // Sort by score, deduplicate same player same market (keep best side)
  scored.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const gameCount = new Map<string, number>();
  const deduped: ScoredProp[] = [];
  const maxPerGame = (PROP_CONFIG as any).MAX_PROPS_PER_GAME ?? 2;

  for (const p of scored) {
    // Dedupe same player + market
    const key = `${p.playerName}__${p.market}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Per-game cap -- force slate diversity
    const gameKey = p.matchup;
    const count = gameCount.get(gameKey) ?? 0;
    if (count >= maxPerGame) continue;
    gameCount.set(gameKey, count + 1);

    deduped.push(p);
  }

  deduped.forEach((p, i) => { p.rank = i + 1; });
  return deduped;
}

// ------------------------------------
// Print prop Top 5
// ------------------------------------

export function printTopProps(props: ScoredProp[]): void {
  // Show intelligence-enhanced output
  const time = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  console.log('\n');
  console.log('+==============================================================+');
  console.log('|              NBA PLAYER PROPS -- TOP EDGES                   |');
  console.log(`|  ${time.padEnd(60)}|`);
  console.log('|  FanDuel + BetMGM only  |  Min 2 signals required           |');
  console.log('+==============================================================+');

  if (props.length === 0) {
    console.log('\n  No prop edges found meeting minimum signal requirements.');
    console.log('  Lines may be efficient -- check back closer to tip-off.\n');
    return;
  }

  const betTier   = props.filter(p => p.tier === 'BET');
  const leanTier  = props.filter(p => p.tier === 'LEAN');
  const monTier   = props.filter(p => p.tier === 'MONITOR');

  function printProp(p: ScoredProp) {
    const gradeBar =
      p.grade === 'A+' ? '[##########]' : p.grade === 'A'  ? '[#########-]' :
      p.grade === 'B+' ? '[#######---]' : p.grade === 'B'  ? '[######----]' :
      p.grade === 'C+' ? '[####------]' : '[###-------]';

    const tierIcon = p.tier === 'BET' ? '[HOT] BET' : p.tier === 'LEAN' ? '[OK] LEAN' : '? MONITOR';
    const hours = p.hoursUntilGame < 2 ? `~${Math.round(p.hoursUntilGame * 60)}min` : `~${Math.round(p.hoursUntilGame)}hrs`;

    console.log(`\n  +---------------------------------------------------------`);
    console.log(`  |  #${String(p.rank).padEnd(3)} ${tierIcon.padEnd(14)} ${p.matchup}`);
    console.log(`  |  [CLK] ${hours.padEnd(14)} Grade: ${p.grade}  ${gradeBar}  (${p.score}/100)`);
    // Show base signals + top intelligence signals
    const intelSigs = ((p as any).prediction?.signals ?? [])
      .filter((s: any) => s.magnitude === 'high' || s.magnitude === 'medium')
      .slice(0, 3)
      .map((s: any) => s.type);
    const allSigNames = [...new Set([...p.signals, ...intelSigs])];
    console.log(`  |  ${allSigNames.length} signals: ${allSigNames.slice(0,5).join(', ')}`);
    console.log(`  +---------------------------------------------------------`);
    const sportEmoji = p.sport === 'NFL' ? '[NFL]'
      : p.sport === 'MLB' ? '[MLB]'
      : p.sport === 'NHL' ? '[NHL]'
      : '[NBA]';
    const teamStr = (p as any).team ? ` (${(p as any).team})` : '';
    const posStr = (p as any).position ? ` -- ${(p as any).position}` : '';
    console.log(`  |  ${sportEmoji} ${p.playerName}${teamStr}${posStr}  --  ${p.market}`);
    console.log(`  |  [OK] Bet  : ${p.side.toUpperCase()} ${p.line}`);
    const brProp = parseFloat(process.env.BANKROLL ?? '0');
    const kProp  = brProp > 0 ? `Kelly: 1.5% = $${Math.round(brProp * 0.015)}` : 'Kelly: 1-2% of bankroll';
    console.log(`  |  [$] ${kProp}`);
    console.log(`  |  [PIN] Best : ${p.bestUserBook.padEnd(10)}  ${fmtPrice(p.bestUserPrice)}`);
    if (p.altUserBook && p.altUserPrice !== null) {
      console.log(`  |  [PIN] Alt  : ${p.altUserBook.padEnd(10)}  ${fmtPrice(p.altUserPrice)}`);
    }
    if (p.lineGapAlert) {
      console.log(`  |  ? LINE GAP: ${p.lineGap} pts between books`);
    }
    console.log(`  |  [~] Consensus: ${p.consensusLine ?? 'N/A'}  |  ${p.bookCount} books  |  Edge: ${fmtPrice(p.priceDiff)}`);
    console.log(`  +---------------------------------------------------------`);
    for (const r of p.fullReasoning) console.log(`  |  ${r}`);
    // Kelly sizing
    const kelly = (p as any).prediction?.kelly;
    if (kelly?.isPositiveEV) {
      console.log(`  |  [$] KELLY: Bet ${kelly.recommendedBetPct}% of bankroll (${kelly.recommendedUnits}u) | EV: +$${kelly.evPerUnit}/100 | Edge: ${kelly.edge}%`);
    }
    console.log(`  +---------------------------------------------------------`);
  }

  if (betTier.length > 0) {
    console.log(`\n  ????????????????  [HOT] BET  (${betTier.length})  ?????????????????????????`);
    betTier.forEach(printProp);
  }
  if (leanTier.length > 0) {
    console.log(`\n  ????????????????  [OK] LEAN  (${leanTier.length})  ????????????????????????`);
    leanTier.forEach(printProp);
  }
  if (monTier.length > 0) {
    console.log(`\n  ????????????????  ? MONITOR  (${monTier.length})  ??????????????????????`);
    monTier.forEach(printProp);
  }

  console.log(`\n  Props: FanDuel + BetMGM  |  ? = line gap alert  |  Min 2 signals`);
  console.log(`  NOTE: Always verify player status before placing prop bets\n`);
}
