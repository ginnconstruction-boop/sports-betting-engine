// ============================================================
// src/services/teaserEngine.ts
// NFL Teaser Engine -- 6, 6.5, and 7 point teasers
// Key numbers: crossing 3 and 7 dramatically increases win rate
// Strategy: only recommend legs that cross at least one key number
// 2-team teasers only (best value, cleanest math)
// ============================================================

export interface TeaserLeg {
  matchup: string;
  gameTime: string;
  sport: string;
  betType: 'Spread' | 'Total';
  originalSide: string;         // e.g. "Cowboys -7"
  originalLine: number;
  teasedLine: number;           // after applying teaser points
  teaserPoints: number;
  direction: 'with' | 'against'; // spread: with=adding pts, Total: over=subtract/under=add
  crossesKeyNumbers: number[];   // which key numbers this crosses (3, 7)
  keyNumberCount: number;
  grade: 'A+' | 'A' | 'B' | 'C';
  score: number;                 // 0-100
  eventId: string;
  sport_key: string;
  matchupScore: number;          // base game score from topTenBets
  signals: string[];
  reasoning: string;
}

export interface TeaserCombination {
  legs: TeaserLeg[];
  teaserPoints: number;
  combinedGrade: string;
  combinedScore: number;
  parlayOdds: number;           // approximate american odds for 2-team teaser
  reasoning: string;
  keyNumberCrossings: number;   // total key number crossings across all legs
}

// NFL key numbers -- these are the most common margins of victory
// Crossing these via teaser dramatically increases probability of covering
const KEY_NUMBERS = [3, 7];
const SECONDARY_KEY_NUMBERS = [1, 2.5, 4, 6, 10];

// Standard teaser sizes
export const TEASER_SIZES = [6, 6.5, 7] as const;
export type TeaserSize = typeof TEASER_SIZES[number];

// Approximate 2-team teaser payouts (american odds) at -110 standard
// These vary by book -- using conservative estimates
const TEASER_ODDS: Record<TeaserSize, number> = {
  6:   -120,
  6.5: -130,
  7:   -140,
};

// Win probability boost from crossing key numbers
// Based on historical NFL margin-of-victory data
function keyNumberBoost(original: number, teased: number, direction: 'spread' | 'total_over' | 'total_under'): number {
  let boost = 0;
  const lo = Math.min(original, teased);
  const hi = Math.max(original, teased);

  for (const kn of KEY_NUMBERS) {
    if (kn > lo && kn <= hi) {
      boost += 12; // primary key number crossing = significant boost
    }
  }
  for (const kn of SECONDARY_KEY_NUMBERS) {
    if (kn > lo && kn <= hi) {
      boost += 4; // secondary key number crossing = modest boost
    }
  }
  return boost;
}

function crossedKeyNumbers(original: number, teased: number): number[] {
  const lo = Math.min(original, teased);
  const hi = Math.max(original, teased);
  return KEY_NUMBERS.filter(kn => kn > lo && kn <= hi);
}

// ── Score a single teaser leg ──────────────────────────────

export function scoreTeaserLeg(
  eventId: string,
  matchup: string,
  gameTime: string,
  sportKey: string,
  betType: 'Spread' | 'Total',
  originalSide: string,
  originalLine: number,
  teaserPoints: TeaserSize,
  matchupScore: number,
  signals: string[]
): TeaserLeg | null {
  // Only NFL for teasers (NBA teasers have terrible value)
  if (!sportKey.includes('nfl') && !sportKey.includes('football')) return null;

  // Spreads: teaser adds points to your team (dogs get better, favs get worse but still cross)
  // Totals: teaser moves the number in your favor (over gets lower line, under gets higher)
  let teasedLine: number;
  let direction: TeaserLeg['direction'];

  if (betType === 'Spread') {
    // Teasing a spread: always add points to favor of the bettor
    // Favorite (negative line): -7 becomes -1 with 6pt teaser
    // Dog (positive line): +1 becomes +7 with 6pt teaser
    teasedLine = Math.round((originalLine + teaserPoints) * 2) / 2;
    direction = 'with';
  } else {
    // Total: can tease over down or under up -- must specify
    // We score both and pick the best
    // For this leg, we check the "under" direction (adds points = more margin)
    teasedLine = Math.round((originalLine + teaserPoints) * 2) / 2;
    direction = 'with';
  }

  const crossed = crossedKeyNumbers(originalLine, teasedLine);
  const boost = keyNumberBoost(originalLine, teasedLine, 'spread');

  if (crossed.length === 0) return null; // no key number crossing = no value

  // Base score from game quality
  let score = Math.min(matchupScore, 80); // cap game score contribution

  // Key number bonus
  score += boost;

  // Bonus if original line was AT a key number (extra sticky number benefit)
  if (KEY_NUMBERS.includes(Math.abs(originalLine))) score += 8;
  if (KEY_NUMBERS.includes(Math.abs(teasedLine))) score += 5;

  // Penalty for low-quality base game
  if (matchupScore < 60) score -= 15;
  if (matchupScore < 50) score -= 10;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const grade: TeaserLeg['grade'] =
    score >= 85 ? 'A+' :
    score >= 75 ? 'A'  :
    score >= 60 ? 'B'  : 'C';

  const keyStr = crossed.length > 0
    ? `crosses key number${crossed.length > 1 ? 's' : ''} ${crossed.join(' and ')}`
    : 'no key number crossing';

  const reasoning =
    `${originalSide} (${originalLine > 0 ? '+' : ''}${originalLine}) teased to ` +
    `${teasedLine > 0 ? '+' : ''}${teasedLine} -- ${keyStr}`;

  return {
    matchup,
    gameTime,
    sport: sportKey.includes('nfl') ? 'NFL' : 'NCAAF',
    betType,
    originalSide,
    originalLine,
    teasedLine,
    teaserPoints,
    direction,
    crossesKeyNumbers: crossed,
    keyNumberCount: crossed.length,
    grade,
    score,
    eventId,
    sport_key: sportKey,
    matchupScore,
    signals,
    reasoning,
  };
}

// ── Build all valid teaser legs from game summaries ─────────

export function buildTeaserLegs(
  events: Array<{
    eventId: string;
    matchup: string;
    gameTime: string;
    sportKey: string;
    spreadLine: number | null;       // home team spread (negative = home fav)
    totalLine: number | null;
    homeTeam: string;
    awayTeam: string;
    score: number;                   // game quality score
    signals: string[];
  }>,
  teaserSize: TeaserSize
): TeaserLeg[] {
  const legs: TeaserLeg[] = [];

  for (const event of events) {
    if (!event.sportKey.includes('nfl') && !event.sportKey.includes('football')) continue;

    // Spread legs -- both home and away
    if (event.spreadLine !== null && !isNaN(event.spreadLine)) {
      const homeSpread = event.spreadLine;
      const awaySpread = -event.spreadLine;

      // Home spread leg
      const homeLeg = scoreTeaserLeg(
        event.eventId, event.matchup, event.gameTime, event.sportKey,
        'Spread', `${event.homeTeam} ${homeSpread > 0 ? '+' : ''}${homeSpread}`,
        homeSpread, teaserSize, event.score, event.signals
      );
      if (homeLeg) legs.push(homeLeg);

      // Away spread leg
      const awayLeg = scoreTeaserLeg(
        event.eventId, event.matchup, event.gameTime, event.sportKey,
        'Spread', `${event.awayTeam} ${awaySpread > 0 ? '+' : ''}${awaySpread}`,
        awaySpread, teaserSize, event.score, event.signals
      );
      if (awayLeg) legs.push(awayLeg);
    }

    // Total legs -- over teased down, under teased up
    if (event.totalLine !== null && !isNaN(event.totalLine)) {
      // Under: add teaser points (e.g. Under 44 becomes Under 50 with 6pt teaser)
      const underTeasedLine = Math.round((event.totalLine + teaserSize) * 2) / 2;
      const underCrossed = crossedKeyNumbers(event.totalLine, underTeasedLine);
      if (underCrossed.length > 0) {
        const boost = keyNumberBoost(event.totalLine, underTeasedLine, 'total_under');
        const score = Math.min(100, Math.round(Math.min(event.score, 80) + boost));
        if (score >= 50) {
          legs.push({
            matchup: event.matchup,
            gameTime: event.gameTime,
            sport: 'NFL',
            betType: 'Total',
            originalSide: `Under ${event.totalLine}`,
            originalLine: event.totalLine,
            teasedLine: underTeasedLine,
            teaserPoints: teaserSize,
            direction: 'with',
            crossesKeyNumbers: underCrossed,
            keyNumberCount: underCrossed.length,
            grade: score >= 85 ? 'A+' : score >= 75 ? 'A' : score >= 60 ? 'B' : 'C',
            score,
            eventId: event.eventId,
            sport_key: event.sportKey,
            matchupScore: event.score,
            signals: event.signals,
            reasoning: `Under ${event.totalLine} teased to Under ${underTeasedLine} -- crosses key number${underCrossed.length > 1 ? 's' : ''} ${underCrossed.join(' and ')}`,
          });
        }
      }

      // Over: subtract teaser points (e.g. Over 48 becomes Over 42 with 6pt teaser)
      const overTeasedLine = Math.round((event.totalLine - teaserSize) * 2) / 2;
      const overCrossed = crossedKeyNumbers(overTeasedLine, event.totalLine);
      if (overCrossed.length > 0) {
        const boost = keyNumberBoost(overTeasedLine, event.totalLine, 'total_over');
        const score = Math.min(100, Math.round(Math.min(event.score, 80) + boost));
        if (score >= 50) {
          legs.push({
            matchup: event.matchup,
            gameTime: event.gameTime,
            sport: 'NFL',
            betType: 'Total',
            originalSide: `Over ${event.totalLine}`,
            originalLine: event.totalLine,
            teasedLine: overTeasedLine,
            teaserPoints: teaserSize,
            direction: 'against',
            crossesKeyNumbers: overCrossed,
            keyNumberCount: overCrossed.length,
            grade: score >= 85 ? 'A+' : score >= 75 ? 'A' : score >= 60 ? 'B' : 'C',
            score,
            eventId: event.eventId,
            sport_key: event.sportKey,
            matchupScore: event.score,
            signals: event.signals,
            reasoning: `Over ${event.totalLine} teased to Over ${overTeasedLine} -- crosses key number${overCrossed.length > 1 ? 's' : ''} ${overCrossed.join(' and ')}`,
          });
        }
      }
    }
  }

  return legs.sort((a, b) => b.score - a.score);
}

// ── Combine legs into 2-team teasers ────────────────────────
// Rule: can't use two legs from the same game

export function buildTeaserCombinations(
  legs: TeaserLeg[],
  teaserSize: TeaserSize,
  maxCombos: number = 5
): TeaserCombination[] {
  const combos: TeaserCombination[] = [];
  const topLegs = legs.slice(0, 10); // only combine top 10 legs

  for (let i = 0; i < topLegs.length; i++) {
    for (let j = i + 1; j < topLegs.length; j++) {
      const legA = topLegs[i];
      const legB = topLegs[j];

      // No two legs from the same game
      if (legA.eventId === legB.eventId) continue;

      // Both legs must cross at least one key number
      if (legA.keyNumberCount === 0 || legB.keyNumberCount === 0) continue;

      const combinedScore = Math.round((legA.score + legB.score) / 2);
      const totalCrossings = legA.keyNumberCount + legB.keyNumberCount;
      const parlayOdds = TEASER_ODDS[teaserSize];

      const grade =
        combinedScore >= 85 && totalCrossings >= 3 ? 'A+' :
        combinedScore >= 78 && totalCrossings >= 2 ? 'A'  :
        combinedScore >= 65 ? 'B+' : 'B';

      combos.push({
        legs: [legA, legB],
        teaserPoints: teaserSize,
        combinedGrade: grade,
        combinedScore,
        parlayOdds,
        reasoning: `${legA.reasoning} | ${legB.reasoning}`,
        keyNumberCrossings: totalCrossings,
      });
    }
  }

  return combos
    .sort((a, b) => b.combinedScore - a.combinedScore || b.keyNumberCrossings - a.keyNumberCrossings)
    .slice(0, maxCombos);
}

// ── Print teaser report ──────────────────────────────────────

export function printTeaserReport(
  allCombos: Array<{ size: TeaserSize; combos: TeaserCombination[] }>
): void {
  const time = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  console.log('\n');
  console.log('+==============================================================+');
  console.log('|            NFL TEASER ENGINE -- KEY NUMBER CROSSINGS          |');
  console.log(`|  ${time.padEnd(60)}|`);
  console.log('|  2-team teasers only  |  Must cross 3 or 7 to qualify        |');
  console.log('+==============================================================+');

  const hasAnyCombos = allCombos.some(({ combos }) => combos.length > 0);
  if (!hasAnyCombos) {
    console.log('\n  No qualifying teaser combinations found.');
    console.log('  Requirements: NFL games with spreads crossing 3 or 7 after teaser adjustment.');
    console.log('  Best results: run Sunday morning when full NFL slate is posted.\n');
    return;
  }

  for (const { size, combos } of allCombos) {
    if (combos.length === 0) continue;

    console.log(`\n  ================================================================`);
    console.log(`  ${size}-POINT TEASERS  (approx ${TEASER_ODDS[size] > 0 ? '+' : ''}${TEASER_ODDS[size]} per 2-team)`);
    console.log(`  ================================================================`);

    combos.forEach((combo, idx) => {
      const gradeBar =
        combo.combinedGrade === 'A+' ? '[##########]' :
        combo.combinedGrade === 'A'  ? '[#########-]' :
        combo.combinedGrade === 'B+' ? '[#######---]' : '[######----]';

      console.log(`\n  +-----------------------------------------------------------`);
      console.log(`  |  TEASER #${idx + 1}  Grade: ${combo.combinedGrade}  ${gradeBar}  (${combo.combinedScore}/100)`);
      console.log(`  |  ${combo.keyNumberCrossings} key number crossing(s)  |  Approx odds: ${combo.parlayOdds > 0 ? '+' : ''}${combo.parlayOdds}`);
      console.log(`  +-----------------------------------------------------------`);

      for (const leg of combo.legs) {
        const hours = (new Date(leg.gameTime).getTime() - Date.now()) / 3600000;
        const timeStr = hours < 2 ? `~${Math.round(hours * 60)}min` : `~${Math.round(hours)}hrs`;
        console.log(`  |`);
        console.log(`  |  [NFL] ${leg.matchup}  (${timeStr})`);
        console.log(`  |  Bet  : ${leg.betType.toUpperCase()} -- ${leg.originalSide}`);
        console.log(`  |  After ${leg.teaserPoints}pt teaser: ${leg.teasedLine > 0 ? '+' : ''}${leg.teasedLine}`);
        console.log(`  |  [KEY] Crosses: ${leg.crossesKeyNumbers.join(', ')}`);
        console.log(`  |  ${leg.reasoning}`);
      }

      const bankroll = parseFloat(process.env.BANKROLL ?? '0');
      const kelly = bankroll > 0 ? `$${Math.round(bankroll * 0.02)} (2% Kelly)` : '2% of bankroll';
      console.log(`  |`);
      console.log(`  |  [$] Suggested bet: ${kelly}`);
      console.log(`  +-----------------------------------------------------------`);
    });
  }

  console.log('\n  TEASER STRATEGY NOTES:');
  console.log('  - 6pt teasers through 3 and 7 win ~75% historically (vs ~73% break-even at -120)');
  console.log('  - Only bet teasers when BOTH legs cross at least one key number');
  console.log('  - Avoid teasers on totals unless crossing a well-defined key number');
  console.log('  - Never tease underdogs getting more than +7 (already have cushion)');
  console.log('  - Best value: tease favorites from -7.5 to -1.5 (crosses both 3 and 7)\n');
}
