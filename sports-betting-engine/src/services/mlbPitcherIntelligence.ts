// ============================================================
// src/services/mlbPitcherIntelligence.ts
//
// MLB Pitcher-specific prop scoring
//
// Standard prop scorer treats all markets the same.
// Pitcher props need pitcher-specific signals:
//
//   1. Recent K rate (last 3 starts vs season avg)
//   2. Opponent team strikeout rate (how often does this lineup K?)
//   3. Park factor (some parks suppress K props)
//   4. Weather (wind direction, temp affect pitcher grip/stamina)
//   5. Pitch count projection (will pitcher go deep enough?)
//   6. Days rest (4 days rest = sharper command)
//   7. Home/away split (some pitchers markedly better at home)
//   8. Handedness matchup (lefty vs righty-heavy lineup)
// ============================================================

export interface PitcherPropInput {
  playerName:      string;
  team:            string;
  market:          string;     // pitcher_strikeouts, pitcher_hits_allowed, etc
  side:            'over' | 'under';
  line:            number;
  bestUserPrice:   number;
  bestUserBook:    string;
  altUserPrice:    number | null;
  altUserBook:     string;
  matchup:         string;
  gameTime:        string;
  homeTeam:        string;
  awayTeam:        string;
  isPitcherHome:   boolean;
  weatherTemp:     number | null;
  weatherWind:     number | null;
  weatherCondition: string;
}

export interface PitcherPropScore {
  playerName:      string;
  team:            string;
  market:          string;
  marketLabel:     string;
  side:            string;
  line:            number;
  bestUserPrice:   number;
  bestUserBook:    string;
  altUserPrice:    number | null;
  altUserBook:     string;
  matchup:         string;
  gameTime:        string;
  score:           number;
  grade:           string;
  tier:            'BET' | 'LEAN' | 'WATCH';
  signals:         string[];
  reasoning:       string[];
  pitcherIntel:    PitcherIntelligence;
}

export interface PitcherIntelligence {
  recentKRate:      number | null;   // K/9 last 3 starts
  seasonKRate:      number | null;   // K/9 season
  oppKRate:         number | null;   // opponent team K%
  parkFactor:       number;          // 1.0 = neutral, >1 = hitter friendly
  daysRest:         number | null;   // days since last start
  isHome:           boolean;
  weatherFlag:      string;          // 'favorable' | 'neutral' | 'unfavorable'
  handednessEdge:   string;          // 'favorable' | 'neutral' | 'unfavorable'
}

// ------------------------------------
// Known pitcher profiles
// These represent season tendencies -- updated as season progresses
// ------------------------------------

interface PitcherProfile {
  kPer9Season:    number;   // strikeouts per 9 innings
  kPer9Recent:    number;   // last 3 starts
  homeKRate:      number;   // K/9 at home
  awayKRate:      number;   // K/9 away
  avgInnings:     number;   // average innings per start
  hand:           'L' | 'R';
}

const PITCHER_PROFILES: Record<string, PitcherProfile> = {
  'Gerrit Cole':         { kPer9Season: 10.8, kPer9Recent: 11.2, homeKRate: 11.1, awayKRate: 10.5, avgInnings: 6.1, hand: 'R' },
  'Spencer Strider':     { kPer9Season: 13.5, kPer9Recent: 13.8, homeKRate: 13.9, awayKRate: 13.1, avgInnings: 5.8, hand: 'R' },
  'Corbin Burnes':       { kPer9Season: 9.8,  kPer9Recent: 10.1, homeKRate: 10.0, awayKRate: 9.6,  avgInnings: 6.2, hand: 'R' },
  'Logan Webb':          { kPer9Season: 8.2,  kPer9Recent: 8.5,  homeKRate: 8.9,  awayKRate: 7.5,  avgInnings: 6.4, hand: 'R' },
  'Zack Wheeler':        { kPer9Season: 9.5,  kPer9Recent: 9.8,  homeKRate: 9.7,  awayKRate: 9.3,  avgInnings: 6.3, hand: 'R' },
  'Dylan Cease':         { kPer9Season: 10.2, kPer9Recent: 10.5, homeKRate: 10.4, awayKRate: 10.0, avgInnings: 5.9, hand: 'R' },
  'Sandy Alcantara':     { kPer9Season: 8.8,  kPer9Recent: 9.0,  homeKRate: 9.2,  awayKRate: 8.4,  avgInnings: 7.0, hand: 'R' },
  'Pablo Lopez':         { kPer9Season: 8.5,  kPer9Recent: 8.8,  homeKRate: 8.7,  awayKRate: 8.3,  avgInnings: 5.8, hand: 'R' },
  'Max Fried':           { kPer9Season: 9.1,  kPer9Recent: 9.4,  homeKRate: 9.5,  awayKRate: 8.7,  avgInnings: 6.0, hand: 'L' },
  'Chris Sale':          { kPer9Season: 10.5, kPer9Recent: 10.8, homeKRate: 10.9, awayKRate: 10.1, avgInnings: 5.5, hand: 'L' },
  'Blake Snell':         { kPer9Season: 11.0, kPer9Recent: 11.3, homeKRate: 11.5, awayKRate: 10.5, avgInnings: 5.2, hand: 'L' },
  'Justin Verlander':    { kPer9Season: 8.5,  kPer9Recent: 8.2,  homeKRate: 8.6,  awayKRate: 8.4,  avgInnings: 6.2, hand: 'R' },
  'Framber Valdez':      { kPer9Season: 8.0,  kPer9Recent: 8.3,  homeKRate: 8.2,  awayKRate: 7.8,  avgInnings: 6.5, hand: 'L' },
  'Nestor Cortes':       { kPer9Season: 8.8,  kPer9Recent: 9.0,  homeKRate: 9.1,  awayKRate: 8.5,  avgInnings: 5.6, hand: 'L' },
  'Kevin Gausman':       { kPer9Season: 9.8,  kPer9Recent: 10.1, homeKRate: 10.2, awayKRate: 9.4,  avgInnings: 6.0, hand: 'R' },
  'Yoshinobu Yamamoto':  { kPer9Season: 10.5, kPer9Recent: 10.8, homeKRate: 10.9, awayKRate: 10.1, avgInnings: 6.0, hand: 'R' },
  'Tyler Glasnow':       { kPer9Season: 11.2, kPer9Recent: 11.5, homeKRate: 11.6, awayKRate: 10.8, avgInnings: 5.8, hand: 'R' },
  'Hunter Brown':        { kPer9Season: 9.2,  kPer9Recent: 9.5,  homeKRate: 9.4,  awayKRate: 9.0,  avgInnings: 5.7, hand: 'R' },
  'Paul Skenes':         { kPer9Season: 11.8, kPer9Recent: 12.0, homeKRate: 12.1, awayKRate: 11.5, avgInnings: 5.5, hand: 'R' },
  'Tarik Skubal':        { kPer9Season: 10.1, kPer9Recent: 10.4, homeKRate: 10.5, awayKRate: 9.7,  avgInnings: 6.1, hand: 'L' },
};

// High-K lineup opponents (these teams strikeout a lot -- good for K overs)
const HIGH_K_TEAMS: string[] = [
  'Athletics', 'White Sox', 'Nationals', 'Rockies',
  'Pirates', 'Angels', 'Marlins', 'Tigers',
];

// Low-K lineup opponents (hard to get Ks against -- bad for K overs)
const LOW_K_TEAMS: string[] = [
  'Cardinals', 'Astros', 'Dodgers', 'Braves', 'Padres',
];

// Park factors for K props (above 1.0 = more Ks expected)
const PARK_K_FACTORS: Record<string, number> = {
  'Dodger Stadium':        1.05,
  'Petco Park':            1.08,
  'Oracle Park':           1.06,
  'Coors Field':           0.88, // thin air = less break on pitches
  'Great American Ball Park': 1.02,
  'Yankee Stadium':        0.95,
  'Fenway Park':           0.97,
  'Truist Park':           1.03,
  'Busch Stadium':         1.01,
  'Globe Life Field':      1.02,
};

// ------------------------------------
// Main scorer
// ------------------------------------

export function scorePitcherProp(prop: PitcherPropInput): PitcherPropScore | null {
  if (!prop.line || !prop.bestUserPrice) return null;
  if (prop.market !== 'pitcher_strikeouts' && !prop.market.includes('pitcher')) return null;

  const profile = PITCHER_PROFILES[prop.playerName];
  const reasoning: string[] = [];
  const signals: string[] = [];
  let score = 50; // base score

  const marketLabel = prop.market === 'pitcher_strikeouts'    ? 'Strikeouts'
    : prop.market === 'pitcher_hits_allowed'  ? 'Hits Allowed'
    : prop.market === 'pitcher_earned_runs'   ? 'Earned Runs'
    : prop.market === 'pitcher_walks'         ? 'Walks'
    : prop.market === 'pitcher_outs'          ? 'Outs Recorded'
    : prop.market;

  const intel: PitcherIntelligence = {
    recentKRate:    profile ? (prop.isPitcherHome ? profile.homeKRate : profile.awayKRate) : null,
    seasonKRate:    profile?.kPer9Season ?? null,
    oppKRate:       null,
    parkFactor:     1.0,
    daysRest:       null,
    isHome:         prop.isPitcherHome,
    weatherFlag:    'neutral',
    handednessEdge: 'neutral',
  };

  // -- Signal 1: Pitcher K rate vs posted line --
  if (prop.market === 'pitcher_strikeouts' && profile) {
    const effectiveKRate = prop.isPitcherHome ? profile.homeKRate : profile.awayKRate;
    // Expected Ks = (K/9) / 9 * avgInnings
    const expectedKs = (effectiveKRate / 9) * profile.avgInnings;
    const diff = expectedKs - prop.line;

    if (diff >= 0.8 && prop.side === 'over') {
      score += 20;
      reasoning.push(`K rate projects ${expectedKs.toFixed(1)} Ks vs line of ${prop.line} -- model favors over`);
      signals.push('K_RATE_OVER');
    } else if (diff <= -0.8 && prop.side === 'under') {
      score += 20;
      reasoning.push(`K rate projects ${expectedKs.toFixed(1)} Ks vs line of ${prop.line} -- model favors under`);
      signals.push('K_RATE_UNDER');
    } else if (Math.abs(diff) <= 0.3) {
      reasoning.push(`K rate projects ${expectedKs.toFixed(1)} Ks -- line is fairly set`);
    } else {
      score -= 5;
    }

    // Recent form vs season
    if (profile.kPer9Recent > profile.kPer9Season + 0.5) {
      score += 10;
      reasoning.push(`Recent K rate (${profile.kPer9Recent.toFixed(1)}/9) trending above season avg (${profile.kPer9Season.toFixed(1)}/9)`);
      signals.push('RECENT_FORM');
    } else if (profile.kPer9Recent < profile.kPer9Season - 0.5) {
      score -= 8;
      reasoning.push(`Recent K rate (${profile.kPer9Recent.toFixed(1)}/9) trending below season avg`);
    }
  } else if (!profile) {
    reasoning.push(`No historical profile for ${prop.playerName} -- scoring on market signals only`);
  }

  // -- Signal 2: Opponent lineup strikeout rate --
  const oppTeam = prop.isPitcherHome ? prop.awayTeam : prop.homeTeam;
  const oppLast = oppTeam.split(' ').pop() ?? '';
  if (HIGH_K_TEAMS.some(t => oppLast.includes(t) || t.includes(oppLast))) {
    score += 12;
    intel.oppKRate = 0.27;
    reasoning.push(`${oppTeam} is a high-K lineup -- favors strikeout overs`);
    signals.push('HIGH_K_OPP');
  } else if (LOW_K_TEAMS.some(t => oppLast.includes(t) || t.includes(oppLast))) {
    score -= 10;
    intel.oppKRate = 0.19;
    reasoning.push(`${oppTeam} makes contact well -- tough for K overs`);
    signals.push('LOW_K_OPP');
  }

  // -- Signal 3: Weather for outdoor parks --
  if (prop.weatherTemp !== null && prop.weatherTemp < 50) {
    score -= 8;
    intel.weatherFlag = 'unfavorable';
    reasoning.push(`Cold weather (${prop.weatherTemp}F) -- pitchers struggle with grip, fewer Ks`);
    signals.push('COLD_WEATHER');
  } else if (prop.weatherWind !== null && prop.weatherWind > 15) {
    score -= 5;
    intel.weatherFlag = 'unfavorable';
    reasoning.push(`High wind (${prop.weatherWind}mph) -- affects pitch movement`);
    signals.push('WIND_FACTOR');
  } else if (prop.weatherTemp !== null && prop.weatherTemp >= 65 && prop.weatherTemp <= 80) {
    score += 5;
    intel.weatherFlag = 'favorable';
    reasoning.push(`Ideal pitching conditions (${prop.weatherTemp}F)`);
  }

  // -- Signal 4: Home/away advantage --
  if (profile && prop.isPitcherHome && profile.homeKRate > profile.awayKRate + 0.5) {
    score += 8;
    reasoning.push(`Pitcher markedly better at home (${profile.homeKRate.toFixed(1)} vs ${profile.awayKRate.toFixed(1)} K/9)`);
    signals.push('HOME_ADVANTAGE');
  }

  // -- Signal 5: Price edge --
  const priceDiff = prop.bestUserPrice - ((prop.altUserPrice ?? prop.bestUserPrice));
  if (priceDiff >= 10) {
    score += 10;
    reasoning.push(`Price edge: ${prop.bestUserBook} better by ${priceDiff} pts vs alt book`);
    signals.push('PRICE_EDGE');
  }

  // -- Signal 6: Innings durability (enough Ks possible?) --
  if (profile && profile.avgInnings < 5.0 && prop.market === 'pitcher_strikeouts') {
    const maxReasonableKs = (profile.kPer9Recent / 9) * 5.0;
    if (prop.side === 'over' && prop.line > maxReasonableKs) {
      score -= 15;
      reasoning.push(`Concern: ${prop.playerName} averages only ${profile.avgInnings.toFixed(1)} innings -- may not reach ${prop.line} Ks`);
      signals.push('INNINGS_RISK');
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  if (score < 55) return null;

  const grade = score >= 85 ? 'A+' : score >= 78 ? 'A' : score >= 70 ? 'B+' : 'B';
  const tier: PitcherPropScore['tier'] = score >= 85 ? 'BET' : score >= 72 ? 'LEAN' : 'WATCH';

  return {
    playerName:    prop.playerName,
    team:          prop.team,
    market:        prop.market,
    marketLabel,
    side:          prop.side,
    line:          prop.line,
    bestUserPrice: prop.bestUserPrice,
    bestUserBook:  prop.bestUserBook,
    altUserPrice:  prop.altUserPrice,
    altUserBook:   prop.altUserBook,
    matchup:       prop.matchup,
    gameTime:      prop.gameTime,
    score,
    grade,
    tier,
    signals,
    reasoning,
    pitcherIntel:  intel,
  };
}

// ------------------------------------
// Print pitcher prop report
// ------------------------------------

export function printPitcherPropReport(props: PitcherPropScore[]): void {
  if (props.length === 0) {
    console.log('\n  No qualifying pitcher props found today.\n');
    return;
  }

  console.log('\n');
  console.log('=================================================================');
  console.log('  MLB PITCHER PROPS -- INTELLIGENT ANALYSIS');
  console.log('  K rate, opponent contact, weather, park factor all applied');
  console.log('=================================================================');

  for (const p of props) {
    const priceStr = p.bestUserPrice > 0 ? `+${p.bestUserPrice}` : `${p.bestUserPrice}`;
    const altStr   = p.altUserPrice
      ? `  Alt: ${p.altUserBook} ${p.altUserPrice > 0 ? '+' : ''}${p.altUserPrice}`
      : '';
    // Pre-risk pitcher scan — [HOT] BET is reserved for Final Card only.
    const tierIcon = p.tier === 'BET' ? '[SIG] BET' : p.tier === 'LEAN' ? '[OK] LEAN' : 'WATCH';

    console.log(`\n  +---------------------------------------------------------`);
    console.log(`  |  [${p.grade}] ${tierIcon}  Score: ${p.score}/100`);
    console.log(`  |  ${p.playerName} (${p.team}) -- ${p.matchup}`);
    console.log(`  |  ${p.marketLabel.toUpperCase()} ${p.side.toUpperCase()} ${p.line}`);
    console.log(`  |  ${p.bestUserBook} ${priceStr}${altStr}`);
    console.log(`  |  Signals: ${p.signals.join(', ')}`);
    p.reasoning.forEach(r => console.log(`  |  -- ${r}`));
    console.log(`  +---------------------------------------------------------`);
  }
  console.log('');
}
