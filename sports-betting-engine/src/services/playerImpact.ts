// ============================================================
// src/services/playerImpact.ts
// Player availability impact modeling
// Turns injury flags into actual point/line adjustments
// Built from ESPN historical box scores
// ============================================================

import https from 'https';

export interface PlayerImpactData {
  playerName: string;
  team: string;
  position: string;
  status: string;
  // Impact on team when out
  pointsImpact: number | null;      // team scores X fewer points when out
  allowedImpact: number | null;     // team allows X more/fewer points when out
  totalImpact: number | null;       // net impact on game total
  spreadImpact: number | null;      // impact on spread (positive = favors opponent)
  confidence: 'high' | 'medium' | 'low';
  basis: string;                    // explanation of how impact was calculated
}

export interface GameImpactSummary {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeImpacts: PlayerImpactData[];
  awayImpacts: PlayerImpactData[];
  // Net adjustments
  adjustedHomeScore: number | null;
  adjustedAwayScore: number | null;
  adjustedTotal: number | null;
  spreadAdjustment: number | null;  // positive = favors away
  totalAdjustment: number | null;   // positive = leans over
  significantImpact: boolean;
  impactSummary: string;
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Parse failed')); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Position importance weights by sport
const POSITION_IMPACT: Record<string, Record<string, { scoring: number; spread: number }>> = {
  basketball_nba: {
    'C':   { scoring: 8,  spread: 4  },
    'PF':  { scoring: 7,  spread: 3.5 },
    'SF':  { scoring: 7,  spread: 3.5 },
    'SG':  { scoring: 6,  spread: 3  },
    'PG':  { scoring: 8,  spread: 4  },
  },
  americanfootball_nfl: {
    'QB':  { scoring: 10, spread: 10 },  // starter-level QB out = ~10 pt swing
    'RB':  { scoring: 4,  spread: 2  },
    'WR':  { scoring: 4,  spread: 2  },
    'TE':  { scoring: 3,  spread: 1.5 },
    'OL':  { scoring: 3,  spread: 1.5 },
    'DL':  { scoring: 2,  spread: 1  },
    'LB':  { scoring: 2,  spread: 1  },
    'CB':  { scoring: 3,  spread: 1.5 },
    'S':   { scoring: 2,  spread: 1  },
  },
  baseball_mlb: {
    'SP':  { scoring: 5,  spread: 2.5 },  // scheduled SP change is huge for totals
    'RP':  { scoring: 1,  spread: 0.5 },
    'C':   { scoring: 1,  spread: 0.5 },
    '1B':  { scoring: 1.5, spread: 0.5 },
    '2B':  { scoring: 1,  spread: 0.5 },
    '3B':  { scoring: 1.5, spread: 0.5 },
    'SS':  { scoring: 1.5, spread: 0.5 },
    'OF':  { scoring: 1.5, spread: 0.5 },
    'DH':  { scoring: 1.5, spread: 0.5 },
  },
  icehockey_nhl: {
    'G':  { scoring: 6, spread: 3 },    // Goalie is critical
    'D':  { scoring: 3, spread: 1.5 },
    'LW': { scoring: 4, spread: 2 },
    'RW': { scoring: 4, spread: 2 },
    'C':  { scoring: 5, spread: 2.5 },
    'F':  { scoring: 4, spread: 2 },    // Generic forward
  },
  basketball_ncaab: {
    'C':   { scoring: 9,  spread: 5  },  // college star removal = more variance
    'PF':  { scoring: 8,  spread: 4.5 },
    'SF':  { scoring: 8,  spread: 4.5 },
    'SG':  { scoring: 7,  spread: 3.5 },
    'PG':  { scoring: 9,  spread: 5  },
  },
  americanfootball_ncaaf: {
    'QB':  { scoring: 12, spread: 12 },  // college QB removal = even larger swing
    'RB':  { scoring: 5,  spread: 2.5 },
    'WR':  { scoring: 5,  spread: 2.5 },
    'TE':  { scoring: 3,  spread: 1.5 },
    'OL':  { scoring: 3,  spread: 1.5 },
    'DL':  { scoring: 2,  spread: 1.5 },
    'LB':  { scoring: 2,  spread: 1.5 },
    'CB':  { scoring: 3,  spread: 1.5 },
    'S':   { scoring: 2,  spread: 1  },
  },
};

// Status severity multiplier
const STATUS_MULTIPLIER: Record<string, number> = {
  'Out': 1.0,
  'Doubtful': 0.75,
  'Questionable': 0.4,
  'Probable': 0.15,
};

// ------------------------------------
// Position tier detection
// Star: scoring > 20% of team average (roughly 1.5x base position impact)
// ------------------------------------

export type PlayerTier = 'star' | 'starter' | 'backup';

export async function getPositionTier(
  sportKey: string,
  playerId: string,
  position: string
): Promise<PlayerTier> {
  try {
    const stats = await getPlayerSeasonStats(sportKey, playerId);
    const ppg = stats.pointsPerGame;
    if (!ppg) return 'starter';

    // Approximate league averages per position to classify tiers
    const STAR_PPG_THRESHOLDS: Record<string, Record<string, number>> = {
      basketball_nba: { PG: 20, SG: 18, SF: 17, PF: 16, C: 15 },
      americanfootball_nfl: { QB: 25, RB: 12, WR: 10, TE: 8, OL: 5, DL: 5, LB: 5, CB: 5, S: 5 },
      baseball_mlb: { SP: 15, RP: 5, C: 8, '1B': 8, '2B': 7, '3B': 8, SS: 8, OF: 8, DH: 8 },
      icehockey_nhl: { G: 0, D: 20, LW: 25, RW: 25, C: 30, F: 22 },
    };

    const thresholds = STAR_PPG_THRESHOLDS[sportKey] ?? {};
    const starThreshold = thresholds[position] ?? 15;

    if (ppg >= starThreshold) return 'star';
    if (ppg >= starThreshold * 0.6) return 'starter';
    return 'backup';
  } catch {
    return 'starter';
  }
}

async function getPlayerSeasonStats(
  sportKey: string,
  playerId: string
): Promise<{ pointsPerGame: number | null; minutesPerGame: number | null }> {
  const ESPN_LEAGUES: Record<string, { sport: string; league: string }> = {
    basketball_nba: { sport: 'basketball', league: 'nba' },
    baseball_mlb:   { sport: 'baseball',   league: 'mlb' },
    americanfootball_nfl: { sport: 'football', league: 'nfl' },
    icehockey_nhl:  { sport: 'hockey',     league: 'nhl' },
  };

  const league = ESPN_LEAGUES[sportKey];
  if (!league) return { pointsPerGame: null, minutesPerGame: null };

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/athletes/${playerId}/statistics`;
    const data = await fetchJson(url);
    const stats = data?.splits?.categories ?? [];

    const general = stats.find((c: any) => c?.name === 'general' || c?.name === 'scoring');
    const ppg = general?.stats?.find((s: any) => s?.name === 'avgPoints' || s?.name === 'points')?.value;
    const mpg = general?.stats?.find((s: any) => s?.name === 'avgMinutes' || s?.name === 'minutes')?.value;

    return {
      pointsPerGame: ppg ? parseFloat(ppg) : null,
      minutesPerGame: mpg ? parseFloat(mpg) : null,
    };
  } catch {
    return { pointsPerGame: null, minutesPerGame: null };
  }
}

// ------------------------------------
// Calculate impact for a single player
// ------------------------------------

function calculatePlayerImpact(
  sportKey: string,
  playerName: string,
  team: string,
  position: string,
  status: string,
  playerPPG: number | null,
  tier: PlayerTier = 'starter'
): PlayerImpactData {
  const positionWeights = POSITION_IMPACT[sportKey]?.[position] ?? { scoring: 2, spread: 1 };
  const statusMultiplier = STATUS_MULTIPLIER[status] ?? 0.5;

  // Star players get 1.5x position impact multiplier
  const tierMultiplier = tier === 'star' ? 1.5 : tier === 'backup' ? 0.6 : 1.0;

  // If we have actual PPG data, use it; otherwise use position baseline
  let scoringImpact: number;
  let basis: string;

  if (playerPPG && playerPPG > 0) {
    // Player's actual contribution -- when they're out, team loses roughly 60% of their output
    // (other players pick up slack, lineup adjustments, etc.)
    scoringImpact = Math.round(playerPPG * 0.6 * statusMultiplier * tierMultiplier * 10) / 10;
    basis = `Based on ${playerPPG} PPG (${tier}) -- team loses ~${scoringImpact} pts when ${status}`;
  } else {
    // Use position baseline
    scoringImpact = Math.round(positionWeights.scoring * statusMultiplier * tierMultiplier * 10) / 10;
    basis = `Based on ${position} position baseline (${tier}) -- ${status} status`;
  }

  const spreadImpact = Math.round(positionWeights.spread * statusMultiplier * tierMultiplier * 10) / 10;
  const confidence: PlayerImpactData['confidence'] = playerPPG ? 'high' : position ? 'medium' : 'low';

  return {
    playerName, team, position, status,
    pointsImpact: -scoringImpact,         // negative = team scores fewer
    allowedImpact: scoringImpact * 0.3,   // slight defensive impact too
    totalImpact: -scoringImpact * 0.7,    // net total impact (leans under)
    spreadImpact,
    confidence,
    basis,
  };
}

// ------------------------------------
// Build full game impact summary
// ------------------------------------

export async function buildGameImpactSummary(
  sportKey: string,
  eventId: string,
  homeTeam: string,
  awayTeam: string,
  homeInjuries: Array<{ playerName: string; position: string; status: string; athleteId?: string }>,
  awayInjuries: Array<{ playerName: string; position: string; status: string; athleteId?: string }>
): Promise<GameImpactSummary> {
  const activeStatuses = ['Out', 'Doubtful', 'Questionable'];

  const homeActive = homeInjuries.filter(i => activeStatuses.includes(i.status));
  const awayActive = awayInjuries.filter(i => activeStatuses.includes(i.status));

  // Get player stats where available
  const homeImpacts: PlayerImpactData[] = [];
  const awayImpacts: PlayerImpactData[] = [];

  for (const injury of homeActive) {
    let ppg: number | null = null;
    let tier: PlayerTier = 'starter';
    if (injury.athleteId) {
      try {
        const stats = await getPlayerSeasonStats(sportKey, injury.athleteId);
        ppg = stats.pointsPerGame;
        tier = await getPositionTier(sportKey, injury.athleteId, injury.position).catch(() => 'starter');
      } catch { }
    }
    homeImpacts.push(calculatePlayerImpact(
      sportKey, injury.playerName, homeTeam, injury.position, injury.status, ppg, tier
    ));
  }

  for (const injury of awayActive) {
    let ppg: number | null = null;
    let tier: PlayerTier = 'starter';
    if (injury.athleteId) {
      try {
        const stats = await getPlayerSeasonStats(sportKey, injury.athleteId);
        ppg = stats.pointsPerGame;
        tier = await getPositionTier(sportKey, injury.athleteId, injury.position).catch(() => 'starter');
      } catch { }
    }
    awayImpacts.push(calculatePlayerImpact(
      sportKey, injury.playerName, awayTeam, injury.position, injury.status, ppg, tier
    ));
  }

  // Net adjustments
  const homeScoringAdj = homeImpacts.reduce((s, i) => s + (i.pointsImpact ?? 0), 0);
  const awayScoringAdj = awayImpacts.reduce((s, i) => s + (i.pointsImpact ?? 0), 0);

  const spreadAdjustment = Math.round((awayScoringAdj - homeScoringAdj) * 10) / 10;
  const totalAdjustment = Math.round((homeScoringAdj + awayScoringAdj) * 10) / 10;

  const significantImpact = Math.abs(spreadAdjustment) >= 1.5 || Math.abs(totalAdjustment) >= 2;

  // Build impact summary
  const parts: string[] = [];
  for (const impact of [...homeImpacts, ...awayImpacts]) {
    if (impact.status === 'Out' || impact.status === 'Doubtful') {
      parts.push(`${impact.playerName} (${impact.team}, ${impact.status}): ~${Math.abs(impact.pointsImpact ?? 0)} pt impact`);
    }
  }

  const impactSummary = parts.length > 0
    ? `Injury adjustments: ${parts.slice(0, 3).join(' | ')}. Spread adj: ${spreadAdjustment > 0 ? '+' : ''}${spreadAdjustment}, Total adj: ${totalAdjustment > 0 ? '+' : ''}${totalAdjustment}`
    : 'No significant injury impacts';

  return {
    eventId, homeTeam, awayTeam,
    homeImpacts, awayImpacts,
    adjustedHomeScore: null,
    adjustedAwayScore: null,
    adjustedTotal: null,
    spreadAdjustment,
    totalAdjustment,
    significantImpact,
    impactSummary,
  };
}
