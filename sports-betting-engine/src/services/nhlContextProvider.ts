import https from 'https';

export interface NHLContextGame {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  gameTime?: string;
}

export interface NHLContextTarget {
  playerName: string;
  marketKey: string;
  team?: string;
  homeTeam: string;
  awayTeam: string;
}

export interface NHLPlayerContext {
  id?: number | null;
  name: string;
  team: string;
  teamAbbrev?: string | null;
  role: 'skater' | 'goalie';
  position?: string | null;
  shootsCatches?: 'L' | 'R' | null;
  seasonGamesPlayed?: number | null;
  seasonShots?: number | null;
  seasonPoints?: number | null;
  seasonAssists?: number | null;
  seasonSaves?: number | null;
  seasonShotsAgainst?: number | null;
  seasonGoalsAgainst?: number | null;
  seasonShotsPerGame?: number | null;
  seasonPointsPerGame?: number | null;
  seasonAssistsPerGame?: number | null;
  seasonSavesPerGame?: number | null;
  seasonShotsAgainstPerGame?: number | null;
  avgToiMinutes?: number | null;
  recentShotsPerGame?: number | null;
  recentPointsPerGame?: number | null;
  recentAssistsPerGame?: number | null;
  recentSavesPerGame?: number | null;
  recentShotsAgainstPerGame?: number | null;
  recentAvgToiMinutes?: number | null;
  recentStarts?: number | null;
  lastGameStarted?: boolean | null;
  starterStatus?: 'confirmed' | 'likely' | 'unknown' | null;
  starterSource?: 'boxscore' | 'recent_usage' | null;
}

export interface NHLTeamContext {
  teamId?: number | null;
  teamName: string;
  teamAbbrev: string;
  shotsForPerGame?: number | null;
  shotsAgainstPerGame?: number | null;
  starterGoalieName?: string | null;
  starterStatus?: 'confirmed' | 'likely' | 'unknown' | null;
}

export interface NHLContextSnapshot {
  players: NHLPlayerContext[];
  teams: NHLTeamContext[];
  league: {
    avgShotsPerGame: number | null;
    avgPointsPerGame: number | null;
    avgSavesPerGame: number | null;
    avgToiMinutes: number | null;
  };
  meta: {
    players: number;
    goalies: number;
    teams: number;
    recent: number;
    matchup: number;
    fallback: number;
    starterConfirmed: number;
    starterLikely: number;
    starterMissing: number;
    starterBoxscore: number;
    starterRecentUsage: number;
    opponent: number;
  };
}

type TeamSeed = {
  teamId: number | null;
  teamName: string;
  teamAbbrev: string;
};

type TeamRosterEntry = {
  playerId: number;
  name: string;
  position: string | null;
  shootsCatches: 'L' | 'R' | null;
  role: 'skater' | 'goalie';
};

type RosterEntry = {
  playerId: number;
  name: string;
  team: string;
  teamAbbrev: string;
  role: 'skater' | 'goalie';
  position?: string | null;
  shootsCatches?: 'L' | 'R' | null;
  seasonGamesPlayed?: number | null;
  seasonShots?: number | null;
  seasonPoints?: number | null;
  seasonAssists?: number | null;
  seasonSaves?: number | null;
  seasonShotsAgainst?: number | null;
  seasonGoalsAgainst?: number | null;
  avgToiMinutes?: number | null;
  contextGameType: number;
};

type CacheEntry = {
  expiresAt: number;
  snapshot: NHLContextSnapshot;
};

type ConfirmedStarterInfo = {
  playerId: number;
  status: 'confirmed';
};

const CACHE_TTL_MS = 20 * 60 * 1000;
const PLAYER_BATCH_SIZE = 8;
const contextCache = new Map<string, CacheEntry>();

function fetchJson(url: string, timeoutMs = 12000, redirectsRemaining = 3): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'sports-betting-engine/1.0',
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
      },
    }, (res) => {
      const redirectLocation = res.headers.location;
      if (
        redirectLocation &&
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        redirectsRemaining > 0
      ) {
        res.resume();
        fetchJson(redirectLocation, timeoutMs, redirectsRemaining - 1).then(resolve).catch(reject);
        return;
      }
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Parse error'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout')));
  });
}

function normalizeName(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNullableNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundToThousandths(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function safeDivide(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (!Number.isFinite(numerator as number) || !Number.isFinite(denominator as number) || !denominator) {
    return null;
  }
  return roundToThousandths((numerator as number) / (denominator as number));
}

function avgOrNull(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => Number.isFinite(value as number));
  if (valid.length === 0) return null;
  return roundToThousandths(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function sumNumbers(values: Array<number | null | undefined>): number {
  return values.reduce((sum, value) => sum + (Number.isFinite(value as number) ? Number(value) : 0), 0);
}

function parseToiMinutes(value: any): number | null {
  const raw = parseNullableNumber(value);
  if (raw !== null && raw > 200) {
    return roundToThousandths(raw / 60);
  }

  const text = String(value ?? '').trim();
  if (!text || !text.includes(':')) return raw !== null ? roundToThousandths(raw) : null;
  const [minutesRaw, secondsRaw] = text.split(':');
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return roundToThousandths(minutes + (seconds / 60));
}

function buildCacheKey(games: NHLContextGame[], targets: NHLContextTarget[]): string {
  const datePart = [...new Set(games.map(game => (game.gameTime ?? '').slice(0, 10)).filter(Boolean))].sort().join('|');
  const teamsPart = games.flatMap(game => [game.homeTeam, game.awayTeam]).sort().join('|');
  const targetPart = [...new Set(targets.map(target => `${normalizeName(target.playerName)}__${target.marketKey.toLowerCase()}`))]
    .sort()
    .join('|');
  return `${datePart}__${teamsPart}__${targetPart}`;
}

function toApiDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function scheduleDateVariants(rawDate: string): string[] {
  const seed = new Date(`${rawDate}T00:00:00Z`);
  if (Number.isNaN(seed.getTime())) return [rawDate];
  return [...new Set([0, -1, 1].map(offset => {
    const copy = new Date(seed);
    copy.setUTCDate(copy.getUTCDate() + offset);
    return copy.toISOString().slice(0, 10);
  }))];
}

function fullTeamName(teamNode: any): string {
  const place = String(teamNode?.placeName?.default ?? '').trim();
  const common = String(teamNode?.commonName?.default ?? '').trim();
  return `${place} ${common}`.trim();
}

function addRosterEntry(entries: RosterEntry[], next: RosterEntry): void {
  const key = `${next.playerId}__${normalizeName(next.team)}__${next.role}`;
  const existingIdx = entries.findIndex(entry =>
    `${entry.playerId}__${normalizeName(entry.team)}__${entry.role}` === key
  );
  if (existingIdx >= 0) {
    entries[existingIdx] = { ...entries[existingIdx], ...next };
    return;
  }
  entries.push(next);
}

function buildTeamRosterMap(roster: any): Map<number, TeamRosterEntry> {
  const result = new Map<number, TeamRosterEntry>();
  const append = (players: any[], role: 'skater' | 'goalie') => {
    for (const player of players ?? []) {
      const playerId = parseNullableNumber(player?.id);
      if (!playerId) continue;
      const firstName = String(player?.firstName?.default ?? '').trim();
      const lastName = String(player?.lastName?.default ?? '').trim();
      const fullName = `${firstName} ${lastName}`.trim();
      const shootsCatches = String(player?.shootsCatches ?? '').trim().toUpperCase();
      result.set(playerId, {
        playerId,
        name: fullName,
        position: String(player?.positionCode ?? '').trim() || null,
        shootsCatches: shootsCatches === 'L' || shootsCatches === 'R' ? shootsCatches : null,
        role,
      });
    }
  };

  append(roster?.forwards ?? [], 'skater');
  append(roster?.defensemen ?? [], 'skater');
  append(roster?.goalies ?? [], 'goalie');
  return result;
}

function computeTeamShotsForPerGame(stats: any): number | null {
  const skaters = Array.isArray(stats?.skaters) ? stats.skaters : [];
  const teamGamesPlayed = Math.max(
    0,
    ...skaters
      .map((skater: any) => parseNullableNumber(skater?.gamesPlayed) ?? 0)
  );
  const totalShots = sumNumbers(
    skaters.map((skater: any) => parseNullableNumber(skater?.shots))
  );
  return teamGamesPlayed > 0 ? roundToThousandths(totalShots / teamGamesPlayed) : null;
}

function computeTeamShotsAgainstPerGame(stats: any): number | null {
  const goalies = Array.isArray(stats?.goalies) ? stats.goalies : [];
  const totalShotsAgainst = sumNumbers(
    goalies.map((goalie: any) => parseNullableNumber(goalie?.shotsAgainst))
  );
  const totalGamesStarted = sumNumbers(
    goalies.map((goalie: any) => parseNullableNumber(goalie?.gamesStarted))
  );
  const fallbackGamesPlayed = Math.max(
    0,
    ...goalies.map((goalie: any) => parseNullableNumber(goalie?.gamesPlayed) ?? 0)
  );
  const denominator = totalGamesStarted > 0 ? totalGamesStarted : fallbackGamesPlayed;
  return denominator > 0 ? roundToThousandths(totalShotsAgainst / denominator) : null;
}

function buildRosterEntriesForTeam(team: TeamSeed, roster: any, stats: any): RosterEntry[] {
  const rosterMap = buildTeamRosterMap(roster);
  const entries: RosterEntry[] = [];
  const contextGameType = parseNullableNumber(stats?.gameType) ?? 2;

  for (const skater of stats?.skaters ?? []) {
    const playerId = parseNullableNumber(skater?.playerId);
    if (!playerId) continue;
    const rosterPlayer = rosterMap.get(playerId);
    const firstName = String(skater?.firstName?.default ?? '').trim();
    const lastName = String(skater?.lastName?.default ?? '').trim();
    const fallbackName = `${firstName} ${lastName}`.trim();
    addRosterEntry(entries, {
      playerId,
      name: rosterPlayer?.name || fallbackName,
      team: team.teamName,
      teamAbbrev: team.teamAbbrev,
      role: 'skater',
      position: rosterPlayer?.position ?? (String(skater?.positionCode ?? '').trim() || null),
      shootsCatches: rosterPlayer?.shootsCatches ?? null,
      seasonGamesPlayed: parseNullableNumber(skater?.gamesPlayed),
      seasonShots: parseNullableNumber(skater?.shots),
      seasonPoints: parseNullableNumber(skater?.points),
      seasonAssists: parseNullableNumber(skater?.assists),
      avgToiMinutes: parseToiMinutes(skater?.avgTimeOnIcePerGame),
      contextGameType,
    });
  }

  for (const goalie of stats?.goalies ?? []) {
    const playerId = parseNullableNumber(goalie?.playerId);
    if (!playerId) continue;
    const rosterPlayer = rosterMap.get(playerId);
    const firstName = String(goalie?.firstName?.default ?? '').trim();
    const lastName = String(goalie?.lastName?.default ?? '').trim();
    const fallbackName = `${firstName} ${lastName}`.trim();
    const seasonGamesPlayed = parseNullableNumber(goalie?.gamesPlayed);
    addRosterEntry(entries, {
      playerId,
      name: rosterPlayer?.name || fallbackName,
      team: team.teamName,
      teamAbbrev: team.teamAbbrev,
      role: 'goalie',
      position: rosterPlayer?.position ?? ('G'),
      shootsCatches: rosterPlayer?.shootsCatches ?? null,
      seasonGamesPlayed,
      seasonSaves: parseNullableNumber(goalie?.saves),
      seasonShotsAgainst: parseNullableNumber(goalie?.shotsAgainst),
      seasonGoalsAgainst: parseNullableNumber(goalie?.goalsAgainst),
      avgToiMinutes: safeDivide(parseToiMinutes(goalie?.toi), seasonGamesPlayed),
      contextGameType,
    });
  }

  return entries;
}

function resolveRosterEntry(
  roster: RosterEntry[],
  target: NHLContextTarget
): RosterEntry | null {
  const normalizedPlayer = normalizeName(target.playerName);
  const preferredTeam = normalizeName(target.team ?? '');
  const homeTeam = normalizeName(target.homeTeam);
  const awayTeam = normalizeName(target.awayTeam);

  const exact = roster.find(entry =>
    normalizeName(entry.name) === normalizedPlayer &&
    (!preferredTeam || normalizeName(entry.team) === preferredTeam)
  );
  if (exact) return exact;

  const sameGame = roster.filter(entry =>
    normalizeName(entry.name) === normalizedPlayer &&
    (normalizeName(entry.team) === homeTeam || normalizeName(entry.team) === awayTeam)
  );
  if (sameGame.length === 1) return sameGame[0];

  const matches = roster.filter(entry => normalizeName(entry.name) === normalizedPlayer);
  return matches.length === 1 ? matches[0] : null;
}

function buildPlayerContext(
  entry: RosterEntry,
  landing: any,
  confirmedStarter: ConfirmedStarterInfo | null
): NHLPlayerContext {
  const recentGames = Array.isArray(landing?.last5Games)
    ? landing.last5Games.filter((game: any) => Number(game?.gameTypeId) === entry.contextGameType)
    : [];
  const recentShots = recentGames.map((game: any) => parseNullableNumber(game?.shots)).filter((value): value is number => value !== null);
  const recentPoints = recentGames.map((game: any) => parseNullableNumber(game?.points)).filter((value): value is number => value !== null);
  const recentAssists = recentGames.map((game: any) => parseNullableNumber(game?.assists)).filter((value): value is number => value !== null);
  const recentSaves = recentGames.map((game: any) => {
    const shotsAgainst = parseNullableNumber(game?.shotsAgainst);
    const goalsAgainst = parseNullableNumber(game?.goalsAgainst) ?? 0;
    if (shotsAgainst === null) return null;
    return Math.max(0, shotsAgainst - goalsAgainst);
  }).filter((value): value is number => value !== null);
  const recentShotsAgainst = recentGames.map((game: any) => parseNullableNumber(game?.shotsAgainst)).filter((value): value is number => value !== null);
  const recentToi = recentGames.map((game: any) => parseToiMinutes(game?.toi)).filter((value): value is number => value !== null);
  const recentStarts = recentGames.filter((game: any) => Number(game?.gamesStarted) === 1).length;
  const lastGameStarted = recentGames.length > 0 ? Number(recentGames[0]?.gamesStarted) === 1 : null;
  const recentStarterToi = recentGames
    .filter((game: any) => Number(game?.gamesStarted) === 1)
    .map((game: any) => parseToiMinutes(game?.toi))
    .filter((value): value is number => value !== null);
  const starterStatus: NHLPlayerContext['starterStatus'] = entry.role !== 'goalie'
    ? null
    : confirmedStarter?.status === 'confirmed'
      ? 'confirmed'
      : (
        lastGameStarted === true &&
        avgOrNull(recentStarterToi) !== null &&
        (avgOrNull(recentStarterToi) ?? 0) >= 55
      ) || (
        recentStarts >= 2 &&
        avgOrNull(recentStarterToi) !== null &&
        (avgOrNull(recentStarterToi) ?? 0) >= 50
      )
        ? 'likely'
        : 'unknown';
  const starterSource: NHLPlayerContext['starterSource'] = entry.role !== 'goalie'
    ? null
    : confirmedStarter?.status === 'confirmed'
      ? 'boxscore'
      : starterStatus === 'likely'
        ? 'recent_usage'
        : null;

  return {
    id: entry.playerId,
    name: entry.name,
    team: entry.team,
    teamAbbrev: entry.teamAbbrev,
    role: entry.role,
    position: entry.position ?? null,
    shootsCatches: entry.shootsCatches ?? null,
    seasonGamesPlayed: entry.seasonGamesPlayed ?? null,
    seasonShots: entry.seasonShots ?? null,
    seasonPoints: entry.seasonPoints ?? null,
    seasonAssists: entry.seasonAssists ?? null,
    seasonSaves: entry.seasonSaves ?? null,
    seasonShotsAgainst: entry.seasonShotsAgainst ?? null,
    seasonGoalsAgainst: entry.seasonGoalsAgainst ?? null,
    seasonShotsPerGame: safeDivide(entry.seasonShots, entry.seasonGamesPlayed),
    seasonPointsPerGame: safeDivide(entry.seasonPoints, entry.seasonGamesPlayed),
    seasonAssistsPerGame: safeDivide(entry.seasonAssists, entry.seasonGamesPlayed),
    seasonSavesPerGame: safeDivide(entry.seasonSaves, entry.seasonGamesPlayed),
    seasonShotsAgainstPerGame: safeDivide(entry.seasonShotsAgainst, entry.seasonGamesPlayed),
    avgToiMinutes: entry.avgToiMinutes ?? null,
    recentShotsPerGame: avgOrNull(recentShots),
    recentPointsPerGame: avgOrNull(recentPoints),
    recentAssistsPerGame: avgOrNull(recentAssists),
    recentSavesPerGame: avgOrNull(recentSaves),
    recentShotsAgainstPerGame: avgOrNull(recentShotsAgainst),
    recentAvgToiMinutes: avgOrNull(recentToi),
    recentStarts,
    lastGameStarted,
    starterStatus,
    starterSource,
  };
}

function computeLeagueAverages(players: NHLPlayerContext[]): NHLContextSnapshot['league'] {
  const skaters = players.filter(player => player.role === 'skater');
  const goalies = players.filter(player => player.role === 'goalie');
  return {
    avgShotsPerGame: avgOrNull(skaters.map(player => player.seasonShotsPerGame)),
    avgPointsPerGame: avgOrNull(skaters.map(player => player.seasonPointsPerGame)),
    avgSavesPerGame: avgOrNull(goalies.map(player => player.seasonSavesPerGame)),
    avgToiMinutes: avgOrNull(skaters.map(player => player.avgToiMinutes)),
  };
}

export async function buildNHLContextForSlate(
  games: NHLContextGame[],
  targets: NHLContextTarget[]
): Promise<NHLContextSnapshot> {
  const cacheKey = buildCacheKey(games, targets);
  const cached = contextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;

  const uniqueDates = [...new Set(games.map(game => (game.gameTime ?? '').slice(0, 10)).filter(Boolean))];
  const seedDates = uniqueDates.length > 0 ? uniqueDates : [toApiDate(new Date())];
  const datesToFetch = [...new Set(seedDates.flatMap(scheduleDateVariants))];
  const matchedGames: any[] = [];
  const matchedGameIds = new Set<number>();
  let fallback = 0;

  for (const date of datesToFetch) {
    try {
      const schedule = await fetchJson(`https://api-web.nhle.com/v1/schedule/${date}`);
      const scheduleGames = Array.isArray(schedule?.gameWeek)
        ? schedule.gameWeek.flatMap((week: any) => week?.games ?? [])
        : [];
      for (const inputGame of games) {
        const normalizedHome = normalizeName(inputGame.homeTeam);
        const normalizedAway = normalizeName(inputGame.awayTeam);
        const match = scheduleGames.find((candidate: any) =>
          normalizeName(fullTeamName(candidate?.homeTeam)) === normalizedHome &&
          normalizeName(fullTeamName(candidate?.awayTeam)) === normalizedAway
        );
        const matchId = parseNullableNumber(match?.id);
        if (match && matchId && !matchedGameIds.has(matchId)) {
          matchedGameIds.add(matchId);
          matchedGames.push(match);
        }
      }
    } catch {
      fallback++;
    }
  }

  const teamsByKey = new Map<string, TeamSeed>();
  const confirmedStartersByPlayerId = new Map<number, ConfirmedStarterInfo>();
  for (const game of matchedGames) {
    const homeTeam: TeamSeed = {
      teamId: parseNullableNumber(game?.homeTeam?.id),
      teamName: fullTeamName(game?.homeTeam),
      teamAbbrev: String(game?.homeTeam?.abbrev ?? '').trim(),
    };
    const awayTeam: TeamSeed = {
      teamId: parseNullableNumber(game?.awayTeam?.id),
      teamName: fullTeamName(game?.awayTeam),
      teamAbbrev: String(game?.awayTeam?.abbrev ?? '').trim(),
    };
    teamsByKey.set(homeTeam.teamAbbrev, homeTeam);
    teamsByKey.set(awayTeam.teamAbbrev, awayTeam);

    try {
      const boxscore = await fetchJson(`https://api-web.nhle.com/v1/gamecenter/${game.id}/boxscore`);
      for (const goalie of boxscore?.playerByGameStats?.homeTeam?.goalies ?? []) {
        if (goalie?.starter === true) {
          const playerId = parseNullableNumber(goalie?.playerId);
          if (playerId) confirmedStartersByPlayerId.set(playerId, { playerId, status: 'confirmed' });
        }
      }
      for (const goalie of boxscore?.playerByGameStats?.awayTeam?.goalies ?? []) {
        if (goalie?.starter === true) {
          const playerId = parseNullableNumber(goalie?.playerId);
          if (playerId) confirmedStartersByPlayerId.set(playerId, { playerId, status: 'confirmed' });
        }
      }
    } catch {
      fallback++;
    }
  }

  const rosterEntries: RosterEntry[] = [];
  const teamContextsByAbbrev = new Map<string, NHLTeamContext>();
  for (const team of teamsByKey.values()) {
    try {
      const [roster, stats] = await Promise.all([
        fetchJson(`https://api-web.nhle.com/v1/roster/${team.teamAbbrev}/current`),
        fetchJson(`https://api-web.nhle.com/v1/club-stats/${team.teamAbbrev}/now`),
      ]);
      for (const entry of buildRosterEntriesForTeam(team, roster, stats)) {
        addRosterEntry(rosterEntries, entry);
      }
      teamContextsByAbbrev.set(team.teamAbbrev, {
        teamId: team.teamId,
        teamName: team.teamName,
        teamAbbrev: team.teamAbbrev,
        shotsForPerGame: computeTeamShotsForPerGame(stats),
        shotsAgainstPerGame: computeTeamShotsAgainstPerGame(stats),
        starterGoalieName: null,
        starterStatus: 'unknown',
      });
    } catch {
      fallback++;
    }
  }

  const supportedTargets = targets.filter(target => {
    const market = target.marketKey.toLowerCase();
    return market === 'player_shots_on_goal' || market === 'goalie_saves';
  });

  const resolvedTargets: RosterEntry[] = [];
  const seenIds = new Set<number>();
  for (const target of supportedTargets) {
    const entry = resolveRosterEntry(rosterEntries, target);
    if (!entry || seenIds.has(entry.playerId)) continue;
    seenIds.add(entry.playerId);
    resolvedTargets.push(entry);
  }

  const players: NHLPlayerContext[] = [];
  for (let i = 0; i < resolvedTargets.length; i += PLAYER_BATCH_SIZE) {
    const batch = resolvedTargets.slice(i, i + PLAYER_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (entry) => {
        const landing = await fetchJson(`https://api-web.nhle.com/v1/player/${entry.playerId}/landing`);
        return buildPlayerContext(entry, landing, confirmedStartersByPlayerId.get(entry.playerId) ?? null);
      })
    );
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        players.push(result.value);
      } else {
        fallback++;
      }
    }
  }

  for (const teamContext of teamContextsByAbbrev.values()) {
    const goalies = players.filter(player =>
      player.role === 'goalie' &&
      player.teamAbbrev === teamContext.teamAbbrev
    );
    const confirmed = goalies.find(player => player.starterStatus === 'confirmed');
    const likely = goalies
      .filter(player => player.starterStatus === 'likely')
      .sort((a, b) => (b.recentAvgToiMinutes ?? 0) - (a.recentAvgToiMinutes ?? 0))[0];
    const chosen = confirmed ?? likely ?? null;
    teamContext.starterGoalieName = chosen?.name ?? null;
    teamContext.starterStatus = chosen?.starterStatus ?? 'unknown';
  }

  const snapshot: NHLContextSnapshot = {
    players,
    teams: [...teamContextsByAbbrev.values()],
    league: computeLeagueAverages(players),
    meta: {
      players: players.filter(player => player.role === 'skater').length,
      goalies: players.filter(player => player.role === 'goalie').length,
      teams: teamContextsByAbbrev.size,
      recent: players.filter(player =>
        (player.role === 'skater' && player.recentShotsPerGame !== null) ||
        (player.role === 'goalie' && player.recentSavesPerGame !== null)
      ).length,
      matchup: matchedGames.length,
      fallback,
      starterConfirmed: players.filter(player => player.role === 'goalie' && player.starterStatus === 'confirmed').length,
      starterLikely: players.filter(player => player.role === 'goalie' && player.starterStatus === 'likely').length,
      starterMissing: players.filter(player => player.role === 'goalie' && player.starterStatus !== 'confirmed' && player.starterStatus !== 'likely').length,
      starterBoxscore: players.filter(player => player.role === 'goalie' && player.starterSource === 'boxscore').length,
      starterRecentUsage: players.filter(player => player.role === 'goalie' && player.starterSource === 'recent_usage').length,
      opponent: [...teamContextsByAbbrev.values()].filter(team => team.shotsAgainstPerGame !== null).length,
    },
  };

  contextCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    snapshot,
  });

  return snapshot;
}

export function resolveNHLPlayerContext(
  snapshot: NHLContextSnapshot | null | undefined,
  playerName: string,
  preferredTeam?: string
): NHLPlayerContext | null {
  if (!snapshot) return null;
  const normalizedPlayer = normalizeName(playerName);
  const normalizedTeam = normalizeName(preferredTeam ?? '');

  const exact = snapshot.players.find(player =>
    normalizeName(player.name) === normalizedPlayer &&
    (!normalizedTeam || normalizeName(player.team) === normalizedTeam)
  );
  if (exact) return exact;

  const matches = snapshot.players.filter(player => normalizeName(player.name) === normalizedPlayer);
  return matches.length === 1 ? matches[0] : null;
}

export function resolveNHLTeamContext(
  snapshot: NHLContextSnapshot | null | undefined,
  teamName: string
): NHLTeamContext | null {
  if (!snapshot) return null;
  const normalizedTeam = normalizeName(teamName);
  return snapshot.teams.find(team => normalizeName(team.teamName) === normalizedTeam) ?? null;
}
