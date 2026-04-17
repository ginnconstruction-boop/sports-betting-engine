// ============================================================
// src/services/travelFatigue.ts
// Travel Fatigue Model
// Computes schedule fatigue for each team based on
// back-to-back games, road trips, and timezone changes
// ============================================================

import https from 'https';

// ------------------------------------
// HTTP helper
// ------------------------------------

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
  basketball_nba: { sport: 'basketball', league: 'nba' },
  baseball_mlb: { sport: 'baseball', league: 'mlb' },
  americanfootball_nfl: { sport: 'football', league: 'nfl' },
  americanfootball_ncaaf: { sport: 'football', league: 'college-football' },
  basketball_ncaab: { sport: 'basketball', league: 'mens-college-basketball' },
  icehockey_nhl: { sport: 'hockey', league: 'nhl' },
};

// ------------------------------------
// City timezone map
// ET=0, CT=-1, MT=-2, PT=-3
// ------------------------------------

const CITY_TIMEZONE: Record<string, number> = {
  'Boston': 0, 'New York': 0, 'Brooklyn': 0, 'Toronto': 0, 'Miami': 0,
  'Philadelphia': 0, 'Washington': 0, 'Charlotte': 0, 'Atlanta': 0, 'Orlando': 0,
  'Cleveland': 0, 'Detroit': 0, 'Indianapolis': 0, 'Milwaukee': 0, 'Pittsburgh': 0,
  'Chicago': -1, 'Minnesota': -1, 'Memphis': -1, 'New Orleans': -1, 'Oklahoma City': -1,
  'San Antonio': -1, 'Dallas': -1, 'Houston': -1, 'Kansas City': -1,
  'Denver': -2, 'Salt Lake City': -2, 'Phoenix': -2,
  'Los Angeles': -3, 'LA': -3, 'Golden State': -3, 'San Francisco': -3,
  'Sacramento': -3, 'Portland': -3, 'Seattle': -3,
};

function getTimezoneForTeam(teamName: string): number {
  for (const [city, tz] of Object.entries(CITY_TIMEZONE)) {
    if (teamName.toLowerCase().includes(city.toLowerCase())) return tz;
  }
  return 0; // default ET
}

// ------------------------------------
// Types
// ------------------------------------

export interface TeamFatigue {
  team: string;
  isB2B: boolean;
  isRoadB2B: boolean;
  consecutiveRoadGames: number;
  daysRest: number;
  timezoneDelta: number;     // hours of timezone change since last game
  fatigueScore: number;      // 0-100, higher = more fatigued
  fatigueLabel: 'fresh' | 'normal' | 'tired' | 'exhausted';
}

export interface TravelFatigueReport {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeFatigue: TeamFatigue;
  awayFatigue: TeamFatigue;
  fatigueEdge: 'home' | 'away' | 'neutral';
  fatigueScoreBonus: number;  // 0-15 bonus to the less-fatigued team's side
  detail: string;
}

// ------------------------------------
// In-memory caches
// ------------------------------------

const teamIdCache = new Map<string, string>(); // sportKey:teamName -> teamId

async function getTeamId(sportKey: string, teamName: string): Promise<string | null> {
  const cacheKey = `${sportKey}:${teamName}`;
  if (teamIdCache.has(cacheKey)) return teamIdCache.get(cacheKey)!;

  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams`;
    const data = await fetchJson(url);
    const teams: any[] = data?.sports?.[0]?.leagues?.[0]?.teams ?? data?.teams ?? [];

    const teamLast = teamName.split(' ').pop()?.toLowerCase() ?? '';
    const teamNorm = teamName.toLowerCase();

    for (const t of teams) {
      const team = t?.team ?? t;
      const displayName: string = (team?.displayName ?? '').toLowerCase();
      const shortName: string = (team?.shortDisplayName ?? '').toLowerCase();
      const name: string = (team?.name ?? '').toLowerCase();
      const id: string = team?.id ?? '';

      if (!id) continue;

      if (
        displayName === teamNorm ||
        displayName.includes(teamLast) ||
        shortName.includes(teamLast) ||
        name === teamLast
      ) {
        teamIdCache.set(cacheKey, id);
        return id;
      }
    }
  } catch { /* ignore */ }

  return null;
}

// ------------------------------------
// Fetch last 5 games for a team
// ------------------------------------

interface GameRecord {
  date: string;         // ISO date
  isHome: boolean;
  opponentCity: string;
}

async function getRecentGames(sportKey: string, teamId: string): Promise<GameRecord[]> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return [];

  try {
    const year = new Date().getFullYear();
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams/${teamId}/schedule?season=${year}&seasontype=2`;
    const data = await fetchJson(url);

    const events: any[] = data?.events ?? [];
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const pastGames: GameRecord[] = [];

    for (const event of events) {
      const dateStr: string = event?.date ?? event?.competitions?.[0]?.date ?? '';
      if (!dateStr) continue;
      const gameDate = new Date(dateStr);
      if (gameDate > today) continue; // future game

      const comp = event?.competitions?.[0];
      if (!comp) continue;

      const competitors: any[] = comp.competitors ?? [];
      const thisTeam = competitors.find((c: any) => c?.id === teamId || c?.team?.id === teamId);
      if (!thisTeam) continue;

      const isHome = thisTeam.homeAway === 'home';
      const opponent = competitors.find((c: any) => c?.id !== teamId && c?.team?.id !== teamId);
      const opponentCity: string = opponent?.team?.location ?? opponent?.team?.displayName ?? '';

      pastGames.push({
        date: gameDate.toISOString(),
        isHome,
        opponentCity,
      });
    }

    // Sort descending (most recent first), take last 5
    pastGames.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return pastGames.slice(0, 5);
  } catch {
    return [];
  }
}

// ------------------------------------
// Compute fatigue score
// ------------------------------------

function computeFatigueLabel(score: number): 'fresh' | 'normal' | 'tired' | 'exhausted' {
  if (score <= 20) return 'fresh';
  if (score <= 40) return 'normal';
  if (score <= 65) return 'tired';
  return 'exhausted';
}

async function computeTeamFatigue(
  sportKey: string,
  teamName: string,
  teamHomeTz: number
): Promise<TeamFatigue> {
  const defaultFatigue: TeamFatigue = {
    team: teamName,
    isB2B: false,
    isRoadB2B: false,
    consecutiveRoadGames: 0,
    daysRest: 3,
    timezoneDelta: 0,
    fatigueScore: 0,
    fatigueLabel: 'fresh',
  };

  try {
    const teamId = await getTeamId(sportKey, teamName);
    if (!teamId) return defaultFatigue;

    const games = await getRecentGames(sportKey, teamId);
    if (games.length === 0) return defaultFatigue;

    const mostRecent = games[0];
    const now = new Date();
    const lastGameDate = new Date(mostRecent.date);

    const msDiff = now.getTime() - lastGameDate.getTime();
    const daysRest = Math.floor(msDiff / (1000 * 60 * 60 * 24));

    const isB2B = daysRest === 1;
    const isRoadB2B = isB2B && !mostRecent.isHome;

    // Count consecutive road games (looking back from most recent)
    let consecutiveRoadGames = 0;
    for (const g of games) {
      if (!g.isHome) consecutiveRoadGames++;
      else break;
    }

    // Timezone delta: where did they last play vs where are they playing now (home TZ)
    const lastGameTz = mostRecent.isHome ? teamHomeTz : getTimezoneForTeam(mostRecent.opponentCity);
    const timezoneDelta = Math.abs(teamHomeTz - lastGameTz);

    // Compute score
    let score = 0;
    if (isB2B) score += 30;
    if (isRoadB2B) score += 20;
    if (consecutiveRoadGames >= 3) score += 10;
    if (daysRest === 0) score += 10;
    if (timezoneDelta >= 3) score += 15;
    else if (timezoneDelta >= 2) score += 8;

    score = Math.min(score, 100);

    return {
      team: teamName,
      isB2B,
      isRoadB2B,
      consecutiveRoadGames,
      daysRest,
      timezoneDelta,
      fatigueScore: score,
      fatigueLabel: computeFatigueLabel(score),
    };
  } catch {
    return defaultFatigue;
  }
}

// ------------------------------------
// Main export
// ------------------------------------

export async function buildTravelFatigueMap(
  events: Array<{ eventId: string; sportKey: string; homeTeam: string; awayTeam: string }>
): Promise<Map<string, TravelFatigueReport>> {
  const result = new Map<string, TravelFatigueReport>();

  for (const event of events) {
    try {
      const homeTz = getTimezoneForTeam(event.homeTeam);
      const awayTz = getTimezoneForTeam(event.awayTeam);

      const [homeFatigue, awayFatigue] = await Promise.all([
        computeTeamFatigue(event.sportKey, event.homeTeam, homeTz).catch(() => ({
          team: event.homeTeam, isB2B: false, isRoadB2B: false,
          consecutiveRoadGames: 0, daysRest: 3, timezoneDelta: 0,
          fatigueScore: 0, fatigueLabel: 'fresh' as const,
        })),
        computeTeamFatigue(event.sportKey, event.awayTeam, awayTz).catch(() => ({
          team: event.awayTeam, isB2B: false, isRoadB2B: false,
          consecutiveRoadGames: 0, daysRest: 3, timezoneDelta: 0,
          fatigueScore: 0, fatigueLabel: 'fresh' as const,
        })),
      ]);

      const diff = homeFatigue.fatigueScore - awayFatigue.fatigueScore;
      const absDiff = Math.abs(diff);

      let fatigueEdge: 'home' | 'away' | 'neutral' = 'neutral';
      let fatigueScoreBonus = 0;

      if (absDiff >= 20) {
        fatigueEdge = diff > 0 ? 'away' : 'home'; // edge goes to LESS fatigued side
        fatigueScoreBonus = Math.min(Math.floor(absDiff / 5), 15);
      }

      // Build detail string
      const parts: string[] = [];
      if (homeFatigue.isB2B) parts.push(`${event.homeTeam} on B2B`);
      if (awayFatigue.isB2B) parts.push(`${event.awayTeam} on B2B`);
      if (homeFatigue.isRoadB2B) parts.push(`${event.homeTeam} road B2B`);
      if (awayFatigue.isRoadB2B) parts.push(`${event.awayTeam} road B2B`);
      if (homeFatigue.consecutiveRoadGames >= 3) parts.push(`${event.homeTeam} on ${homeFatigue.consecutiveRoadGames}-game road trip`);
      if (awayFatigue.consecutiveRoadGames >= 3) parts.push(`${event.awayTeam} on ${awayFatigue.consecutiveRoadGames}-game road trip`);
      if (homeFatigue.timezoneDelta >= 2) parts.push(`${event.homeTeam} traveled ${homeFatigue.timezoneDelta}TZ`);
      if (awayFatigue.timezoneDelta >= 2) parts.push(`${event.awayTeam} traveled ${awayFatigue.timezoneDelta}TZ`);

      let detail = parts.length > 0 ? parts.join(' | ') : 'No significant fatigue factors';
      if (fatigueEdge !== 'neutral') {
        const edgeTeam = fatigueEdge === 'home' ? event.homeTeam : event.awayTeam;
        detail += ` — fatigue edge to ${edgeTeam} (+${fatigueScoreBonus} pts)`;
      }

      result.set(event.eventId, {
        eventId: event.eventId,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        homeFatigue,
        awayFatigue,
        fatigueEdge,
        fatigueScoreBonus,
        detail,
      });
    } catch {
      // Non-fatal -- skip this event
    }
  }

  return result;
}
