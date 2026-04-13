// ============================================================
// src/services/advancedStats.ts
// Advanced team stats layer
// Sources: ESPN stats API (free, no key)
// Makes power ratings significantly more accurate
// ============================================================

import https from 'https';

export interface AdvancedTeamStats {
  teamName: string;
  sportKey: string;
  // Efficiency ratings (per 100 possessions for basketball, per game for others)
  offensiveEfficiency: number | null;
  defensiveEfficiency: number | null;
  netEfficiency: number | null;
  // Pace
  paceOfPlay: number | null;        // possessions per 48 min (NBA) or plays per game
  // Win probability
  pythagoreanWinPct: number | null; // expected win% based on points scored/allowed
  actualWinPct: number | null;
  luckAdjustment: number | null;    // pythagorean - actual (positive = due for regression)
  // Scoring
  pointsPerGame: number | null;
  pointsAllowedPerGame: number | null;
  // Sport-specific
  threePointRate?: number | null;   // NBA: % of shots from 3
  strikeoutRate?: number | null;    // MLB: K/9
  fip?: number | null;              // MLB: fielding independent pitching
  corsiPct?: number | null;         // NHL: shot attempt %
  fetchedAt: string;
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

const ESPN_LEAGUES: Record<string, { sport: string; league: string }> = {
  basketball_nba:          { sport: 'basketball',   league: 'nba' },
  baseball_mlb:            { sport: 'baseball',     league: 'mlb' },
  americanfootball_nfl:    { sport: 'football',     league: 'nfl' },
  americanfootball_ncaaf:  { sport: 'football',     league: 'college-football' },
  basketball_ncaab:        { sport: 'basketball',   league: 'mens-college-basketball' },
  icehockey_nhl:           { sport: 'hockey',       league: 'nhl' },
};

function fuzzyMatch(a: string, b: string): boolean {
  const last = (s: string) => s.toLowerCase().split(' ').pop() ?? '';
  return last(a) === last(b) ||
    a.toLowerCase().includes(last(b)) ||
    b.toLowerCase().includes(last(a));
}

// Cache to avoid repeated fetches
const statsCache = new Map<string, { stats: AdvancedTeamStats; fetchedAt: number }>();
const CACHE_TTL = 3600000;

function pythagoreanWinPct(pointsFor: number, pointsAgainst: number, exponent = 13.91): number {
  if (pointsAgainst === 0) return 1;
  const pf = Math.pow(pointsFor, exponent);
  const pa = Math.pow(pointsAgainst, exponent);
  return Math.round((pf / (pf + pa)) * 1000) / 1000;
}

export async function getAdvancedTeamStats(
  sportKey: string,
  teamName: string
): Promise<AdvancedTeamStats | null> {
  const cacheKey = `${sportKey}__${teamName}__advanced`;
  const cached = statsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.stats;

  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;

  try {
    // Get team ID
    const teamsUrl = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams`;
    const teamsData = await fetchJson(teamsUrl);
    const teams = Array.isArray(teamsData?.sports?.[0]?.leagues?.[0]?.teams) ? teamsData.sports[0].leagues[0].teams : Array.isArray(teamsData?.teams) ? teamsData.teams : [];

    const teamObj = (teams ?? []).find((t: any) => fuzzyMatch(t?.team?.displayName ?? '', teamName));
    if (!teamObj) return null;
    const teamId = teamObj?.team?.id;

    // Get stats
    const statsUrl = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams/${teamId}/statistics`;
    const statsData = await fetchJson(statsUrl);

    const categories = statsData?.results?.stats?.categories ?? [];

    // Helper to find a stat by name
    const getStat = (catName: string, statName: string): number | null => {
      const cat = (categories ?? []).find((c: any) =>
        c?.name?.toLowerCase().includes(catName.toLowerCase())
      );
      if (!cat) return null;
      const stat = (cat?.stats ?? []).find((s: any) =>
        s?.name?.toLowerCase().includes(statName.toLowerCase())
      );
      return stat?.value !== undefined ? parseFloat(stat.value) : null;
    };

    // Get schedule for pythagorean calc
    const schedUrl = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams/${teamId}/schedule`;
    const schedData = await fetchJson(schedUrl);
    const events = (schedData?.events ?? []).filter((e: any) => e?.competitions?.[0]?.status?.type?.completed);

    let totalFor = 0, totalAgainst = 0, wins = 0, games = 0;
    for (const game of events.slice(-20)) {
      const comp = game?.competitions?.[0];
      const us = (comp?.competitors ?? []).find((c: any) => fuzzyMatch(c?.team?.displayName ?? '', teamName));
      const them = (comp?.competitors ?? []).find((c: any) => !fuzzyMatch(c?.team?.displayName ?? '', teamName));
      if (!us || !them) continue;
      const ourScore = parseFloat(us?.score ?? '0');
      const theirScore = parseFloat(them?.score ?? '0');
      if (isNaN(ourScore) || isNaN(theirScore)) continue;
      totalFor += ourScore;
      totalAgainst += theirScore;
      if (us?.winner) wins++;
      games++;
    }

    const ppg = games > 0 ? Math.round((totalFor / games) * 10) / 10 : null;
    const papg = games > 0 ? Math.round((totalAgainst / games) * 10) / 10 : null;
    const pyth = ppg && papg ? pythagoreanWinPct(ppg, papg) : null;
    const actualWinPct = games > 0 ? Math.round((wins / games) * 1000) / 1000 : null;
    const luckAdj = pyth && actualWinPct ? Math.round((pyth - actualWinPct) * 1000) / 1000 : null;

    // Sport-specific efficiency
    let offEff: number | null = null;
    let defEff: number | null = null;
    let pace: number | null = null;

    if (sportKey === 'basketball_nba' || sportKey === 'basketball_ncaab') {
      offEff = getStat('offensive', 'efficiency') ?? getStat('scoring', 'points');
      defEff = getStat('defensive', 'efficiency') ?? getStat('defensive', 'points');
      pace = getStat('general', 'pace') ?? getStat('team', 'possessions');
    } else if (sportKey === 'americanfootball_nfl' || sportKey === 'americanfootball_ncaaf') {
      offEff = getStat('scoring', 'points') ?? ppg;
      defEff = getStat('defensive', 'points') ?? papg;
      pace = getStat('general', 'plays');
    } else if (sportKey === 'baseball_mlb') {
      offEff = getStat('batting', 'runs') ?? ppg;
      defEff = getStat('pitching', 'era');
      pace = null;
    } else if (sportKey === 'icehockey_nhl') {
      offEff = getStat('scoring', 'goals') ?? ppg;
      defEff = getStat('goaltending', 'saves');
      pace = getStat('general', 'shots');
    }

    const netEff = offEff !== null && defEff !== null
      ? Math.round((offEff - defEff) * 10) / 10
      : null;

    const stats: AdvancedTeamStats = {
      teamName, sportKey,
      offensiveEfficiency: offEff,
      defensiveEfficiency: defEff,
      netEfficiency: netEff,
      paceOfPlay: pace,
      pythagoreanWinPct: pyth,
      actualWinPct,
      luckAdjustment: luckAdj,
      pointsPerGame: ppg,
      pointsAllowedPerGame: papg,
      fetchedAt: new Date().toISOString(),
    };

    statsCache.set(cacheKey, { stats, fetchedAt: Date.now() });
    return stats;
  } catch {
    return null;
  }
}

// ------------------------------------
// Get implied total from advanced stats
// Used for total betting edge detection
// ------------------------------------

export function getImpliedTotal(
  homeStats: AdvancedTeamStats | null,
  awayStats: AdvancedTeamStats | null
): number | null {
  if (!homeStats?.pointsPerGame || !awayStats?.pointsPerGame) return null;
  if (!homeStats?.pointsAllowedPerGame || !awayStats?.pointsAllowedPerGame) return null;

  // Blend each team's offense vs opponent's defense
  const homeImplied = (homeStats.pointsPerGame + awayStats.pointsAllowedPerGame) / 2;
  const awayImplied = (awayStats.pointsPerGame + homeStats.pointsAllowedPerGame) / 2;
  return Math.round((homeImplied + awayImplied) * 2) / 2;
}

// ------------------------------------
// Build stats map for all events
// ------------------------------------

export async function buildAdvancedStatsMap(
  events: Array<{ eventId: string; sportKey: string; homeTeam: string; awayTeam: string }>
): Promise<Map<string, { home: AdvancedTeamStats | null; away: AdvancedTeamStats | null; impliedTotal: number | null }>> {
  const result = new Map();

  for (let i = 0; i < events.length; i += 3) {
    const batch = events.slice(i, i + 3);
    await Promise.allSettled(batch.map(async (e) => {
      try {
        const [home, away] = await Promise.allSettled([
          getAdvancedTeamStats(e.sportKey, e.homeTeam),
          getAdvancedTeamStats(e.sportKey, e.awayTeam),
        ]);
        const homeStats = home.status === 'fulfilled' ? home.value : null;
        const awayStats = away.status === 'fulfilled' ? away.value : null;
        result.set(e.eventId, {
          home: homeStats,
          away: awayStats,
          impliedTotal: getImpliedTotal(homeStats, awayStats),
        });
      } catch { }
    }));
  }

  return result;
}
