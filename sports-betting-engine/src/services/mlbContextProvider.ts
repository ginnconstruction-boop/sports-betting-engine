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
  seasonGamesPlayed?: number | null;
  seasonGamesStarted?: number | null;
  seasonPlateAppearances?: number | null;
  seasonAtBats?: number | null;
  seasonHits?: number | null;
  seasonTotalBases?: number | null;
  seasonBatterStrikeouts?: number | null;
  seasonPitchingOuts?: number | null;
  seasonPitcherStrikeouts?: number | null;
  seasonPitcherHitsAllowed?: number | null;
  seasonPitcherEarnedRuns?: number | null;
  seasonPitcherBattersFaced?: number | null;
  seasonHitsPerGame?: number | null;
  seasonTotalBasesPerGame?: number | null;
  recentHitsPerGame?: number | null;
  recentTotalBasesPerGame?: number | null;
  splitVsLeftHitsPerGame?: number | null;
  splitVsRightHitsPerGame?: number | null;
  splitVsLeftTotalBasesPerGame?: number | null;
  splitVsRightTotalBasesPerGame?: number | null;
  seasonAvgInnings?: number | null;
  recentAvgInnings?: number | null;
  projectedInnings?: number | null;
  seasonKPerStart?: number | null;
  recentKPerStart?: number | null;
  seasonHitsAllowedPerStart?: number | null;
  recentHitsAllowedPerStart?: number | null;
  seasonERPerStart?: number | null;
  recentERPerStart?: number | null;
  pitcherKRate?: number | null;
}

export interface MLBTeamContext {
  teamId?: number | null;
  teamName: string;
  probablePitcher?: string | null;
  probablePitcherId?: number | null;
  probablePitcherHand?: 'L' | 'R' | null;
  lineupConfirmed: boolean;
  teamStrikeoutRate?: number | null;
  teamContactRate?: number | null;
  lineupStrikeoutRate?: number | null;
  lineupContactRate?: number | null;
  lineupBatterCount?: number | null;
  parkRunFactor?: number | null;
  parkHitFactor?: number | null;
}

export interface MLBContextSnapshot {
  players: MLBPlayerContext[];
  teams: MLBTeamContext[];
  league: {
    avgPitcherKRate: number | null;
    avgOpponentKRate: number | null;
    avgContactRate: number | null;
    avgHitsAllowedPerStart: number | null;
    avgERPerStart: number | null;
  };
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
const RECENT_GAMES_COUNT = 10;
const RECENT_LOOKBACK_DAYS = 35;

const MLB_PARK_FACTORS: Record<string, { run: number; hit: number }> = {
  'Arizona Diamondbacks': { run: 1.07, hit: 1.05 },
  'Athletics': { run: 0.94, hit: 0.95 },
  'Atlanta Braves': { run: 0.97, hit: 0.98 },
  'Baltimore Orioles': { run: 1.06, hit: 1.05 },
  'Colorado Rockies': { run: 1.16, hit: 1.12 },
  'Boston Red Sox': { run: 1.09, hit: 1.08 },
  'Chicago Cubs': { run: 1.03, hit: 1.03 },
  'Chicago White Sox': { run: 1.01, hit: 1.01 },
  'Cincinnati Reds': { run: 1.08, hit: 1.06 },
  'Cleveland Guardians': { run: 0.99, hit: 0.99 },
  'Detroit Tigers': { run: 0.95, hit: 0.96 },
  'Houston Astros': { run: 0.98, hit: 0.99 },
  'Kansas City Royals': { run: 0.99, hit: 1.00 },
  'Los Angeles Angels': { run: 0.96, hit: 0.97 },
  'Los Angeles Dodgers': { run: 0.97, hit: 0.98 },
  'Miami Marlins': { run: 0.92, hit: 0.93 },
  'Milwaukee Brewers': { run: 1.01, hit: 1.01 },
  'Minnesota Twins': { run: 1.00, hit: 1.00 },
  'New York Mets': { run: 0.96, hit: 0.97 },
  'New York Yankees': { run: 1.04, hit: 1.03 },
  'Philadelphia Phillies': { run: 1.05, hit: 1.04 },
  'Pittsburgh Pirates': { run: 0.96, hit: 0.97 },
  'San Diego Padres': { run: 0.93, hit: 0.94 },
  'San Francisco Giants': { run: 0.93, hit: 0.94 },
  'Seattle Mariners': { run: 0.94, hit: 0.95 },
  'St. Louis Cardinals': { run: 0.99, hit: 0.99 },
  'Tampa Bay Rays': { run: 0.95, hit: 0.96 },
  'Texas Rangers': { run: 1.01, hit: 1.02 },
  'Toronto Blue Jays': { run: 1.02, hit: 1.02 },
  'Washington Nationals': { run: 0.97, hit: 0.98 },
};

type CacheEntry = {
  expiresAt: number;
  snapshot: MLBContextSnapshot;
};

type BatterRecentAccumulator = {
  games: number;
  hits: number;
  totalBases: number;
  vsLeftGames: number;
  vsLeftHits: number;
  vsLeftTotalBases: number;
  vsRightGames: number;
  vsRightHits: number;
  vsRightTotalBases: number;
};

type PitcherRecentAccumulator = {
  starts: number;
  outs: number;
  strikeouts: number;
  hitsAllowed: number;
  earnedRuns: number;
};

type TeamRecentAccumulator = {
  games: number;
  atBats: number;
  plateAppearances: number;
  strikeouts: number;
};

type BatterSplitAccumulator = {
  hitsPerGame: number | null;
  totalBasesPerGame: number | null;
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

function parseNullableNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseHandCode(value: any): 'L' | 'R' | 'S' | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'L' || normalized === 'R' || normalized === 'S') return normalized;
  return null;
}

function parsePitchHandCode(value: any): 'L' | 'R' | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'L' || normalized === 'R') return normalized;
  return null;
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

function computeTotalBasesFromBattingStats(stats: any): number | null {
  const singles = parseNullableNumber(stats?.hits) ?? 0;
  const doubles = parseNullableNumber(stats?.doubles) ?? 0;
  const triples = parseNullableNumber(stats?.triples) ?? 0;
  const homeRuns = parseNullableNumber(stats?.homeRuns) ?? 0;
  const derivedSingles = Math.max(0, singles - doubles - triples - homeRuns);
  const weighted = derivedSingles + (doubles * 2) + (triples * 3) + (homeRuns * 4);
  const provided = parseNullableNumber(stats?.totalBases);
  if (provided !== null && provided > 0) return provided;
  return weighted > 0 ? weighted : null;
}

function toApiDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function subtractDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return toApiDate(date);
}

function extractSeasonBaselines(player: any): Partial<MLBPlayerContext> {
  const batting = player?.seasonStats?.batting ?? {};
  const pitching = player?.seasonStats?.pitching ?? {};
  const seasonGamesPlayed = parseNullableNumber(batting?.gamesPlayed ?? pitching?.gamesPlayed);
  const seasonGamesStarted = parseNullableNumber(pitching?.gamesStarted);
  const seasonPlateAppearances = parseNullableNumber(batting?.plateAppearances);
  const seasonAtBats = parseNullableNumber(batting?.atBats);
  const seasonHits = parseNullableNumber(batting?.hits);
  const seasonTotalBases = computeTotalBasesFromBattingStats(batting);
  const seasonBatterStrikeouts = parseNullableNumber(batting?.strikeOuts);
  const seasonPitchingOuts = parseNullableNumber(pitching?.outs);
  const seasonPitcherStrikeouts = parseNullableNumber(pitching?.strikeOuts);
  const seasonPitcherHitsAllowed = parseNullableNumber(pitching?.hits);
  const seasonPitcherEarnedRuns = parseNullableNumber(pitching?.earnedRuns);
  const seasonPitcherBattersFaced = parseNullableNumber(pitching?.battersFaced);

  return {
    seasonGamesPlayed,
    seasonGamesStarted,
    seasonPlateAppearances,
    seasonAtBats,
    seasonHits,
    seasonTotalBases,
    seasonBatterStrikeouts,
    seasonPitchingOuts,
    seasonPitcherStrikeouts,
    seasonPitcherHitsAllowed,
    seasonPitcherEarnedRuns,
    seasonPitcherBattersFaced,
    seasonHitsPerGame: safeDivide(seasonHits, seasonGamesPlayed),
    seasonTotalBasesPerGame: safeDivide(seasonTotalBases, seasonGamesPlayed),
    seasonAvgInnings: safeDivide(seasonPitchingOuts, Math.max((seasonGamesStarted ?? 0), 1) * 3),
    seasonKPerStart: safeDivide(seasonPitcherStrikeouts, seasonGamesStarted),
    seasonHitsAllowedPerStart: safeDivide(seasonPitcherHitsAllowed, seasonGamesStarted),
    seasonERPerStart: safeDivide(seasonPitcherEarnedRuns, seasonGamesStarted),
    pitcherKRate: safeDivide(seasonPitcherStrikeouts, seasonPitcherBattersFaced),
  };
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

function getPlayerById(teamNode: any, playerId: number | null | undefined): any | null {
  if (!playerId) return null;
  return teamNode?.players?.[`ID${playerId}`] ?? null;
}

function getLineupPlayers(teamNode: any): any[] {
  const seenSpots = new Set<number>();
  return (Object.values(teamNode?.players ?? {}) as any[])
    .filter((player: any) => Boolean(player?.battingOrder))
    .filter((player: any) => {
      const positionType = String(player?.position?.type ?? '').toLowerCase();
      return !positionType.includes('pitcher');
    })
    .filter((player: any) => {
      const spot = parseLineupSpot(player?.battingOrder);
      if (!spot || seenSpots.has(spot)) return false;
      seenSpots.add(spot);
      return true;
    })
    .sort((a: any, b: any) => String(a?.battingOrder ?? '').localeCompare(String(b?.battingOrder ?? '')));
}

function computeLineupRates(teamNode: any): {
  strikeoutRate: number | null;
  contactRate: number | null;
  batterCount: number;
} {
  const lineupPlayers = getLineupPlayers(teamNode);
  if (lineupPlayers.length === 0) {
    return { strikeoutRate: null, contactRate: null, batterCount: 0 };
  }

  let totalPlateAppearances = 0;
  let totalAtBats = 0;
  let totalStrikeouts = 0;

  for (const player of lineupPlayers) {
    const batting = player?.seasonStats?.batting ?? {};
    totalPlateAppearances += parseNullableNumber(batting?.plateAppearances) ?? 0;
    totalAtBats += parseNullableNumber(batting?.atBats) ?? 0;
    totalStrikeouts += parseNullableNumber(batting?.strikeOuts) ?? 0;
  }

  const nonStrikeoutAtBats = totalAtBats - totalStrikeouts;
  return {
    strikeoutRate: safeDivide(totalStrikeouts, totalPlateAppearances),
    contactRate: safeDivide(nonStrikeoutAtBats, totalAtBats),
    batterCount: lineupPlayers.length,
  };
}

function extractGamePlayers(feed: any, homeTeam: string, awayTeam: string): MLBPlayerContext[] {
  const players: MLBPlayerContext[] = [];
  const sides = [
    { teamName: homeTeam, node: feed?.liveData?.boxscore?.teams?.home },
    { teamName: awayTeam, node: feed?.liveData?.boxscore?.teams?.away },
  ];

  for (const side of sides) {
    const playerMap = side.node?.players ?? {};
    const teamPitchers = Array.isArray(side.node?.pitchers) ? side.node.pitchers : [];
    const probablePitcherId = teamPitchers.length > 0 ? teamPitchers[0] : null;

    for (const player of Object.values(playerMap) as any[]) {
      const name = player?.person?.fullName ?? '';
      if (!name) continue;
      const positionType = String(player?.position?.type ?? '').toLowerCase();
      const role: MLBPlayerContext['role'] = positionType.includes('pitcher') ? 'pitcher' : 'batter';
      const playerId = player?.person?.id ?? null;
      addPlayerIfMissing(players, {
        id: playerId,
        name,
        team: side.teamName,
        role,
        batsHand: parseHandCode(player?.batSide?.code),
        throwsHand: parsePitchHandCode(player?.pitchHand?.code),
        lineupSpot: parseLineupSpot(player?.battingOrder),
        starterConfirmed: Boolean(player?.battingOrder) || Boolean(player?.stats?.batting) || Boolean(player?.stats?.pitching),
        probableStarter: role === 'pitcher' ? probablePitcherId === playerId : false,
        ...extractSeasonBaselines(player),
      });
    }
  }

  return players;
}

function extractTeamContexts(feed: any, homeTeam: string, awayTeam: string): MLBTeamContext[] {
  const gameData = feed?.gameData ?? {};
  const homeNode = feed?.liveData?.boxscore?.teams?.home;
  const awayNode = feed?.liveData?.boxscore?.teams?.away;
  const homePitcherId = Array.isArray(homeNode?.pitchers) && homeNode.pitchers.length > 0 ? homeNode.pitchers[0] : null;
  const awayPitcherId = Array.isArray(awayNode?.pitchers) && awayNode.pitchers.length > 0 ? awayNode.pitchers[0] : null;
  const homePitcher = getPlayerById(homeNode, homePitcherId);
  const awayPitcher = getPlayerById(awayNode, awayPitcherId);
  const homeLineup = computeLineupRates(homeNode);
  const awayLineup = computeLineupRates(awayNode);
  const homeLineupConfirmed = homeLineup.batterCount >= 7;
  const awayLineupConfirmed = awayLineup.batterCount >= 7;
  const homeParkFactor = MLB_PARK_FACTORS[homeTeam] ?? null;

  return [
    {
      teamId: parseNullableNumber(gameData?.teams?.home?.id),
      teamName: homeTeam,
      probablePitcher: homePitcher?.person?.fullName ?? gameData?.probablePitchers?.home?.fullName ?? null,
      probablePitcherId: homePitcherId,
      probablePitcherHand: parsePitchHandCode(homePitcher?.pitchHand?.code ?? gameData?.probablePitchers?.home?.pitchHand?.code),
      lineupConfirmed: homeLineupConfirmed,
      lineupStrikeoutRate: homeLineup.strikeoutRate,
      lineupContactRate: homeLineup.contactRate,
      lineupBatterCount: homeLineup.batterCount,
      parkRunFactor: homeParkFactor?.run ?? null,
      parkHitFactor: homeParkFactor?.hit ?? null,
    },
    {
      teamId: parseNullableNumber(gameData?.teams?.away?.id),
      teamName: awayTeam,
      probablePitcher: awayPitcher?.person?.fullName ?? gameData?.probablePitchers?.away?.fullName ?? null,
      probablePitcherId: awayPitcherId,
      probablePitcherHand: parsePitchHandCode(awayPitcher?.pitchHand?.code ?? gameData?.probablePitchers?.away?.pitchHand?.code),
      lineupConfirmed: awayLineupConfirmed,
      lineupStrikeoutRate: awayLineup.strikeoutRate,
      lineupContactRate: awayLineup.contactRate,
      lineupBatterCount: awayLineup.batterCount,
      parkRunFactor: homeParkFactor?.run ?? null,
      parkHitFactor: homeParkFactor?.hit ?? null,
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

function accumulateBatterRecent(
  accumulators: Map<string, BatterRecentAccumulator>,
  player: any,
  teamName: string,
  opposingStarterHand: 'L' | 'R' | null
): void {
  const stats = player?.stats?.batting;
  if (!stats) return;
  const plateAppearances = parseNullableNumber(stats.plateAppearances);
  const atBats = parseNullableNumber(stats.atBats);
  if ((plateAppearances ?? 0) <= 0 && (atBats ?? 0) <= 0) return;

  const key = `${normalizeName(player?.person?.fullName ?? '')}__${normalizeName(teamName)}`;
  if (!key.startsWith('__')) {
    const existing = accumulators.get(key) ?? {
      games: 0,
      hits: 0,
      totalBases: 0,
      vsLeftGames: 0,
      vsLeftHits: 0,
      vsLeftTotalBases: 0,
      vsRightGames: 0,
      vsRightHits: 0,
      vsRightTotalBases: 0,
    };
    const hits = parseNullableNumber(stats.hits) ?? 0;
    const totalBases = computeTotalBasesFromBattingStats(stats) ?? 0;
    existing.games += 1;
    existing.hits += hits;
    existing.totalBases += totalBases;
    if (opposingStarterHand === 'L') {
      existing.vsLeftGames += 1;
      existing.vsLeftHits += hits;
      existing.vsLeftTotalBases += totalBases;
    } else if (opposingStarterHand === 'R') {
      existing.vsRightGames += 1;
      existing.vsRightHits += hits;
      existing.vsRightTotalBases += totalBases;
    }
    accumulators.set(key, existing);
  }
}

function accumulatePitcherRecent(
  accumulators: Map<string, PitcherRecentAccumulator>,
  player: any,
  teamName: string
): void {
  const stats = player?.stats?.pitching;
  if (!stats) return;
  const starts = parseNullableNumber(stats.gamesStarted);
  const outs = parseNullableNumber(stats.outs);
  if ((starts ?? 0) < 1 || (outs ?? 0) <= 0) return;

  const key = `${normalizeName(player?.person?.fullName ?? '')}__${normalizeName(teamName)}`;
  if (!key.startsWith('__')) {
    const existing = accumulators.get(key) ?? {
      starts: 0,
      outs: 0,
      strikeouts: 0,
      hitsAllowed: 0,
      earnedRuns: 0,
    };
    existing.starts += 1;
    existing.outs += outs ?? 0;
    existing.strikeouts += parseNullableNumber(stats.strikeOuts) ?? 0;
    existing.hitsAllowed += parseNullableNumber(stats.hits) ?? 0;
    existing.earnedRuns += parseNullableNumber(stats.earnedRuns) ?? 0;
    accumulators.set(key, existing);
  }
}

function accumulateTeamRecent(
  accumulators: Map<string, TeamRecentAccumulator>,
  teamNode: any,
  teamName: string
): void {
  const key = normalizeName(teamName);
  if (!key) return;
  const existing = accumulators.get(key) ?? {
    games: 0,
    atBats: 0,
    plateAppearances: 0,
    strikeouts: 0,
  };

  let seenBattingGame = false;
  for (const player of Object.values(teamNode?.players ?? {}) as any[]) {
    const batting = player?.stats?.batting;
    if (!batting) continue;
    const plateAppearances = parseNullableNumber(batting.plateAppearances);
    const atBats = parseNullableNumber(batting.atBats);
    if ((plateAppearances ?? 0) <= 0 && (atBats ?? 0) <= 0) continue;
    seenBattingGame = true;
    existing.atBats += atBats ?? 0;
    existing.plateAppearances += plateAppearances ?? 0;
    existing.strikeouts += parseNullableNumber(batting.strikeOuts) ?? 0;
  }

  if (seenBattingGame) {
    existing.games += 1;
    accumulators.set(key, existing);
  }
}

function getStarterHand(teamNode: any): 'L' | 'R' | null {
  const starterId = Array.isArray(teamNode?.pitchers) && teamNode.pitchers.length > 0
    ? teamNode.pitchers[0]
    : null;
  const starter = getPlayerById(teamNode, starterId);
  return starter?.pitchHand?.code ?? null;
}

async function buildRecentStats(
  teams: MLBTeamContext[],
  slateDate: string
): Promise<{
  batterRecent: Map<string, BatterRecentAccumulator>;
  pitcherRecent: Map<string, PitcherRecentAccumulator>;
  teamRecent: Map<string, TeamRecentAccumulator>;
  fallback: number;
}> {
  const recentStart = subtractDays(slateDate, RECENT_LOOKBACK_DAYS);
  const recentEnd = subtractDays(slateDate, 1);
  const recentSchedules = new Map<string, any>();
  let fallback = 0;

  await Promise.all(teams
    .filter(team => team.teamId)
    .map(async (team) => {
      try {
        const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${team.teamId}&startDate=${recentStart}&endDate=${recentEnd}`;
        recentSchedules.set(team.teamName, await fetchJson(url));
      } catch {
        fallback++;
      }
    }));

  const gamePks = new Set<number>();
  for (const team of teams) {
    const schedule = recentSchedules.get(team.teamName);
    const games = (Array.isArray(schedule?.dates) ? schedule.dates : [])
      .flatMap((dateNode: any) => Array.isArray(dateNode?.games) ? dateNode.games : [])
      .filter((game: any) => game?.status?.abstractGameState === 'Final')
      .sort((a: any, b: any) => String(b.gameDate).localeCompare(String(a.gameDate)))
      .slice(0, RECENT_GAMES_COUNT);
    for (const game of games) {
      if (game?.gamePk) gamePks.add(game.gamePk);
    }
  }

  const feeds = new Map<number, any>();
  await Promise.all(Array.from(gamePks).map(async (gamePk) => {
    try {
      feeds.set(gamePk, await fetchJson(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`));
    } catch {
      fallback++;
    }
  }));

  const batterRecent = new Map<string, BatterRecentAccumulator>();
  const pitcherRecent = new Map<string, PitcherRecentAccumulator>();
  const teamRecent = new Map<string, TeamRecentAccumulator>();

  for (const feed of feeds.values()) {
    const homeName = feed?.gameData?.teams?.home?.name ?? '';
    const awayName = feed?.gameData?.teams?.away?.name ?? '';
    const homeNode = feed?.liveData?.boxscore?.teams?.home;
    const awayNode = feed?.liveData?.boxscore?.teams?.away;
    if (!homeName || !awayName || !homeNode || !awayNode) continue;

    const awayStarterHand = getStarterHand(awayNode);
    const homeStarterHand = getStarterHand(homeNode);

    for (const player of Object.values(homeNode.players ?? {}) as any[]) {
      const roleType = String(player?.position?.type ?? '').toLowerCase();
      if (roleType.includes('pitcher')) {
        accumulatePitcherRecent(pitcherRecent, player, homeName);
      } else {
        accumulateBatterRecent(batterRecent, player, homeName, awayStarterHand);
      }
    }

    for (const player of Object.values(awayNode.players ?? {}) as any[]) {
      const roleType = String(player?.position?.type ?? '').toLowerCase();
      if (roleType.includes('pitcher')) {
        accumulatePitcherRecent(pitcherRecent, player, awayName);
      } else {
        accumulateBatterRecent(batterRecent, player, awayName, homeStarterHand);
      }
    }

    accumulateTeamRecent(teamRecent, homeNode, homeName);
    accumulateTeamRecent(teamRecent, awayNode, awayName);
  }

  return { batterRecent, pitcherRecent, teamRecent, fallback };
}

async function buildBatterSplitStats(
  players: MLBPlayerContext[],
  season: string
): Promise<{
  vsLeft: Map<number, BatterSplitAccumulator>;
  vsRight: Map<number, BatterSplitAccumulator>;
  fallback: number;
}> {
  const batterIds = [...new Set(
    players
      .filter(player => player.role === 'batter' && player.id)
      .map(player => player.id as number)
  )];
  const vsLeft = new Map<number, BatterSplitAccumulator>();
  const vsRight = new Map<number, BatterSplitAccumulator>();
  let fallback = 0;

  for (let i = 0; i < batterIds.length; i += 50) {
    const chunk = batterIds.slice(i, i + 50);
    if (chunk.length === 0) continue;
    try {
      const url = `https://statsapi.mlb.com/api/v1/people?personIds=${chunk.join(',')}&hydrate=stats(group=[hitting],type=[statSplits],sitCodes=[vl,vr],season=${season})`;
      const response = await fetchJson(url);
      const people = Array.isArray(response?.people) ? response.people : [];
      for (const person of people) {
        const splits = Array.isArray(person?.stats?.[0]?.splits) ? person.stats[0].splits : [];
        for (const split of splits) {
          const splitCode = String(split?.split?.code ?? '').toLowerCase();
          const stat = split?.stat ?? {};
          const target = splitCode === 'vl' ? vsLeft : splitCode === 'vr' ? vsRight : null;
          if (!target) continue;
          const games = parseNullableNumber(stat?.gamesPlayed);
          const hits = parseNullableNumber(stat?.hits);
          const totalBases = computeTotalBasesFromBattingStats(stat);
          target.set(person.id, {
            hitsPerGame: safeDivide(hits, games),
            totalBasesPerGame: safeDivide(totalBases, games),
          });
        }
      }
    } catch {
      fallback++;
    }
  }

  return { vsLeft, vsRight, fallback };
}

async function buildPlayerHandData(
  players: MLBPlayerContext[]
): Promise<{
  hands: Map<number, { batsHand: 'L' | 'R' | 'S' | null; throwsHand: 'L' | 'R' | null }>;
  fallback: number;
}> {
  const playerIds = [...new Set(players.filter(player => player.id).map(player => player.id as number))];
  const hands = new Map<number, { batsHand: 'L' | 'R' | 'S' | null; throwsHand: 'L' | 'R' | null }>();
  let fallback = 0;

  for (let i = 0; i < playerIds.length; i += 75) {
    const chunk = playerIds.slice(i, i + 75);
    if (chunk.length === 0) continue;
    try {
      const url = `https://statsapi.mlb.com/api/v1/people?personIds=${chunk.join(',')}`;
      const response = await fetchJson(url);
      const people = Array.isArray(response?.people) ? response.people : [];
      for (const person of people) {
        hands.set(person.id, {
          batsHand: parseHandCode(person?.batSide?.code),
          throwsHand: parsePitchHandCode(person?.pitchHand?.code),
        });
      }
    } catch {
      fallback++;
    }
  }

  return { hands, fallback };
}

function mergeRecentStats(
  players: MLBPlayerContext[],
  teams: MLBTeamContext[],
  batterRecent: Map<string, BatterRecentAccumulator>,
  pitcherRecent: Map<string, PitcherRecentAccumulator>,
  teamRecent: Map<string, TeamRecentAccumulator>
): void {
  for (const player of players) {
    if (player.role === 'batter') {
      const recent = batterRecent.get(`${normalizeName(player.name)}__${normalizeName(player.team)}`);
      if (!recent || recent.games <= 0) continue;
      player.recentHitsPerGame = safeDivide(recent.hits, recent.games);
      player.recentTotalBasesPerGame = safeDivide(recent.totalBases, recent.games);
      player.splitVsLeftHitsPerGame = safeDivide(recent.vsLeftHits, recent.vsLeftGames);
      player.splitVsRightHitsPerGame = safeDivide(recent.vsRightHits, recent.vsRightGames);
      player.splitVsLeftTotalBasesPerGame = safeDivide(recent.vsLeftTotalBases, recent.vsLeftGames);
      player.splitVsRightTotalBasesPerGame = safeDivide(recent.vsRightTotalBases, recent.vsRightGames);
      continue;
    }

    const recent = pitcherRecent.get(`${normalizeName(player.name)}__${normalizeName(player.team)}`);
    if (!recent || recent.starts <= 0) continue;
    player.recentAvgInnings = safeDivide(recent.outs, recent.starts * 3);
    player.projectedInnings = avgOrNull([player.recentAvgInnings, player.seasonAvgInnings]);
    player.recentKPerStart = safeDivide(recent.strikeouts, recent.starts);
    player.recentHitsAllowedPerStart = safeDivide(recent.hitsAllowed, recent.starts);
    player.recentERPerStart = safeDivide(recent.earnedRuns, recent.starts);
  }

  for (const team of teams) {
    const recent = teamRecent.get(normalizeName(team.teamName));
    if (!recent || recent.games <= 0) continue;
    team.teamStrikeoutRate = safeDivide(recent.strikeouts, recent.plateAppearances);
    const nonStrikeoutAtBats = recent.atBats - recent.strikeouts;
    team.teamContactRate = safeDivide(nonStrikeoutAtBats, recent.atBats);
  }
}

function mergeBatterSplitStats(
  players: MLBPlayerContext[],
  splitStats: {
    vsLeft: Map<number, BatterSplitAccumulator>;
    vsRight: Map<number, BatterSplitAccumulator>;
  }
): void {
  for (const player of players) {
    if (player.role !== 'batter' || !player.id) continue;
    const leftSplit = splitStats.vsLeft.get(player.id);
    const rightSplit = splitStats.vsRight.get(player.id);
    player.splitVsLeftHitsPerGame = leftSplit?.hitsPerGame ?? player.splitVsLeftHitsPerGame ?? null;
    player.splitVsLeftTotalBasesPerGame = leftSplit?.totalBasesPerGame ?? player.splitVsLeftTotalBasesPerGame ?? null;
    player.splitVsRightHitsPerGame = rightSplit?.hitsPerGame ?? player.splitVsRightHitsPerGame ?? null;
    player.splitVsRightTotalBasesPerGame = rightSplit?.totalBasesPerGame ?? player.splitVsRightTotalBasesPerGame ?? null;
  }
}

function mergePlayerHandData(
  players: MLBPlayerContext[],
  handData: Map<number, { batsHand: 'L' | 'R' | 'S' | null; throwsHand: 'L' | 'R' | null }>
): void {
  for (const player of players) {
    if (!player.id) continue;
    const hands = handData.get(player.id);
    if (!hands) continue;
    player.batsHand = hands.batsHand ?? player.batsHand ?? null;
    player.throwsHand = hands.throwsHand ?? player.throwsHand ?? null;
  }
}

function mergeTeamPitcherHands(
  teams: MLBTeamContext[],
  handData: Map<number, { batsHand: 'L' | 'R' | 'S' | null; throwsHand: 'L' | 'R' | null }>
): void {
  for (const team of teams) {
    if (!team.probablePitcherId) continue;
    const hands = handData.get(team.probablePitcherId);
    if (!hands) continue;
    team.probablePitcherHand = hands.throwsHand ?? team.probablePitcherHand ?? null;
  }
}

function computeLeagueAverages(
  players: MLBPlayerContext[],
  teams: MLBTeamContext[]
): MLBContextSnapshot['league'] {
  return {
    avgPitcherKRate: avgOrNull(players.filter(player => player.role === 'pitcher').map(player => player.pitcherKRate)),
    avgOpponentKRate: avgOrNull(teams.map(team => team.teamStrikeoutRate)),
    avgContactRate: avgOrNull(teams.map(team => team.teamContactRate)),
    avgHitsAllowedPerStart: avgOrNull(players.filter(player => player.role === 'pitcher').map(player => player.seasonHitsAllowedPerStart)),
    avgERPerStart: avgOrNull(players.filter(player => player.role === 'pitcher').map(player => player.seasonERPerStart)),
  };
}

export async function buildMLBContextForSlate(games: MLBContextGame[]): Promise<MLBContextSnapshot> {
  if (games.length === 0) {
    return {
      players: [],
      teams: [],
      league: {
        avgPitcherKRate: null,
        avgOpponentKRate: null,
        avgContactRate: null,
        avgHitsAllowedPerStart: null,
        avgERPerStart: null,
      },
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

  const slateDate = uniqueDates.sort()[0] ?? toApiDate(new Date());
  const recentStats = await buildRecentStats(teams, slateDate);
  fallback += recentStats.fallback;

  mergeRecentStats(players, teams, recentStats.batterRecent, recentStats.pitcherRecent, recentStats.teamRecent);
  const handData = await buildPlayerHandData(players);
  fallback += handData.fallback;
  mergePlayerHandData(players, handData.hands);
  mergeTeamPitcherHands(teams, handData.hands);
  const splitStats = await buildBatterSplitStats(players, slateDate.slice(0, 4));
  fallback += splitStats.fallback;
  mergeBatterSplitStats(players, splitStats);

  const snapshot: MLBContextSnapshot = {
    players,
    teams,
    league: computeLeagueAverages(players, teams),
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
