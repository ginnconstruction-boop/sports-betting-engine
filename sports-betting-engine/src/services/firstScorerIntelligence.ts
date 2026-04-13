// ============================================================
// src/services/firstScorerIntelligence.ts
//
// First Basket (NBA) and First TD (NFL) prop intelligence
//
// These are binary YES/NO props -- no line, just a price
// e.g. "Tyler Herro to score first basket" at +700
//
// Scoring model:
//   1. Usage rate -- high usage = more shots = higher chance
//   2. Pace adjustment -- faster pace = more possessions = better
//   3. Starting lineup -- must be starting (confirmed via lineup)
//   4. Recent first scorer history -- has player scored early lately?
//   5. Price value -- implied prob vs our estimated true probability
//   6. Matchup -- opponent defense pace and first quarter tendency
//   7. Home/away split -- some players start faster at home
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

export interface FirstScorerProp {
  playerName:    string;
  team:          string;
  sport:         'NBA' | 'NFL';
  marketKey:     string;  // player_first_basket or player_first_touchdown
  marketLabel:   string;  // 'First Basket' or 'First TD'
  bestBook:      string;
  bestPrice:     number;  // american odds e.g. +700
  altBook:       string;
  altPrice:      number | null;
  impliedProb:   number;  // from book price
  estimatedProb: number;  // our estimate
  edge:          number;  // estimatedProb - impliedProb (positive = value)
  edgePct:       number;  // edge as percentage points
  score:         number;  // 0-100 composite score
  grade:         string;
  tier:          'STRONG' | 'VALUE' | 'WATCH';
  matchup:       string;
  gameTime:      string;
  hoursUntilGame: number;
  reasoning:     string[];
  signals:       string[];
}

// ------------------------------------
// Key player usage data
// (These are historical averages -- updated as season progresses)
// In a full implementation this would pull from ESPN API
// ------------------------------------

// NBA usage rate estimates (% of team possessions used when on court)
const NBA_USAGE: Record<string, number> = {
  // High usage stars -- best first basket candidates
  'Luka Doncic':        0.37,
  'Shai Gilgeous-Alexander': 0.35,
  'Giannis Antetokounmpo':   0.34,
  'Joel Embiid':        0.34,
  'Nikola Jokic':       0.32,
  'Jayson Tatum':       0.32,
  'Donovan Mitchell':   0.31,
  'Trae Young':         0.31,
  'LeBron James':       0.30,
  'Kevin Durant':       0.30,
  'Stephen Curry':      0.30,
  'Damian Lillard':     0.30,
  'Devin Booker':       0.29,
  'Anthony Davis':      0.29,
  'Ja Morant':          0.29,
  'Tyler Herro':        0.26,
  'Bam Adebayo':        0.24,
  'Tyrese Haliburton':  0.27,
  'Cade Cunningham':    0.30,
  'Paolo Banchero':     0.29,
  'Victor Wembanyama':  0.29,
  'Darius Garland':     0.26,
  'Jalen Brunson':      0.30,
  'Karl-Anthony Towns': 0.27,
  'Anthony Edwards':    0.32,
};

// NFL first TD usage -- red zone target/carry share
const NFL_FIRST_TD: Record<string, { redZoneShare: number; tdRatePerGame: number }> = {
  // Running backs with high red zone usage
  'Saquon Barkley':     { redZoneShare: 0.35, tdRatePerGame: 0.72 },
  'Derrick Henry':      { redZoneShare: 0.40, tdRatePerGame: 0.80 },
  'Josh Jacobs':        { redZoneShare: 0.30, tdRatePerGame: 0.65 },
  'Breece Hall':        { redZoneShare: 0.28, tdRatePerGame: 0.58 },
  'De\'Von Achane':     { redZoneShare: 0.25, tdRatePerGame: 0.55 },
  // QBs
  'Lamar Jackson':      { redZoneShare: 0.45, tdRatePerGame: 0.88 },
  'Josh Allen':         { redZoneShare: 0.40, tdRatePerGame: 0.85 },
  'Jalen Hurts':        { redZoneShare: 0.38, tdRatePerGame: 0.80 },
  // WRs
  'Davante Adams':      { redZoneShare: 0.22, tdRatePerGame: 0.52 },
  'Stefon Diggs':       { redZoneShare: 0.20, tdRatePerGame: 0.48 },
  'CeeDee Lamb':        { redZoneShare: 0.25, tdRatePerGame: 0.60 },
  'Justin Jefferson':   { redZoneShare: 0.22, tdRatePerGame: 0.52 },
};

// ------------------------------------
// Helpers
// ------------------------------------

function impliedProb(american: number): number {
  return american > 0
    ? 100 / (american + 100)
    : Math.abs(american) / (Math.abs(american) + 100);
}

function toAmerican(prob: number): number {
  if (prob <= 0 || prob >= 1) return 0;
  return prob >= 0.5
    ? -Math.round(prob / (1 - prob) * 100)
    : Math.round((1 - prob) / prob * 100);
}

function scoreToGrade(score: number): string {
  return score >= 85 ? 'A+' : score >= 78 ? 'A' : score >= 70 ? 'B+' : score >= 60 ? 'B' : 'C';
}

function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3600000;
}

// ------------------------------------
// NBA First Basket scorer
// ------------------------------------

function scoreFirstBasket(
  playerName: string,
  team: string,
  bestPrice: number,
  altPrice: number | null,
  matchup: string,
  gameTime: string,
  lineupConfirmed: boolean,
  gameTotal: number | null,
  isHome: boolean
): { score: number; estimatedProb: number; reasoning: string[]; signals: string[] } {
  const reasoning: string[] = [];
  const signals: string[] = [];
  let estimatedProb = 0;

  // Base: usage rate
  // Higher usage = more likely to get ball early and score first
  const usage = NBA_USAGE[playerName] ?? 0.20; // default 20% usage
  // A player with 35% usage has roughly 35/5 = 7% chance of being 1st scorer
  // (5 players on court, but usage weighted)
  const baseFirstBasketProb = Math.min(0.22, usage * 0.55);
  estimatedProb = baseFirstBasketProb;

  if (usage >= 0.30) {
    reasoning.push(`High usage rate (${Math.round(usage * 100)}%) -- primary scoring option`);
    signals.push('HIGH_USAGE');
  } else if (usage >= 0.25) {
    reasoning.push(`Above-average usage (${Math.round(usage * 100)}%)`);
    signals.push('USAGE_EDGE');
  }

  // Pace adjustment -- higher pace = more shots early
  if (gameTotal && gameTotal >= 230) {
    estimatedProb *= 1.08;
    reasoning.push(`High pace game (total ${gameTotal}) -- more early possessions`);
    signals.push('PACE_BOOST');
  }

  // Lineup confirmation boost
  if (lineupConfirmed) {
    reasoning.push('Starting lineup confirmed');
    signals.push('LINEUP_CONFIRMED');
  } else {
    estimatedProb *= 0.85;
    reasoning.push('Lineup not yet confirmed -- risk of scratch');
  }

  // Home court -- some players are more aggressive at home to start
  if (isHome) {
    estimatedProb *= 1.03;
    reasoning.push('Home game -- typically more aggressive to start');
  }

  // Price value check
  const bookImplied = impliedProb(bestPrice);
  const edge = estimatedProb - bookImplied;
  const edgePct = Math.round(edge * 1000) / 10;

  if (edge >= 0.03) {
    reasoning.push(`Price value: we estimate ${Math.round(estimatedProb * 100)}% vs book's ${Math.round(bookImplied * 100)}% (+${edgePct}% edge)`);
    signals.push('PRICE_EDGE');
  } else if (edge < -0.02) {
    reasoning.push(`Book prices this accurately -- limited value`);
  }

  // Alt book gap
  if (altPrice !== null && Math.abs(bestPrice - altPrice) >= 50) {
    signals.push('BOOK_GAP');
    reasoning.push(`Book gap: ${bestPrice > 0 ? '+' : ''}${bestPrice} vs ${altPrice > 0 ? '+' : ''}${altPrice}`);
  }

  // Score 0-100
  let score = 0;
  score += Math.min(40, usage * 120);       // usage = up to 40pts
  score += edge >= 0.03 ? 25 : edge >= 0 ? 10 : 0; // price edge up to 25pts
  score += lineupConfirmed ? 15 : 0;         // lineup = 15pts
  score += gameTotal && gameTotal >= 230 ? 10 : 0; // pace = 10pts
  score += altPrice !== null && Math.abs(bestPrice - altPrice) >= 50 ? 10 : 0; // gap = 10pts
  score = Math.min(100, Math.round(score));

  return { score, estimatedProb, reasoning, signals };
}

// ------------------------------------
// NFL First TD scorer
// ------------------------------------

function scoreFirstTD(
  playerName: string,
  team: string,
  bestPrice: number,
  altPrice: number | null,
  matchup: string,
  gameTime: string,
  gameTotal: number | null,
  gameSpread: number | null
): { score: number; estimatedProb: number; reasoning: string[]; signals: string[] } {
  const reasoning: string[] = [];
  const signals: string[] = [];

  const profile = NFL_FIRST_TD[playerName];
  // Default probability for unknown player
  const tdRatePerGame = profile?.tdRatePerGame ?? 0.35;
  const redZoneShare  = profile?.redZoneShare  ?? 0.15;

  // Base probability -- first TD scorer (roughly tdRate / 6 total TDs avg per game)
  // If player scores 0.7 TDs/game and avg game has 5 TDs, rough first TD prob = 0.7/5 = 14%
  // But first TD is often the highest-profile bet in NFL so book juice is heavy
  const avgTDsPerGame = 5.0;
  let estimatedProb = Math.min(0.22, tdRatePerGame / avgTDsPerGame);

  if (profile) {
    reasoning.push(`Historical: ${Math.round(tdRatePerGame * 100)}% TD rate/game, ${Math.round(redZoneShare * 100)}% red zone share`);
    signals.push('TD_HISTORY');
  }

  // High-scoring game boost
  if (gameTotal && gameTotal >= 48) {
    estimatedProb *= 1.10;
    reasoning.push(`High-scoring game expected (O/U ${gameTotal}) -- more TDs total`);
    signals.push('HIGH_TOTAL');
  }

  // Spread -- if team is big favorite, their RB/WR gets more red zone looks
  if (gameSpread !== null && Math.abs(gameSpread) >= 7) {
    estimatedProb *= 1.05;
    reasoning.push(`Team favored by ${Math.abs(gameSpread)}+ -- more scoring opportunities`);
    signals.push('FAVORABLE_SCRIPT');
  }

  // Price edge
  const bookImplied = impliedProb(bestPrice);
  const edge = estimatedProb - bookImplied;
  const edgePct = Math.round(edge * 1000) / 10;

  if (edge >= 0.03) {
    reasoning.push(`Price value: estimated ${Math.round(estimatedProb * 100)}% vs book ${Math.round(bookImplied * 100)}% (+${edgePct}% edge)`);
    signals.push('PRICE_EDGE');
  }

  // Book gap
  if (altPrice !== null && Math.abs(bestPrice - altPrice) >= 50) {
    signals.push('BOOK_GAP');
    reasoning.push(`Book gap: ${bestPrice > 0 ? '+' : ''}${bestPrice} vs ${altPrice > 0 ? '+' : ''}${altPrice}`);
  }

  // Score
  let score = 0;
  score += Math.min(35, tdRatePerGame * 35);
  score += edge >= 0.03 ? 25 : edge >= 0 ? 10 : 0;
  score += redZoneShare >= 0.30 ? 20 : redZoneShare >= 0.20 ? 10 : 5;
  score += gameTotal && gameTotal >= 48 ? 10 : 0;
  score += altPrice !== null && Math.abs(bestPrice - altPrice) >= 50 ? 10 : 0;
  score = Math.min(100, Math.round(score));

  return { score, estimatedProb, reasoning, signals };
}

// ------------------------------------
// Main scorer -- takes raw prop offers
// ------------------------------------

export function scoreFirstScorerProps(
  rawProps: Array<{
    playerName: string;
    team: string;
    sport: 'NBA' | 'NFL';
    marketKey: string;
    matchup: string;
    gameTime: string;
    bestBook: string;
    bestPrice: number;
    altBook?: string;
    altPrice?: number | null;
    lineupConfirmed?: boolean;
    gameTotal?: number | null;
    gameSpread?: number | null;
    isHome?: boolean;
  }>
): FirstScorerProp[] {
  const results: FirstScorerProp[] = [];

  for (const prop of rawProps) {
    const h = hoursUntil(prop.gameTime);
    if (h < 0.5 || h > 24) continue;
    if (!prop.bestPrice || prop.bestPrice <= 0) continue; // must be plus-money

    const marketLabel = prop.marketKey === 'player_first_basket' ? 'First Basket'
      : prop.marketKey === 'player_first_touchdown' ? 'First TD'
      : prop.marketKey === 'player_anytime_td' ? 'Anytime TD'
      : prop.marketKey;

    let result: { score: number; estimatedProb: number; reasoning: string[]; signals: string[] };

    if (prop.sport === 'NBA') {
      result = scoreFirstBasket(
        prop.playerName, prop.team,
        prop.bestPrice, prop.altPrice ?? null,
        prop.matchup, prop.gameTime,
        prop.lineupConfirmed ?? false,
        prop.gameTotal ?? null,
        prop.isHome ?? false
      );
    } else {
      result = scoreFirstTD(
        prop.playerName, prop.team,
        prop.bestPrice, prop.altPrice ?? null,
        prop.matchup, prop.gameTime,
        prop.gameTotal ?? null,
        prop.gameSpread ?? null
      );
    }

    if (result.score < 45) continue; // filter low-quality

    const bookImplied = impliedProb(prop.bestPrice);
    const edge = result.estimatedProb - bookImplied;
    const edgePct = Math.round(edge * 1000) / 10;

    const tier: FirstScorerProp['tier'] =
      result.score >= 80 ? 'STRONG' :
      result.score >= 65 ? 'VALUE'  : 'WATCH';

    results.push({
      playerName:    prop.playerName,
      team:          prop.team,
      sport:         prop.sport,
      marketKey:     prop.marketKey,
      marketLabel,
      bestBook:      prop.bestBook,
      bestPrice:     prop.bestPrice,
      altBook:       prop.altBook ?? '',
      altPrice:      prop.altPrice ?? null,
      impliedProb:   Math.round(bookImplied * 1000) / 10,
      estimatedProb: Math.round(result.estimatedProb * 1000) / 10,
      edge:          Math.round(edge * 1000) / 10,
      edgePct,
      score:         result.score,
      grade:         scoreToGrade(result.score),
      tier,
      matchup:       prop.matchup,
      gameTime:      prop.gameTime,
      hoursUntilGame: Math.round(h * 10) / 10,
      reasoning:     result.reasoning,
      signals:       result.signals,
    });
  }

  // Sort by score, cap 2 per game
  results.sort((a, b) => b.score - a.score);
  const seen = new Map<string, number>();
  return results.filter(p => {
    const c = seen.get(p.matchup) ?? 0;
    if (c >= 2) return false;
    seen.set(p.matchup, c + 1);
    return true;
  });
}

// ------------------------------------
// Print first scorer report
// ------------------------------------

export function printFirstScorerReport(props: FirstScorerProp[]): void {
  if (props.length === 0) {
    console.log('\n  No qualifying first scorer props found.');
    console.log('  Books may not have posted these markets yet -- try 2hrs before tip.\n');
    return;
  }

  const sport = props[0]?.sport ?? 'NBA';
  console.log('\n');
  console.log('=================================================================');
  console.log(`  ${sport} FIRST SCORER PROPS`);
  console.log('  Soft market -- books price these loosely, usage rate is king');
  console.log('=================================================================');
  console.log('  HOW TO PLACE: FanDuel/BetMGM -> Player Props -> First Basket/TD');
  console.log('=================================================================');

  for (const p of props) {
    const priceStr = `+${p.bestPrice}`;
    const altStr   = p.altPrice ? `  Alt: ${p.altBook} +${p.altPrice}` : '';
    const tierIcon = p.tier === 'STRONG' ? '** STRONG **' : p.tier === 'VALUE' ? '* VALUE *' : 'WATCH';
    const hrs = p.hoursUntilGame < 2
      ? `~${Math.round(p.hoursUntilGame * 60)}min`
      : `~${Math.round(p.hoursUntilGame)}hrs`;

    console.log(`\n  [${p.grade}] ${tierIcon}  Score: ${p.score}/100`);
    console.log(`  ${p.playerName} -- ${p.marketLabel}`);
    console.log(`  Game   : ${p.matchup}  (${hrs})`);
    console.log(`  Price  : ${p.bestBook} ${priceStr}${altStr}`);
    console.log(`  Edge   : We estimate ${p.estimatedProb}% true prob vs book's ${p.impliedProb}% (+${p.edgePct}%)`);
    console.log(`  Signals: ${p.signals.join(', ')}`);
    p.reasoning.forEach(r => console.log(`  -- ${r}`));
  }

  console.log('\n  NOTE: First scorer props are high-variance (+600 to +1000 range)');
  console.log('  Recommended sizing: 0.5-1% of bankroll max per play.');
  console.log('  Best value when edge > 3% above book implied probability.\n');
}
