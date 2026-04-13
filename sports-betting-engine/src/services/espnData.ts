// ============================================================
// src/services/espnData.ts
// Pulls injury reports and team news from ESPN's free API
// No key required
// ============================================================

import https from 'https';

export interface ESPNInjury {
  team: string;
  playerName: string;
  status: string;       // 'Out', 'Doubtful', 'Questionable', 'Probable'
  position: string;
  detail: string;
}

export interface ESPNGameInfo {
  homeTeam: string;
  awayTeam: string;
  injuries: ESPNInjury[];
  newsHeadlines: string[];
  venue: string;
  city: string;
  state: string;
  isOutdoor: boolean;
}

// ESPN sport slug map
const ESPN_SPORT_MAP: Record<string, { sport: string; league: string }> = {
  baseball_mlb:            { sport: 'baseball',       league: 'mlb' },
  basketball_nba:          { sport: 'basketball',     league: 'nba' },
  americanfootball_nfl:    { sport: 'football',       league: 'nfl' },
  americanfootball_ncaaf:  { sport: 'football',       league: 'college-football' },
  basketball_ncaab:        { sport: 'basketball',     league: 'mens-college-basketball' },
  icehockey_nhl:           { sport: 'hockey',         league: 'nhl' },
};

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Failed to parse ESPN response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('ESPN request timed out')); });
  });
}

// Normalize team name for fuzzy matching
function normalizeTeam(name: string): string {
  return name.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/i, '')
    .trim();
}

function teamsMatch(a: string, b: string): boolean {
  const na = normalizeTeam(a);
  const nb = normalizeTeam(b);
  // Check if either contains the other (handles "Red Sox" vs "Boston Red Sox")
  return na.includes(nb) || nb.includes(na) ||
    na.split(' ').pop() === nb.split(' ').pop(); // last word match (city names differ)
}

export async function getESPNGameInfo(
  sportKey: string,
  homeTeam: string,
  awayTeam: string
): Promise<ESPNGameInfo | null> {
  const mapping = ESPN_SPORT_MAP[sportKey];
  if (!mapping) return null;

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${mapping.sport}/${mapping.league}/scoreboard`;
    const data = await fetchJson(url) as any;
    const events = data?.events ?? [];

    // Find matching game
    const game = events.find((e: any) => {
      const competitors = e?.competitions?.[0]?.competitors ?? [];
      const names = competitors.map((c: any) => c?.team?.displayName ?? '');
      return names.some((n: string) => teamsMatch(n, homeTeam)) &&
             names.some((n: string) => teamsMatch(n, awayTeam));
    });

    if (!game) return null;

    const competition = game.competitions?.[0];
    const competitors = competition?.competitors ?? [];
    const venue = competition?.venue;
    const isIndoor = venue?.indoor ?? true;

    // Collect injuries
    const injuries: ESPNInjury[] = [];
    for (const competitor of competitors) {
      const teamName = competitor?.team?.displayName ?? '';
      const roster = competitor?.injuries ?? [];
      for (const injury of roster) {
        injuries.push({
          team: teamName,
          playerName: injury?.athlete?.displayName ?? 'Unknown',
          status: injury?.status ?? 'Unknown',
          position: injury?.athlete?.position?.abbreviation ?? '',
          detail: injury?.type?.detail ?? '',
        });
      }
    }

    // Headlines from game notes
    const newsHeadlines: string[] = (game.notes ?? [])
      .map((n: any) => n?.headline ?? '')
      .filter(Boolean);

    return {
      homeTeam: competitors.find((c: any) => c.homeAway === 'home')?.team?.displayName ?? homeTeam,
      awayTeam: competitors.find((c: any) => c.homeAway === 'away')?.team?.displayName ?? awayTeam,
      injuries,
      newsHeadlines,
      venue: venue?.fullName ?? '',
      city: venue?.address?.city ?? '',
      state: venue?.address?.state ?? '',
      isOutdoor: !isIndoor,
    };
  } catch {
    return null; // ESPN data is supplemental -- never block a run
  }
}

// Pull injuries for a whole sport
export async function getESPNInjuries(sportKey: string): Promise<Map<string, ESPNInjury[]>> {
  const mapping = ESPN_SPORT_MAP[sportKey];
  if (!mapping) return new Map();

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${mapping.sport}/${mapping.league}/injuries`;
    const data = await fetchJson(url) as any;
    const result = new Map<string, ESPNInjury[]>();

    for (const team of (data?.injuries ?? [])) {
      const teamName = team?.team?.displayName ?? '';
      const players: ESPNInjury[] = (team?.injuries ?? []).map((i: any) => ({
        team: teamName,
        playerName: i?.athlete?.displayName ?? '',
        status: i?.status ?? '',
        position: i?.athlete?.position?.abbreviation ?? '',
        detail: i?.type?.detail ?? '',
      }));
      if (players.length > 0) result.set(teamName, players);
    }

    return result;
  } catch {
    return new Map();
  }
}
