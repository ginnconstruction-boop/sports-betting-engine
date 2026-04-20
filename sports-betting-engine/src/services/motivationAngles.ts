// ============================================================
// src/services/motivationAngles.ts
// Motivation / Situational Expansion
// Additional situational angles: playoff elimination, revenge,
// division rivalries, road trip length, post-clinch letdown
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
    // unref: don't hold the Node.js event loop open if this request outlives its parent promise
    req.on('socket', s => s.unref());
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
// Division maps
// ------------------------------------

const NBA_DIVISIONS: string[][] = [
  ['Boston Celtics', 'Brooklyn Nets', 'New York Knicks', 'Philadelphia 76ers', 'Toronto Raptors'],
  ['Chicago Bulls', 'Cleveland Cavaliers', 'Detroit Pistons', 'Indiana Pacers', 'Milwaukee Bucks'],
  ['Atlanta Hawks', 'Charlotte Hornets', 'Miami Heat', 'Orlando Magic', 'Washington Wizards'],
  ['Denver Nuggets', 'Minnesota Timberwolves', 'Oklahoma City Thunder', 'Portland Trail Blazers', 'Utah Jazz'],
  ['Golden State Warriors', 'LA Clippers', 'Los Angeles Lakers', 'Phoenix Suns', 'Sacramento Kings'],
  ['Dallas Mavericks', 'Houston Rockets', 'Memphis Grizzlies', 'New Orleans Pelicans', 'San Antonio Spurs'],
];

const MLB_DIVISIONS: string[][] = [
  ['Baltimore Orioles', 'Boston Red Sox', 'New York Yankees', 'Tampa Bay Rays', 'Toronto Blue Jays'],
  ['Chicago White Sox', 'Cleveland Guardians', 'Detroit Tigers', 'Kansas City Royals', 'Minnesota Twins'],
  ['Houston Astros', 'Los Angeles Angels', 'Oakland Athletics', 'Seattle Mariners', 'Texas Rangers'],
  ['Atlanta Braves', 'Miami Marlins', 'New York Mets', 'Philadelphia Phillies', 'Washington Nationals'],
  ['Chicago Cubs', 'Cincinnati Reds', 'Milwaukee Brewers', 'Pittsburgh Pirates', 'St. Louis Cardinals'],
  ['Arizona Diamondbacks', 'Colorado Rockies', 'Los Angeles Dodgers', 'San Diego Padres', 'San Francisco Giants'],
];

const NHL_DIVISIONS: string[][] = [
  ['Boston Bruins', 'Buffalo Sabres', 'Detroit Red Wings', 'Florida Panthers', 'Montreal Canadiens', 'Ottawa Senators', 'Tampa Bay Lightning', 'Toronto Maple Leafs'],
  ['Carolina Hurricanes', 'Columbus Blue Jackets', 'New Jersey Devils', 'New York Islanders', 'New York Rangers', 'Philadelphia Flyers', 'Pittsburgh Penguins', 'Washington Capitals'],
  ['Arizona Coyotes', 'Chicago Blackhawks', 'Colorado Avalanche', 'Dallas Stars', 'Minnesota Wild', 'Nashville Predators', 'St. Louis Blues', 'Winnipeg Jets'],
  ['Anaheim Ducks', 'Calgary Flames', 'Edmonton Oilers', 'Los Angeles Kings', 'San Jose Sharks', 'Seattle Kraken', 'Vancouver Canucks', 'Vegas Golden Knights'],
];

const NFL_DIVISIONS: string[][] = [
  ['Buffalo Bills', 'Miami Dolphins', 'New England Patriots', 'New York Jets'],
  ['Baltimore Ravens', 'Cincinnati Bengals', 'Cleveland Browns', 'Pittsburgh Steelers'],
  ['Houston Texans', 'Indianapolis Colts', 'Jacksonville Jaguars', 'Tennessee Titans'],
  ['Denver Broncos', 'Kansas City Chiefs', 'Las Vegas Raiders', 'Los Angeles Chargers'],
  ['Dallas Cowboys', 'New York Giants', 'Philadelphia Eagles', 'Washington Commanders'],
  ['Chicago Bears', 'Detroit Lions', 'Green Bay Packers', 'Minnesota Vikings'],
  ['Atlanta Falcons', 'Carolina Panthers', 'New Orleans Saints', 'Tampa Bay Buccaneers'],
  ['Arizona Cardinals', 'Los Angeles Rams', 'San Francisco 49ers', 'Seattle Seahawks'],
];

const DIVISIONS_BY_SPORT: Record<string, string[][]> = {
  basketball_nba: NBA_DIVISIONS,
  baseball_mlb: MLB_DIVISIONS,
  icehockey_nhl: NHL_DIVISIONS,
  americanfootball_nfl: NFL_DIVISIONS,
};

// ------------------------------------
// Types
// ------------------------------------

export interface MotivationFactor {
  name: string;
  team: 'home' | 'away' | 'both';
  detail: string;
  scoreBonus: number;     // can be negative for low motivation
  confidence: 'high' | 'medium' | 'low';
}

export interface MotivationReport {
  eventId: string;
  factors: MotivationFactor[];
  netBonus: number;         // sum of all bonuses, capped at ±20
  highMotivationTeam: 'home' | 'away' | 'neither';
  lowMotivationTeam: 'home' | 'away' | 'neither';
  summary: string;
}

// ------------------------------------
// In-memory caches
// ------------------------------------

const standingsCache = new Map<string, { data: any; fetchedAt: number }>();
const teamIdCache = new Map<string, string>();
const scheduleCache = new Map<string, { data: any[]; fetchedAt: number }>();

async function getStandings(sportKey: string): Promise<any | null> {
  const cached = standingsCache.get(sportKey);
  if (cached && Date.now() - cached.fetchedAt < 3600000) return cached.data;

  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/standings`;
    const data = await fetchJson(url);
    standingsCache.set(sportKey, { data, fetchedAt: Date.now() });
    return data;
  } catch {
    return null;
  }
}

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
      const id: string = team?.id ?? '';
      if (!id) continue;
      if (displayName === teamNorm || displayName.includes(teamLast) || shortName.includes(teamLast)) {
        teamIdCache.set(cacheKey, id);
        return id;
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function getTeamRecentGames(sportKey: string, teamId: string): Promise<any[]> {
  const cacheKey = `${sportKey}:${teamId}`;
  const cached = scheduleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 3600000) return cached.data;

  const league = ESPN_LEAGUES[sportKey];
  if (!league) return [];

  try {
    const year = new Date().getFullYear();
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams/${teamId}/schedule?season=${year}&seasontype=2`;
    const data = await fetchJson(url);
    const events: any[] = data?.events ?? [];
    const today = new Date();

    const past = events.filter(e => {
      const d = new Date(e?.date ?? e?.competitions?.[0]?.date ?? '');
      return d <= today;
    }).sort((a, b) => {
      const da = new Date(a?.date ?? a?.competitions?.[0]?.date ?? '');
      const db = new Date(b?.date ?? b?.competitions?.[0]?.date ?? '');
      return db.getTime() - da.getTime();
    });

    scheduleCache.set(cacheKey, { data: past, fetchedAt: Date.now() });
    return past;
  } catch {
    return [];
  }
}

// ------------------------------------
// Division rival check
// ------------------------------------

function areDivisionRivals(sportKey: string, team1: string, team2: string): boolean {
  const divisions = DIVISIONS_BY_SPORT[sportKey];
  if (!divisions) return false;

  const norm = (s: string) => s.toLowerCase();
  const t1 = norm(team1);
  const t2 = norm(team2);

  for (const division of divisions) {
    const divNorm = division.map(norm);
    const t1InDiv = divNorm.some(d => d === t1 || d.includes(t1.split(' ').pop() ?? '') || t1.includes(d.split(' ').pop() ?? ''));
    const t2InDiv = divNorm.some(d => d === t2 || d.includes(t2.split(' ').pop() ?? '') || t2.includes(d.split(' ').pop() ?? ''));
    if (t1InDiv && t2InDiv) return true;
  }
  return false;
}

// ------------------------------------
// Standings analysis
// ------------------------------------

interface StandingInfo {
  eliminated: boolean;
  clinched: boolean;
  mustWin: boolean;
  gamesBack: number;
  gamesRemaining: number;
}

function extractStandingInfo(standingsData: any, teamName: string): StandingInfo | null {
  const defaultResult: StandingInfo = {
    eliminated: false, clinched: false, mustWin: false, gamesBack: 0, gamesRemaining: 0
  };

  if (!standingsData) return null;

  try {
    const teamLast = teamName.split(' ').pop()?.toLowerCase() ?? '';
    const groups: any[] = standingsData?.children ?? standingsData?.standings ?? [];

    for (const group of groups) {
      const entries: any[] = group?.standings?.entries ?? group?.entries ?? [];
      for (const entry of entries) {
        const name: string = (entry?.team?.displayName ?? entry?.team?.name ?? '').toLowerCase();
        if (!name.includes(teamLast)) continue;

        const stats: any[] = entry?.stats ?? [];
        const gb = stats.find((s: any) => s.name === 'gamesBehind' || s.abbreviation === 'GB')?.value ?? 0;
        const gr = stats.find((s: any) => s.name === 'gamesRemaining' || s.abbreviation === 'GR')?.value ?? 0;
        const eliminated = stats.find((s: any) => s.name === 'eliminated')?.value === 1 || false;
        const clinched = stats.find((s: any) => s.name === 'clinched' || s.abbreviation === 'CLNCH')?.value === 1 || false;

        const mustWin = !eliminated && !clinched && gb <= 1 && gr <= 5;

        return {
          eliminated,
          clinched,
          mustWin,
          gamesBack: parseFloat(String(gb)),
          gamesRemaining: parseInt(String(gr), 10),
        };
      }
    }
  } catch { /* ignore */ }

  return defaultResult;
}

// ------------------------------------
// Schedule-based checks
// ------------------------------------

async function checkScheduleFactors(
  sportKey: string,
  homeTeam: string,
  awayTeam: string,
): Promise<MotivationFactor[]> {
  const factors: MotivationFactor[] = [];

  try {
    const [homeId, awayId] = await Promise.all([
      getTeamId(sportKey, homeTeam).catch(() => null),
      getTeamId(sportKey, awayTeam).catch(() => null),
    ]);

    const [homeGames, awayGames] = await Promise.all([
      homeId ? getTeamRecentGames(sportKey, homeId).catch(() => []) : Promise.resolve([]),
      awayId ? getTeamRecentGames(sportKey, awayId).catch(() => []) : Promise.resolve([]),
    ]);

    // Revenge game check: home team lost to away team recently
    if (homeGames.length > 0 && awayId) {
      const lastVsAway = homeGames.find((g: any) => {
        const comps: any[] = g?.competitions?.[0]?.competitors ?? [];
        return comps.some((c: any) => c?.id === awayId || c?.team?.id === awayId);
      });

      if (lastVsAway) {
        const homeComp = lastVsAway?.competitions?.[0]?.competitors?.find((c: any) => c?.homeAway === 'home');
        const awayComp = lastVsAway?.competitions?.[0]?.competitors?.find((c: any) => c?.homeAway === 'away');

        if (homeComp && awayComp) {
          const homeScore = parseFloat(homeComp?.score ?? '0');
          const awayScore = parseFloat(awayComp?.score ?? '0');
          const gameDate = new Date(lastVsAway?.date ?? '');
          const daysSince = Math.floor((Date.now() - gameDate.getTime()) / (1000 * 60 * 60 * 24));

          if (daysSince <= 30 && daysSince > 0) {
            // Check if home team lost
            const homeTeamInComp = homeComp?.team?.displayName ?? '';
            const homeTeamNorm = homeTeam.toLowerCase();
            const homeWasHome = homeTeamInComp.toLowerCase().includes(homeTeam.split(' ').pop()?.toLowerCase() ?? '');

            if (homeWasHome && homeScore < awayScore) {
              factors.push({
                name: 'REVENGE_SPOT',
                team: 'home',
                detail: `Revenge spot — ${homeTeam} lost to ${awayTeam} ${daysSince} days ago`,
                scoreBonus: 8,
                confidence: 'medium',
              });
            } else if (!homeWasHome && awayScore < homeScore) {
              factors.push({
                name: 'REVENGE_SPOT',
                team: 'away',
                detail: `Revenge spot — ${awayTeam} lost to ${homeTeam} ${daysSince} days ago`,
                scoreBonus: 8,
                confidence: 'medium',
              });
            }
          }
        }
      }
    }

    // End of road trip for away team
    if (awayGames.length >= 3) {
      let consecutiveRoad = 0;
      for (const g of awayGames) {
        const comps: any[] = g?.competitions?.[0]?.competitors ?? [];
        const thisTeam = comps.find((c: any) => c?.id === awayId || c?.team?.id === awayId);
        if (thisTeam?.homeAway === 'away') consecutiveRoad++;
        else break;
      }
      if (consecutiveRoad >= 4) {
        factors.push({
          name: 'ROAD_TRIP_END',
          team: 'away',
          detail: `${consecutiveRoad}th road game — travel fatigue and low morale`,
          scoreBonus: -5,
          confidence: 'medium',
        });
      }
    }
  } catch { /* ignore */ }

  return factors;
}

// ------------------------------------
// Main export
// ------------------------------------

export async function buildMotivationMap(
  events: Array<{
    eventId: string; sportKey: string;
    homeTeam: string; awayTeam: string; gameTime: string;
  }>
): Promise<Map<string, MotivationReport>> {
  const result = new Map<string, MotivationReport>();

  // Pre-fetch standings once per sport
  const sportsInScope = [...new Set(events.map(e => e.sportKey))];
  const standingsMap = new Map<string, any>();
  await Promise.all(sportsInScope.map(async (sportKey) => {
    try {
      const data = await getStandings(sportKey);
      if (data) standingsMap.set(sportKey, data);
    } catch { /* ignore */ }
  }));

  for (const event of events) {
    try {
      const factors: MotivationFactor[] = [];

      // Check division rivalry
      if (areDivisionRivals(event.sportKey, event.homeTeam, event.awayTeam)) {
        factors.push({
          name: 'DIVISION_RIVAL',
          team: 'both',
          detail: `Division rival — expect max effort from both sides`,
          scoreBonus: 5,
          confidence: 'high',
        });
      }

      // Standings-based checks
      const standingsData = standingsMap.get(event.sportKey);
      if (standingsData) {
        const homeStanding = extractStandingInfo(standingsData, event.homeTeam);
        const awayStanding = extractStandingInfo(standingsData, event.awayTeam);

        if (homeStanding?.eliminated) {
          factors.push({
            name: 'PLAYOFF_ELIMINATED',
            team: 'home',
            detail: `${event.homeTeam} eliminated from playoffs — dead cat`,
            scoreBonus: -8,
            confidence: 'high',
          });
        }
        if (awayStanding?.eliminated) {
          factors.push({
            name: 'PLAYOFF_ELIMINATED',
            team: 'away',
            detail: `${event.awayTeam} eliminated from playoffs — dead cat`,
            scoreBonus: -8,
            confidence: 'high',
          });
        }

        if (homeStanding?.mustWin) {
          factors.push({
            name: 'MUST_WIN',
            team: 'home',
            detail: `${event.homeTeam} in must-win spot (${homeStanding.gamesBack}GB, ${homeStanding.gamesRemaining} remaining)`,
            scoreBonus: 10,
            confidence: 'high',
          });
        }
        if (awayStanding?.mustWin) {
          factors.push({
            name: 'MUST_WIN',
            team: 'away',
            detail: `${event.awayTeam} in must-win spot (${awayStanding.gamesBack}GB, ${awayStanding.gamesRemaining} remaining)`,
            scoreBonus: 10,
            confidence: 'high',
          });
        }

        if (homeStanding?.clinched && homeStanding.gamesRemaining >= 10) {
          factors.push({
            name: 'POST_CLINCH',
            team: 'home',
            detail: `${event.homeTeam} clinched with ${homeStanding.gamesRemaining} games left — possible resting of starters`,
            scoreBonus: -6,
            confidence: 'medium',
          });
        }
        if (awayStanding?.clinched && awayStanding.gamesRemaining >= 10) {
          factors.push({
            name: 'POST_CLINCH',
            team: 'away',
            detail: `${event.awayTeam} clinched with ${awayStanding.gamesRemaining} games left — possible resting of starters`,
            scoreBonus: -6,
            confidence: 'medium',
          });
        }
      }

      // Schedule-based checks (async)
      try {
        const schedFactors = await checkScheduleFactors(event.sportKey, event.homeTeam, event.awayTeam);
        factors.push(...schedFactors);
      } catch { /* ignore */ }

      // Compute net bonus
      const rawNet = factors.reduce((s, f) => s + f.scoreBonus, 0);
      const netBonus = Math.max(-20, Math.min(20, rawNet));

      // Determine high/low motivation teams
      const homeBonus = factors.filter(f => f.team === 'home' || f.team === 'both')
        .reduce((s, f) => s + f.scoreBonus, 0);
      const awayBonus = factors.filter(f => f.team === 'away' || f.team === 'both')
        .reduce((s, f) => s + f.scoreBonus, 0);

      let highMotivationTeam: 'home' | 'away' | 'neither' = 'neither';
      let lowMotivationTeam: 'home' | 'away' | 'neither' = 'neither';

      if (homeBonus > 5) highMotivationTeam = 'home';
      else if (awayBonus > 5) highMotivationTeam = 'away';

      if (homeBonus < -5) lowMotivationTeam = 'home';
      else if (awayBonus < -5) lowMotivationTeam = 'away';

      const summaryParts: string[] = [];
      if (highMotivationTeam !== 'neither') {
        const teamName = highMotivationTeam === 'home' ? event.homeTeam : event.awayTeam;
        summaryParts.push(`${teamName} highly motivated`);
      }
      if (lowMotivationTeam !== 'neither') {
        const teamName = lowMotivationTeam === 'home' ? event.homeTeam : event.awayTeam;
        summaryParts.push(`${teamName} low motivation`);
      }
      if (factors.some(f => f.name === 'DIVISION_RIVAL')) {
        summaryParts.push('division rival game');
      }
      const summary = summaryParts.length > 0
        ? summaryParts.join(' | ')
        : 'No significant motivation factors';

      result.set(event.eventId, {
        eventId: event.eventId,
        factors,
        netBonus,
        highMotivationTeam,
        lowMotivationTeam,
        summary,
      });
    } catch {
      // Non-fatal
    }
  }

  return result;
}
