// ============================================================
// src/services/propMatchups.ts
// Opponent matchup data for prop betting
// How many points/assists/rebounds does this opponent
// allow to this position historically?
// Source: ESPN stats API -- free
// ============================================================

import https from 'https';

export interface PositionMatchup {
  opponentTeam: string;
  position: string;
  statType: string;       // 'points' | 'rebounds' | 'assists' | 'threes'
  allowedPerGame: number; // avg allowed to this position
  leagueAvgAllowed: number;
  vsLeagueAvg: number;    // positive = defense allows more than avg = offense-friendly
  rank: number;           // 1 = toughest, 30 = softest (NBA)
  matchupGrade: 'elite' | 'good' | 'average' | 'poor' | 'terrible';
  // Implied edge
  overEdge: boolean;      // true = good matchup, lean over
  underEdge: boolean;     // true = tough matchup, lean under
  edgeDetail: string;
}

export interface GameMatchupPackage {
  homeTeam: string;
  awayTeam: string;
  // For each position, how does the defense rank
  matchups: Map<string, PositionMatchup[]>; // key = playerName
  pace: number | null;          // possessions per game for this matchup
  impliedPaceMultiplier: number; // high pace = lean over all counting stats
  gameTotal: number | null;
  gameTotalVsLeagueAvg: number | null; // positive = high scoring game
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

// League averages by position (NBA 2024-25 approximate)
const NBA_LEAGUE_AVG_ALLOWED: Record<string, Record<string, number>> = {
  PG:  { points: 22.5, assists: 7.2, rebounds: 4.1, threes: 2.8 },
  SG:  { points: 21.8, assists: 4.1, rebounds: 4.2, threes: 2.6 },
  SF:  { points: 20.9, assists: 3.8, rebounds: 5.8, threes: 2.1 },
  PF:  { points: 19.2, assists: 3.1, rebounds: 7.4, threes: 1.4 },
  C:   { points: 17.8, assists: 2.4, rebounds: 9.8, threes: 0.6 },
  QB:  { points: 0,    assists: 0,   rebounds: 0,   threes: 0   }, // NFL
};

// Grades based on rank percentile
function getMatchupGrade(rank: number, total: number): PositionMatchup['matchupGrade'] {
  const pct = rank / total;
  if (pct <= 0.15) return 'terrible';  // top 15% hardest
  if (pct <= 0.35) return 'poor';
  if (pct <= 0.65) return 'average';
  if (pct <= 0.85) return 'good';
  return 'elite';                       // bottom 15% easiest (most allowed)
}

// Cache matchup data
const matchupCache = new Map<string, { data: any; fetchedAt: number }>();
const CACHE_TTL = 3600000;

export async function getOpponentPositionStats(
  opponentTeam: string,
  position: string,
  statType: string,
  sportKey: string = 'basketball_nba'
): Promise<{ allowed: number; rank: number; total: number } | null> {
  const cacheKey = `${opponentTeam}__${position}__${statType}__${sportKey}`;
  const cached = matchupCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.data;

  try {
    // ESPN doesn't have a direct "points allowed to position" endpoint
    // We approximate using opponent's defensive stats and position weights
    const league = sportKey === 'basketball_nba' ? 'nba' : 'nfl';
    const sport = sportKey === 'basketball_nba' ? 'basketball' : 'football';

    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams`;
    const data = await fetchJson(url);
    const teams = data?.sports?.[0]?.leagues?.[0]?.teams ?? data?.teams ?? [];

    const last = (s: string) => s.toLowerCase().split(' ').pop() ?? '';
    const teamObj = (Array.isArray(teams) ? teams : []).find((t: any) =>
      last(t?.team?.displayName ?? '') === last(opponentTeam)
    );
    if (!teamObj) return null;

    const teamId = teamObj?.team?.id;

    // Get team defensive stats
    const statsUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/statistics`;
    const statsData = await fetchJson(statsUrl);
    const categories = statsData?.results?.stats?.categories ?? [];

    // Find defensive scoring allowed
    let defRating: number | null = null;
    for (const cat of (Array.isArray(categories) ? categories : [])) {
      const catName = (cat?.name ?? '').toLowerCase();
      if (catName.includes('defensive') || catName.includes('opponent')) {
        const stats = cat?.stats ?? [];
        for (const stat of (Array.isArray(stats) ? stats : [])) {
          if ((stat?.name ?? '').toLowerCase().includes('points')) {
            defRating = parseFloat(stat?.value ?? '0') || null;
          }
        }
      }
    }

    // Use defensive rating to estimate position-specific allowed
    // A team allowing more points overall will allow more at each position proportionally
    const leagueAvgTotal = 113.5; // NBA league average points allowed 2024-25
    const defMultiplier = defRating ? (defRating / leagueAvgTotal) : 1.0;

    const leagueAvg = NBA_LEAGUE_AVG_ALLOWED[position]?.[statType] ?? 0;
    const allowed = Math.round(leagueAvg * defMultiplier * 10) / 10;

    // Rank = estimated based on def rating
    // Better (lower) defensive rating = higher rank number (easier to face)
    const rank = defRating ? Math.round((defRating / leagueAvgTotal) * 15) : 15;
    const total = 30;

    const result = { allowed, rank: Math.min(30, Math.max(1, rank)), total };
    matchupCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
    return result;
  } catch {
    return null;
  }
}

// ------------------------------------
// Build matchup package for a game
// ------------------------------------

export async function buildMatchupPackage(
  homeTeam: string,
  awayTeam: string,
  gameTotal: number | null,
  players: Array<{ name: string; team: string; position: string; statType: string }>,
  sportKey: string = 'basketball_nba'
): Promise<GameMatchupPackage> {
  const matchups = new Map<string, PositionMatchup[]>();
  const NBA_LEAGUE_AVG_TOTAL = 226.5; // 2024-25 approximate

  // Pace multiplier from game total
  const impliedPaceMultiplier = gameTotal && NBA_LEAGUE_AVG_TOTAL > 0
    ? Math.round((gameTotal / NBA_LEAGUE_AVG_TOTAL) * 100) / 100
    : 1.0;

  const gameTotalVsLeagueAvg = gameTotal ? gameTotal - NBA_LEAGUE_AVG_TOTAL : null;

  for (const player of players) {
    const opponent = player.team === homeTeam ? awayTeam : homeTeam;

    try {
      const oppData = await getOpponentPositionStats(
        opponent, player.position, player.statType, sportKey
      );

      if (!oppData) continue;

      const leagueAvg = NBA_LEAGUE_AVG_ALLOWED[player.position]?.[player.statType] ?? 0;
      const vsLeagueAvg = Math.round((oppData.allowed - leagueAvg) * 10) / 10;
      const grade = getMatchupGrade(oppData.rank, oppData.total);

      const overEdge = grade === 'elite' || grade === 'good';
      const underEdge = grade === 'terrible' || grade === 'poor';

      let edgeDetail = '';
      if (overEdge) {
        edgeDetail = `${opponent} allows ${oppData.allowed} ${player.statType}/g to ${player.position}s (+${vsLeagueAvg} vs avg) -- soft matchup`;
      } else if (underEdge) {
        edgeDetail = `${opponent} allows only ${oppData.allowed} ${player.statType}/g to ${player.position}s (${vsLeagueAvg} vs avg) -- tough matchup`;
      } else {
        edgeDetail = `${opponent} is average (${oppData.allowed} ${player.statType}/g to ${player.position}s)`;
      }

      const existing = matchups.get(player.name) ?? [];
      existing.push({
        opponentTeam: opponent,
        position: player.position,
        statType: player.statType,
        allowedPerGame: oppData.allowed,
        leagueAvgAllowed: leagueAvg,
        vsLeagueAvg,
        rank: oppData.rank,
        matchupGrade: grade,
        overEdge,
        underEdge,
        edgeDetail,
      });
      matchups.set(player.name, existing);
    } catch { /* matchup data is supplemental */ }
  }

  return {
    homeTeam, awayTeam, matchups,
    pace: null,
    impliedPaceMultiplier,
    gameTotal,
    gameTotalVsLeagueAvg,
  };
}
