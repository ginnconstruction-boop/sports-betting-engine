// ============================================================
// src/services/propEdgeFactors.ts
// Competitive advantage signals -- factors no platform uses
// Blowout risk, market inefficiency, public star bias,
// foul trouble, OT risk, prop correlation, Kelly sizing
// Applies to ALL sports uniformly
// ============================================================

import { PlayerProfile } from './playerStats';

// ------------------------------------
// Types
// ------------------------------------

export interface BlowoutRisk {
  isHighRisk: boolean;
  spreadFavored: number | null;    // abs value of spread
  blowoutProbability: number;      // 0-1
  impactedProps: string[];         // which stat types are affected
  detail: string;
  scorePenalty: number;
}

export interface MarketEfficiencyByPropType {
  propType: string;
  sport: string;
  efficiencyRating: number;       // 0-100, lower = softer market = more edge
  edgeMultiplier: number;         // multiply score by this
  volumeCategory: 'high' | 'medium' | 'low' | 'very_low';
  detail: string;
}

export interface PublicStarBias {
  playerName: string;
  isStarPlayer: boolean;
  publicOverBias: number;         // estimated points of line inflation on over
  shouldFadeOver: boolean;
  shouldFadeUnder: boolean;
  detail: string;
  scoreAdjustment: number;
}

export interface FoulTroubleRisk {
  playerName: string;
  sport: string;
  avgFoulsPerGame: number | null;
  foulTroubleRisk: 'high' | 'medium' | 'low';
  minutesAtRisk: boolean;
  impactedProps: string[];
  detail: string;
  scorePenalty: number;
}

export interface OvertimeRisk {
  gameSpread: number | null;
  gameTotal: number | null;
  otProbability: number;          // 0-1
  isHighOTRisk: boolean;
  booksExcludeOT: boolean;        // most books do for props
  affectedSide: 'over' | 'under' | 'none';
  detail: string;
  scoreAdjustment: number;
}

export interface PropCorrelation {
  prop1: string;
  prop2: string;
  correlationType: 'positive' | 'negative' | 'none';
  correlationStrength: 'high' | 'medium' | 'low';
  detail: string;
  warning: string;
}

export interface KellyCriterion {
  winProbability: number;         // our model's estimated win %
  impliedProbability: number;     // book's implied win % from price
  edge: number;                   // winProb - impliedProb
  kellyFraction: number;          // full Kelly %
  recommendedBetPct: number;      // fractional Kelly (25%) -- safer
  recommendedUnits: number;       // out of 100 unit bankroll
  isPositiveEV: boolean;
  evPerUnit: number;              // expected value per $100 bet
  detail: string;
}

// ------------------------------------
// Sport-specific configurations
// ------------------------------------

const SPORT_CONFIGS: Record<string, {
  avgPointsPerTeam: number;
  blowoutThreshold: number;       // spread where star sits
  avgFoulsPerGame: number;
  overtimeExcluded: boolean;      // most books exclude OT from props
  starThresholdPPG: number;       // PPG to be considered a "star"
}> = {
  basketball_nba: {
    avgPointsPerTeam: 113.5,
    blowoutThreshold: 12,         // leads of 15+ in 4th = stars sit
    avgFoulsPerGame: 2.8,
    overtimeExcluded: true,
    starThresholdPPG: 22,
  },
  americanfootball_nfl: {
    avgPointsPerTeam: 23.5,
    blowoutThreshold: 14,
    avgFoulsPerGame: 0,
    overtimeExcluded: true,       // NFL books often exclude OT passing/rushing
    starThresholdPPG: 80,         // rushing yards equivalent
  },
  baseball_mlb: {
    avgPointsPerTeam: 4.5,
    blowoutThreshold: 5,
    avgFoulsPerGame: 0,
    overtimeExcluded: false,
    starThresholdPPG: 1.0,
  },
  icehockey_nhl: {
    avgPointsPerTeam: 3.0,
    blowoutThreshold: 3,
    avgFoulsPerGame: 0,
    overtimeExcluded: false,
    starThresholdPPG: 1.0,
  },
};

// Market efficiency by prop type -- lower = softer = more edge available
// Based on documented research: low-volume props are systematically mispriced
const PROP_TYPE_EFFICIENCY: Record<string, Record<string, number>> = {
  basketball_nba: {
    player_points:                    78,   // high volume, sharp pricing
    player_assists:                   72,   // medium volume
    player_rebounds:                  70,   // medium volume
    player_points_rebounds_assists:   68,   // combo -- less modeled
    player_threes:                    65,   // medium
    player_blocks:                    45,   // LOW VOLUME -- major edge here
    player_steals:                    45,   // LOW VOLUME -- major edge here
    player_turnovers:                 50,   // low volume
    player_points_rebounds:           65,
    player_points_assists:            65,
  },
  americanfootball_nfl: {
    player_pass_yds:                  80,   // very high volume
    player_rush_yds:                  75,
    player_reception_yds:             72,
    player_receptions:                70,
    player_pass_tds:                  68,
    player_anytime_td:                65,
    player_rush_attempts:             55,
    player_pass_attempts:             60,
    player_kicking_points:            50,
  },
  baseball_mlb: {
    batter_strikeouts:                60,
    pitcher_strikeouts:               72,
    batter_hits:                      65,
    batter_total_bases:               62,
    batter_rbis:                      55,
    pitcher_outs:                     68,
  },
  icehockey_nhl: {
    player_points:                    65,
    player_shots_on_goal:             58,
    player_goals:                     55,
    player_assists:                   52,
    goalie_saves:                     60,
  },
};

// Known "star" players who attract heavy public over action
// (partial list -- system also uses PPG threshold)
const KNOWN_STARS: Record<string, string[]> = {
  basketball_nba: [
    'LeBron James', 'Stephen Curry', 'Nikola Jokic', 'Luka Doncic',
    'Giannis Antetokounmpo', 'Joel Embiid', 'Kevin Durant', 'Jayson Tatum',
    'Damian Lillard', 'Devin Booker', 'Anthony Edwards', 'Shai Gilgeous-Alexander',
    'Victor Wembanyama', 'Donovan Mitchell', 'Tyrese Haliburton',
  ],
  americanfootball_nfl: [
    'Patrick Mahomes', 'Josh Allen', 'Lamar Jackson', 'Justin Jefferson',
    'Tyreek Hill', 'Ja\'Marr Chase', 'Christian McCaffrey', 'Travis Kelce',
    'Davante Adams', 'Cooper Kupp', 'CeeDee Lamb', 'Justin Herbert',
  ],
};

// ------------------------------------
// 1. BLOWOUT RISK
// ------------------------------------

export function assessBlowoutRisk(
  sportKey: string,
  playerTeam: string,
  homeTeam: string,
  awayTeam: string,
  spread: number | null,    // from home team perspective
  statType: string
): BlowoutRisk {
  const config = SPORT_CONFIGS[sportKey] ?? SPORT_CONFIGS['basketball_nba'];

  if (spread === null) {
    return { isHighRisk: false, spreadFavored: null, blowoutProbability: 0, impactedProps: [], detail: 'No spread data', scorePenalty: 0 };
  }

  // Is the player's team the heavy favorite?
  const playerIsHome = playerTeam === homeTeam;
  const playerSpread = playerIsHome ? spread : -spread;
  const absSpread = Math.abs(playerSpread);
  const teamIsBigFavorite = playerSpread < -config.blowoutThreshold;
  const teamIsHeavyDog = playerSpread > config.blowoutThreshold;

  // Blowout probability increases with spread size
  const blowoutProbability = absSpread >= config.blowoutThreshold
    ? Math.min(0.85, 0.3 + (absSpread - config.blowoutThreshold) * 0.05)
    : absSpread >= config.blowoutThreshold * 0.7
    ? 0.15
    : 0.05;

  const isHighRisk = blowoutProbability >= 0.3;

  // Which props are affected by blowout?
  const countingStats = ['points', 'rebounds', 'assists', 'rush_yds', 'pass_yds', 'reception_yds', 'receptions'];
  const impactedProps = countingStats.filter(s => statType.toLowerCase().includes(s));

  let detail = '';
  let scorePenalty = 0;

  if (teamIsBigFavorite && isHighRisk) {
    detail = `${playerTeam} favored by ${absSpread} -- high blowout risk (${Math.round(blowoutProbability * 100)}% chance). Stars sit in 4th if up big -> lean UNDER counting stats`;
    scorePenalty = -(Math.min(15, Math.round(blowoutProbability * 20)));
  } else if (teamIsHeavyDog && isHighRisk) {
    detail = `${playerTeam} dog by ${absSpread} -- may fall behind early -> garbage time minutes possible (double-edged)`;
    scorePenalty = -5;
  } else {
    detail = `Close game expected -- no blowout risk adjustment needed`;
  }

  return { isHighRisk, spreadFavored: absSpread, blowoutProbability, impactedProps, detail, scorePenalty };
}

// ------------------------------------
// 2. MARKET EFFICIENCY BY PROP TYPE
// ------------------------------------

export function getMarketEfficiencyForProp(
  sportKey: string,
  marketKey: string
): MarketEfficiencyByPropType {
  const sportEfficiency = PROP_TYPE_EFFICIENCY[sportKey] ?? PROP_TYPE_EFFICIENCY['basketball_nba'];
  const efficiency = sportEfficiency[marketKey] ?? 65;

  const volumeCategory: MarketEfficiencyByPropType['volumeCategory'] =
    efficiency >= 75 ? 'high'
    : efficiency >= 65 ? 'medium'
    : efficiency >= 55 ? 'low'
    : 'very_low';

  // Softer markets get a score boost -- more edge available
  const edgeMultiplier = efficiency <= 50 ? 1.35
    : efficiency <= 60 ? 1.20
    : efficiency <= 70 ? 1.05
    : 0.95;

  const propLabel = marketKey.replace('player_', '').replace(/_/g, ' ');
  const detail = efficiency <= 55
    ? `${propLabel} is a LOW VOLUME market (efficiency ${efficiency}/100) -- books underprice these, edge is larger here`
    : efficiency >= 75
    ? `${propLabel} is heavily traded -- market is sharp, need stronger signals to justify`
    : `${propLabel} is a medium-volume market -- standard edge threshold applies`;

  return {
    propType: marketKey,
    sport: sportKey,
    efficiencyRating: efficiency,
    edgeMultiplier,
    volumeCategory,
    detail,
  };
}

// ------------------------------------
// 3. PUBLIC STAR BIAS FADE
// ------------------------------------

export function assessPublicStarBias(
  playerName: string,
  sportKey: string,
  seasonPPG: number | null,
  statType: string,
  side: 'over' | 'under'
): PublicStarBias {
  const config = SPORT_CONFIGS[sportKey] ?? SPORT_CONFIGS['basketball_nba'];
  const starPlayers = KNOWN_STARS[sportKey] ?? [];

  const isKnownStar = starPlayers.some(s =>
    s.toLowerCase().includes(playerName.toLowerCase().split(' ').pop() ?? '')
  );
  const isStatStar = seasonPPG !== null && seasonPPG >= config.starThresholdPPG;
  const isStarPlayer = isKnownStar || isStatStar;

  // Books shade star over lines up because public always bets over on stars
  // Estimated 1.5-3 point inflation on points props for top stars
  const overBias = isKnownStar ? 2.5 : isStatStar ? 1.5 : 0;

  const shouldFadeOver = isStarPlayer && side === 'over' && overBias >= 1.5;
  const shouldFadeUnder = false; // public doesn't systematically under-bet stars

  let detail = '';
  let scoreAdjustment = 0;

  if (shouldFadeOver) {
    detail = `${playerName} is a high-profile player -- books inflate over lines ~${overBias}pts due to public over-betting. True line likely ${overBias} lower`;
    scoreAdjustment = -8; // penalty for betting with public on star overs
  } else if (isStarPlayer && side === 'under') {
    detail = `${playerName} star under -- fades public bias, historically profitable position`;
    scoreAdjustment = +6; // bonus for going against public on star unders
  } else {
    detail = `Non-star player -- no public bias adjustment needed`;
  }

  return { playerName, isStarPlayer, publicOverBias: overBias, shouldFadeOver, shouldFadeUnder, detail, scoreAdjustment };
}

// ------------------------------------
// 4. FOUL TROUBLE RISK (NBA)
// ------------------------------------

export function assessFoulTroubleRisk(
  playerName: string,
  sportKey: string,
  position: string,
  profile: PlayerProfile | null
): FoulTroubleRisk {
  if (sportKey !== 'basketball_nba') {
    return {
      playerName, sport: sportKey,
      avgFoulsPerGame: null, foulTroubleRisk: 'low',
      minutesAtRisk: false, impactedProps: [],
      detail: 'Foul trouble only tracked for NBA', scorePenalty: 0,
    };
  }

  // Positions with high foul risk
  const highFoulPositions = ['C', 'PF', 'SF'];
  const isHighFoulPosition = highFoulPositions.includes(position.toUpperCase());

  // Calculate from game logs if available
  let avgFoulsPerGame: number | null = null;
  if (profile?.recentGames && profile.recentGames.length > 0) {
    // ESPN game logs don't always have fouls, use position baseline
    avgFoulsPerGame = isHighFoulPosition ? 3.2 : 2.1;
  }

  const foulTroubleRisk: FoulTroubleRisk['foulTroubleRisk'] =
    (avgFoulsPerGame ?? 0) >= 3.5 || isHighFoulPosition ? 'high'
    : (avgFoulsPerGame ?? 0) >= 2.5 ? 'medium'
    : 'low';

  const minutesAtRisk = foulTroubleRisk === 'high';
  const impactedProps = minutesAtRisk
    ? ['points', 'rebounds', 'blocks', 'player_points', 'player_rebounds', 'player_blocks']
    : [];

  const detail = foulTroubleRisk === 'high'
    ? `${playerName} (${position}) is a high-foul-risk position -- minutes may be limited if in foul trouble, lean under counting stats`
    : foulTroubleRisk === 'medium'
    ? `${playerName} moderate foul risk -- monitor lineup news`
    : `Low foul trouble risk`;

  const scorePenalty = foulTroubleRisk === 'high' && impactedProps.some(p => p.includes('point') || p.includes('rebound'))
    ? -6 : 0;

  return { playerName, sport: sportKey, avgFoulsPerGame, foulTroubleRisk, minutesAtRisk, impactedProps, detail, scorePenalty };
}

// ------------------------------------
// 5. OVERTIME RISK
// ------------------------------------

export function assessOvertimeRisk(
  sportKey: string,
  gameSpread: number | null,
  gameTotal: number | null,
  statType: string,
  side: 'over' | 'under'
): OvertimeRisk {
  const config = SPORT_CONFIGS[sportKey] ?? SPORT_CONFIGS['basketball_nba'];

  // OT probability based on spread closeness
  let otProbability = 0.05; // baseline ~5%
  if (gameSpread !== null && Math.abs(gameSpread) <= 1.5) {
    otProbability = 0.22; // pick'em games go to OT ~22% historically
  } else if (gameSpread !== null && Math.abs(gameSpread) <= 3) {
    otProbability = 0.15;
  } else if (gameSpread !== null && Math.abs(gameSpread) <= 5) {
    otProbability = 0.10;
  }

  const isHighOTRisk = otProbability >= 0.15;
  const booksExcludeOT = config.overtimeExcluded;

  // Impact on the bet
  let affectedSide: OvertimeRisk['affectedSide'] = 'none';
  let scoreAdjustment = 0;

  if (isHighOTRisk && booksExcludeOT) {
    const countingStatTypes = ['points', 'rebounds', 'assists', 'pass_yds', 'rush_yds', 'reception_yds'];
    const isCountingStat = countingStatTypes.some(s => statType.toLowerCase().includes(s));

    if (isCountingStat) {
      // OT excluded = player accumulates stats in OT but bet doesn't count them
      // This hurts OVER bets -- player needs to hit line in regulation only
      affectedSide = 'over';
      scoreAdjustment = side === 'over' ? -8 : +5; // over is riskier, under gets a boost
    }
  }

  const detail = isHighOTRisk && booksExcludeOT
    ? `${Math.round(otProbability * 100)}% OT probability (spread ${gameSpread}) -- books exclude OT stats. OVER bettors need player to hit line in regulation only`
    : isHighOTRisk
    ? `${Math.round(otProbability * 100)}% OT probability -- close game expected`
    : `Low OT risk (spread ${gameSpread})`;

  return { gameSpread, gameTotal, otProbability, isHighOTRisk, booksExcludeOT, affectedSide, detail, scoreAdjustment };
}

// ------------------------------------
// 6. PROP CORRELATION DETECTION
// ------------------------------------

export function detectPropCorrelation(
  prop1PlayerName: string,
  prop1StatType: string,
  prop1Side: 'over' | 'under',
  prop2PlayerName: string,
  prop2StatType: string,
  prop2Side: 'over' | 'under',
  sameTeam: boolean,
  sportKey: string
): PropCorrelation {
  // Same player, different stats -- some are positively correlated
  if (prop1PlayerName === prop2PlayerName) {
    const pointsAndAssists = (prop1StatType.includes('point') && prop2StatType.includes('assist')) ||
                              (prop1StatType.includes('assist') && prop2StatType.includes('point'));
    if (pointsAndAssists && prop1Side === prop2Side) {
      return {
        prop1: `${prop1PlayerName} ${prop1StatType} ${prop1Side}`,
        prop2: `${prop2PlayerName} ${prop2StatType} ${prop2Side}`,
        correlationType: 'positive',
        correlationStrength: 'high',
        detail: 'Points and assists for same player are highly correlated -- both hit or miss together',
        warning: `[!]? CORRELATED: These two props tend to win/lose together. Consider betting only the stronger signal, not both.`,
      };
    }
  }

  // Same team, both overs -- correlated with team scoring well
  if (sameTeam && prop1Side === 'over' && prop2Side === 'over') {
    const bothCountingStats = ['point', 'assist', 'rebound', 'rush', 'pass', 'reception']
      .filter(s => prop1StatType.includes(s) || prop2StatType.includes(s)).length >= 2;
    if (bothCountingStats) {
      return {
        prop1: `${prop1PlayerName} ${prop1StatType} over`,
        prop2: `${prop2PlayerName} ${prop2StatType} over`,
        correlationType: 'positive',
        correlationStrength: 'medium',
        detail: 'Two overs from the same team correlate with that team having a high-scoring game',
        warning: `[!]? TEAM CORRELATION: Both props win if ${prop1PlayerName.split(' ').pop()}'s team scores big. Not independent bets.`,
      };
    }
  }

  // Opposing players in same game -- QB yards and opposing CB coverage
  if (!sameTeam && sportKey === 'americanfootball_nfl') {
    if (prop1StatType.includes('pass_yds') && prop2StatType.includes('pass_yds') &&
        prop1Side !== prop2Side) {
      return {
        prop1: `${prop1PlayerName} pass yds ${prop1Side}`,
        prop2: `${prop2PlayerName} pass yds ${prop2Side}`,
        correlationType: 'negative',
        correlationStrength: 'low',
        detail: 'Opposing QBs in same game -- if one throws for many yards, opponent likely has to throw to keep up',
        warning: `Both QBs in same game -- positive correlation possible if game turns into shootout.`,
      };
    }
  }

  return {
    prop1: `${prop1PlayerName} ${prop1StatType}`,
    prop2: `${prop2PlayerName} ${prop2StatType}`,
    correlationType: 'none',
    correlationStrength: 'low',
    detail: 'No significant correlation detected between these props',
    warning: '',
  };
}

// ------------------------------------
// 7. KELLY CRITERION BET SIZING
// ------------------------------------

export function calculateKelly(
  predictedWinProbability: number,  // our model's estimate (0-1)
  americanOdds: number,             // the price (e.g., -110, +150)
  bankrollUnits: number = 100       // default 100 unit bankroll
): KellyCriterion {
  // Convert american odds to decimal odds
  const decimalOdds = americanOdds > 0
    ? (americanOdds / 100) + 1
    : (100 / Math.abs(americanOdds)) + 1;

  // Implied probability from odds (includes vig)
  const impliedProbability = 1 / decimalOdds;

  // Edge = our probability - implied probability
  const edge = predictedWinProbability - impliedProbability;

  // Full Kelly = edge / (decimalOdds - 1)
  const kellyFraction = edge > 0
    ? edge / (decimalOdds - 1)
    : 0;

  // Use 25% Kelly (fractional) -- much safer, still mathematically sound
  const fractionalKelly = kellyFraction * 0.25;
  const recommendedBetPct = Math.min(fractionalKelly * 100, 5); // cap at 5% of bankroll
  const recommendedUnits = Math.round(recommendedBetPct * bankrollUnits / 100 * 10) / 10;

  // Expected value per $100 bet
  const evPerUnit = edge > 0
    ? Math.round(((predictedWinProbability * (decimalOdds - 1)) - (1 - predictedWinProbability)) * 100 * 10) / 10
    : 0;

  const isPositiveEV = edge > 0;

  const detail = isPositiveEV
    ? `Win probability: ${Math.round(predictedWinProbability * 100)}% vs implied ${Math.round(impliedProbability * 100)}% -- edge: ${Math.round(edge * 100)}%. Bet ${recommendedBetPct.toFixed(1)}% of bankroll (${recommendedUnits}u). EV: +$${evPerUnit} per $100`
    : `Win probability: ${Math.round(predictedWinProbability * 100)}% vs implied ${Math.round(impliedProbability * 100)}% -- no positive EV detected at this price`;

  return {
    winProbability: Math.round(predictedWinProbability * 1000) / 10,
    impliedProbability: Math.round(impliedProbability * 1000) / 10,
    edge: Math.round(edge * 1000) / 10,
    kellyFraction: Math.round(kellyFraction * 1000) / 10,
    recommendedBetPct: Math.round(recommendedBetPct * 10) / 10,
    recommendedUnits,
    isPositiveEV,
    evPerUnit,
    detail,
  };
}

// ------------------------------------
// Convert score adjustment to win probability
// Used to feed Kelly from our model score
// ------------------------------------

export function scoreToProbability(
  score: number,           // 0-100 model score
  baseWinRate: number = 0.527  // break-even at -110 juice
): number {
  // Score of 50 = baseWinRate, 100 = 0.75, 0 = 0.35
  // Linear interpolation with bounds
  const scaledScore = (score - 50) / 50;  // -1 to +1
  const probability = baseWinRate + scaledScore * 0.22;
  return Math.max(0.35, Math.min(0.75, Math.round(probability * 1000) / 1000));
}
