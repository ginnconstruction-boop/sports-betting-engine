// ============================================================
// src/services/contextIntelligence.ts
// Full contextual intelligence layer
// Pulls: recent form, rest/travel, lineups, news, referee data
// All free sources -- no additional API keys needed
// ============================================================

import https from 'https';

// ------------------------------------
// Types
// ------------------------------------

export interface TeamForm {
  teamName: string;
  last5: string[];          // ['W','L','W','W','L']
  last5Record: string;      // '3-2'
  last5PointsFor: number;
  last5PointsAgainst: number;
  last5Avg: number;         // avg score
  streak: string;           // 'W3' or 'L2'
  homeRecord?: string;
  awayRecord?: string;
}

export interface RestData {
  teamName: string;
  daysRest: number;         // days since last game
  isBackToBack: boolean;
  lastGameDate: string;
  lastGameResult: string;
  travelDistance?: number;  // miles traveled (if available)
  crossCountryTravel: boolean;
}

export interface LineupInfo {
  teamName: string;
  confirmedStarters: string[];
  keyPlayerOut: boolean;
  outPlayers: string[];
  questionablePlayers: string[];
  lineupConfirmed: boolean;
}

export interface NewsItem {
  headline: string;
  source: string;
  publishedAt: string;
  relevance: 'high' | 'medium' | 'low';
  type: 'injury' | 'lineup' | 'trade' | 'suspension' | 'weather' | 'general';
  teams: string[];
}

export interface RefereeData {
  sport: string;
  refName: string;
  avgTotal?: number;        // avg game total for this ref
  foulsPerGame?: number;    // NBA
  tendencies: string[];
}

export interface ContextPackage {
  eventId: string;
  matchup: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  // Form
  homeForm: TeamForm | null;
  awayForm: TeamForm | null;
  // Rest
  homeRest: RestData | null;
  awayRest: RestData | null;
  // Lineups
  homeLineup: LineupInfo | null;
  awayLineup: LineupInfo | null;
  // News
  relevantNews: NewsItem[];
  // Referee
  referee: RefereeData | null;
  // Derived signals
  contextSignals: ContextSignal[];
  contextScore: number;     // 0-100 overall context confidence
  fetchedAt: string;
}

export interface ContextSignal {
  type: string;
  team: string | 'both' | 'game';
  detail: string;
  impact: 'positive' | 'negative' | 'neutral';
  severity: 'high' | 'medium' | 'low';
  side: 'home' | 'away' | 'over' | 'under' | 'none';
}

// ------------------------------------
// HTTP helper
// ------------------------------------

function fetchJson(url: string, timeout = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; research-bot/1.0)',
        'Accept': 'application/json',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Parse failed for ${url}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function fetchText(url: string, timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,application/xml' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

// ------------------------------------
// Sport key to ESPN league mapping
// ------------------------------------

const ESPN_LEAGUES: Record<string, { sport: string; league: string }> = {
  basketball_nba:          { sport: 'basketball',   league: 'nba' },
  baseball_mlb:            { sport: 'baseball',     league: 'mlb' },
  americanfootball_nfl:    { sport: 'football',     league: 'nfl' },
  americanfootball_ncaaf:  { sport: 'football',     league: 'college-football' },
  basketball_ncaab:        { sport: 'basketball',   league: 'mens-college-basketball' },
  icehockey_nhl:           { sport: 'hockey',       league: 'nhl' },
};

// ------------------------------------
// Fuzzy team name matching
// ------------------------------------

function fuzzyMatch(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z]/g, '');
  const nb = b.toLowerCase().replace(/[^a-z]/g, '');
  // Check last word (city names differ, team names usually match)
  const lastA = a.toLowerCase().split(' ').pop() ?? '';
  const lastB = b.toLowerCase().split(' ').pop() ?? '';
  return na.includes(nb) || nb.includes(na) || lastA === lastB;
}

// ------------------------------------
// 1. TEAM RECENT FORM
// ------------------------------------

export async function getTeamForm(
  sportKey: string,
  teamName: string
): Promise<TeamForm | null> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams`;
    const data = await fetchJson(url);
    const teams = data?.sports?.[0]?.leagues?.[0]?.teams ?? data?.teams ?? [];

    // Find team
    const teamObj = (teams ?? []).find((t: any) => {
      const name = t?.team?.displayName ?? t?.team?.name ?? '';
      return fuzzyMatch(name, teamName);
    });

    if (!teamObj) return null;

    const teamId = teamObj?.team?.id;
    if (!teamId) return null;

    // Get team record and schedule
    const teamUrl = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams/${teamId}`;
    const teamData = await fetchJson(teamUrl);

    const record = teamData?.team?.record?.items ?? [];
    const overallRecord = (record ?? []).find((r: any) => r.type === 'total') ?? record[0];
    const homeRecord = (record ?? []).find((r: any) => r.type === 'home');
    const awayRecord = (record ?? []).find((r: any) => r.type === 'road');

    // Get recent schedule
    const schedUrl = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams/${teamId}/schedule`;
    const schedData = await fetchJson(schedUrl);
    const events = Array.isArray(schedData?.events) ? schedData.events : [];

    // Get last 5 completed games
    const completed = events
      .filter((e: any) => e?.competitions?.[0]?.status?.type?.completed === true)
      .slice(-5);

    const last5: string[] = [];
    let pointsFor = 0, pointsAgainst = 0;

    for (const game of completed) {
      const comp = game?.competitions?.[0];
      const competitors = comp?.competitors ?? [];
      const us = (competitors ?? []).find((c: any) => fuzzyMatch(c?.team?.displayName ?? '', teamName));
      const them = (competitors ?? []).find((c: any) => !fuzzyMatch(c?.team?.displayName ?? '', teamName));

      if (!us) continue;

      const ourScore = parseInt(us?.score ?? '0');
      const theirScore = parseInt(them?.score ?? '0');
      pointsFor += ourScore;
      pointsAgainst += theirScore;

      const winner = comp?.status?.type?.description === 'Final'
        ? (us?.winner === true ? 'W' : 'L')
        : null;
      if (winner) last5.push(winner);
    }

    // Calculate streak
    let streak = '';
    if (last5.length > 0) {
      const lastResult = last5[last5.length - 1];
      let count = 0;
      for (let i = last5.length - 1; i >= 0; i--) {
        if (last5[i] === lastResult) count++;
        else break;
      }
      streak = `${lastResult}${count}`;
    }

    const wins = last5.filter(r => r === 'W').length;
    const losses = last5.filter(r => r === 'L').length;

    return {
      teamName,
      last5,
      last5Record: `${wins}-${losses}`,
      last5PointsFor: Math.round(pointsFor),
      last5PointsAgainst: Math.round(pointsAgainst),
      last5Avg: last5.length > 0 ? Math.round(pointsFor / last5.length) : 0,
      streak,
      homeRecord: homeRecord ? `${homeRecord.wins}-${homeRecord.losses}` : undefined,
      awayRecord: awayRecord ? `${awayRecord.wins}-${awayRecord.losses}` : undefined,
    };
  } catch {
    return null;
  }
}

// ------------------------------------
// 2. REST AND TRAVEL DATA
// ------------------------------------

export async function getRestData(
  sportKey: string,
  teamName: string,
  gameDate: string
): Promise<RestData | null> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams`;
    const data = await fetchJson(url);
    const teams = data?.sports?.[0]?.leagues?.[0]?.teams ?? data?.teams ?? [];

    const teamObj = (teams ?? []).find((t: any) =>
      fuzzyMatch(t?.team?.displayName ?? '', teamName)
    );
    if (!teamObj) return null;

    const teamId = teamObj?.team?.id;
    const schedUrl = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams/${teamId}/schedule`;
    const schedData = await fetchJson(schedUrl);
    const events = Array.isArray(schedData?.events) ? schedData.events : [];

    // Find last completed game before today's game
    const gameDateMs = new Date(gameDate).getTime();
    const pastGames = events.filter((e: any) => {
      const eventDate = new Date(e?.date ?? 0).getTime();
      return eventDate < gameDateMs &&
        e?.competitions?.[0]?.status?.type?.completed === true;
    });

    if (pastGames.length === 0) return null;

    const lastGame = pastGames[pastGames.length - 1];
    const lastGameDate = new Date(lastGame?.date ?? 0);
    const daysRest = Math.floor((gameDateMs - lastGameDate.getTime()) / (1000 * 60 * 60 * 24));
    const isBackToBack = daysRest <= 1;

    // Check if cross-country travel (crude: compare venue timezones)
    const lastVenue = lastGame?.competitions?.[0]?.venue;
    const lastCity = lastVenue?.address?.city ?? '';

    // Simple west/east detection for cross-country flag
    const westCities = ['Los Angeles','San Francisco','Portland','Seattle','Phoenix','Denver','Sacramento','Las Vegas'];
    const eastCities = ['New York','Boston','Philadelphia','Miami','Toronto','Atlanta','Washington','Charlotte','Orlando'];
    const lastIsWest = westCities.some(c => lastCity.includes(c));
    const lastIsEast = eastCities.some(c => lastCity.includes(c));
    const crossCountry = (lastIsWest || lastIsEast) && lastIsWest !== lastIsEast;

    const comp = lastGame?.competitions?.[0];
    const us = comp?.competitors?.find((c: any) => fuzzyMatch(c?.team?.displayName ?? '', teamName));
    const lastResult = us?.winner === true ? 'W' : 'L';

    return {
      teamName,
      daysRest,
      isBackToBack,
      lastGameDate: lastGameDate.toLocaleDateString(),
      lastGameResult: lastResult,
      crossCountryTravel: crossCountry,
    };
  } catch {
    return null;
  }
}

// ------------------------------------
// 3. LINEUP / INJURY DATA
// ------------------------------------

export async function getLineupInfo(
  sportKey: string,
  teamName: string
): Promise<LineupInfo | null> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;

  try {
    // Get injuries from ESPN
    const injuryUrl = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/injuries`;
    const injData = await fetchJson(injuryUrl);

    const teamInjuries = (injData?.injuries ?? []).find((t: any) =>
      fuzzyMatch(t?.team?.displayName ?? '', teamName)
    );

    const injuries = teamInjuries?.injuries ?? [];

    const outPlayers = injuries
      .filter((i: any) => ['Out', 'Doubtful'].includes(i?.status ?? ''))
      .map((i: any) => `${i?.athlete?.displayName ?? 'Unknown'} (${i?.athlete?.position?.abbreviation ?? '?'}) -- ${i?.status}`);

    const questionable = injuries
      .filter((i: any) => ['Questionable', 'Probable'].includes(i?.status ?? ''))
      .map((i: any) => `${i?.athlete?.displayName ?? 'Unknown'} (${i?.athlete?.position?.abbreviation ?? '?'})`);

    // Check for key player out (QB, star PG, SP, etc.)
    const keyPositions = ['QB', 'PG', 'SG', 'SF', 'PF', 'C', 'SP', 'RP'];
    const keyPlayerOut = injuries.some((i: any) =>
      ['Out', 'Doubtful'].includes(i?.status ?? '') &&
      keyPositions.includes(i?.athlete?.position?.abbreviation ?? '')
    );

    return {
      teamName,
      confirmedStarters: [], // ESPN doesn't provide starters pre-game reliably
      keyPlayerOut,
      outPlayers,
      questionablePlayers: questionable,
      lineupConfirmed: false,
    };
  } catch {
    return null;
  }
}

// ------------------------------------
// 4. NEWS HEADLINES
// ------------------------------------

export async function getRelevantNews(
  sportKey: string,
  homeTeam: string,
  awayTeam: string
): Promise<NewsItem[]> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return [];

  const news: NewsItem[] = [];

  try {
    // ESPN news feed
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/news`;
    const data = await fetchJson(url);
    const articles = Array.isArray(data?.articles) ? data.articles : [];

    for (const article of articles.slice(0, 20)) {
      const headline = article?.headline ?? '';
      const published = article?.published ?? '';

      // Check if relevant to our teams
      const mentionsHome = fuzzyMatch(headline, homeTeam) ||
        (article?.categories ?? []).some((c: any) => fuzzyMatch(c?.teamDisplayName ?? '', homeTeam));
      const mentionsAway = fuzzyMatch(headline, awayTeam) ||
        (article?.categories ?? []).some((c: any) => fuzzyMatch(c?.teamDisplayName ?? '', awayTeam));

      if (!mentionsHome && !mentionsAway) continue;

      // Classify news type
      let type: NewsItem['type'] = 'general';
      let relevance: NewsItem['relevance'] = 'low';
      const hl = headline.toLowerCase();

      if (hl.includes('injur') || hl.includes('out') || hl.includes('ruled out') ||
          hl.includes('questionable') || hl.includes('doubtful') || hl.includes('scratch')) {
        type = 'injury'; relevance = 'high';
      } else if (hl.includes('lineup') || hl.includes('starting') || hl.includes('scratch') ||
                 hl.includes('rest') || hl.includes('load manag')) {
        type = 'lineup'; relevance = 'high';
      } else if (hl.includes('trade') || hl.includes('waiv') || hl.includes('sign')) {
        type = 'trade'; relevance = 'medium';
      } else if (hl.includes('suspend') || hl.includes('ejected') || hl.includes('ban')) {
        type = 'suspension'; relevance = 'high';
      } else {
        relevance = 'low';
      }

      const teams: string[] = [];
      if (mentionsHome) teams.push(homeTeam);
      if (mentionsAway) teams.push(awayTeam);

      news.push({ headline, source: 'ESPN', publishedAt: published, relevance, type, teams });
    }

    // Also try Google News RSS for broader coverage
    try {
      const query = encodeURIComponent(`${homeTeam} ${awayTeam} injury lineup`);
      const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
      const rssText = await fetchText(rssUrl);

      // Parse RSS items
      const itemMatches = rssText.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
      for (const item of itemMatches.slice(0, 5)) {
        const titleMatch = item.match(/<title>(.*?)<\/title>/);
        const pubMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
        const sourceMatch = item.match(/<source[^>]*>(.*?)<\/source>/);

        if (!titleMatch) continue;
        const headline = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        const hl = headline.toLowerCase();

        const mentionsH = hl.includes(homeTeam.toLowerCase().split(' ').pop() ?? '');
        const mentionsA = hl.includes(awayTeam.toLowerCase().split(' ').pop() ?? '');
        if (!mentionsH && !mentionsA) continue;

        let type: NewsItem['type'] = 'general';
        let relevance: NewsItem['relevance'] = 'low';

        if (hl.includes('injur') || hl.includes('out') || hl.includes('ruled out')) {
          type = 'injury'; relevance = 'high';
        } else if (hl.includes('lineup') || hl.includes('starting') || hl.includes('scratch')) {
          type = 'lineup'; relevance = 'high';
        }

        if (relevance === 'high') {
          news.push({
            headline,
            source: sourceMatch?.[1] ?? 'Google News',
            publishedAt: pubMatch?.[1] ?? '',
            relevance,
            type,
            teams: [mentionsH ? homeTeam : awayTeam],
          });
        }
      }
    } catch { /* Google News is supplemental */ }

  } catch { /* News is always supplemental -- never block */ }

  // Sort by relevance
  const order = { high: 0, medium: 1, low: 2 };
  return news.sort((a, b) => order[a.relevance] - order[b.relevance]).slice(0, 8);
}

// ------------------------------------
// 5. REFEREE / UMPIRE DATA
// ------------------------------------

export async function getRefereeData(
  sportKey: string,
  eventId?: string
): Promise<RefereeData | null> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;

  try {
    if (eventId) {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/summary?event=${eventId}`;
      const data = await fetchJson(url);
      const officials = data?.gameInfo?.officials ?? [];

      if (officials.length === 0) return null;

      const ref = officials[0];
      return {
        sport: sportKey,
        refName: ref?.displayName ?? ref?.fullName ?? 'Unknown',
        tendencies: [],
      };
    }
  } catch { /* Referee data is supplemental */ }

  return null;
}

// ------------------------------------
// 6. DERIVE CONTEXT SIGNALS
// ------------------------------------

function deriveSignals(pkg: Partial<ContextPackage>): ContextSignal[] {
  const signals: ContextSignal[] = [];

  // Rest advantage
  const homeRest = pkg.homeRest?.daysRest ?? 2;
  const awayRest = pkg.awayRest?.daysRest ?? 2;
  const restDiff = homeRest - awayRest;

  if (pkg.homeRest?.isBackToBack) {
    signals.push({
      type: 'BACK_TO_BACK',
      team: pkg.homeTeam ?? 'Home',
      detail: `${pkg.homeTeam} on B2B -- fatigue factor, lean away or under`,
      impact: 'negative',
      severity: 'medium',
      side: 'away',
    });
  }

  if (pkg.awayRest?.isBackToBack) {
    signals.push({
      type: 'BACK_TO_BACK',
      team: pkg.awayTeam ?? 'Away',
      detail: `${pkg.awayTeam} on B2B -- fatigue factor, lean home or under`,
      impact: 'negative',
      severity: 'medium',
      side: 'home',
    });
  }

  if (Math.abs(restDiff) >= 2) {
    const rested = restDiff > 0 ? pkg.homeTeam : pkg.awayTeam;
    const tired = restDiff > 0 ? pkg.awayTeam : pkg.homeTeam;
    signals.push({
      type: 'REST_ADVANTAGE',
      team: rested ?? 'unknown',
      detail: `${rested} has ${Math.abs(restDiff)} more days rest than ${tired}`,
      impact: 'positive',
      severity: Math.abs(restDiff) >= 3 ? 'high' : 'medium',
      side: restDiff > 0 ? 'home' : 'away',
    });
  }

  // Cross-country travel
  if (pkg.awayRest?.crossCountryTravel) {
    signals.push({
      type: 'TRAVEL_FATIGUE',
      team: pkg.awayTeam ?? 'Away',
      detail: `${pkg.awayTeam} traveled cross-country -- fatigue may be a factor`,
      impact: 'negative',
      severity: 'low',
      side: 'home',
    });
  }

  // Key player out
  if (pkg.homeLineup?.keyPlayerOut) {
    signals.push({
      type: 'KEY_PLAYER_OUT',
      team: pkg.homeTeam ?? 'Home',
      detail: `${pkg.homeTeam} missing key player(s): ${pkg.homeLineup.outPlayers.slice(0,2).join(', ')}`,
      impact: 'negative',
      severity: 'high',
      side: 'away',
    });
  }

  if (pkg.awayLineup?.keyPlayerOut) {
    signals.push({
      type: 'KEY_PLAYER_OUT',
      team: pkg.awayTeam ?? 'Away',
      detail: `${pkg.awayTeam} missing key player(s): ${pkg.awayLineup.outPlayers.slice(0,2).join(', ')}`,
      impact: 'negative',
      severity: 'high',
      side: 'home',
    });
  }

  // Recent form
  if (pkg.homeForm && pkg.awayForm) {
    const homeWins = pkg.homeForm.last5.filter(r => r === 'W').length;
    const awayWins = pkg.awayForm.last5.filter(r => r === 'W').length;
    const formDiff = homeWins - awayWins;

    if (Math.abs(formDiff) >= 2) {
      const hotTeam = formDiff > 0 ? pkg.homeTeam : pkg.awayTeam;
      const coldTeam = formDiff > 0 ? pkg.awayTeam : pkg.homeTeam;
      signals.push({
        type: 'FORM_ADVANTAGE',
        team: hotTeam ?? 'unknown',
        detail: `${hotTeam} ${formDiff > 0 ? pkg.homeForm.last5Record : pkg.awayForm.last5Record} last 5 vs ${coldTeam} ${formDiff > 0 ? pkg.awayForm.last5Record : pkg.homeForm.last5Record}`,
        impact: 'positive',
        severity: Math.abs(formDiff) >= 3 ? 'high' : 'medium',
        side: formDiff > 0 ? 'home' : 'away',
      });
    }

    // Hot streak
    if (pkg.homeForm.streak.startsWith('W') && parseInt(pkg.homeForm.streak.slice(1)) >= 3) {
      signals.push({
        type: 'HOT_STREAK',
        team: pkg.homeTeam ?? 'Home',
        detail: `${pkg.homeTeam} on ${pkg.homeForm.streak} streak`,
        impact: 'positive',
        severity: 'medium',
        side: 'home',
      });
    }

    if (pkg.awayForm.streak.startsWith('W') && parseInt(pkg.awayForm.streak.slice(1)) >= 3) {
      signals.push({
        type: 'HOT_STREAK',
        team: pkg.awayTeam ?? 'Away',
        detail: `${pkg.awayTeam} on ${pkg.awayForm.streak} streak`,
        impact: 'positive',
        severity: 'medium',
        side: 'away',
      });
    }

    // Cold streak
    if (pkg.homeForm.streak.startsWith('L') && parseInt(pkg.homeForm.streak.slice(1)) >= 3) {
      signals.push({
        type: 'COLD_STREAK',
        team: pkg.homeTeam ?? 'Home',
        detail: `${pkg.homeTeam} on ${pkg.homeForm.streak} losing streak`,
        impact: 'negative',
        severity: 'medium',
        side: 'away',
      });
    }
  }

  // High-value news
  for (const item of pkg.relevantNews ?? []) {
    if (item.relevance === 'high') {
      signals.push({
        type: `NEWS_${item.type.toUpperCase()}`,
        team: item.teams[0] ?? 'unknown',
        detail: item.headline,
        impact: item.type === 'injury' || item.type === 'suspension' ? 'negative' : 'neutral',
        severity: 'high',
        side: 'none',
      });
    }
  }

  return signals;
}

// ------------------------------------
// 7. MAIN: Build full context package for one game
// ------------------------------------

// Wrapper that guarantees never throws -- ESPN data is always supplemental
export async function buildContextPackageSafe(
  eventId: string, matchup: string, sportKey: string,
  homeTeam: string, awayTeam: string, gameTime: string
): Promise<ContextPackage> {
  try {
    return await buildContextPackage(eventId, matchup, sportKey, homeTeam, awayTeam, gameTime);
  } catch {
    return {
      eventId, matchup, sport: sportKey, homeTeam, awayTeam,
      homeForm: null, awayForm: null, homeRest: null, awayRest: null,
      homeLineup: null, awayLineup: null, relevantNews: [], referee: null,
      contextSignals: [], contextScore: 0,
      fetchedAt: new Date().toISOString(),
    };
  }
}

export async function buildContextPackage(
  eventId: string,
  matchup: string,
  sportKey: string,
  homeTeam: string,
  awayTeam: string,
  gameTime: string
): Promise<ContextPackage> {
  const fetchedAt = new Date().toISOString();

  // Run all fetches in parallel -- never block if one fails
  const [
    homeForm, awayForm,
    homeRest, awayRest,
    homeLineup, awayLineup,
    news, referee,
  ] = await Promise.allSettled([
    getTeamForm(sportKey, homeTeam),
    getTeamForm(sportKey, awayTeam),
    getRestData(sportKey, homeTeam, gameTime),
    getRestData(sportKey, awayTeam, gameTime),
    getLineupInfo(sportKey, homeTeam),
    getLineupInfo(sportKey, awayTeam),
    getRelevantNews(sportKey, homeTeam, awayTeam),
    getRefereeData(sportKey, eventId),
  ]);

  const pkg: Partial<ContextPackage> = {
    eventId, matchup, sport: sportKey, homeTeam, awayTeam,
    homeForm: homeForm.status === 'fulfilled' ? homeForm.value : null,
    awayForm: awayForm.status === 'fulfilled' ? awayForm.value : null,
    homeRest: homeRest.status === 'fulfilled' ? homeRest.value : null,
    awayRest: awayRest.status === 'fulfilled' ? awayRest.value : null,
    homeLineup: homeLineup.status === 'fulfilled' ? homeLineup.value : null,
    awayLineup: awayLineup.status === 'fulfilled' ? awayLineup.value : null,
    relevantNews: news.status === 'fulfilled' ? (news.value ?? []) : [],
    referee: referee.status === 'fulfilled' ? referee.value : null,
    fetchedAt,
  };

  const contextSignals = deriveSignals(pkg);

  // Context score: how much useful data we got (0-100)
  let dataPoints = 0;
  if (pkg.homeForm) dataPoints += 20;
  if (pkg.awayForm) dataPoints += 20;
  if (pkg.homeRest) dataPoints += 15;
  if (pkg.awayRest) dataPoints += 15;
  if (pkg.homeLineup) dataPoints += 10;
  if (pkg.awayLineup) dataPoints += 10;
  if ((pkg.relevantNews?.length ?? 0) > 0) dataPoints += 10;

  return {
    ...pkg,
    contextSignals,
    contextScore: Math.min(dataPoints, 100),
    fetchedAt,
  } as ContextPackage;
}

// ------------------------------------
// 8. Build context for multiple events (parallel)
// ------------------------------------

export async function buildAllContextPackages(
  events: Array<{
    eventId: string;
    matchup: string;
    sportKey: string;
    homeTeam: string;
    awayTeam: string;
    gameTime: string;
  }>
): Promise<Map<string, ContextPackage>> {
  const result = new Map<string, ContextPackage>();

  // Process in batches of 3 to avoid overwhelming ESPN
  const batchSize = 3;
  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    const packages = await Promise.allSettled(
      batch.map(e => buildContextPackageSafe(
        e.eventId, e.matchup, e.sportKey,
        e.homeTeam, e.awayTeam, e.gameTime
      ))
    );

    for (let j = 0; j < batch.length; j++) {
      const pkg = packages[j];
      if (pkg.status === 'fulfilled' && pkg.value) {
        result.set(batch[j].eventId, pkg.value);
      }
    }
  }

  return result;
}
