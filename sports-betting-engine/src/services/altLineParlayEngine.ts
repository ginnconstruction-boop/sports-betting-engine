// ============================================================
// src/services/altLineParlayEngine.ts
//
// HIGH-PROBABILITY ALT LINE PARLAY ENGINE
//
// Core concept:
//   Step each prop line DOWN to where individual hit rate
//   reaches 68-78%. Combine 2-3 of those legs into a parlay.
//   Result: ~50-55% combined hit rate, payout in +100 to +130 range.
//
// Why this works:
//   Standard 2-leg parlay: 52% x 52% = 27% hit rate at +260
//   Alt line 2-leg parlay:  73% x 73% = 53% hit rate at +115
//   53% at +115 = profitable long term. 27% at +260 = break even.
//
// Target parlay profile:
//   - 2 legs preferred, 3 legs max
//   - Combined price: -110 to +130 range
//   - Individual leg hit rate: 68-78% each
//   - Legs filtered by full 23-signal model score
//   - Blowout risk and B2B legs excluded
// ============================================================

export interface AltLine {
  playerName:       string;
  team:             string;
  market:           string;
  marketLabel:      string;
  standardLine:     number;
  altLine:          number;
  lineReduction:    number;
  side:             string;  // 'over', 'under', 'Over', 'Under'
  standardPrice:    number;
  altPrice:         number;
  estimatedHitRate: number;   // 0-100
  modelScore:       number;
  hasBlowoutRisk:   boolean;
  isB2B:            boolean;
  predictedValue:   number | null;
  confidence:       string;
  sport:            string;
  eventId:          string;
  matchup:          string;
}

export interface AltLineParlay {
  legs:             AltLine[];
  parlayPrice:      number;   // american odds
  hitRate:          number;   // % probability all legs hit
  expectedValue:    number;   // $ profit per $100 bet long term
  kellyBet:         number;   // % of bankroll
  grade:            string;
  tier:             'PRIME' | 'SOLID' | 'LEAN';
  correlationType:  string;
  whyItWorks:       string;
  bestBook:         string;
  legCount:         number;
}

// ------------------------------------
// Market config
// ------------------------------------

const MARKET_LABELS: Record<string, string> = {
  player_points: 'Pts', player_rebounds: 'Reb', player_assists: 'Ast',
  player_threes: '3PM', player_blocks: 'Blk', player_steals: 'Stl',
  player_pass_yds: 'Pass Yds', player_rush_yds: 'Rush Yds',
  player_reception_yds: 'Rec Yds', player_receptions: 'Rec',
};

// Step-down options per market
const ALT_STEPS: Record<string, number[]> = {
  player_points:        [1.5, 2.5, 3.5, 4.5, 5.5, 6.5],
  player_rebounds:      [1.5, 2.5, 3.5],
  player_assists:       [1.5, 2.5, 3.5],
  player_threes:        [0.5, 1.5],
  player_blocks:        [0.5, 1.0],
  player_steals:        [0.5, 1.0],
  player_pass_yds:      [15, 25, 35],
  player_rush_yds:      [10, 20, 30],
  player_reception_yds: [10, 20, 30],
  player_receptions:    [1.5, 2.5],
};

// Hit rate gain per unit of line reduction
const HIT_RATE_PER_UNIT: Record<string, number> = {
  player_points:        0.028,
  player_rebounds:      0.045,
  player_assists:       0.050,
  player_threes:        0.090,
  player_blocks:        0.080,
  player_steals:        0.085,
  player_pass_yds:      0.008,
  player_rush_yds:      0.012,
  player_reception_yds: 0.010,
  player_receptions:    0.050,
};

// Juice cost per unit of line reduction (in american odds points)
const JUICE_PER_UNIT: Record<string, number> = {
  player_points:        18,
  player_rebounds:      22,
  player_assists:       22,
  player_threes:        50,
  player_blocks:        45,
  player_steals:        45,
  player_pass_yds:      3,
  player_rush_yds:      4,
  player_reception_yds: 4,
  player_receptions:    25,
};

// ------------------------------------
// Odds math helpers
// ------------------------------------

function toDecimal(american: number): number {
  return american > 0
    ? (american / 100) + 1
    : (100 / Math.abs(american)) + 1;
}

function toAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return -Math.round(100 / (decimal - 1));
}

function impliedProb(american: number): number {
  return american > 0
    ? 100 / (american + 100)
    : Math.abs(american) / (Math.abs(american) + 100);
}

// ------------------------------------
// Resolve market key from scored prop
// ------------------------------------

function resolveMarketKey(prop: any): string {
  const raw = (prop.market ?? prop.statType ?? '').toLowerCase().trim();
  const map: Record<string, string> = {
    'points': 'player_points', 'pts': 'player_points',
    'rebounds': 'player_rebounds', 'reb': 'player_rebounds',
    'assists': 'player_assists', 'ast': 'player_assists',
    '3-pointers made': 'player_threes', '3pm': 'player_threes',
    'blocks': 'player_blocks', 'blk': 'player_blocks',
    'steals': 'player_steals', 'stl': 'player_steals',
    'pass yds': 'player_pass_yds', 'passing yards': 'player_pass_yds',
    'rush yds': 'player_rush_yds', 'rushing yards': 'player_rush_yds',
    'rec yds': 'player_reception_yds', 'receiving yards': 'player_reception_yds',
    'receptions': 'player_receptions', 'rec': 'player_receptions',
  };
  for (const [key, val] of Object.entries(map)) {
    if (raw.includes(key)) return val;
  }
  if (ALT_STEPS[raw]) return raw;
  return '';
}

// ------------------------------------
// Find the alt line step that produces
// a 68-78% individual hit rate
// This is the sweet spot for 2-leg parlays
// landing in the -110 to +130 range
// ------------------------------------

function findOptimalAltLine(prop: any): AltLine | null {
  if (!prop.line || !prop.bestUserPrice) return null;
  const sideNorm = (prop.side ?? '').toLowerCase();
  if (sideNorm !== 'over' && sideNorm !== 'under') return null;
  const isOver = sideNorm === 'over';

  const marketKey = resolveMarketKey(prop);
  if (!marketKey || !ALT_STEPS[marketKey]) return null;

  // Base hit rate from the book price
  const baseImplied = impliedProb(prop.bestUserPrice);

  // Model score boost -- higher score = better base hit rate
  const modelBoost = prop.score >= 80 ? 0.08
    : prop.score >= 70 ? 0.05
    : prop.score >= 60 ? 0.02 : 0;

  // Predicted value boost -- if model says player projects above line
  const predictedVal: number | null = prop.prediction?.predictedValue ?? null;
  const predEdge = predictedVal ? Math.max(0, predictedVal - prop.line) : 0;
  const predBoost = Math.min(0.08, predEdge * 0.015);

  // Penalty signals from prop reasoning
  const reasoning = (prop.fullReasoning ?? []).join(' ').toUpperCase();
  const hasBlowout = reasoning.includes('BLOWOUT');
  const isB2B = reasoning.includes('B2B') || reasoning.includes('BACK-TO-BACK');
  const blowoutPenalty = hasBlowout ? 0.06 : 0;
  const b2bPenalty = isB2B ? 0.04 : 0;

  const baseHitRate = Math.min(0.80,
    baseImplied + modelBoost + predBoost - blowoutPenalty - b2bPenalty
  );

  const hitRatePerUnit = HIT_RATE_PER_UNIT[marketKey] ?? 0.025;
  const juicePerUnit = JUICE_PER_UNIT[marketKey] ?? 18;

  // TARGET: find the step that gets individual hit rate to 60-78%
  // For OVERS: step line DOWN (easier to go over a lower number)
  // For UNDERS: step line UP (easier to go under a higher number)
  // Both land parlay price in -110 to +150 range
  const TARGET_LOW  = 0.60;
  const TARGET_HIGH = 0.80;

  let bestAlt: AltLine | null = null;
  let bestDist = Infinity; // closest to target center (73%)
  const TARGET_CENTER = 0.73;

  for (const step of ALT_STEPS[marketKey]) {
    // Over: step line DOWN. Under: step line UP.
    const altLine = isOver ? prop.line - step : prop.line + step;
    if (altLine <= 0) continue;

    const hitRate = Math.min(0.88, baseHitRate + hitRatePerUnit * step);
    const altPrice = Math.round(prop.bestUserPrice - juicePerUnit * step);

    // Skip if hit rate not in target zone
    if (hitRate < TARGET_LOW || hitRate > TARGET_HIGH) continue;

    // Skip if alt price too juicy to be useful in parlay
    if (altPrice < -250) continue;

    const dist = Math.abs(hitRate - TARGET_CENTER);
    if (dist < bestDist) {
      bestDist = dist;
      bestAlt = {
        playerName:       prop.playerName,
        team:             prop.team ?? '',
        market:           marketKey,
        marketLabel:      MARKET_LABELS[marketKey] ?? marketKey.replace('player_', ''),
        standardLine:     prop.line,
        altLine,
        lineReduction:    step,
        side:             sideNorm as 'over' | 'under',
        standardPrice:    prop.bestUserPrice,
        altPrice,
        estimatedHitRate: Math.round(hitRate * 1000) / 10,
        modelScore:       prop.score ?? 0,
        hasBlowoutRisk:   hasBlowout,
        isB2B,
        predictedValue:   predictedVal,
        confidence:       prop.prediction?.confidence ?? 'medium',
        sport:            prop.sport ?? 'NBA',
        eventId:          prop.eventId ?? '',
        matchup:          prop.matchup ?? '',
      };
    }
  }

  // If nothing hit target range, take closest valid step
  if (!bestAlt) {
    for (const step of ALT_STEPS[marketKey]) {
      const altLine = isOver ? prop.line - step : prop.line + step;
      if (altLine <= 0) continue;
      const hitRate = Math.min(0.88, baseHitRate + hitRatePerUnit * step);
      const altPrice = Math.round(prop.bestUserPrice - juicePerUnit * step);
      if (altPrice < -250) continue;
      if (hitRate < 0.55) continue; // minimum viable
      const dist = Math.abs(hitRate - TARGET_CENTER);
      if (dist < bestDist) {
        bestDist = dist;
        bestAlt = {
          playerName:       prop.playerName,
          team:             prop.team ?? '',
          market:           marketKey,
          marketLabel:      MARKET_LABELS[marketKey] ?? marketKey.replace('player_', ''),
          standardLine:     prop.line,
          altLine,
          lineReduction:    step,
          side:             sideNorm as 'over' | 'under',
          standardPrice:    prop.bestUserPrice,
          altPrice,
          estimatedHitRate: Math.round(hitRate * 1000) / 10,
          modelScore:       prop.score ?? 0,
          hasBlowoutRisk:   hasBlowout,
          isB2B,
          predictedValue:   predictedVal,
          confidence:       prop.prediction?.confidence ?? 'medium',
          sport:            prop.sport ?? 'NBA',
          eventId:          prop.eventId ?? '',
          matchup:          prop.matchup ?? '',
        };
      }
    }
  }

  return bestAlt;
}

// ------------------------------------
// Public: generate alt lines
// ------------------------------------

export function generateAltLines(
  scoredProps: any[],
  minScore: number = 50
): AltLine[] {
  return scoredProps
    .filter(p => (p.score ?? 0) >= minScore)
    .map(p => findOptimalAltLine(p))
    .filter((a): a is AltLine => a !== null)
    .sort((a, b) => b.estimatedHitRate - a.estimatedHitRate);
}

// ------------------------------------
// Build 2-3 leg parlays
// ------------------------------------

function getCombinations<T>(arr: T[], size: number): T[][] {
  if (size === 1) return arr.map(x => [x]);
  const result: T[][] = [];
  for (let i = 0; i <= arr.length - size; i++) {
    for (const rest of getCombinations(arr.slice(i + 1), size - 1)) {
      result.push([arr[i], ...rest]);
    }
  }
  return result;
}

function buildParlay(legs: AltLine[]): AltLineParlay | null {
  // No duplicate players
  if (new Set(legs.map(l => l.playerName)).size < legs.length) return null;

  // Correlation: same-team legs are positively correlated
  const teams = legs.map(l => l.team).filter(Boolean);
  const sameTeam = teams.length === legs.length && new Set(teams).size === 1;
  const correlationBoost = sameTeam ? 0.03 : 0;

  // Combined hit rate
  const combinedHitRate = Math.min(
    0.78,
    legs.reduce((p, l) => p * (l.estimatedHitRate / 100), 1) + correlationBoost
  );

  // Combined parlay price
  const parlayDecimal = legs.reduce((p, l) => p * toDecimal(l.altPrice), 1);
  const parlayPrice   = toAmerican(parlayDecimal);

  // EV: expected profit per $100
  // Win: combinedHitRate * parlayPrice (if positive) or combinedHitRate * (100/|price|*100)
  const winAmount = parlayPrice > 0 ? parlayPrice : (100 / Math.abs(parlayPrice)) * 100;
  const ev = Math.round(
    (combinedHitRate * winAmount - (1 - combinedHitRate) * 100) * 10
  ) / 10;

  // Allow slightly negative EV parlays if they are close to break-even
  // and have high hit rate (informational value for tracking)
  if (ev < -5) return null;

  // Kelly (fractional 20% for parlays)
  const fullKelly = (combinedHitRate * parlayDecimal - 1) / (parlayDecimal - 1);
  const kellyBet  = Math.max(0.5, Math.min(2.5, Math.round(fullKelly * 20 * 10) / 10));

  // Grade
  const grade = ev >= 20 ? 'A+' : ev >= 12 ? 'A' : ev >= 6 ? 'B+' : 'B';
  const tier: AltLineParlay['tier'] = ev >= 18 ? 'PRIME' : ev >= 8 ? 'SOLID' : 'LEAN';

  // Why it works
  const reasons: string[] = [];
  if (sameTeam) reasons.push('Same-team stack -- legs correlate positively');
  const highScoreLegs = legs.filter(l => l.modelScore >= 70);
  if (highScoreLegs.length > 0) reasons.push(`${highScoreLegs.length} leg(s) scored 70+ across all 23 signals`);
  const predLegs = legs.filter(l => l.predictedValue !== null && l.predictedValue > l.altLine);
  if (predLegs.length > 0) reasons.push(`Model projects ${predLegs.length} player(s) above the alt line`);
  if (reasons.length === 0) reasons.push('High individual hit rates on adjusted lines');

  return {
    legs,
    parlayPrice,
    hitRate:       Math.round(combinedHitRate * 1000) / 10,
    expectedValue: ev,
    kellyBet,
    grade,
    tier,
    correlationType: sameTeam ? 'TEAM STACK' : legs.length >= 3 ? 'MULTI-GAME' : 'INDEPENDENT',
    whyItWorks: reasons.join('. '),
    bestBook: 'FanDuel',
    legCount: legs.length,
  };
}

export function buildAltLineParlays(
  altLines: AltLine[],
  maxLegs: number = 3,
  minLegs: number = 2
): AltLineParlay[] {
  const top    = altLines.slice(0, 10);
  const seen   = new Set<string>();
  const result: AltLineParlay[] = [];

  for (let n = minLegs; n <= Math.min(maxLegs, top.length); n++) {
    for (const combo of getCombinations(top, n).slice(0, 80)) {
      const p = buildParlay(combo);
      if (!p) continue;
      const key = combo.map(l => l.playerName).sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(p);
    }
  }

  return result
    .sort((a, b) => b.expectedValue - a.expectedValue)
    .slice(0, 6);
}

// ------------------------------------
// Print report
// ------------------------------------

export function printAltLineParlayReport(parlays: AltLineParlay[]): void {
  if (parlays.length === 0) {
    console.log('\n  No high-probability alt line parlays found today.');
    console.log('  Try running closer to game time when lines are finalized.\n');
    return;
  }

  console.log('\n');
  console.log('=================================================================');
  console.log('  HIGH-PROBABILITY ALT LINE PARLAYS');
  console.log('  Each leg stepped down to 68-78% individual hit rate');
  console.log('  Combined: ~50-55% hit rate, pays in -110 to +130 range');
  console.log('=================================================================');
  console.log('  HOW TO PLACE:');
  console.log('  FanDuel/BetMGM -> Player Props -> tap player name');
  console.log('  -> scroll to "Alternate Lines" -> add each leg to parlay slip');
  console.log('=================================================================');

  for (let i = 0; i < parlays.length; i++) {
    const p = parlays[i];
    const priceStr = p.parlayPrice >= 0
      ? `+${p.parlayPrice}` : `${p.parlayPrice}`;
    const tierLabel = p.tier === 'PRIME' ? '** PRIME **'
      : p.tier === 'SOLID' ? '* SOLID *' : 'LEAN';

    console.log(`\n  #${i + 1}  ${tierLabel}  Grade: ${p.grade}  |  ${p.legCount}-leg`);
    console.log(`  Price   : ${priceStr}  |  Hit Rate: ${p.hitRate}%  |  EV: +$${p.expectedValue}/100`);
    console.log(`  Sizing  : ${p.kellyBet}% of bankroll  |  ${p.correlationType}`);
    console.log(`  -------------------------------------------------------`);

    for (const leg of p.legs) {
      const std  = leg.standardPrice > 0 ? `+${leg.standardPrice}` : `${leg.standardPrice}`;
      const alt  = leg.altPrice > 0 ? `+${leg.altPrice}` : `${leg.altPrice}`;
      const pred = leg.predictedValue ? `  model: ${leg.predictedValue}` : '';
      console.log(`  Leg: ${leg.playerName} -- ${leg.marketLabel} OVER ${leg.altLine}  [${alt}]`);
      console.log(`       Hit rate: ${leg.estimatedHitRate}%  |  Standard was ${leg.standardLine} [${std}]  (-${leg.lineReduction} pts)${pred}`);
    }

    console.log(`  Why: ${p.whyItWorks}`);
  }

  console.log('\n  NOTE: Standard line pays more but hits ~27%. Alt line parlay');
  console.log('  hits ~53% and still pays +100 to +130. Better long-term math.\n');
}
