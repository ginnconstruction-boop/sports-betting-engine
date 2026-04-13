// ============================================================
// src/services/refereeData.ts
// Referee and umpire tendency data
// NBA refs who call more fouls = higher totals
// MLB umpires with wide zones = lower scoring
// NHL refs who let things go = physical, lower scoring
// ============================================================

import https from 'https';

export interface RefereeProfile {
  name: string;
  sport: string;
  // NBA specific
  foulsPerGame?: number;
  homeTeamFoulRate?: number;
  avgTotalInGames?: number;
  overRate?: number;          // % of games going over with this ref
  // MLB specific
  strikeZoneSize?: 'large' | 'average' | 'small';
  kPer9?: number;             // strikeouts per 9 innings
  runsPer9?: number;
  // NHL specific
  penaltiesPerGame?: number;
  avgGoalsInGames?: number;
  // General
  tendencies: string[];
  totalImpact: number;        // positive = lean over, negative = lean under
  confidence: 'high' | 'medium' | 'low';
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
    req.setTimeout(6000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

const ESPN_LEAGUES: Record<string, { sport: string; league: string }> = {
  basketball_nba: { sport: 'basketball', league: 'nba' },
  baseball_mlb:   { sport: 'baseball',   league: 'mlb' },
  icehockey_nhl:  { sport: 'hockey',     league: 'nhl' },
};

// ------------------------------------
// Get officials for a game from ESPN
// ------------------------------------

export async function getGameOfficials(
  sportKey: string,
  espnEventId: string
): Promise<string[]> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return [];

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/summary?event=${espnEventId}`;
    const data = await fetchJson(url);
    const officials = data?.gameInfo?.officials ?? [];
    return officials.map((o: any) => o?.displayName ?? o?.fullName ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

// ------------------------------------
// Build referee profile from historical data
// We use ESPN game summaries to build patterns
// ------------------------------------

export async function buildRefereeProfile(
  sportKey: string,
  refName: string
): Promise<RefereeProfile | null> {
  // For now, return a basic profile structure
  // Full historical scraping would require many API calls
  // This provides the framework that gets populated over time
  return {
    name: refName,
    sport: sportKey,
    tendencies: [],
    totalImpact: 0,
    confidence: 'low',
  };
}

// ------------------------------------
// Get referee data for upcoming game
// ------------------------------------

export async function getUpcomingGameReferees(
  sportKey: string,
  homeTeam: string,
  awayTeam: string
): Promise<{ officials: string[]; profiles: RefereeProfile[] }> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return { officials: [], profiles: [] };

  try {
    // Get today's scoreboard to find the event
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/scoreboard`;
    const data = await fetchJson(url);
    const events = data?.events ?? [];

    const matchingEvent = (events ?? []).find((e: any) => {
      const competitors = e?.competitions?.[0]?.competitors ?? [];
      const names = competitors.map((c: any) => c?.team?.displayName ?? '');
      const last = (s: string) => s.toLowerCase().split(' ').pop() ?? '';
      return names.some((n: string) => last(n) === last(homeTeam)) &&
             names.some((n: string) => last(n) === last(awayTeam));
    });

    if (!matchingEvent) return { officials: [], profiles: [] };

    const eventId = matchingEvent?.id;
    if (!eventId) return { officials: [], profiles: [] };

    const officials = await getGameOfficials(sportKey, eventId);
    const profiles = await Promise.all(
      officials.map(name => buildRefereeProfile(sportKey, name))
    );

    return {
      officials,
      profiles: profiles.filter((p): p is RefereeProfile => p !== null),
    };
  } catch {
    return { officials: [], profiles: [] };
  }
}
