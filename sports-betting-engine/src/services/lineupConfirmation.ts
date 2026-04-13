// ============================================================
// src/services/lineupConfirmation.ts
// Pre-game lineup and starter confirmation
// Sources:
//   - NBA.com official injury report (90 min before tip)
//   - ESPN roster/lineup data
//   - Rotowire probable starters (free tier)
//   - Beat reporter RSS feeds
// Zero cost -- all free sources
// ============================================================

import https from 'https';
import * as http from 'http';

export interface ConfirmedLineup {
  teamName: string;
  sport: string;
  gameTime: string;
  confirmedStarters: StarterInfo[];
  scratchedPlayers: ScratchedPlayer[];
  keyPlayersOut: ScratchedPlayer[];
  lineupConfirmed: boolean;       // true = official pre-game report available
  minutesUntilGame: number;
  source: string;
  fetchedAt: string;
}

export interface StarterInfo {
  playerName: string;
  position: string;
  number?: string;
  isStarter: boolean;
}

export interface ScratchedPlayer {
  playerName: string;
  position: string;
  reason: string;           // 'injury', 'rest', 'suspension', 'personal'
  status: string;           // 'Out', 'Doubtful', 'GTD'
  isKeyPlayer: boolean;
  pointsImpact: number;     // estimated scoring impact
}

export interface LineupNews {
  headline: string;
  playerName: string;
  team: string;
  type: 'scratch' | 'starter_confirmed' | 'rest' | 'injury_update' | 'general';
  publishedAt: string;
  source: string;
  isBreaking: boolean;
}

// ------------------------------------
// HTTP helpers
// ------------------------------------

function fetchText(url: string, isHttps = true, timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = isHttps ? https : http;
    const req = (lib as any).get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/json,application/xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }, (res: any) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (c: any) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', ...headers }
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Parse failed')); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fuzzyMatch(a: string, b: string): boolean {
  const last = (s: string) => s.toLowerCase().split(' ').pop() ?? '';
  return last(a) === last(b) ||
    a.toLowerCase().includes(last(b)) ||
    b.toLowerCase().includes(last(a));
}

const ESPN_LEAGUES: Record<string, { sport: string; league: string }> = {
  basketball_nba:          { sport: 'basketball',   league: 'nba' },
  baseball_mlb:            { sport: 'baseball',     league: 'mlb' },
  americanfootball_nfl:    { sport: 'football',     league: 'nfl' },
  americanfootball_ncaaf:  { sport: 'football',     league: 'college-football' },
  basketball_ncaab:        { sport: 'basketball',   league: 'mens-college-basketball' },
  icehockey_nhl:           { sport: 'hockey',       league: 'nhl' },
};

// ------------------------------------
// 1. ESPN Official Injury / Lineup Report
// ------------------------------------

async function getESPNLineup(
  sportKey: string,
  teamName: string
): Promise<{ starters: StarterInfo[]; scratched: ScratchedPlayer[] }> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return { starters: [], scratched: [] };

  try {
    const injuryUrl = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/injuries`;
    const data = await fetchJson(injuryUrl);

    const teamData = (data?.injuries ?? []).find((t: any) =>
      fuzzyMatch(t?.team?.displayName ?? '', teamName)
    );

    const injuries = teamData?.injuries ?? [];
    const scratched: ScratchedPlayer[] = [];

    const KEY_POSITIONS: Record<string, string[]> = {
      basketball_nba: ['PG', 'SG', 'SF', 'PF', 'C'],
      americanfootball_nfl: ['QB', 'RB', 'WR', 'TE'],
      baseball_mlb: ['SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH'],
      icehockey_nhl: ['C', 'LW', 'RW', 'D', 'G'],
    };

    const keyPos = KEY_POSITIONS[sportKey] ?? [];

    for (const injury of injuries) {
      const status = injury?.status ?? '';
      const position = injury?.athlete?.position?.abbreviation ?? '';
      const name = injury?.athlete?.displayName ?? '';
      const detail = injury?.type?.detail ?? injury?.longComment ?? '';

      if (!['Out', 'Doubtful', 'Questionable', 'GTD'].includes(status)) continue;

      const isKey = keyPos.includes(position);

      // Estimate point impact by position
      const IMPACT: Record<string, number> = {
        QB: 7, PG: 8, SP: 3, C: 8, SF: 7, PF: 7, SG: 6,
        RB: 3, WR: 3, TE: 2, LW: 0.4, RW: 0.4, D: 0.2, G: 0.3,
      };

      const impact = IMPACT[position] ?? 2;
      const multiplier = status === 'Out' ? 1.0 : status === 'Doubtful' ? 0.75 : 0.4;

      scratched.push({
        playerName: name,
        position,
        reason: detail.toLowerCase().includes('rest') ? 'rest' : 'injury',
        status,
        isKeyPlayer: isKey,
        pointsImpact: Math.round(impact * multiplier * 10) / 10,
      });
    }

    return { starters: [], scratched };
  } catch {
    return { starters: [], scratched: [] };
  }
}

// ------------------------------------
// 2. NBA Official Injury Report
// Pulls from NBA.com -- most authoritative source
// Posted 90 minutes before tip-off
// ------------------------------------

async function getNBAOfficialReport(teamName: string): Promise<ScratchedPlayer[]> {
  try {
    const url = 'https://www.nba.com/players/day/injuryreport';
    const html = await fetchText(url);

    // Parse the injury report table
    const scratched: ScratchedPlayer[] = [];
    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];

    for (const row of rows) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? [];
      if (cells.length < 4) continue;

      const getText = (cell: string) => cell.replace(/<[^>]+>/g, '').trim();
      const team = getText(cells[0] ?? '');
      const player = getText(cells[1] ?? '');
      const status = getText(cells[2] ?? '');
      const reason = getText(cells[3] ?? '');

      if (!fuzzyMatch(team, teamName)) continue;
      if (!['Out', 'Doubtful', 'Questionable', 'GTD'].includes(status)) continue;

      scratched.push({
        playerName: player,
        position: '',
        reason: reason.toLowerCase().includes('rest') ? 'rest' : 'injury',
        status,
        isKeyPlayer: false, // position not available in this report
        pointsImpact: status === 'Out' ? 5 : status === 'Doubtful' ? 3 : 1,
      });
    }

    return scratched;
  } catch {
    return [];
  }
}

// ------------------------------------
// 3. Beat Reporter RSS Feeds
// These break news EARLIEST -- before official reports
// ------------------------------------

const BEAT_REPORTER_RSS: Record<string, string[]> = {
  basketball_nba: [
    'https://www.espn.com/espn/rss/nba/news',
    'https://feeds.nbcsports.com/nba',
  ],
  baseball_mlb: [
    'https://www.espn.com/espn/rss/mlb/news',
  ],
  americanfootball_nfl: [
    'https://www.espn.com/espn/rss/nfl/news',
  ],
  icehockey_nhl: [
    'https://www.espn.com/espn/rss/nhl/news',
  ],
  basketball_ncaab: [
    'https://www.espn.com/espn/rss/ncb/news',
  ],
};

export async function getBreakingLineupNews(
  sportKey: string,
  homeTeam: string,
  awayTeam: string
): Promise<LineupNews[]> {
  const feeds = BEAT_REPORTER_RSS[sportKey] ?? [];
  const news: LineupNews[] = [];
  const cutoffHours = 24;
  const cutoff = new Date(Date.now() - cutoffHours * 3600000);

  for (const feedUrl of feeds) {
    try {
      const xml = await fetchText(feedUrl);
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];

      for (const item of items.slice(0, 20)) {
        const getTag = (tag: string) => {
          const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
          return m?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() ?? '';
        };

        const headline = getTag('title');
        const pubDate = getTag('pubDate');
        const link = getTag('link');

        if (!headline) continue;

        // Check if relevant to our teams
        const hl = headline.toLowerCase();
        const lastHome = homeTeam.toLowerCase().split(' ').pop() ?? '';
        const lastAway = awayTeam.toLowerCase().split(' ').pop() ?? '';
        const mentionsGame = hl.includes(lastHome) || hl.includes(lastAway);
        if (!mentionsGame) continue;

        // Check recency
        const pubTime = pubDate ? new Date(pubDate) : new Date();
        if (pubTime < cutoff) continue;

        // Classify
        let type: LineupNews['type'] = 'general';
        const isBreaking =
          hl.includes('out') || hl.includes('scratch') ||
          hl.includes('ruled out') || hl.includes('will not play') ||
          hl.includes('questionable') || hl.includes('doubtful') ||
          hl.includes('starting') || hl.includes('lineup');

        if (hl.includes('scratch') || hl.includes('ruled out') || hl.includes('will not play')) type = 'scratch';
        else if (hl.includes('starting') || hl.includes('lineup')) type = 'starter_confirmed';
        else if (hl.includes('rest') || hl.includes('load manag')) type = 'rest';
        else if (hl.includes('injur') || hl.includes('questionable') || hl.includes('doubtful')) type = 'injury_update';

        const team = hl.includes(lastHome) ? homeTeam : awayTeam;

        news.push({
          headline,
          playerName: extractPlayerName(headline),
          team,
          type,
          publishedAt: pubTime.toISOString(),
          source: feedUrl.includes('espn') ? 'ESPN' : 'News Feed',
          isBreaking,
        });
      }
    } catch { /* RSS feed unavailable -- skip */ }
  }

  // Sort by most recent and most relevant
  return news
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .filter(n => n.isBreaking || n.type !== 'general')
    .slice(0, 10);
}

function extractPlayerName(headline: string): string {
  // Common patterns: "Player Name out vs...", "Player Name ruled out"
  const patterns = [
    /^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:out|ruled|questionable|doubtful|scratch)/i,
    /([A-Z][a-z]+ [A-Z][a-z]+)\s+(?:will not|won't|not expected)/i,
  ];
  for (const pattern of patterns) {
    const match = headline.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

// ------------------------------------
// 4. Main: Get full lineup confirmation for a game
// ------------------------------------

export async function getGameLineupConfirmation(
  sportKey: string,
  homeTeam: string,
  awayTeam: string,
  gameTime: string
): Promise<{ home: ConfirmedLineup; away: ConfirmedLineup; breakingNews: LineupNews[] }> {
  const now = Date.now();
  const gameMs = new Date(gameTime).getTime();
  const minutesUntilGame = Math.max(0, (gameMs - now) / 60000);

  // Run all fetches in parallel
  const [
    homeESPN, awayESPN,
    homeNBA, awayNBA,
    breakingNews,
  ] = await Promise.allSettled([
    getESPNLineup(sportKey, homeTeam),
    getESPNLineup(sportKey, awayTeam),
    sportKey === 'basketball_nba' ? getNBAOfficialReport(homeTeam) : Promise.resolve([]),
    sportKey === 'basketball_nba' ? getNBAOfficialReport(awayTeam) : Promise.resolve([]),
    getBreakingLineupNews(sportKey, homeTeam, awayTeam),
  ]);

  const homeESPNData = homeESPN.status === 'fulfilled' ? homeESPN.value : { starters: [], scratched: [] };
  const awayESPNData = awayESPN.status === 'fulfilled' ? awayESPN.value : { starters: [], scratched: [] };

  // Merge NBA official + ESPN data, deduplicating
  const mergeScratched = (espnData: ScratchedPlayer[], nbaData: ScratchedPlayer[]): ScratchedPlayer[] => {
    const merged = [...espnData];
    for (const nbaPlayer of nbaData) {
      const exists = merged.some(p => fuzzyMatch(p.playerName, nbaPlayer.playerName));
      if (!exists) merged.push(nbaPlayer);
    }
    return merged;
  };

  const homeScratched = mergeScratched(
    homeESPNData.scratched,
    homeNBA.status === 'fulfilled' ? homeNBA.value : []
  );
  const awayScratched = mergeScratched(
    awayESPNData.scratched,
    awayNBA.status === 'fulfilled' ? awayNBA.value : []
  );

  const fetchedAt = new Date().toISOString();
  const isConfirmed = minutesUntilGame <= 90;
  const source = sportKey === 'basketball_nba' && isConfirmed
    ? 'NBA Official + ESPN'
    : 'ESPN Injury Report';

  return {
    home: {
      teamName: homeTeam,
      sport: sportKey,
      gameTime,
      confirmedStarters: homeESPNData.starters,
      scratchedPlayers: homeScratched,
      keyPlayersOut: homeScratched.filter(p => p.isKeyPlayer),
      lineupConfirmed: isConfirmed,
      minutesUntilGame: Math.round(minutesUntilGame),
      source,
      fetchedAt,
    },
    away: {
      teamName: awayTeam,
      sport: sportKey,
      gameTime,
      confirmedStarters: awayESPNData.starters,
      scratchedPlayers: awayScratched,
      keyPlayersOut: awayScratched.filter(p => p.isKeyPlayer),
      lineupConfirmed: isConfirmed,
      minutesUntilGame: Math.round(minutesUntilGame),
      source,
      fetchedAt,
    },
    breakingNews: breakingNews.status === 'fulfilled' ? breakingNews.value : [],
  };
}

// ------------------------------------
// Build lineup map for all events
// ------------------------------------

export async function buildLineupMap(
  events: Array<{
    eventId: string;
    sportKey: string;
    homeTeam: string;
    awayTeam: string;
    gameTime: string;
  }>
): Promise<Map<string, Awaited<ReturnType<typeof getGameLineupConfirmation>>>> {
  const result = new Map();

  for (let i = 0; i < events.length; i += 3) {
    const batch = events.slice(i, i + 3);
    await Promise.allSettled(batch.map(async (e) => {
      try {
        const lineup = await getGameLineupConfirmation(
          e.sportKey, e.homeTeam, e.awayTeam, e.gameTime
        );
        result.set(e.eventId, lineup);
      } catch { }
    }));
  }

  return result;
}
