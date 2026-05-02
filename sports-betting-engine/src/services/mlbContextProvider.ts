import https from 'https';

export interface MLBContextGame {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  gameTime?: string;
}

export interface MLBPlayerContext {
  id?: number | null;
  name: string;
  team: string;
  role: 'batter' | 'pitcher';
  batsHand?: 'L' | 'R' | 'S' | null;
  throwsHand?: 'L' | 'R' | null;
  lineupSpot?: number | null;
  starterConfirmed?: boolean;
  probableStarter?: boolean;
}

export interface MLBTeamContext {
  teamName: string;
  probablePitcher?: string | null;
  lineupConfirmed: boolean;
}

export interface MLBContextSnapshot {
  players: MLBPlayerContext[];
  teams: MLBTeamContext[];
  meta: {
    players: number;
    pitchers: number;
    teams: number;
    lineup: number;
    matchup: number;
    fallback: number;
  };
}

const CACHE_TTL_MS = 20 * 60 * 1000;

type CacheEntry = {
  expiresAt: number;
  snapshot: MLBContextSnapshot;
};

const contextCache = new Map<string, CacheEntry>();

function normalizeName(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fetchJson(url: string, timeoutMs = 12000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'sports-betting-engine/1.0',
        Accept: 'application/json',
      },
    }, (res) => {
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
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Timeout'));
    });
  });
}

function buildCacheKey(games: MLBContextGame[]): string {
  const datePart = [...new Set(games.map(game => (game.gameTime ?? '').slice(0, 10)).filter(Boolean))].sort().join('|');
  const teamsPart = games.flatMap(game => [game.homeTeam, game.awayTeam]).sort().join('|');
  return `${datePart}__${teamsPart}`;
}

function parseLineupSpot(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = String(value).replace(/^0+/, '');
  if (!cleaned) return null;
  const parsed = parseInt(cleaned.slice(0, 1), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function addPlayerIfMissing(players: MLBPlayerContext[], next: MLBPlayerContext): void {
  const key = `${normalizeName(next.name)}__${normalizeName(next.team)}__${next.role}`;
  const existingIdx = players.findIndex(player =>
    `${normalizeName(player.name)}__${normalizeName(player.team)}__${player.role}` === key
  );
  if (existingIdx >= 0) {
    players[existingIdx] = {
      ...players[existingIdx],
      ...next,
    };
    return;
  }
  players.push(next);
}

function extractGamePlayers(feed: any, homeTeam: string, awayTeam: string): MLBPlayerContext[] {
  const players: MLBPlayerContext[] = [];
  const sides = [
    { teamName: homeTeam, node: feed?.liveData?.boxscore?.teams?.home, probableStarter: true },
    { teamName: awayTeam, node: feed?.liveData?.boxscore?.teams?.away, probableStarter: true },
  ];

  for (const side of sides) {
    const playerMap = side.node?.players ?? {};
    for (const player of Object.values(playerMap) as any[]) {
      const name = player?.person?.fullName ?? '';
      if (!name) continue;
      const positionType = String(player?.position?.type ?? '').toLowerCase();
      const role: MLBPlayerContext['role'] = positionType.includes('pitcher') ? 'pitcher' : 'batter';
      addPlayerIfMissing(players, {
        id: player?.person?.id ?? null,
        name,
        team: side.teamName,
        role,
        batsHand: player?.batSide?.code ?? null,
        throwsHand: player?.pitchHand?.code ?? null,
        lineupSpot: parseLineupSpot(player?.battingOrder),
        starterConfirmed: Boolean(player?.battingOrder) || Boolean(player?.stats?.batting) || Boolean(player?.stats?.pitching),
        probableStarter: role === 'pitcher' ? Boolean(player?.gameStatus?.isCurrentPitcher) || Boolean(player?.stats?.pitching) : false,
      });
    }
  }

  return players;
}

function extractTeamContexts(feed: any, homeTeam: string, awayTeam: string): MLBTeamContext[] {
  const gameData = feed?.gameData ?? {};
  const probablePitchers = gameData?.probablePitchers ?? {};
  const homeLineup = feed?.liveData?.boxscore?.teams?.home?.players ?? {};
  const awayLineup = feed?.liveData?.boxscore?.teams?.away?.players ?? {};

  const homeLineupConfirmed = Object.values(homeLineup).some((player: any) => Boolean(player?.battingOrder));
  const awayLineupConfirmed = Object.values(awayLineup).some((player: any) => Boolean(player?.battingOrder));

  return [
    {
      teamName: homeTeam,
      probablePitcher: probablePitchers?.home?.fullName ?? null,
      lineupConfirmed: homeLineupConfirmed,
    },
    {
      teamName: awayTeam,
      probablePitcher: probablePitchers?.away?.fullName ?? null,
      lineupConfirmed: awayLineupConfirmed,
    },
  ];
}

function findScheduleGame(scheduleData: any, homeTeam: string, awayTeam: string): any | null {
  const dates = Array.isArray(scheduleData?.dates) ? scheduleData.dates : [];
  for (const dateNode of dates) {
    const games = Array.isArray(dateNode?.games) ? dateNode.games : [];
    for (const game of games) {
      const schedHome = game?.teams?.home?.team?.name ?? '';
      const schedAway = game?.teams?.away?.team?.name ?? '';
      if (
        normalizeName(schedHome) === normalizeName(homeTeam) &&
        normalizeName(schedAway) === normalizeName(awayTeam)
      ) {
        return game;
      }
    }
  }
  return null;
}

export async function buildMLBContextForSlate(games: MLBContextGame[]): Promise<MLBContextSnapshot> {
  if (games.length === 0) {
    return {
      players: [],
      teams: [],
      meta: { players: 0, pitchers: 0, teams: 0, lineup: 0, matchup: 0, fallback: 0 },
    };
  }

  const cacheKey = buildCacheKey(games);
  const cached = contextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.snapshot;
  }

  const uniqueDates = [...new Set(games.map(game => (game.gameTime ?? '').slice(0, 10)).filter(Boolean))];
  const scheduleByDate = new Map<string, any>();
  let fallback = 0;

  await Promise.all(uniqueDates.map(async (date) => {
    try {
      const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`;
      scheduleByDate.set(date, await fetchJson(url));
    } catch {
      fallback++;
    }
  }));

  const players: MLBPlayerContext[] = [];
  const teams: MLBTeamContext[] = [];
  let matchedGames = 0;

  for (const game of games) {
    try {
      const dateKey = (game.gameTime ?? '').slice(0, 10);
      const scheduleData = scheduleByDate.get(dateKey);
      const scheduleGame = scheduleData ? findScheduleGame(scheduleData, game.homeTeam, game.awayTeam) : null;
      const gamePk = scheduleGame?.gamePk;
      if (!gamePk) {
        fallback++;
        continue;
      }

      const feed = await fetchJson(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
      matchedGames++;

      for (const player of extractGamePlayers(feed, game.homeTeam, game.awayTeam)) {
        addPlayerIfMissing(players, player);
      }

      for (const teamContext of extractTeamContexts(feed, game.homeTeam, game.awayTeam)) {
        const existingIdx = teams.findIndex(team => normalizeName(team.teamName) === normalizeName(teamContext.teamName));
        if (existingIdx >= 0) {
          teams[existingIdx] = { ...teams[existingIdx], ...teamContext };
        } else {
          teams.push(teamContext);
        }
      }
    } catch {
      fallback++;
    }
  }

  const snapshot: MLBContextSnapshot = {
    players,
    teams,
    meta: {
      players: players.filter(player => player.role === 'batter').length,
      pitchers: players.filter(player => player.role === 'pitcher').length,
      teams: teams.length,
      lineup: teams.filter(team => team.lineupConfirmed).length,
      matchup: matchedGames,
      fallback,
    },
  };

  contextCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    snapshot,
  });

  return snapshot;
}

export function resolveMLBPlayerContext(
  snapshot: MLBContextSnapshot | null | undefined,
  playerName: string,
  preferredTeam?: string
): MLBPlayerContext | null {
  if (!snapshot) return null;
  const normalizedName = normalizeName(playerName);
  const exactTeam = preferredTeam ? normalizeName(preferredTeam) : '';

  const exact = snapshot.players.find(player =>
    normalizeName(player.name) === normalizedName &&
    (!exactTeam || normalizeName(player.team) === exactTeam)
  );
  if (exact) return exact;

  const matches = snapshot.players.filter(player => normalizeName(player.name) === normalizedName);
  return matches.length === 1 ? matches[0] : null;
}

export function resolveMLBTeamContext(
  snapshot: MLBContextSnapshot | null | undefined,
  teamName: string
): MLBTeamContext | null {
  if (!snapshot) return null;
  const normalizedTeam = normalizeName(teamName);
  return snapshot.teams.find(team => normalizeName(team.teamName) === normalizedTeam) ?? null;
}
