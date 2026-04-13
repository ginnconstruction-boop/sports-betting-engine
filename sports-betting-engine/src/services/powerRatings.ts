// ============================================================
// src/services/powerRatings.ts
// Internal power ratings system
// Built from ESPN stats -- offense, defense, recent form
// Compares our number vs posted line to find true edge
// ============================================================

import https from 'https';

export interface PowerRating {
  teamName: string;
  sportKey: string;
  offensiveRating: number;    // points scored per game adjusted
  defensiveRating: number;    // points allowed per game adjusted
  netRating: number;          // offensive - defensive
  recentNetRating: number;    // last 5 games net
  homeBonus: number;          // home court/field advantage
  powerScore: number;         // final composite 0-100
  gamesPlayed: number;
  lastUpdated: string;
}

export interface LineComparison {
  ourLine: number;            // what our power ratings say the line should be
  postedLine: number;         // what the book has
  gap: number;                // ourLine - postedLine
  recommendation: 'home' | 'away' | 'none';
  confidence: 'high' | 'medium' | 'low';
  detail: string;
}

// Home advantage by sport (points)
const HOME_ADVANTAGE: Record<string, number> = {
  basketball_nba:         2.5,
  baseball_mlb:           0.3,
  americanfootball_nfl:   2.5,
  americanfootball_ncaaf: 3.0,
  basketball_ncaab:       3.5,
  icehockey_nhl:          0.15,
};

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

// Cache ratings to avoid re-fetching within same run
const ratingsCache = new Map<string, { rating: PowerRating; fetchedAt: number }>();
const CACHE_TTL = 3600000; // 1 hour

export async function getTeamPowerRating(
  sportKey: string,
  teamName: string
): Promise<PowerRating | null> {
  const cacheKey = `${sportKey}__${teamName}`;
  const cached = ratingsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.rating;
  }

  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;

  try {
    // Get team list to find ID
    const teamsUrl = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams`;
    const teamsData = await fetchJson(teamsUrl);
    const teams = Array.isArray(teamsData?.sports?.[0]?.leagues?.[0]?.teams) ? teamsData.sports[0].leagues[0].teams : Array.isArray(teamsData?.teams) ? teamsData.teams : [];

    const teamObj = (teams ?? []).find((t: any) => {
      const name = t?.team?.displayName ?? t?.team?.name ?? '';
      const last = teamName.toLowerCase().split(' ').pop() ?? '';
      return name.toLowerCase().includes(last);
    });

    if (!teamObj) return null;
    const teamId = teamObj?.team?.id;
    if (!teamId) return null;

    // Get team stats
    const statsUrl = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams/${teamId}`;
    const teamData = await fetchJson(statsUrl);

    // Get schedule for recent form
    const schedUrl = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams/${teamId}/schedule`;
    const schedData = await fetchJson(schedUrl);
    const events = Array.isArray(schedData?.events) ? schedData.events : [];

    // Last 5 completed games
    const completed = (Array.isArray(events) ? events : [])
      .filter((e: any) => e?.competitions?.[0]?.status?.type?.completed === true)
      .slice(-10);

    let totalFor = 0, totalAgainst = 0, count = 0;
    let recentFor = 0, recentAgainst = 0, recentCount = 0;

    for (let i = 0; i < completed.length; i++) {
      const game = completed[i];
      const comp = game?.competitions?.[0];
      const competitors = comp?.competitors ?? [];
      const us = (competitors ?? []).find((c: any) => {
        const last = teamName.toLowerCase().split(' ').pop() ?? '';
        return (c?.team?.displayName ?? '').toLowerCase().includes(last);
      });
      const them = (competitors ?? []).find((c: any) => {
        const last = teamName.toLowerCase().split(' ').pop() ?? '';
        return !(c?.team?.displayName ?? '').toLowerCase().includes(last);
      });

      if (!us || !them) continue;

      const ourScore = parseFloat(us?.score ?? '0');
      const theirScore = parseFloat(them?.score ?? '0');

      if (isNaN(ourScore) || isNaN(theirScore)) continue;

      totalFor += ourScore;
      totalAgainst += theirScore;
      count++;

      if (i >= completed.length - 5) {
        recentFor += ourScore;
        recentAgainst += theirScore;
        recentCount++;
      }
    }

    if (count === 0) return null;

    const offRating = totalFor / count;
    const defRating = totalAgainst / count;
    const netRating = offRating - defRating;
    const recentNet = recentCount > 0
      ? (recentFor / recentCount) - (recentAgainst / recentCount)
      : netRating;

    // Composite power score -- normalize to 0-100
    // Net rating of +15 = elite, -15 = poor
    const normalizedNet = Math.max(0, Math.min(100, (netRating + 20) / 40 * 100));
    const normalizedRecent = Math.max(0, Math.min(100, (recentNet + 20) / 40 * 100));
    // Weight recent form 40%, season 60%
    const powerScore = Math.round(normalizedNet * 0.6 + normalizedRecent * 0.4);

    const rating: PowerRating = {
      teamName,
      sportKey,
      offensiveRating: Math.round(offRating * 10) / 10,
      defensiveRating: Math.round(defRating * 10) / 10,
      netRating: Math.round(netRating * 10) / 10,
      recentNetRating: Math.round(recentNet * 10) / 10,
      homeBonus: HOME_ADVANTAGE[sportKey] ?? 2.5,
      powerScore,
      gamesPlayed: count,
      lastUpdated: new Date().toISOString(),
    };

    ratingsCache.set(cacheKey, { rating, fetchedAt: Date.now() });
    return rating;

  } catch {
    return null;
  }
}

// ------------------------------------
// Compare power ratings to posted line
// ------------------------------------

export function compareToLine(
  homeRating: PowerRating,
  awayRating: PowerRating,
  postedLine: number,   // from home team's perspective (negative = home fav)
  sportKey: string
): LineComparison {
  const homeAdv = HOME_ADVANTAGE[sportKey] ?? 2.5;

  // Our implied line = away net - home net - home advantage
  // Negative = home team favored in our model
  const ourLine = Math.round(
    (awayRating.recentNetRating - homeRating.recentNetRating - homeAdv) * 10
  ) / 10;

  // Gap: positive = posted line favors home more than we think (bet away)
  //       negative = posted line favors away more than we think (bet home)
  const gap = Math.round((postedLine - ourLine) * 10) / 10;
  const absGap = Math.abs(gap);

  let recommendation: 'home' | 'away' | 'none' = 'none';
  let confidence: 'high' | 'medium' | 'low' = 'low';

  if (absGap >= 3) {
    recommendation = gap > 0 ? 'away' : 'home';
    confidence = absGap >= 5 ? 'high' : 'medium';
  } else if (absGap >= 1.5) {
    recommendation = gap > 0 ? 'away' : 'home';
    confidence = 'low';
  }

  const detail = absGap >= 1.5
    ? `Our model says ${Math.abs(ourLine) > 0 ? (ourLine < 0 ? 'home' : 'away') : 'pick'} -${Math.abs(ourLine)}, line posted at ${postedLine > 0 ? '+' : ''}${postedLine} -- ${absGap} pt gap favors ${recommendation === 'none' ? 'neither side' : recommendation}`
    : `Line within model range -- no power rating edge`;

  return { ourLine, postedLine, gap, recommendation, confidence, detail };
}

// ------------------------------------
// Get ratings for both teams in a game
// ------------------------------------

export async function getGamePowerRatings(
  sportKey: string,
  homeTeam: string,
  awayTeam: string
): Promise<{ home: PowerRating | null; away: PowerRating | null }> {
  const [home, away] = await Promise.allSettled([
    getTeamPowerRating(sportKey, homeTeam),
    getTeamPowerRating(sportKey, awayTeam),
  ]);

  return {
    home: home.status === 'fulfilled' ? home.value : null,
    away: away.status === 'fulfilled' ? away.value : null,
  };
}
