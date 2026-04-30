import axios from 'axios';

export interface NBAContextGame {
  eventId?: string;
  homeTeam: string;
  awayTeam: string;
}

export interface NBAPlayerContext {
  playerId: string;
  playerName: string;
  teamId: number | null;
  teamName: string;
  teamAbbreviation: string;
  usageRate: number | null;
  seasonUsageRate: number | null;
  assistRate: number | null;
  reboundRate: number | null;
  touches: number | null;
  minutes: number | null;
}

export interface NBATeamContext {
  teamId: number;
  teamName: string;
  teamAbbreviation: string;
  teamPace: number | null;
  defensiveRating: number | null;
  opponentDefenseRank: number | null;
  opponentAssistAllowedRank: number | null;
  opponentReboundAllowedRank: number | null;
  opponentThreeAllowedRank: number | null;
}

export interface NBAContextSnapshot {
  season: string;
  players: Map<string, NBAPlayerContext[]>;
  teams: Map<string, NBATeamContext>;
  meta: {
    players: number;
    teams: number;
    usage: number;
    matchup: number;
    fallback: number;
    requestedTeams: number;
    cacheHit: boolean;
  };
}

const NBA_STATS_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 20 * 60 * 1000;
const snapshotCache = new Map<string, { fetchedAt: number; snapshot: NBAContextSnapshot }>();

const NBA_STATS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
};

const TEAM_NAME_ALIASES: Record<string, string> = {
  'la clippers': 'los angeles clippers',
  'la lakers': 'los angeles lakers',
  'okc thunder': 'oklahoma city thunder',
  'ny knicks': 'new york knicks',
  'no pelicans': 'new orleans pelicans',
  'sa spurs': 'san antonio spurs',
};

type StatsRow = Record<string, any>;

function normalizeKey(value: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.'’`-]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalTeamKey(teamName: string): string {
  const normalized = normalizeKey(teamName);
  return TEAM_NAME_ALIASES[normalized] ?? normalized;
}

function getNBASeasonString(date = new Date()): string {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (month >= 9) {
    return `${year}-${String(year + 1).slice(-2)}`;
  }
  return `${year - 1}-${String(year).slice(-2)}`;
}

function safeNumber(value: any): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePct(value: any): number | null {
  const numeric = safeNumber(value);
  if (numeric === null || numeric <= 0) return null;
  return numeric > 1 ? numeric / 100 : numeric;
}

function buildEmptySnapshot(
  season: string,
  requestedTeams: number,
  fallback: number,
  cacheHit: boolean
): NBAContextSnapshot {
  return {
    season,
    players: new Map(),
    teams: new Map(),
    meta: {
      players: 0,
      teams: 0,
      usage: 0,
      matchup: 0,
      fallback,
      requestedTeams,
      cacheHit,
    },
  };
}

function makePlayerKey(playerName: string): string {
  return normalizeKey(playerName);
}

function rankAscendingByMetric(metricByTeamId: Map<number, number>): Map<number, number> {
  const ordered = [...metricByTeamId.entries()]
    .filter(([, value]) => Number.isFinite(value))
    .sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0));
  const ranks = new Map<number, number>();
  ordered.forEach(([teamId], idx) => ranks.set(teamId, idx + 1));
  return ranks;
}

async function fetchStatsEndpoint(endpoint: string, params: Record<string, string>): Promise<StatsRow[]> {
  const { data } = await axios.get(`https://stats.nba.com/stats/${endpoint}`, {
    headers: NBA_STATS_HEADERS,
    params,
    timeout: NBA_STATS_TIMEOUT_MS,
  });

  const resultSet = data?.resultSets?.[0] ?? data?.resultSet;
  const headers: string[] = resultSet?.headers ?? [];
  const rows: any[][] = resultSet?.rowSet ?? [];

  if (!Array.isArray(headers) || !Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => {
    const mapped: StatsRow = {};
    headers.forEach((header, idx) => {
      mapped[header] = row[idx];
    });
    return mapped;
  });
}

function getLeagueDashPlayerStatsParams(season: string, lastNGames: string): Record<string, string> {
  return {
    College: '',
    Conference: '',
    Country: '',
    DateFrom: '',
    DateTo: '',
    Division: '',
    DraftPick: '',
    DraftYear: '',
    GameScope: '',
    GameSegment: '',
    Height: '',
    LastNGames: lastNGames,
    LeagueID: '00',
    Location: '',
    MeasureType: 'Advanced',
    Month: '0',
    OpponentTeamID: '0',
    Outcome: '',
    PORound: '0',
    PaceAdjust: 'N',
    PerMode: 'PerGame',
    Period: '0',
    PlayerExperience: '',
    PlayerPosition: '',
    PlusMinus: 'N',
    Rank: 'N',
    Season: season,
    SeasonSegment: '',
    SeasonType: 'Regular Season',
    ShotClockRange: '',
    StarterBench: '',
    TeamID: '0',
    TwoWay: '0',
    VsConference: '',
    VsDivision: '',
    Weight: '',
  };
}

function getLeagueDashTeamStatsParams(season: string): Record<string, string> {
  return {
    College: '',
    Conference: '',
    Country: '',
    DateFrom: '',
    DateTo: '',
    Division: '',
    GameScope: '',
    GameSegment: '',
    LastNGames: '0',
    LeagueID: '00',
    Location: '',
    MeasureType: 'Advanced',
    Month: '0',
    OpponentTeamID: '0',
    Outcome: '',
    PORound: '0',
    PaceAdjust: 'N',
    PerMode: 'PerGame',
    Period: '0',
    PlayerExperience: '',
    PlayerPosition: '',
    PlusMinus: 'N',
    Rank: 'N',
    Season: season,
    SeasonSegment: '',
    SeasonType: 'Regular Season',
    ShotClockRange: '',
    StarterBench: '',
    TeamID: '0',
    TwoWay: '0',
    VsConference: '',
    VsDivision: '',
  };
}

function getTeamGameLogsParams(season: string): Record<string, string> {
  return {
    LeagueID: '00',
    Season: season,
    SeasonType: 'Regular Season',
    DateFrom: '',
    DateTo: '',
  };
}

export function resolveNBATeamContext(
  snapshot: NBAContextSnapshot | undefined,
  teamNameOrAbbr: string
): NBATeamContext | null {
  if (!snapshot) return null;
  return snapshot.teams.get(canonicalTeamKey(teamNameOrAbbr)) ?? null;
}

export function resolveNBAPlayerContext(
  snapshot: NBAContextSnapshot | undefined,
  playerName: string,
  preferredTeam?: string,
  homeTeam?: string,
  awayTeam?: string
): NBAPlayerContext | null {
  if (!snapshot) return null;
  const normalizedTargetName = makePlayerKey(playerName);
  let candidates = snapshot.players.get(normalizedTargetName) ?? [];
  if (candidates.length === 0) {
    const uniqueNameMatches = [...snapshot.players.entries()]
      .filter(([nameKey]) => nameKey === normalizedTargetName)
      .flatMap(([, playerContexts]) => playerContexts);
    if (uniqueNameMatches.length === 1) {
      return uniqueNameMatches[0];
    }
    candidates = uniqueNameMatches;
  }
  if (candidates.length === 0) return null;

  const requestedTeamKeys = new Set(
    [preferredTeam, homeTeam, awayTeam]
      .filter(Boolean)
      .map(team => canonicalTeamKey(String(team)))
  );

  if (requestedTeamKeys.size > 0) {
    const exact = candidates.find(candidate =>
      requestedTeamKeys.has(canonicalTeamKey(candidate.teamName)) ||
      requestedTeamKeys.has(canonicalTeamKey(candidate.teamAbbreviation))
    );
    if (exact) return exact;
  }

  const uniqueNameMatches = [...snapshot.players.values()]
    .flat()
    .filter(candidate => makePlayerKey(candidate.playerName) === normalizedTargetName);
  if (uniqueNameMatches.length === 1) {
    return uniqueNameMatches[0];
  }

  return candidates.length === 1 ? candidates[0] : null;
}

export async function buildNBAContextForSlate(games: NBAContextGame[]): Promise<NBAContextSnapshot> {
  const season = getNBASeasonString();
  const requestedTeams = [...new Set(games.flatMap(game => [game.homeTeam, game.awayTeam]).map(canonicalTeamKey))];
  const cacheKey = `${season}::${requestedTeams.slice().sort().join('|')}`;
  const cached = snapshotCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return {
      ...cached.snapshot,
      meta: {
        ...cached.snapshot.meta,
        cacheHit: true,
      },
    };
  }

  if (requestedTeams.length === 0) {
    return buildEmptySnapshot(season, 0, 0, false);
  }

  const [seasonPlayersResult, recentPlayersResult, teamStatsResult, teamLogsResult] = await Promise.allSettled([
    fetchStatsEndpoint('leaguedashplayerstats', getLeagueDashPlayerStatsParams(season, '0')),
    fetchStatsEndpoint('leaguedashplayerstats', getLeagueDashPlayerStatsParams(season, '5')),
    fetchStatsEndpoint('leaguedashteamstats', getLeagueDashTeamStatsParams(season)),
    fetchStatsEndpoint('teamgamelogs', getTeamGameLogsParams(season)),
  ]);

  const fallback = [seasonPlayersResult, recentPlayersResult, teamStatsResult, teamLogsResult]
    .filter(result => result.status === 'rejected').length;

  const seasonPlayerRows = seasonPlayersResult.status === 'fulfilled' ? seasonPlayersResult.value : [];
  const recentPlayerRows = recentPlayersResult.status === 'fulfilled' ? recentPlayersResult.value : [];
  const teamStatsRows = teamStatsResult.status === 'fulfilled' ? teamStatsResult.value : [];
  const teamLogRows = teamLogsResult.status === 'fulfilled' ? teamLogsResult.value : [];

  const snapshot = buildEmptySnapshot(season, requestedTeams.length, fallback, false);
  if (teamStatsRows.length === 0 && teamLogRows.length === 0) {
    snapshotCache.set(cacheKey, { fetchedAt: Date.now(), snapshot });
    return snapshot;
  }

  const teamMetaById = new Map<number, { teamId: number; teamName: string; teamAbbreviation: string }>();
  const teamMetaByKey = new Map<string, { teamId: number; teamName: string; teamAbbreviation: string }>();

  for (const row of teamLogRows) {
    const teamId = safeNumber(row.TEAM_ID);
    const teamName = String(row.TEAM_NAME ?? '').trim();
    const teamAbbreviation = String(row.TEAM_ABBREVIATION ?? '').trim();
    if (!teamId || !teamName) continue;
    const meta = { teamId, teamName, teamAbbreviation };
    teamMetaById.set(teamId, meta);
    teamMetaByKey.set(canonicalTeamKey(teamName), meta);
    if (teamAbbreviation) teamMetaByKey.set(canonicalTeamKey(teamAbbreviation), meta);
  }

  for (const row of teamStatsRows) {
    const teamId = safeNumber(row.TEAM_ID);
    const teamName = String(row.TEAM_NAME ?? '').trim();
    if (!teamId || !teamName) continue;
    const existing = teamMetaById.get(teamId);
    const meta = {
      teamId,
      teamName,
      teamAbbreviation: existing?.teamAbbreviation ?? '',
    };
    teamMetaById.set(teamId, meta);
    teamMetaByKey.set(canonicalTeamKey(teamName), meta);
  }

  const requestedTeamIds = new Set<number>();
  for (const teamName of requestedTeams) {
    const meta = teamMetaByKey.get(teamName);
    if (meta) requestedTeamIds.add(meta.teamId);
  }

  const teamStatsById = new Map<number, StatsRow>();
  for (const row of teamStatsRows) {
    const teamId = safeNumber(row.TEAM_ID);
    if (teamId) teamStatsById.set(teamId, row);
  }

  const allowedTotals = new Map<number, { points: number; assists: number; rebounds: number; threes: number; games: number }>();
  const gameRowsByGameId = new Map<string, StatsRow[]>();
  for (const row of teamLogRows) {
    const gameId = String(row.GAME_ID ?? '');
    if (!gameId) continue;
    const existing = gameRowsByGameId.get(gameId) ?? [];
    existing.push(row);
    gameRowsByGameId.set(gameId, existing);
  }

  for (const [, rows] of gameRowsByGameId) {
    if (rows.length !== 2) continue;
    const [rowA, rowB] = rows;
    const teamAId = safeNumber(rowA.TEAM_ID);
    const teamBId = safeNumber(rowB.TEAM_ID);
    if (!teamAId || !teamBId) continue;

    const totalsA = allowedTotals.get(teamAId) ?? { points: 0, assists: 0, rebounds: 0, threes: 0, games: 0 };
    totalsA.points += safeNumber(rowB.PTS) ?? 0;
    totalsA.assists += safeNumber(rowB.AST) ?? 0;
    totalsA.rebounds += safeNumber(rowB.REB) ?? 0;
    totalsA.threes += safeNumber(rowB.FG3M) ?? 0;
    totalsA.games += 1;
    allowedTotals.set(teamAId, totalsA);

    const totalsB = allowedTotals.get(teamBId) ?? { points: 0, assists: 0, rebounds: 0, threes: 0, games: 0 };
    totalsB.points += safeNumber(rowA.PTS) ?? 0;
    totalsB.assists += safeNumber(rowA.AST) ?? 0;
    totalsB.rebounds += safeNumber(rowA.REB) ?? 0;
    totalsB.threes += safeNumber(rowA.FG3M) ?? 0;
    totalsB.games += 1;
    allowedTotals.set(teamBId, totalsB);
  }

  const defensiveRatingByTeamId = new Map<number, number>();
  const assistsAllowedByTeamId = new Map<number, number>();
  const reboundsAllowedByTeamId = new Map<number, number>();
  const threesAllowedByTeamId = new Map<number, number>();

  for (const [teamId] of teamMetaById.entries()) {
    const teamStats = teamStatsById.get(teamId);
    const defensiveRating = safeNumber(teamStats?.DEF_RATING ?? teamStats?.E_DEF_RATING);
    if (defensiveRating !== null) defensiveRatingByTeamId.set(teamId, defensiveRating);

    const allowed = allowedTotals.get(teamId);
    if (!allowed || allowed.games <= 0) continue;
    assistsAllowedByTeamId.set(teamId, allowed.assists / allowed.games);
    reboundsAllowedByTeamId.set(teamId, allowed.rebounds / allowed.games);
    threesAllowedByTeamId.set(teamId, allowed.threes / allowed.games);
  }

  const defenseRanks = rankAscendingByMetric(defensiveRatingByTeamId);
  const assistRanks = rankAscendingByMetric(assistsAllowedByTeamId);
  const reboundRanks = rankAscendingByMetric(reboundsAllowedByTeamId);
  const threeRanks = rankAscendingByMetric(threesAllowedByTeamId);

  for (const teamId of requestedTeamIds) {
    const meta = teamMetaById.get(teamId);
    if (!meta) continue;
    const stats = teamStatsById.get(teamId);
    const teamContext: NBATeamContext = {
      teamId,
      teamName: meta.teamName,
      teamAbbreviation: meta.teamAbbreviation,
      teamPace: safeNumber(stats?.PACE ?? stats?.E_PACE),
      defensiveRating: safeNumber(stats?.DEF_RATING ?? stats?.E_DEF_RATING),
      opponentDefenseRank: defenseRanks.get(teamId) ?? null,
      opponentAssistAllowedRank: assistRanks.get(teamId) ?? null,
      opponentReboundAllowedRank: reboundRanks.get(teamId) ?? null,
      opponentThreeAllowedRank: threeRanks.get(teamId) ?? null,
    };
    snapshot.teams.set(canonicalTeamKey(meta.teamName), teamContext);
    if (meta.teamAbbreviation) snapshot.teams.set(canonicalTeamKey(meta.teamAbbreviation), teamContext);
  }

  const recentPlayersById = new Map<string, StatsRow>();
  for (const row of recentPlayerRows) {
    const playerId = String(row.PLAYER_ID ?? '').trim();
    if (playerId) recentPlayersById.set(playerId, row);
  }

  const seenPlayers = new Set<string>();
  for (const row of seasonPlayerRows) {
    const teamId = safeNumber(row.TEAM_ID);
    const playerId = String(row.PLAYER_ID ?? '').trim();
    const playerName = String(row.PLAYER_NAME ?? '').trim();
    if (!teamId || !playerId || !playerName) continue;
    if (requestedTeamIds.size > 0 && !requestedTeamIds.has(teamId)) continue;

    const teamMeta = teamMetaById.get(teamId);
    const recentRow = recentPlayersById.get(playerId);
    const playerContext: NBAPlayerContext = {
      playerId,
      playerName,
      teamId,
      teamName: teamMeta?.teamName ?? '',
      teamAbbreviation: String(row.TEAM_ABBREVIATION ?? teamMeta?.teamAbbreviation ?? '').trim(),
      usageRate: normalizePct(recentRow?.USG_PCT ?? recentRow?.E_USG_PCT),
      seasonUsageRate: normalizePct(row.USG_PCT ?? row.E_USG_PCT),
      assistRate: normalizePct(recentRow?.AST_PCT ?? row.AST_PCT ?? row.E_AST_RATIO),
      reboundRate: normalizePct(recentRow?.REB_PCT ?? row.REB_PCT ?? row.E_REB_PCT),
      touches: null,
      minutes: safeNumber(recentRow?.MIN ?? row.MIN),
    };
    const playerKey = makePlayerKey(playerName);
    const list = snapshot.players.get(playerKey) ?? [];
    list.push(playerContext);
    snapshot.players.set(playerKey, list);
    seenPlayers.add(`${playerId}__${teamId}`);
  }

  snapshot.meta.players = seenPlayers.size;
  snapshot.meta.teams = [...new Set([...snapshot.teams.values()].map(team => team.teamId))].length;
  snapshot.meta.usage = [...snapshot.players.values()]
    .flat()
    .filter(player => player.usageRate !== null || player.seasonUsageRate !== null).length;
  snapshot.meta.matchup = [...new Set(
    [...snapshot.teams.values()]
      .filter(team =>
        team.opponentDefenseRank !== null ||
        team.opponentAssistAllowedRank !== null ||
        team.opponentReboundAllowedRank !== null ||
        team.opponentThreeAllowedRank !== null
      )
      .map(team => team.teamId)
  )].length;

  snapshotCache.set(cacheKey, { fetchedAt: Date.now(), snapshot });
  return snapshot;
}
