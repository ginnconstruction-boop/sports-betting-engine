// ============================================================
// src/services/playerStats.ts
// Player recent form, usage, minutes trends
// Source: ESPN free API -- no key needed
// Foundation for the full prop prediction engine
// ============================================================

import https from 'https';

export interface PlayerGameLog {
  date: string;
  opponent: string;
  isHome: boolean;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fieldGoalAttempts: number;
  fieldGoalsMade: number;
  freeThrowAttempts: number;
  freeThrowsMade: number;
  plusMinus: number;
  didNotPlay: boolean;
}

export interface PlayerProfile {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  // Season averages
  seasonPPG: number;
  seasonRPG: number;
  seasonAPG: number;
  seasonMPG: number;
  season3PG: number;
  // Last 5 game averages
  l5PPG: number;
  l5RPG: number;
  l5APG: number;
  l5MPG: number;
  l5_3PG: number;
  // Last 10 game averages
  l10PPG: number;
  l10MPG: number;
  // Trends
  minutesTrend: 'rising' | 'falling' | 'stable';
  pointsTrend: 'rising' | 'falling' | 'stable';
  formVsSeason: number;       // L5 PPG - season PPG (positive = hot)
  minutesTrendPct: number;    // % change in minutes L5 vs L10
  // Home/away splits
  homePPG: number | null;
  awayPPG: number | null;
  // Prop streak tracking
  propStreaks: Record<string, number>;   // statType -> consecutive overs (positive) or unders (negative)
  // Usage rate (NBA: % of team possessions used while on floor)
  usageRate: number | null;
  // H2H vs tonight's opponent (last 5 matchups)
  h2hRecord: Record<string, { avg: number; hits: number; total: number }>;
  // Recent game logs
  recentGames: PlayerGameLog[];
  gamesPlayed: number;
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

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
}

function trend(recent: number[], older: number[]): 'rising' | 'falling' | 'stable' {
  const recentAvg = avg(recent);
  const olderAvg = avg(older);
  if (olderAvg === 0) return 'stable';
  const diff = recentAvg - olderAvg;
  if (diff > 2) return 'rising';
  if (diff < -2) return 'falling';
  return 'stable';
}

// Cache profiles to avoid re-fetching within same run
const profileCache = new Map<string, { profile: PlayerProfile; fetchedAt: number }>();
const CACHE_TTL = 3600000; // 1 hour

export async function getPlayerProfile(
  playerId: string,
  playerName: string,
  team: string,
  position: string,
  sportKey: string = 'basketball_nba'
): Promise<PlayerProfile | null> {
  const cacheKey = `${playerId}__${sportKey}`;
  const cached = profileCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.profile;

  // Only NBA has full ESPN game-log support in this engine.
  // MLB and NHL prop intelligence degrades gracefully -- return null so
  // downstream callers skip intelligence adjustment rather than use wrong data.
  if (sportKey !== 'basketball_nba' && sportKey !== 'americanfootball_nfl') {
    return null; // [DEGRADED] no ESPN game-log support for this sport
  }
  if (sportKey !== 'basketball_nba' && sportKey !== 'americanfootball_nfl') {
    return null; // [DEGRADED] player ID lookup not supported for this sport
  }
  const league = sportKey === 'basketball_nba' ? 'nba' : 'nfl';
  const sport  = sportKey === 'basketball_nba' ? 'basketball' : 'football';;

  try {
    // Get player game log from ESPN
    const logUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/athletes/${playerId}/gamelog`;
    const logData = await fetchJson(logUrl);

    const categories = logData?.seasonTypes?.[0]?.categories ?? logData?.categories ?? [];
    const events = logData?.events ?? {};

    // Build game logs
    const recentGames: PlayerGameLog[] = [];

    // ESPN gamelog structure: categories contain stats, events contain metadata
    const statCategories = Array.isArray(categories) ? categories : [];

    // Find relevant stat indices
    const getIdx = (catName: string, statName: string): number => {
      const cat = statCategories.find((c: any) =>
        (c?.name ?? c?.displayName ?? '').toLowerCase().includes(catName.toLowerCase())
      );
      if (!cat) return -1;
      const labels = cat?.labels ?? cat?.names ?? [];
      return (Array.isArray(labels) ? labels : []).findIndex((l: string) =>
        l.toLowerCase().includes(statName.toLowerCase())
      );
    };

    // Process event entries from gamelog
    const eventEntries = Object.entries(events);
    for (let i = 0; i < Math.min(eventEntries.length, 15); i++) {
      const [eventId, eventData]: [string, any] = eventEntries[i] as any;

      const isHome = eventData?.homeAway === 'home';
      const opponentAbbr = eventData?.opponent?.abbreviation ?? 'OPP';
      const gameDate = eventData?.gameDate ?? '';

      // Get stats from each category
      let pts = 0, reb = 0, ast = 0, min = 0, threes = 0, stl = 0, blk = 0, to = 0;
      let fga = 0, fgm = 0, fta = 0, ftm = 0, plusMinus = 0;
      let dnp = false;

      for (const cat of statCategories) {
        const catStats = cat?.athletes?.[0]?.stats ?? cat?.totals ?? [];
        if (!Array.isArray(catStats)) continue;

        const labels = cat?.labels ?? cat?.names ?? [];
        if (!Array.isArray(labels)) continue;

        for (let j = 0; j < labels.length; j++) {
          const label = (labels[j] ?? '').toLowerCase();
          const val = parseFloat(catStats[j] ?? '0') || 0;

          if (label === 'pts' || label === 'points') pts = val;
          else if (label === 'reb' || label === 'rebounds') reb = val;
          else if (label === 'ast' || label === 'assists') ast = val;
          else if (label === 'min' || label === 'minutes') min = val;
          else if (label === '3pm' || label === 'threes') threes = val;
          else if (label === 'stl' || label === 'steals') stl = val;
          else if (label === 'blk' || label === 'blocks') blk = val;
          else if (label === 'to' || label === 'turnovers') to = val;
          else if (label === 'fga') fga = val;
          else if (label === 'fgm') fgm = val;
          else if (label === 'fta') fta = val;
          else if (label === 'ftm') ftm = val;
          else if (label === '+/-') plusMinus = val;
          else if (label.includes('dnp') || label.includes('did not play')) dnp = true;
        }
      }

      if (min === 0 && pts === 0 && !dnp) continue; // skip empty entries

      recentGames.push({
        date: gameDate,
        opponent: opponentAbbr,
        isHome,
        minutes: min,
        points: pts,
        rebounds: reb,
        assists: ast,
        threes,
        steals: stl,
        blocks: blk,
        turnovers: to,
        fieldGoalAttempts: fga,
        fieldGoalsMade: fgm,
        freeThrowAttempts: fta,
        freeThrowsMade: ftm,
        plusMinus,
        didNotPlay: dnp,
      });
    }

    const playedGames = recentGames.filter(g => !g.didNotPlay);
    if (playedGames.length === 0) return null;

    const l5 = playedGames.slice(0, 5);
    const l10 = playedGames.slice(0, 10);
    const l5older = playedGames.slice(5, 10);

    const homeGames = playedGames.filter(g => g.isHome);
    const awayGames = playedGames.filter(g => !g.isHome);

    // Get season averages from ESPN stats endpoint
    let seasonPPG = avg(playedGames.map(g => g.points));
    let seasonRPG = avg(playedGames.map(g => g.rebounds));
    let seasonAPG = avg(playedGames.map(g => g.assists));
    let seasonMPG = avg(playedGames.map(g => g.minutes));
    let season3PG = avg(playedGames.map(g => g.threes));

    try {
      const statsUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/athletes/${playerId}/statistics`;
      const statsData = await fetchJson(statsUrl);
      const splits = statsData?.splits?.categories ?? [];
      for (const cat of (Array.isArray(splits) ? splits : [])) {
        const stats = cat?.stats ?? [];
        const names = cat?.names ?? [];
        if (!Array.isArray(stats) || !Array.isArray(names)) continue;
        for (let i = 0; i < names.length; i++) {
          const n = (names[i] ?? '').toLowerCase();
          const v = parseFloat(stats[i]?.value ?? stats[i] ?? '0') || 0;
          if (n.includes('avgpoints') || n === 'avgpts') seasonPPG = v;
          else if (n.includes('avgrebounds') || n === 'avgreb') seasonRPG = v;
          else if (n.includes('avgassists') || n === 'avgast') seasonAPG = v;
          else if (n.includes('avgminutes') || n === 'avgmin') seasonMPG = v;
        }
      }
    } catch { /* season stats are supplemental */ }

    const l5PPG = avg(l5.map(g => g.points));
    const l5MPG = avg(l5.map(g => g.minutes));
    const l10MPG = avg(l10.map(g => g.minutes));
    const l5older_MPG = avg(l5older.map(g => g.minutes));

    const minutesTrendPct = l5older_MPG > 0
      ? Math.round(((l5MPG - l5older_MPG) / l5older_MPG) * 100)
      : 0;

    // Calculate prop streaks for common markets
    // streak > 0 = consecutive overs vs season average; < 0 = consecutive unders
    const propStreaks: Record<string, number> = {};
    const statTypes = ['points', 'rebounds', 'assists', 'threes'];
    for (const st of statTypes) {
      // Use the season averages already computed above -- no undefined references
      const seasonAvg =
        st === 'points'   ? seasonPPG :
        st === 'rebounds' ? seasonRPG :
        st === 'assists'  ? seasonAPG :
        st === 'threes'   ? season3PG : 0;

      let streak = 0;
      for (const g of playedGames.slice(0, 10)) {
        const val =
          st === 'points'   ? g.points :
          st === 'rebounds' ? g.rebounds :
          st === 'assists'  ? g.assists :
          g.threes;

        const overAvg = val > seasonAvg;
        if (streak === 0) {
          streak = overAvg ? 1 : -1;
        } else if (streak > 0 && overAvg) {
          streak++;
        } else if (streak < 0 && !overAvg) {
          streak--;
        } else {
          break; // streak ended
        }
      }
      propStreaks[st] = streak;
    }

    const profile: PlayerProfile = {
      playerId, playerName, team, position,
      seasonPPG, seasonRPG, seasonAPG, seasonMPG, season3PG,
      l5PPG,
      l5RPG: avg(l5.map(g => g.rebounds)),
      l5APG: avg(l5.map(g => g.assists)),
      l5MPG,
      l5_3PG: avg(l5.map(g => g.threes)),
      l10PPG: avg(l10.map(g => g.points)),
      l10MPG,
      minutesTrend: trend(l5.map(g => g.minutes), l5older.map(g => g.minutes)),
      pointsTrend: trend(l5.map(g => g.points), l5older.map(g => g.points)),
      formVsSeason: Math.round((l5PPG - seasonPPG) * 10) / 10,
      minutesTrendPct,
      homePPG: homeGames.length > 0 ? avg(homeGames.map(g => g.points)) : null,
      awayPPG: awayGames.length > 0 ? avg(awayGames.map(g => g.points)) : null,
      propStreaks,
      usageRate: null,   // ESPN doesn't expose usage rate in free API
      h2hRecord: {},     // populated separately via H2H lookup
      recentGames: recentGames.slice(0, 10),
      gamesPlayed: playedGames.length,
      fetchedAt: new Date().toISOString(),
    };

    profileCache.set(cacheKey, { profile, fetchedAt: Date.now() });
    return profile;
  } catch {
    return null;
  }
}

// ------------------------------------
// Find player ID from name and team
// ------------------------------------

const playerIdCache = new Map<string, string>();

export async function findPlayerId(
  playerName: string,
  teamName: string,
  sportKey: string = 'basketball_nba'
): Promise<string | null> {
  const cacheKey = `${playerName}__${teamName}`;
  if (playerIdCache.has(cacheKey)) return playerIdCache.get(cacheKey)!;

  const league = sportKey === 'basketball_nba' ? 'nba' : 'nfl';
  const sport = sportKey === 'basketball_nba' ? 'basketball' : 'football';

  try {
    const last = (s: string) => s.toLowerCase().split(' ').pop() ?? '';

    // Search by roster
    const teamsUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams`;
    const teamsData = await fetchJson(teamsUrl);
    const teams = teamsData?.sports?.[0]?.leagues?.[0]?.teams ?? teamsData?.teams ?? [];

    const teamObj = (Array.isArray(teams) ? teams : []).find((t: any) =>
      last(t?.team?.displayName ?? '') === last(teamName)
    );
    if (!teamObj) return null;

    const teamId = teamObj?.team?.id;
    const rosterUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/roster`;
    const rosterData = await fetchJson(rosterUrl);
    const athletes = rosterData?.athletes ?? [];

    for (const group of (Array.isArray(athletes) ? athletes : [])) {
      const items = group?.items ?? (Array.isArray(group) ? group : []);
      for (const player of (Array.isArray(items) ? items : [])) {
        const name = player?.fullName ?? player?.displayName ?? '';
        if (last(name) === last(playerName) || name.toLowerCase().includes(last(playerName))) {
          const id = player?.id ?? '';
          if (id) {
            playerIdCache.set(cacheKey, id);
            return id;
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
