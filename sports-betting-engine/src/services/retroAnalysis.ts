// ============================================================
// src/services/retroAnalysis.ts
// Retrospective analysis -- runs automatically each morning
// Checks yesterday's picks against Odds API scores with ESPN fallback
// Identifies what signals were on wins vs losses
// Adjusts signal weights based on actual results
// ============================================================

import https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { getCompletedScores, CompletedScore } from '../api/oddsApiClient';
import { CreditBudgetGuard } from './creditBudgetGuard';
import { getPickRecordBucket, PickRecordBucket } from './closingLineTracker';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const PICKS_FILE   = path.join(SNAPSHOT_DIR, 'picks_log.json');
const RETRO_FILE   = path.join(SNAPSHOT_DIR, 'retro_analysis.json');
const WEIGHTS_FILE = path.join(SNAPSHOT_DIR, 'signal_weights.json');
const CLV_WEIGHTS_FILE = path.join(SNAPSHOT_DIR, 'clv_weights.json');

// ------------------------------------
// Types
// ------------------------------------

export interface RetroResult {
  pickId: string;
  date: string;
  matchup: string;
  sport: string;
  betType: string;
  side: string;
  line: number | null;
  grade: string;
  score: number;
  signals: string[];           // signal types that fired
  /**
   * Grading outcome:
   *   PENDING       — game has not been attempted yet (start time in future or
   *                   not enough time has passed since game start).
   *   WIN/LOSS/PUSH — final result, confirmed from score source.
   *   MISSING_SCORE — grading was attempted after the expected game-end window
   *                   but no score was found across all 4 sources. Never graded
   *                   as a loss — treated as unresolvable and excluded from stats.
   *   VOID          — manually voided (cancelled game, postponed, no action).
   */
  gameResult: 'WIN' | 'LOSS' | 'PUSH' | 'PENDING' | 'MISSING_SCORE' | 'VOID';
  actualScore: string | null;  // "112-108" etc
  margin: number | null;       // how much we won/lost by vs the line
  clvActual: number | null;    // actual closing line value
  missedSignals: string[];     // signals that WOULD have helped if present
  autoGraded: boolean;
  recordBucket?: PickRecordBucket;
  /** Set when grading was attempted but no score was available. */
  gradingNote?: string;
}

export interface SignalPerformance {
  signalType: string;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  avgScoreWhenPresent: number;
  avgScoreWhenAbsent: number;
  liftVsBaseline: number;      // how much this signal improves win rate
  shouldBoost: boolean;        // true = signal is genuinely predictive
  shouldPenalize: boolean;     // true = signal is noise or misleading
  recommendedWeight: number;   // 0.5-2.0 multiplier
}

export interface RetroReport {
  dateAnalyzed: string;
  /** Gradeable results included in the W/L analysis slice. */
  picksAnalyzed: number;
  /** Auto-graded picks within the same analyzed slice. */
  autoGraded: number;
  /** Picks where score was unresolvable after the game-end window. Never counted as losses. */
  missingScoreCount: number;
  /** Manually voided picks (postponed, cancelled). Never counted as losses. */
  voidCount: number;
  overallRecord: { wins: number; losses: number; pushes: number; winRate: number };
  byGrade: Record<string, { wins: number; losses: number; winRate: number }>;
  bySport: Record<string, { wins: number; losses: number; winRate: number }>;
  byBetType: Record<string, { wins: number; losses: number; winRate: number }>;
  signalPerformance: SignalPerformance[];
  topMissedSignals: string[];   // signals that were absent on most losses
  weightAdjustments: Record<string, number>;  // signal -> new multiplier
  insights: string[];
}

export interface AutoGradeSummary {
  checked: number;
  graded: number;
  pending: number;
  missing: number;
  void: number;
  officialGraded: number;
  trackedGraded: number;
  officialPending: number;
  trackedPending: number;
}

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
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Parse')); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ------------------------------------
// ESPN score fallback lookup
// ------------------------------------

const ESPN_LEAGUES: Record<string, { sport: string; league: string }> = {
  basketball_nba:          { sport: 'basketball',   league: 'nba' },
  baseball_mlb:            { sport: 'baseball',     league: 'mlb' },
  baseball_ncaa:           { sport: 'baseball',     league: 'college-baseball' },
  americanfootball_nfl:    { sport: 'football',     league: 'nfl' },
  americanfootball_ncaaf:  { sport: 'football',     league: 'college-football' },
  basketball_ncaab:        { sport: 'basketball',   league: 'mens-college-basketball' },
  icehockey_nhl:           { sport: 'hockey',       league: 'nhl' },
};

// Multi-word team name matching -- tries last word, full name, abbreviations
function teamsMatch(searchHome: string, searchAway: string, nameA: string, nameB: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const words = (s: string) => norm(s).split(' ');
  const last = (s: string) => words(s).pop() ?? '';
  const abbrev = (s: string) => words(s).map(w => w[0]).join('');

  const h = norm(searchHome);
  const a = norm(searchAway);
  const n1 = norm(nameA);
  const n2 = norm(nameB);

  // Try matching both teams to both names in either order
  const matchPair = (t1: string, t2: string, n1: string, n2: string): boolean => {
    const checks = [
      () => (n1.includes(last(t1)) || last(n1) === last(t1) || abbrev(t1) === abbrev(n1)) &&
            (n2.includes(last(t2)) || last(n2) === last(t2) || abbrev(t2) === abbrev(n2)),
      () => n1.includes(t1) || t1.includes(n1),
      () => n2.includes(t2) || t2.includes(n2),
    ];
    return checks.some(c => { try { return c(); } catch { return false; } });
  };

  return matchPair(h, a, n1, n2) || matchPair(h, a, n2, n1) ||
         matchPair(a, h, n1, n2) || matchPair(a, h, n2, n1);
}

// Source 0: Odds API scores — exact eventId match, most reliable
// Pre-fetched once per sport at the start of autoGradePicks() and
// stored in a module-level cache for the duration of the run.
// Key format: "<sportKey>:<eventId>"

const oddsApiScoreCache = new Map<string, { homeScore: number; awayScore: number }>();
let oddsApiScoreFetchedSports = new Set<string>();

/**
 * Pre-fetches completed scores from the Odds API for a set of sport keys.
 * Call once at the start of autoGradePicks() — populates the cache so
 * individual pick lookups are instant and cost 0 additional credits.
 * Cost: 2 credits per unique sport key.
 */
async function prefetchOddsApiScores(sportKeys: string[]): Promise<void> {
  const unique = [...new Set(sportKeys)].filter(sk => !oddsApiScoreFetchedSports.has(sk));
  for (const sk of unique) {
    try {
      const scores: CompletedScore[] = await getCompletedScores(sk, 3);
      for (const s of scores) {
        oddsApiScoreCache.set(`${sk}:${s.id}`, { homeScore: s.homeScore, awayScore: s.awayScore });
      }
      oddsApiScoreFetchedSports.add(sk);
    } catch { /* non-fatal — ESPN fallback will handle */ }
  }
}

/**
 * Looks up a score from the pre-fetched Odds API cache by exact event ID.
 * Returns null if the eventId was not found in the cache.
 */
function getScoreFromOddsApiCache(
  sportKey: string,
  eventId: string | undefined
): { homeScore: number; awayScore: number; final: boolean } | null {
  if (!eventId) return null;
  const entry = oddsApiScoreCache.get(`${sportKey}:${eventId}`);
  if (!entry) return null;
  return { ...entry, final: true };
}

// Source 1: ESPN scoreboard API fallback
async function getScoreFromESPN(
  sportKey: string, homeTeam: string, awayTeam: string, gameDate: string
): Promise<{ homeScore: number; awayScore: number; final: boolean } | null> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;
  try {
    const date = gameDate.split('T')[0].replace(/-/g, '');
    // Try both the game date and the day after (for late night games)
    const dates = [date];
    const d = new Date(gameDate);
    d.setDate(d.getDate() + 1);
    dates.push(d.toISOString().split('T')[0].replace(/-/g, ''));

    for (const tryDate of dates) {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/scoreboard?dates=${tryDate}`;
      const data = await fetchJson(url);
      const events = Array.isArray(data?.events) ? data.events : [];

      const event = events.find((e: any) => {
        const competitors = e?.competitions?.[0]?.competitors ?? [];
        const names = competitors.map((c: any) => c?.team?.displayName ?? '');
        const shorts = competitors.map((c: any) => c?.team?.shortDisplayName ?? '');
        const abbrevs = competitors.map((c: any) => c?.team?.abbreviation ?? '');
        const allNames = [...names, ...shorts, ...abbrevs];
        if (allNames.length < 2) return false;
        return teamsMatch(homeTeam, awayTeam, allNames[0], allNames[1]) ||
               teamsMatch(homeTeam, awayTeam, allNames[2] ?? allNames[0], allNames[3] ?? allNames[1]);
      });

      if (!event) continue;
      const comp = event?.competitions?.[0];
      if (comp?.status?.type?.completed !== true) continue;
      const competitors = comp?.competitors ?? [];
      const home = competitors.find((c: any) => c?.homeAway === 'home');
      const away = competitors.find((c: any) => c?.homeAway === 'away');
      const homeScore = parseFloat(home?.score ?? '0');
      const awayScore = parseFloat(away?.score ?? '0');
      if (homeScore === 0 && awayScore === 0) continue;
      return { homeScore, awayScore, final: true };
    }
    return null;
  } catch { return null; }
}

// Source 2: ESPN summary API fallback (different endpoint, more reliable for older games)
async function getScoreFromESPNSummary(
  sportKey: string, homeTeam: string, awayTeam: string, gameDate: string
): Promise<{ homeScore: number; awayScore: number; final: boolean } | null> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;
  try {
    const date = gameDate.split('T')[0].replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/scoreboard?dates=${date}&limit=50`;
    const data = await fetchJson(url);
    const events = Array.isArray(data?.events) ? data.events : [];

    for (const event of events) {
      const comp = event?.competitions?.[0];
      if (!comp) continue;
      const competitors = comp.competitors ?? [];
      if (competitors.length < 2) continue;
      const teamNames = competitors.flatMap((c: any) => [
        c?.team?.displayName ?? '',
        c?.team?.name ?? '',
        c?.team?.shortDisplayName ?? '',
        c?.team?.abbreviation ?? '',
      ]).filter(Boolean);

      // Try every combination
      let matched = false;
      for (let i = 0; i < teamNames.length - 1; i++) {
        for (let j = i + 1; j < teamNames.length; j++) {
          if (teamsMatch(homeTeam, awayTeam, teamNames[i], teamNames[j])) {
            matched = true; break;
          }
        }
        if (matched) break;
      }
      if (!matched) continue;
      if (comp?.status?.type?.completed !== true) continue;

      const home = competitors.find((c: any) => c?.homeAway === 'home');
      const away = competitors.find((c: any) => c?.homeAway === 'away');
      const homeScore = parseFloat(home?.score ?? '0');
      const awayScore = parseFloat(away?.score ?? '0');
      if (homeScore === 0 && awayScore === 0) continue;
      return { homeScore, awayScore, final: true };
    }
    return null;
  } catch { return null; }
}

// Master score lookup -- tries multiple sources, returns first hit.
// Priority:
//   1. Odds API cache (exact eventId match — most reliable, 0 extra credits)
//   2. ESPN scoreboard API
//   3. ESPN summary endpoint (handles late night / next-day results)
//   4. ESPN reversed home/away
async function getGameScore(
  sportKey: string,
  homeTeam: string,
  awayTeam: string,
  gameDate: string,
  eventId?: string,
): Promise<{ homeScore: number; awayScore: number; final: boolean } | null> {
  // Source 0: Odds API cache — zero cost, exact eventId match
  const oddsApi = getScoreFromOddsApiCache(sportKey, eventId);
  if (oddsApi) return oddsApi;

  // Source 1: ESPN scoreboard (primary)
  const espn1 = await getScoreFromESPN(sportKey, homeTeam, awayTeam, gameDate);
  if (espn1) return espn1;

  // Source 2: ESPN summary endpoint (fallback -- handles late night / next-day results)
  const espn2 = await getScoreFromESPNSummary(sportKey, homeTeam, awayTeam, gameDate);
  if (espn2) return espn2;

  // Source 3: ESPN reversed home/away (sometimes matchup string is stored away @ home)
  const espn3 = await getScoreFromESPN(sportKey, awayTeam, homeTeam, gameDate);
  if (espn3) return { homeScore: espn3.awayScore, awayScore: espn3.homeScore, final: true };

  return null;
}

type SupportedNBAPropType =
  | 'player_points'
  | 'player_rebounds'
  | 'player_assists'
  | 'player_threes'
  | 'player_points_rebounds_assists'
  | 'player_points_rebounds'
  | 'player_points_assists';

type SupportedMLBPropType =
  | 'pitcher_strikeouts'
  | 'pitcher_hits_allowed'
  | 'pitcher_earned_runs'
  | 'batter_hits'
  | 'batter_total_bases';

type SupportedNHLPropType =
  | 'player_shots_on_goal'
  | 'goalie_saves';

interface NBABoxScorePlayerStat {
  playerName: string;
  normalizedName: string;
  didNotPlay: boolean;
  active: boolean;
  reason: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
}

interface NBABoxScoreGame {
  final: boolean;
  eventId: string;
  source: 'ESPN_NBA_SUMMARY';
  players: NBABoxScorePlayerStat[];
}

const nbaBoxScoreCache = new Map<string, NBABoxScoreGame | null>();

interface MLBBoxScorePlayerStat {
  playerName: string;
  normalizedName: string;
  battingOrder: string;
  atBats: number;
  plateAppearances: number;
  hits: number;
  totalBases: number;
  pitchingOuts: number;
  battersFaced: number;
  strikeouts: number;
  hitsAllowed: number;
  earnedRuns: number;
}

interface MLBBoxScoreGame {
  final: boolean;
  eventId: string;
  source: 'MLB_STATSAPI_LIVE_FEED';
  players: MLBBoxScorePlayerStat[];
}

const mlbBoxScoreCache = new Map<string, MLBBoxScoreGame | null>();

interface NHLBoxScorePlayerStat {
  playerName: string;
  normalizedName: string;
  role: 'skater' | 'goalie';
  position: string;
  shotsOnGoal: number;
  shotsAgainst: number;
  saves: number;
  goalsAgainst: number;
  toi: string;
  starter: boolean;
}

interface NHLBoxScoreGame {
  final: boolean;
  eventId: string;
  source: 'NHL_GAMECENTER_BOXSCORE';
  players: NHLBoxScorePlayerStat[];
}

const nhlBoxScoreCache = new Map<string, NHLBoxScoreGame | null>();

function normalizeSportKey(raw: any): string {
  const s = raw?.sport ?? raw?.sportKey ?? raw ?? '';
  if (s === 'NBA') return 'basketball_nba';
  if (s === 'NFL') return 'americanfootball_nfl';
  if (s === 'MLB') return 'baseball_mlb';
  if (s === 'NHL') return 'icehockey_nhl';
  if (s === 'NCAAB') return 'basketball_ncaab';
  if (s === 'NCAAF') return 'americanfootball_ncaaf';
  if (s === 'NCAA Baseball' || s === 'ncaa baseball') return 'baseball_ncaa';
  return s;
}

function normalizePlayerName(name: string): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.'’`-]/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function playerNamesMatch(searchName: string, candidateName: string): boolean {
  const search = normalizePlayerName(searchName);
  const candidate = normalizePlayerName(candidateName);
  if (!search || !candidate) return false;
  if (search === candidate) return true;

  const searchTokens = search.split(' ').filter(Boolean);
  const candidateTokens = candidate.split(' ').filter(Boolean);
  if (searchTokens.length === 0 || candidateTokens.length === 0) return false;

  const searchLast = searchTokens[searchTokens.length - 1];
  const candidateLast = candidateTokens[candidateTokens.length - 1];
  if (searchLast !== candidateLast) return false;

  return searchTokens[0]?.[0] === candidateTokens[0]?.[0];
}

function scoreboardDatesForGame(gameTime: string): string[] {
  const seed = new Date(gameTime);
  if (Number.isNaN(seed.getTime())) return [];

  const variants = [0, -1, 1].map(offset => {
    const copy = new Date(seed);
    copy.setUTCDate(copy.getUTCDate() + offset);
    return copy.toISOString().split('T')[0].replace(/-/g, '');
  });

  return [...new Set(variants)];
}

function parseMadeShots(raw: string): number {
  const match = String(raw ?? '').match(/^(\d+)/);
  return match ? parseFloat(match[1]) || 0 : 0;
}

function parseNullableNumber(raw: any): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeMLBTotalBases(stats: any): number {
  const hits = parseNullableNumber(stats?.hits) ?? 0;
  const doubles = parseNullableNumber(stats?.doubles) ?? 0;
  const triples = parseNullableNumber(stats?.triples) ?? 0;
  const homeRuns = parseNullableNumber(stats?.homeRuns) ?? 0;
  const derivedSingles = Math.max(0, hits - doubles - triples - homeRuns);
  const provided = parseNullableNumber(stats?.totalBases);
  if (provided !== null) return provided;
  return derivedSingles + (doubles * 2) + (triples * 3) + (homeRuns * 4);
}

function mlbScheduleDatesForGame(gameTime: string): string[] {
  const seed = new Date(gameTime);
  if (Number.isNaN(seed.getTime())) return [];

  return [...new Set([0, -1, 1].map(offset => {
    const copy = new Date(seed);
    copy.setUTCDate(copy.getUTCDate() + offset);
    return copy.toISOString().split('T')[0];
  }))];
}

function nhlScheduleDatesForGame(gameTime: string): string[] {
  const seed = new Date(gameTime);
  if (Number.isNaN(seed.getTime())) return [];

  return [...new Set([0, -1, 1].map(offset => {
    const copy = new Date(seed);
    copy.setUTCDate(copy.getUTCDate() + offset);
    return copy.toISOString().split('T')[0];
  }))];
}

export function inferSupportedNBAPropType(
  pick: Partial<{ propType: string; notes: string; side: string }>
): SupportedNBAPropType | null {
  const raw = `${pick.propType ?? ''} ${pick.notes ?? ''} ${pick.side ?? ''}`.toLowerCase();
  const normalized = raw.replace(/[^a-z0-9+]/g, ' ');

  if (normalized.includes('player_points_rebounds_assists') || normalized.includes('pts+reb+ast') || normalized.includes('points rebounds assists')) {
    return 'player_points_rebounds_assists';
  }
  if (normalized.includes('player_points_rebounds') || normalized.includes('pts+reb') || normalized.includes('points rebounds')) {
    return 'player_points_rebounds';
  }
  if (normalized.includes('player_points_assists') || normalized.includes('pts+ast') || normalized.includes('points assists')) {
    return 'player_points_assists';
  }

  if (
    normalized.includes('rebounds assists') ||
    normalized.includes('steals') ||
    normalized.includes('blocks') ||
    normalized.includes('turnovers')
  ) {
    return null;
  }

  if (normalized.includes('player_threes') || normalized.includes('threes') || normalized.includes('3pt') || normalized.includes('three pointers')) {
    return 'player_threes';
  }
  if (normalized.includes('player_rebounds') || normalized.includes('rebounds')) {
    return 'player_rebounds';
  }
  if (normalized.includes('player_assists') || normalized.includes('assists')) {
    return 'player_assists';
  }
  if (normalized.includes('player_points') || normalized.includes('points')) {
    return 'player_points';
  }

  return null;
}

export function inferSupportedMLBPropType(
  pick: Partial<{ propType: string; notes: string; side: string }>
): SupportedMLBPropType | null {
  const raw = `${pick.propType ?? ''} ${pick.notes ?? ''} ${pick.side ?? ''}`.toLowerCase();
  const normalized = raw.replace(/[^a-z0-9+]/g, ' ');

  if (
    normalized.includes('batter_home_runs') ||
    normalized.includes('home runs') ||
    normalized.includes('batter_rbis') ||
    normalized.includes('rbis') ||
    normalized.includes('rbi') ||
    normalized.includes('batter_strikeouts') ||
    normalized.includes('batter strikeouts')
  ) {
    return null;
  }

  if (normalized.includes('pitcher_strikeouts') || normalized.includes('pitcher strikeouts') || normalized.includes('pitcher strikeout')) {
    return 'pitcher_strikeouts';
  }
  if (normalized.includes('pitcher_hits_allowed') || normalized.includes('pitcher hits allowed')) {
    return 'pitcher_hits_allowed';
  }
  if (normalized.includes('pitcher_earned_runs') || normalized.includes('pitcher earned runs')) {
    return 'pitcher_earned_runs';
  }
  if (normalized.includes('batter_total_bases') || normalized.includes('total bases')) {
    return 'batter_total_bases';
  }
  if (normalized.includes('batter_hits') || normalized.includes(' batter hits') || normalized.includes(' hits over') || normalized.includes(' hits under')) {
    return 'batter_hits';
  }

  return null;
}

export function inferSupportedNHLPropType(
  pick: Partial<{ propType: string; notes: string; side: string }>
): SupportedNHLPropType | null {
  const raw = `${pick.propType ?? ''} ${pick.notes ?? ''} ${pick.side ?? ''}`.toLowerCase();
  const normalized = raw.replace(/[^a-z0-9+]/g, ' ');

  if (
    normalized.includes('player_points') ||
    normalized.includes('player goals') ||
    normalized.includes('player_goals') ||
    normalized.includes('player_assists') ||
    normalized.includes('assists') ||
    normalized.includes('player points') ||
    normalized.includes('player assists')
  ) {
    return null;
  }

  if (normalized.includes('player_shots_on_goal') || normalized.includes('shots on goal') || normalized.includes('sog')) {
    return 'player_shots_on_goal';
  }
  if (normalized.includes('goalie_saves') || normalized.includes('goalie saves') || normalized.includes('saves')) {
    return 'goalie_saves';
  }

  return null;
}

function inferPropDirection(raw: string): 'OVER' | 'UNDER' | null {
  const text = (raw ?? '').toUpperCase();
  if (text.includes(' OVER ')) return 'OVER';
  if (text.includes(' UNDER ')) return 'UNDER';
  return null;
}

function extractPlayerNameFromSide(side: string): string | null {
  const text = side ?? '';
  const patterns = [
    /\s+(Pts\+Reb\+Ast|Points Rebounds Assists|Pts\+Reb|Points Rebounds|Pts\+Ast|Points Assists)\s+(Over|Under)\b/i,
    /\s+(Points|Rebounds|Assists|Threes)\s+(Over|Under)\b/i,
    /\s+(3PT|Three Pointers|Three-Pointers)\s+(Over|Under)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      const playerName = text.slice(0, match.index).trim();
      if (playerName) return playerName;
    }
  }

  return null;
}

function extractMLBPlayerNameFromSide(side: string): string | null {
  const text = side ?? '';
  const patterns = [
    /\s+(pitcher strikeouts|pitcher hits allowed|pitcher earned runs|batter hits|batter total bases)\s+(over|under)\b/i,
    /\s+(strikeouts|hits allowed|earned runs|hits|total bases)\s+(over|under)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      const playerName = text.slice(0, match.index).trim();
      if (playerName) return playerName;
    }
  }

  return null;
}

function extractNHLPlayerNameFromSide(side: string): string | null {
  const text = side ?? '';
  const patterns = [
    /\s+(player shots on goal|goalie saves)\s+(over|under)\b/i,
    /\s+(shots on goal|saves)\s+(over|under)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      const playerName = text.slice(0, match.index).trim();
      if (playerName) return playerName;
    }
  }

  return null;
}

export function evaluateNBAPropResult(
  side: 'OVER' | 'UNDER',
  line: number,
  actualStat: number
): 'WIN' | 'LOSS' | 'PUSH' {
  if (side === 'OVER') {
    if (actualStat > line) return 'WIN';
    if (actualStat < line) return 'LOSS';
    return 'PUSH';
  }

  if (actualStat < line) return 'WIN';
  if (actualStat > line) return 'LOSS';
  return 'PUSH';
}

export function evaluateMLBPropResult(
  side: 'OVER' | 'UNDER',
  line: number,
  actualStat: number
): 'WIN' | 'LOSS' | 'PUSH' {
  return evaluateNBAPropResult(side, line, actualStat);
}

export function evaluateNHLPropResult(
  side: 'OVER' | 'UNDER',
  line: number,
  actualStat: number
): 'WIN' | 'LOSS' | 'PUSH' {
  return evaluateNBAPropResult(side, line, actualStat);
}

function readNBAStat(player: NBABoxScorePlayerStat, propType: SupportedNBAPropType): number {
  switch (propType) {
    case 'player_points': return player.points;
    case 'player_rebounds': return player.rebounds;
    case 'player_assists': return player.assists;
    case 'player_threes': return player.threes;
    case 'player_points_rebounds_assists': return player.points + player.rebounds + player.assists;
    case 'player_points_rebounds': return player.points + player.rebounds;
    case 'player_points_assists': return player.points + player.assists;
  }
}

function readMLBStat(player: MLBBoxScorePlayerStat, propType: SupportedMLBPropType): number {
  switch (propType) {
    case 'pitcher_strikeouts': return player.strikeouts;
    case 'pitcher_hits_allowed': return player.hitsAllowed;
    case 'pitcher_earned_runs': return player.earnedRuns;
    case 'batter_hits': return player.hits;
    case 'batter_total_bases': return player.totalBases;
  }
}

function readNHLStat(player: NHLBoxScorePlayerStat, propType: SupportedNHLPropType): number {
  switch (propType) {
    case 'player_shots_on_goal': return player.shotsOnGoal;
    case 'goalie_saves': return player.saves;
  }
}

async function fetchNBABoxScoreForGame(matchup: string, gameTime: string): Promise<NBABoxScoreGame | null> {
  const cacheKey = `${matchup}__${gameTime}`;
  if (nbaBoxScoreCache.has(cacheKey)) return nbaBoxScoreCache.get(cacheKey) ?? null;

  const [awayTeam, homeTeam] = (matchup ?? '').split(' @ ').map(part => part?.trim());
  if (!awayTeam || !homeTeam) {
    nbaBoxScoreCache.set(cacheKey, null);
    return null;
  }

  try {
    for (const date of scoreboardDatesForGame(gameTime)) {
      const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`;
      const scoreboardData = await fetchJson(scoreboardUrl);
      const events = Array.isArray(scoreboardData?.events) ? scoreboardData.events : [];
      const event = events.find((candidate: any) => {
        const competitors = candidate?.competitions?.[0]?.competitors ?? [];
        const teamNames = competitors.flatMap((c: any) => [
          c?.team?.displayName ?? '',
          c?.team?.shortDisplayName ?? '',
          c?.team?.abbreviation ?? '',
        ]).filter(Boolean);
        if (teamNames.length < 2) return false;
        for (let i = 0; i < teamNames.length - 1; i++) {
          for (let j = i + 1; j < teamNames.length; j++) {
            if (teamsMatch(homeTeam, awayTeam, teamNames[i], teamNames[j])) return true;
          }
        }
        return false;
      });

      if (!event?.id) continue;

      const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`;
      const summaryData = await fetchJson(summaryUrl);
      const completed = summaryData?.header?.competitions?.[0]?.status?.type?.completed === true;
      const players: NBABoxScorePlayerStat[] = [];

      for (const teamBlock of summaryData?.boxscore?.players ?? []) {
        for (const statGroup of teamBlock?.statistics ?? []) {
          const keys = Array.isArray(statGroup?.keys) ? statGroup.keys : [];
          const athletes = Array.isArray(statGroup?.athletes) ? statGroup.athletes : [];
          const minutesIdx = keys.indexOf('minutes');
          const pointsIdx = keys.indexOf('points');
          const reboundsIdx = keys.indexOf('rebounds');
          const assistsIdx = keys.indexOf('assists');
          const threesIdx = keys.indexOf('threePointFieldGoalsMade-threePointFieldGoalsAttempted');

          for (const athleteRow of athletes) {
            const stats = Array.isArray(athleteRow?.stats) ? athleteRow.stats : [];
            players.push({
              playerName: athleteRow?.athlete?.displayName ?? '',
              normalizedName: normalizePlayerName(athleteRow?.athlete?.displayName ?? ''),
              didNotPlay: athleteRow?.didNotPlay === true,
              active: athleteRow?.active === true,
              reason: athleteRow?.reason ?? '',
              minutes: minutesIdx >= 0 ? parseFloat(stats[minutesIdx] ?? '0') || 0 : 0,
              points: pointsIdx >= 0 ? parseFloat(stats[pointsIdx] ?? '0') || 0 : 0,
              rebounds: reboundsIdx >= 0 ? parseFloat(stats[reboundsIdx] ?? '0') || 0 : 0,
              assists: assistsIdx >= 0 ? parseFloat(stats[assistsIdx] ?? '0') || 0 : 0,
              threes: threesIdx >= 0 ? parseMadeShots(stats[threesIdx] ?? '0-0') : 0,
            });
          }
        }
      }

      const boxScoreGame: NBABoxScoreGame = {
        final: completed,
        eventId: String(event.id),
        source: 'ESPN_NBA_SUMMARY',
        players,
      };
      nbaBoxScoreCache.set(cacheKey, boxScoreGame);
      return boxScoreGame;
    }
  } catch {
    nbaBoxScoreCache.set(cacheKey, null);
    return null;
  }

  nbaBoxScoreCache.set(cacheKey, null);
  return null;
}

async function fetchMLBBoxScoreForGame(matchup: string, gameTime: string): Promise<MLBBoxScoreGame | null> {
  const cacheKey = `${matchup}__${gameTime}`;
  if (mlbBoxScoreCache.has(cacheKey)) return mlbBoxScoreCache.get(cacheKey) ?? null;

  const [awayTeam, homeTeam] = (matchup ?? '').split(' @ ').map(part => part?.trim());
  if (!awayTeam || !homeTeam) {
    mlbBoxScoreCache.set(cacheKey, null);
    return null;
  }

  try {
    for (const date of mlbScheduleDatesForGame(gameTime)) {
      const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`;
      const scheduleData = await fetchJson(scheduleUrl);
      const games = (Array.isArray(scheduleData?.dates) ? scheduleData.dates : [])
        .flatMap((dateNode: any) => Array.isArray(dateNode?.games) ? dateNode.games : []);
      const game = games.find((candidate: any) => {
        const candidateHome = candidate?.teams?.home?.team?.name ?? '';
        const candidateAway = candidate?.teams?.away?.team?.name ?? '';
        return (
          normalizePlayerName(candidateHome) === normalizePlayerName(homeTeam) &&
          normalizePlayerName(candidateAway) === normalizePlayerName(awayTeam)
        );
      });

      if (!game?.gamePk) continue;

      const feedUrl = `https://statsapi.mlb.com/api/v1.1/game/${game.gamePk}/feed/live`;
      const feed = await fetchJson(feedUrl);
      const final =
        feed?.gameData?.status?.abstractGameState === 'Final' ||
        feed?.gameData?.status?.detailedState === 'Final';
      const players: MLBBoxScorePlayerStat[] = [];

      for (const teamBlock of [feed?.liveData?.boxscore?.teams?.home, feed?.liveData?.boxscore?.teams?.away]) {
        for (const player of Object.values(teamBlock?.players ?? {}) as any[]) {
          const batting = player?.stats?.batting ?? {};
          const pitching = player?.stats?.pitching ?? {};
          players.push({
            playerName: player?.person?.fullName ?? '',
            normalizedName: normalizePlayerName(player?.person?.fullName ?? ''),
            battingOrder: String(player?.battingOrder ?? ''),
            atBats: parseNullableNumber(batting?.atBats) ?? 0,
            plateAppearances: parseNullableNumber(batting?.plateAppearances) ?? 0,
            hits: parseNullableNumber(batting?.hits) ?? 0,
            totalBases: computeMLBTotalBases(batting),
            pitchingOuts: parseNullableNumber(pitching?.outs) ?? 0,
            battersFaced: parseNullableNumber(pitching?.battersFaced) ?? 0,
            strikeouts: parseNullableNumber(pitching?.strikeOuts) ?? 0,
            hitsAllowed: parseNullableNumber(pitching?.hits) ?? 0,
            earnedRuns: parseNullableNumber(pitching?.earnedRuns) ?? 0,
          });
        }
      }

      const boxScoreGame: MLBBoxScoreGame = {
        final,
        eventId: String(game.gamePk),
        source: 'MLB_STATSAPI_LIVE_FEED',
        players,
      };
      mlbBoxScoreCache.set(cacheKey, boxScoreGame);
      return boxScoreGame;
    }
  } catch {
    mlbBoxScoreCache.set(cacheKey, null);
    return null;
  }

  mlbBoxScoreCache.set(cacheKey, null);
  return null;
}

async function fetchNHLBoxScoreForGame(matchup: string, gameTime: string): Promise<NHLBoxScoreGame | null> {
  const cacheKey = `${matchup}__${gameTime}`;
  if (nhlBoxScoreCache.has(cacheKey)) return nhlBoxScoreCache.get(cacheKey) ?? null;

  const [awayTeam, homeTeam] = (matchup ?? '').split(' @ ').map(part => part?.trim());
  if (!awayTeam || !homeTeam) {
    nhlBoxScoreCache.set(cacheKey, null);
    return null;
  }

  try {
    const targetStartMs = new Date(gameTime).getTime();
    const candidateGames: any[] = [];
    for (const date of nhlScheduleDatesForGame(gameTime)) {
      const scheduleUrl = `https://api-web.nhle.com/v1/schedule/${date}`;
      const scheduleData = await fetchJson(scheduleUrl);
      const games = (Array.isArray(scheduleData?.gameWeek) ? scheduleData.gameWeek : [])
        .flatMap((weekNode: any) => Array.isArray(weekNode?.games) ? weekNode.games : []);
      const matchingGames = games.filter((candidate: any) => {
        const candidateHome = `${candidate?.homeTeam?.placeName?.default ?? ''} ${candidate?.homeTeam?.commonName?.default ?? ''}`.trim();
        const candidateAway = `${candidate?.awayTeam?.placeName?.default ?? ''} ${candidate?.awayTeam?.commonName?.default ?? ''}`.trim();
        return (
          normalizePlayerName(candidateHome) === normalizePlayerName(homeTeam) &&
          normalizePlayerName(candidateAway) === normalizePlayerName(awayTeam)
        );
      });
      candidateGames.push(...matchingGames);
    }

    const uniqueGames = [...new Map(candidateGames.map((game: any) => [String(game?.id ?? ''), game])).values()];
    const game = uniqueGames.sort((a: any, b: any) => {
      const aDelta = Math.abs(new Date(a?.startTimeUTC ?? 0).getTime() - targetStartMs);
      const bDelta = Math.abs(new Date(b?.startTimeUTC ?? 0).getTime() - targetStartMs);
      return aDelta - bDelta;
    })[0];

    if (!game?.id) {
      nhlBoxScoreCache.set(cacheKey, null);
      return null;
    }

    const boxscoreUrl = `https://api-web.nhle.com/v1/gamecenter/${game.id}/boxscore`;
    const boxscore = await fetchJson(boxscoreUrl);
    const final = boxscore?.gameState === 'OFF';
    const players: NHLBoxScorePlayerStat[] = [];

    for (const teamBlock of [boxscore?.playerByGameStats?.homeTeam, boxscore?.playerByGameStats?.awayTeam]) {
      for (const skater of [...(teamBlock?.forwards ?? []), ...(teamBlock?.defense ?? []), ...(teamBlock?.defensemen ?? [])]) {
        players.push({
          playerName: skater?.name?.default ?? '',
          normalizedName: normalizePlayerName(skater?.name?.default ?? ''),
          role: 'skater',
          position: String(skater?.position ?? '').trim() || 'F',
          shotsOnGoal: parseNullableNumber(skater?.sog) ?? 0,
          shotsAgainst: 0,
          saves: 0,
          goalsAgainst: 0,
          toi: String(skater?.toi ?? ''),
          starter: false,
        });
      }
      for (const goalie of teamBlock?.goalies ?? []) {
        players.push({
          playerName: goalie?.name?.default ?? '',
          normalizedName: normalizePlayerName(goalie?.name?.default ?? ''),
          role: 'goalie',
          position: 'G',
          shotsOnGoal: 0,
          shotsAgainst: parseNullableNumber(goalie?.shotsAgainst) ?? 0,
          saves: parseNullableNumber(goalie?.saves) ?? 0,
          goalsAgainst: parseNullableNumber(goalie?.goalsAgainst) ?? 0,
          toi: String(goalie?.toi ?? ''),
          starter: goalie?.starter === true,
        });
      }
    }

    const boxScoreGame: NHLBoxScoreGame = {
      final,
      eventId: String(game.id),
      source: 'NHL_GAMECENTER_BOXSCORE',
      players,
    };
    nhlBoxScoreCache.set(cacheKey, boxScoreGame);
    return boxScoreGame;
  } catch {
    nhlBoxScoreCache.set(cacheKey, null);
    return null;
  }

  nhlBoxScoreCache.set(cacheKey, null);
  return null;
}

// ------------------------------------
// Determine if a pick won based on score
// ------------------------------------

function evaluatePick(
  betType: string,
  side: string,
  line: number | null,
  homeTeam: string,
  awayTeam: string,
  homeScore: number,
  awayScore: number
): 'WIN' | 'LOSS' | 'PUSH' {
  const last = (s: string) => s?.toLowerCase().split(' ').pop() ?? '';
  const sideIsHome = last(side).includes(last(homeTeam)) || side.toLowerCase().includes('home');
  const margin = homeScore - awayScore; // positive = home won

  if (betType === 'Moneyline' || betType === 'h2h') {
    if (sideIsHome) return homeScore > awayScore ? 'WIN' : homeScore < awayScore ? 'LOSS' : 'PUSH';
    else return awayScore > homeScore ? 'WIN' : awayScore < homeScore ? 'LOSS' : 'PUSH';
  }

  if ((betType === 'Spread' || betType === 'spreads') && line !== null) {
    // line is from the perspective of the side we bet
    const coverMargin = sideIsHome ? (margin + line) : (-margin + line);
    if (coverMargin > 0) return 'WIN';
    if (coverMargin < 0) return 'LOSS';
    return 'PUSH';
  }

  if (betType === 'Total' || betType === 'totals') {
    // Use explicit line; fall back to parsing from side string (e.g. "Over 8.5")
    const effectiveLine = line ?? (() => {
      const m = side.match(/(\d+\.?\d*)/);
      return m ? parseFloat(m[1]) : null;
    })();
    if (effectiveLine !== null) {
      const combined = homeScore + awayScore;
      if (side.toLowerCase().includes('over')) {
        return combined > effectiveLine ? 'WIN' : combined < effectiveLine ? 'LOSS' : 'PUSH';
      } else {
        return combined < effectiveLine ? 'WIN' : combined > effectiveLine ? 'LOSS' : 'PUSH';
      }
    }
  }

  return 'PUSH';
}

// ------------------------------------
// Load/save data
// ------------------------------------

function loadPicks(): any[] {
  if (!fs.existsSync(PICKS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PICKS_FILE, 'utf-8')); }
  catch { return []; }
}

function savePicks(picks: any[]): void {
  fs.writeFileSync(PICKS_FILE, JSON.stringify(picks, null, 2));
}

function loadRetroResults(): RetroResult[] {
  if (!fs.existsSync(RETRO_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(RETRO_FILE, 'utf-8')); }
  catch { return []; }
}

function saveRetroResults(results: RetroResult[]): void {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(RETRO_FILE, JSON.stringify(results, null, 2));
}

export function loadSignalWeights(): Record<string, number> {
  if (!fs.existsSync(WEIGHTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(WEIGHTS_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveSignalWeights(weights: Record<string, number>): void {
  fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(weights, null, 2));
}

// ------------------------------------
// Time-based grading gate
// ------------------------------------

/**
 * Expected game duration in hours per sport key.
 * Used to determine when a game should be definitively over.
 * We add a 1-hour buffer beyond the typical duration to handle overtime,
 * rain delays, and late-night West Coast finishes.
 */
const SPORT_GAME_DURATION_HOURS: Record<string, number> = {
  americanfootball_nfl:   4,   // ~3h typical + buffer
  americanfootball_ncaaf: 4,
  basketball_nba:         3,   // ~2.5h typical + buffer
  basketball_ncaab:       3,
  baseball_mlb:           5,   // can run very long; 5h = safe buffer
  baseball_ncaa:          4,   // college games typically shorter than MLB
  icehockey_nhl:          3,
};
const DEFAULT_GAME_DURATION_HOURS = 4;

/**
 * Returns true when enough time has passed since game start that the game
 * should definitely be over.
 *
 * Gate: gameTime + sport_duration_hours < now
 *
 * If this returns false the pick is left as PENDING — we never attempt to
 * grade a game that may still be in progress.
 */
function isGradeReady(gameTime: string, sportKey: string): boolean {
  const duration   = SPORT_GAME_DURATION_HOURS[sportKey] ?? DEFAULT_GAME_DURATION_HOURS;
  const expectedEndMs = new Date(gameTime).getTime() + duration * 3_600_000;
  return Date.now() > expectedEndMs;
}

function buildRetroPickId(pick: any): string {
  return pick.id ?? pick.pickId ?? `${pick.matchup}_${pick.date}`;
}

function isPlayerPropPick(pick: any): boolean {
  return pick?.marketType === 'player_prop' ||
    String(pick?.betType ?? '').toLowerCase() === 'player prop';
}

function markPickGrade(
  picks: any[],
  targetPick: any,
  updates: Record<string, any>
): void {
  const targetId = buildRetroPickId(targetPick);
  const pickIdx = picks.findIndex((p: any) => buildRetroPickId(p) === targetId);
  if (pickIdx < 0) return;

  picks[pickIdx] = {
    ...picks[pickIdx],
    ...updates,
  };
}

async function gradePendingNBAPropPicks(
  picks: any[],
  existingRetro: RetroResult[],
  gradedIds: Set<string>,
  _cutoffIso: string,
): Promise<{
  checked: number;
  graded: number;
  pending: number;
  missing: number;
  void: number;
  officialGraded: number;
  trackedGraded: number;
  officialPending: number;
  trackedPending: number;
}> {
  const toGrade = picks.filter((pick: any) => {
    const gameTime = pick.gameTime ?? pick.startTime;
    if (!gameTime) return false;
    if (buildRetroPickId(pick) && gradedIds.has(buildRetroPickId(pick))) return false;
    if (normalizeSportKey(pick) !== 'basketball_nba') return false;
    if (!isPlayerPropPick(pick)) return false;
    if ((pick.gameResult ?? 'PENDING') !== 'PENDING') return false;
    if (inferSupportedNBAPropType(pick) === null) return false;
    if (inferPropDirection(`${pick.side ?? ''} ${pick.notes ?? ''}`) === null) return false;
    if ((pick.playerName ?? extractPlayerNameFromSide(pick.side ?? '')) === null) return false;
    if (typeof pick.pickedLine !== 'number') return false;
    if (!isGradeReady(gameTime, 'basketball_nba')) return false;
    return true;
  });

  let graded = 0;
  let missing = 0;
  let voidCount = 0;
  let officialGraded = 0;
  let trackedGraded = 0;

  for (const pick of toGrade) {
    const propType = inferSupportedNBAPropType(pick);
    const side = inferPropDirection(`${pick.side ?? ''} ${pick.notes ?? ''}`);
    const playerName = pick.playerName ?? extractPlayerNameFromSide(pick.side ?? '');
    const line = typeof pick.pickedLine === 'number' ? pick.pickedLine : null;
    const recordBucket = getPickRecordBucket(pick);

    if (!propType || !side || !playerName || line === null) {
      continue;
    }

    const boxScore = await fetchNBABoxScoreForGame(pick.matchup ?? '', pick.gameTime ?? pick.startTime ?? pick.date);
    if (!boxScore) {
      markPickGrade(picks, pick, {
        sportKey: normalizeSportKey(pick),
        marketType: 'player_prop',
        gameResult: 'MISSING_SCORE',
        actualStat: null,
        gradedAt: new Date().toISOString(),
        gradingSource: 'ESPN_NBA_SUMMARY',
        gradingNotes: `box score lookup failed for matchup ${pick.matchup ?? 'unknown'}`,
        autoGraded: true,
      });
      existingRetro.push({
        pickId: buildRetroPickId(pick),
        date: pick.date ?? (pick.gameTime ?? '').split('T')[0],
        matchup: pick.matchup,
        sport: pick.sport,
        betType: pick.betType,
        side: pick.side,
        line,
        grade: pick.grade,
        score: pick.score,
        signals: pick.signalTypes ?? pick.signals ?? [],
        gameResult: 'MISSING_SCORE',
        actualScore: null,
        margin: null,
        clvActual: null,
        missedSignals: [],
        autoGraded: true,
        recordBucket,
        gradingNote: `box score lookup failed for matchup ${pick.matchup ?? 'unknown'}`,
      });
      gradedIds.add(buildRetroPickId(pick));
      missing++;
      continue;
    }
    if (boxScore.final !== true) continue;

    const player = boxScore.players.find(candidate => playerNamesMatch(playerName, candidate.playerName));
    if (!player) {
      markPickGrade(picks, pick, {
        sportKey: normalizeSportKey(pick),
        gameResult: 'MISSING_SCORE',
        actualStat: null,
        gradedAt: new Date().toISOString(),
        gradingSource: boxScore.source,
        gradingNotes: `player box score row not found for ${playerName}`,
        autoGraded: true,
      });
      existingRetro.push({
        pickId: buildRetroPickId(pick),
        date: pick.date ?? (pick.gameTime ?? '').split('T')[0],
        matchup: pick.matchup,
        sport: pick.sport,
        betType: pick.betType,
        side: pick.side,
        line,
        grade: pick.grade,
        score: pick.score,
        signals: pick.signalTypes ?? pick.signals ?? [],
        gameResult: 'MISSING_SCORE',
        actualScore: null,
        margin: null,
        clvActual: null,
        missedSignals: [],
        autoGraded: true,
        recordBucket,
        gradingNote: `player box score row not found for ${playerName}`,
      });
      gradedIds.add(buildRetroPickId(pick));
      missing++;
      continue;
    }

    if (player.didNotPlay || (!player.active && player.minutes === 0)) {
      markPickGrade(picks, pick, {
        sportKey: normalizeSportKey(pick),
        marketType: 'player_prop',
        gameResult: 'VOID',
        actualStat: null,
        gradedAt: new Date().toISOString(),
        gradingSource: boxScore.source,
        gradingNotes: player.reason ? `DNP/Inactive: ${player.reason}` : 'DNP/Inactive',
        autoGraded: true,
      });
      existingRetro.push({
        pickId: buildRetroPickId(pick),
        date: pick.date ?? (pick.gameTime ?? '').split('T')[0],
        matchup: pick.matchup,
        sport: pick.sport,
        betType: pick.betType,
        side: pick.side,
        line,
        grade: pick.grade,
        score: pick.score,
        signals: pick.signalTypes ?? pick.signals ?? [],
        gameResult: 'VOID',
        actualScore: null,
        margin: null,
        clvActual: null,
        missedSignals: [],
        autoGraded: true,
        recordBucket,
        gradingNote: player.reason ? `DNP/Inactive: ${player.reason}` : 'DNP/Inactive',
      });
      gradedIds.add(buildRetroPickId(pick));
      voidCount++;
      continue;
    }

    const actualStat = readNBAStat(player, propType);
    const result = evaluateNBAPropResult(side, line, actualStat);
    markPickGrade(picks, pick, {
      sportKey: normalizeSportKey(pick),
      marketType: 'player_prop',
      gameResult: result,
      actualStat,
      gradedAt: new Date().toISOString(),
      gradingSource: boxScore.source,
      gradingNotes: `${propType} ${side} graded from ESPN NBA summary`,
      autoGraded: true,
    });
    existingRetro.push({
      pickId: buildRetroPickId(pick),
      date: pick.date ?? pick.gameTime?.split('T')[0],
      matchup: pick.matchup,
      sport: pick.sport,
      betType: pick.betType,
      side: pick.side,
      line,
      grade: pick.grade,
      score: pick.score,
      signals: pick.signalTypes ?? pick.signals ?? [],
      gameResult: result,
      actualScore: String(actualStat),
      margin: null,
      clvActual: null,
      missedSignals: result === 'LOSS' ? ['NBA_PROP_RESULT_AGAINST_PICK'] : [],
      autoGraded: true,
      recordBucket,
    });
    gradedIds.add(buildRetroPickId(pick));
    graded++;
    if (recordBucket === 'official') officialGraded++;
    else trackedGraded++;
  }

  const pendingPicks = picks.filter((pick: any) => {
    const gameTime = pick.gameTime ?? pick.startTime;
    return (
      normalizeSportKey(pick) === 'basketball_nba' &&
      isPlayerPropPick(pick) &&
      (pick.gameResult ?? 'PENDING') === 'PENDING' &&
      inferSupportedNBAPropType(pick) !== null &&
      Boolean(gameTime)
    );
  });
  const officialPending = pendingPicks.filter(p => getPickRecordBucket(p) === 'official').length;
  const trackedPending = pendingPicks.length - officialPending;

  return {
    checked: toGrade.length,
    graded,
    pending: pendingPicks.length,
    missing,
    void: voidCount,
    officialGraded,
    trackedGraded,
    officialPending,
    trackedPending,
  };
}

async function gradePendingMLBPropPicks(
  picks: any[],
  existingRetro: RetroResult[],
  gradedIds: Set<string>,
  _cutoffIso: string,
): Promise<{
  checked: number;
  graded: number;
  pending: number;
  missing: number;
  void: number;
  officialGraded: number;
  trackedGraded: number;
  officialPending: number;
  trackedPending: number;
}> {
  const toGrade = picks.filter((pick: any) => {
    const gameTime = pick.gameTime ?? pick.startTime;
    if (!gameTime) return false;
    if (buildRetroPickId(pick) && gradedIds.has(buildRetroPickId(pick))) return false;
    if (normalizeSportKey(pick) !== 'baseball_mlb') return false;
    if (!isPlayerPropPick(pick)) return false;
    if ((pick.gameResult ?? 'PENDING') !== 'PENDING') return false;
    if (inferSupportedMLBPropType(pick) === null) return false;
    if (inferPropDirection(`${pick.side ?? ''} ${pick.notes ?? ''}`) === null) return false;
    if ((pick.playerName ?? extractMLBPlayerNameFromSide(pick.side ?? '')) === null) return false;
    if (typeof pick.pickedLine !== 'number') return false;
    if (!isGradeReady(gameTime, 'baseball_mlb')) return false;
    return true;
  });

  let graded = 0;
  let missing = 0;
  let voidCount = 0;
  let officialGraded = 0;
  let trackedGraded = 0;

  for (const pick of toGrade) {
    const propType = inferSupportedMLBPropType(pick);
    const side = inferPropDirection(`${pick.side ?? ''} ${pick.notes ?? ''}`);
    const playerName = pick.playerName ?? extractMLBPlayerNameFromSide(pick.side ?? '');
    const line = typeof pick.pickedLine === 'number' ? pick.pickedLine : null;
    const recordBucket = getPickRecordBucket(pick);

    if (!propType || !side || !playerName || line === null) continue;

    const boxScore = await fetchMLBBoxScoreForGame(pick.matchup ?? '', pick.gameTime ?? pick.startTime ?? pick.date);
    if (!boxScore) {
      markPickGrade(picks, pick, {
        sportKey: normalizeSportKey(pick),
        marketType: 'player_prop',
        gameResult: 'MISSING_SCORE',
        actualStat: null,
        gradedAt: new Date().toISOString(),
        gradingSource: 'MLB_STATSAPI_LIVE_FEED',
        gradingNotes: `box score lookup failed for matchup ${pick.matchup ?? 'unknown'}`,
        autoGraded: true,
      });
      existingRetro.push({
        pickId: buildRetroPickId(pick),
        date: pick.date ?? (pick.gameTime ?? '').split('T')[0],
        matchup: pick.matchup,
        sport: pick.sport,
        betType: pick.betType,
        side: pick.side,
        line,
        grade: pick.grade,
        score: pick.score,
        signals: pick.signalTypes ?? pick.signals ?? [],
        gameResult: 'MISSING_SCORE',
        actualScore: null,
        margin: null,
        clvActual: null,
        missedSignals: [],
        autoGraded: true,
        recordBucket,
        gradingNote: `box score lookup failed for matchup ${pick.matchup ?? 'unknown'}`,
      });
      gradedIds.add(buildRetroPickId(pick));
      missing++;
      continue;
    }
    if (boxScore.final !== true) continue;

    const player = boxScore.players.find(candidate => playerNamesMatch(playerName, candidate.playerName));
    if (!player) {
      markPickGrade(picks, pick, {
        sportKey: normalizeSportKey(pick),
        marketType: 'player_prop',
        gameResult: 'MISSING_SCORE',
        actualStat: null,
        gradedAt: new Date().toISOString(),
        gradingSource: boxScore.source,
        gradingNotes: `player box score row not found for ${playerName}`,
        autoGraded: true,
      });
      existingRetro.push({
        pickId: buildRetroPickId(pick),
        date: pick.date ?? (pick.gameTime ?? '').split('T')[0],
        matchup: pick.matchup,
        sport: pick.sport,
        betType: pick.betType,
        side: pick.side,
        line,
        grade: pick.grade,
        score: pick.score,
        signals: pick.signalTypes ?? pick.signals ?? [],
        gameResult: 'MISSING_SCORE',
        actualScore: null,
        margin: null,
        clvActual: null,
        missedSignals: [],
        autoGraded: true,
        recordBucket,
        gradingNote: `player box score row not found for ${playerName}`,
      });
      gradedIds.add(buildRetroPickId(pick));
      missing++;
      continue;
    }

    const isPitcherProp =
      propType === 'pitcher_strikeouts' ||
      propType === 'pitcher_hits_allowed' ||
      propType === 'pitcher_earned_runs';
    const hasBattingAction =
      player.plateAppearances > 0 ||
      player.atBats > 0 ||
      player.hits > 0 ||
      player.totalBases > 0;
    const hasPitchingAction =
      player.pitchingOuts > 0 ||
      player.battersFaced > 0 ||
      player.strikeouts > 0 ||
      player.hitsAllowed > 0 ||
      player.earnedRuns > 0;

    if ((isPitcherProp && !hasPitchingAction) || (!isPitcherProp && !hasBattingAction)) {
      const gradingNote = isPitcherProp
        ? 'No pitching action recorded'
        : 'No batting action recorded';
      markPickGrade(picks, pick, {
        sportKey: normalizeSportKey(pick),
        marketType: 'player_prop',
        gameResult: 'VOID',
        actualStat: null,
        gradedAt: new Date().toISOString(),
        gradingSource: boxScore.source,
        gradingNotes: gradingNote,
        autoGraded: true,
      });
      existingRetro.push({
        pickId: buildRetroPickId(pick),
        date: pick.date ?? (pick.gameTime ?? '').split('T')[0],
        matchup: pick.matchup,
        sport: pick.sport,
        betType: pick.betType,
        side: pick.side,
        line,
        grade: pick.grade,
        score: pick.score,
        signals: pick.signalTypes ?? pick.signals ?? [],
        gameResult: 'VOID',
        actualScore: null,
        margin: null,
        clvActual: null,
        missedSignals: [],
        autoGraded: true,
        recordBucket,
        gradingNote,
      });
      gradedIds.add(buildRetroPickId(pick));
      voidCount++;
      continue;
    }

    const actualStat = readMLBStat(player, propType);
    const result = evaluateMLBPropResult(side, line, actualStat);
    markPickGrade(picks, pick, {
      sportKey: normalizeSportKey(pick),
      marketType: 'player_prop',
      gameResult: result,
      actualStat,
      gradedAt: new Date().toISOString(),
      gradingSource: boxScore.source,
      gradingNotes: `${propType} ${side} graded from MLB Stats API live feed`,
      autoGraded: true,
    });
    existingRetro.push({
      pickId: buildRetroPickId(pick),
      date: pick.date ?? pick.gameTime?.split('T')[0],
      matchup: pick.matchup,
      sport: pick.sport,
      betType: pick.betType,
      side: pick.side,
      line,
      grade: pick.grade,
      score: pick.score,
      signals: pick.signalTypes ?? pick.signals ?? [],
      gameResult: result,
      actualScore: String(actualStat),
      margin: null,
      clvActual: null,
      missedSignals: result === 'LOSS' ? ['MLB_PROP_RESULT_AGAINST_PICK'] : [],
      autoGraded: true,
      recordBucket,
    });
    gradedIds.add(buildRetroPickId(pick));
    graded++;
    if (recordBucket === 'official') officialGraded++;
    else trackedGraded++;
  }

  const pendingPicks = picks.filter((pick: any) => {
    const gameTime = pick.gameTime ?? pick.startTime;
    return (
      normalizeSportKey(pick) === 'baseball_mlb' &&
      isPlayerPropPick(pick) &&
      (pick.gameResult ?? 'PENDING') === 'PENDING' &&
      inferSupportedMLBPropType(pick) !== null &&
      Boolean(gameTime)
    );
  });
  const officialPending = pendingPicks.filter(p => getPickRecordBucket(p) === 'official').length;
  const trackedPending = pendingPicks.length - officialPending;

  return {
    checked: toGrade.length,
    graded,
    pending: pendingPicks.length,
    missing,
    void: voidCount,
    officialGraded,
    trackedGraded,
    officialPending,
    trackedPending,
  };
}

async function gradePendingNHLPropPicks(
  picks: any[],
  existingRetro: RetroResult[],
  gradedIds: Set<string>,
  _cutoffIso: string,
): Promise<{
  checked: number;
  graded: number;
  pending: number;
  missing: number;
  void: number;
  officialGraded: number;
  trackedGraded: number;
  officialPending: number;
  trackedPending: number;
}> {
  const toGrade = picks.filter((pick: any) => {
    const gameTime = pick.gameTime ?? pick.startTime;
    if (!gameTime) return false;
    if (buildRetroPickId(pick) && gradedIds.has(buildRetroPickId(pick))) return false;
    if (normalizeSportKey(pick) !== 'icehockey_nhl') return false;
    if (!isPlayerPropPick(pick)) return false;
    if ((pick.gameResult ?? 'PENDING') !== 'PENDING') return false;
    if (inferSupportedNHLPropType(pick) === null) return false;
    if (inferPropDirection(`${pick.side ?? ''} ${pick.notes ?? ''}`) === null) return false;
    if ((pick.playerName ?? extractNHLPlayerNameFromSide(pick.side ?? '')) === null) return false;
    if (typeof pick.pickedLine !== 'number') return false;
    if (!isGradeReady(gameTime, 'icehockey_nhl')) return false;
    return true;
  });

  let graded = 0;
  let missing = 0;
  let voidCount = 0;
  let officialGraded = 0;
  let trackedGraded = 0;

  for (const pick of toGrade) {
    const propType = inferSupportedNHLPropType(pick);
    const side = inferPropDirection(`${pick.side ?? ''} ${pick.notes ?? ''}`);
    const playerName = pick.playerName ?? extractNHLPlayerNameFromSide(pick.side ?? '');
    const line = typeof pick.pickedLine === 'number' ? pick.pickedLine : null;
    const recordBucket = getPickRecordBucket(pick);

    if (!propType || !side || !playerName || line === null) continue;

    const boxScore = await fetchNHLBoxScoreForGame(pick.matchup ?? '', pick.gameTime ?? pick.startTime ?? pick.date);
    if (!boxScore) {
      markPickGrade(picks, pick, {
        sportKey: normalizeSportKey(pick),
        marketType: 'player_prop',
        gameResult: 'MISSING_SCORE',
        actualStat: null,
        gradedAt: new Date().toISOString(),
        gradingSource: 'NHL_GAMECENTER_BOXSCORE',
        gradingNotes: `box score lookup failed for matchup ${pick.matchup ?? 'unknown'}`,
        autoGraded: true,
      });
      existingRetro.push({
        pickId: buildRetroPickId(pick),
        date: pick.date ?? (pick.gameTime ?? '').split('T')[0],
        matchup: pick.matchup,
        sport: pick.sport,
        betType: pick.betType,
        side: pick.side,
        line,
        grade: pick.grade,
        score: pick.score,
        signals: pick.signalTypes ?? pick.signals ?? [],
        gameResult: 'MISSING_SCORE',
        actualScore: null,
        margin: null,
        clvActual: null,
        missedSignals: [],
        autoGraded: true,
        recordBucket,
        gradingNote: `box score lookup failed for matchup ${pick.matchup ?? 'unknown'}`,
      });
      gradedIds.add(buildRetroPickId(pick));
      missing++;
      continue;
    }
    if (boxScore.final !== true) continue;

    const player = boxScore.players.find(candidate => playerNamesMatch(playerName, candidate.playerName));
    if (!player) {
      markPickGrade(picks, pick, {
        sportKey: normalizeSportKey(pick),
        marketType: 'player_prop',
        gameResult: 'MISSING_SCORE',
        actualStat: null,
        gradedAt: new Date().toISOString(),
        gradingSource: boxScore.source,
        gradingNotes: `player box score row not found for ${playerName}`,
        autoGraded: true,
      });
      existingRetro.push({
        pickId: buildRetroPickId(pick),
        date: pick.date ?? (pick.gameTime ?? '').split('T')[0],
        matchup: pick.matchup,
        sport: pick.sport,
        betType: pick.betType,
        side: pick.side,
        line,
        grade: pick.grade,
        score: pick.score,
        signals: pick.signalTypes ?? pick.signals ?? [],
        gameResult: 'MISSING_SCORE',
        actualScore: null,
        margin: null,
        clvActual: null,
        missedSignals: [],
        autoGraded: true,
        recordBucket,
        gradingNote: `player box score row not found for ${playerName}`,
      });
      gradedIds.add(buildRetroPickId(pick));
      missing++;
      continue;
    }

    const noAction = propType === 'goalie_saves'
      ? player.role !== 'goalie' || (!player.starter && player.saves === 0 && player.shotsAgainst === 0)
      : player.role !== 'skater';
    if (noAction) {
      const gradingNote = propType === 'goalie_saves'
        ? 'No goalie start or save chance recorded'
        : 'No skater box score row recorded';
      markPickGrade(picks, pick, {
        sportKey: normalizeSportKey(pick),
        marketType: 'player_prop',
        gameResult: 'VOID',
        actualStat: null,
        gradedAt: new Date().toISOString(),
        gradingSource: boxScore.source,
        gradingNotes: gradingNote,
        autoGraded: true,
      });
      existingRetro.push({
        pickId: buildRetroPickId(pick),
        date: pick.date ?? (pick.gameTime ?? '').split('T')[0],
        matchup: pick.matchup,
        sport: pick.sport,
        betType: pick.betType,
        side: pick.side,
        line,
        grade: pick.grade,
        score: pick.score,
        signals: pick.signalTypes ?? pick.signals ?? [],
        gameResult: 'VOID',
        actualScore: null,
        margin: null,
        clvActual: null,
        missedSignals: [],
        autoGraded: true,
        recordBucket,
        gradingNote: gradingNote,
      });
      gradedIds.add(buildRetroPickId(pick));
      voidCount++;
      continue;
    }

    const actualStat = readNHLStat(player, propType);
    const result = evaluateNHLPropResult(side, line, actualStat);
    markPickGrade(picks, pick, {
      sportKey: normalizeSportKey(pick),
      marketType: 'player_prop',
      gameResult: result,
      actualStat,
      gradedAt: new Date().toISOString(),
      gradingSource: boxScore.source,
      gradingNotes: `${propType} ${side} graded from NHL GameCenter boxscore`,
      autoGraded: true,
    });
    existingRetro.push({
      pickId: buildRetroPickId(pick),
      date: pick.date ?? pick.gameTime?.split('T')[0],
      matchup: pick.matchup,
      sport: pick.sport,
      betType: pick.betType,
      side: pick.side,
      line,
      grade: pick.grade,
      score: pick.score,
      signals: pick.signalTypes ?? pick.signals ?? [],
      gameResult: result,
      actualScore: String(actualStat),
      margin: null,
      clvActual: null,
      missedSignals: result === 'LOSS' ? ['NHL_PROP_RESULT_AGAINST_PICK'] : [],
      autoGraded: true,
      recordBucket,
    });
    gradedIds.add(buildRetroPickId(pick));
    graded++;
    if (recordBucket === 'official') officialGraded++;
    else trackedGraded++;
  }

  const pendingPicks = picks.filter((pick: any) => {
    const gameTime = pick.gameTime ?? pick.startTime;
    return (
      normalizeSportKey(pick) === 'icehockey_nhl' &&
      isPlayerPropPick(pick) &&
      (pick.gameResult ?? 'PENDING') === 'PENDING' &&
      inferSupportedNHLPropType(pick) !== null &&
      Boolean(gameTime)
    );
  });
  const officialPending = pendingPicks.filter(p => getPickRecordBucket(p) === 'official').length;
  const trackedPending = pendingPicks.length - officialPending;

  return {
    checked: toGrade.length,
    graded,
    pending: pendingPicks.length,
    missing,
    void: voidCount,
    officialGraded,
    trackedGraded,
    officialPending,
    trackedPending,
  };
}

// ------------------------------------
// Auto-grade picks from Odds API scores with ESPN fallback
// ------------------------------------

export async function autoGradePicks(): Promise<AutoGradeSummary> {
  const picks = loadPicks();
  let existingRetro = loadRetroResults();
  const supportedPropIds = new Set(
    picks
      .filter((pick: any) =>
        isPlayerPropPick(pick) &&
        (
          (
            normalizeSportKey(pick) === 'basketball_nba' &&
            inferSupportedNBAPropType(pick) !== null
          ) ||
          (
            normalizeSportKey(pick) === 'baseball_mlb' &&
            inferSupportedMLBPropType(pick) !== null
          ) ||
          (
            normalizeSportKey(pick) === 'icehockey_nhl' &&
            inferSupportedNHLPropType(pick) !== null
          )
        )
      )
      .map((pick: any) => buildRetroPickId(pick))
  );
  const supportedNBAPropIds = new Set(
    picks
      .filter((pick: any) =>
        normalizeSportKey(pick) === 'basketball_nba' &&
        isPlayerPropPick(pick) &&
        inferSupportedNBAPropType(pick) !== null
      )
      .map((pick: any) => buildRetroPickId(pick))
  );
  const supportedNHLPropIds = new Set(
    picks
      .filter((pick: any) =>
        normalizeSportKey(pick) === 'icehockey_nhl' &&
        isPlayerPropPick(pick) &&
        inferSupportedNHLPropType(pick) !== null
      )
      .map((pick: any) => buildRetroPickId(pick))
  );

  // ── One-time cleanup: remove entries that were incorrectly stored as PUSH ──
  // evaluatePick only handles: Moneyline/h2h, Spread/spreads, Total/totals.
  // Anything else (player props, alt lines, SGPs) falls through to 'PUSH', which
  // is wrong.  Also purge Spread/Total entries where line=null (can't evaluate).
  // Purge all such auto-graded PUSH entries so the W/L record is clean.
  // The corresponding picks are reset to PENDING and re-evaluated below.
  const GRADEABLE_TYPES = new Set([
    'Moneyline', 'h2h', 'Spread', 'spreads', 'Total', 'totals',
  ]);
  const badIds = new Set(
    existingRetro
      .filter(r =>
        r.autoGraded &&
        r.gameResult === 'PUSH' &&
        !supportedPropIds.has(r.pickId) &&
        (
          !GRADEABLE_TYPES.has(r.betType) ||
          ((r.betType === 'Total' || r.betType === 'spreads' || r.betType === 'Spread') &&
           r.line === null)
        )
      )
      .map(r => r.pickId)
  );
  if (badIds.size > 0) {
    existingRetro = existingRetro.filter(r => !badIds.has(r.pickId));
    // Reset those picks to PENDING in picks_log so they're re-evaluated below.
    // Exception: MISSING_SCORE picks are not reset — they've been graded and
    // are excluded from stats by design.
    let changed = false;
    for (let i = 0; i < picks.length; i++) {
      const id = buildRetroPickId(picks[i]);
      if (badIds.has(id) && picks[i].gameResult !== 'MISSING_SCORE') {
        picks[i] = {
          ...picks[i],
          gameResult: 'PENDING',
          autoGraded: false,
          actualScore: null,
          actualStat: null,
          gradedAt: '',
          gradingSource: '',
          gradingNotes: '',
        };
        changed = true;
      }
    }
    if (changed) savePicks(picks);
    saveRetroResults(existingRetro);
  }

  // Treat MISSING_SCORE and VOID as "done" — never re-attempt grading on them
  const gradedIds = new Set(existingRetro.map(r => r.pickId));

  let newlyGraded = 0;
  let missingScoreCount = 0;
  let voidCount = 0;
  let officialGraded = 0;
  let trackedGraded = 0;
  let structurallyResolved = 0;
  // Time readiness, not a rolling cutoff, should control grading.
  // If a game is definitively over, we should attempt grading even if it
  // started recently or was missed by a previous run.
  const cutoff = new Date(Date.now() - 30 * 3_600_000).toISOString();

  // Resolve legacy game-line picks that can never be graded because the
  // stored record is missing the spread/total line. Leaving them as PENDING
  // forever makes the picks log misleading and blocks clean pending counts.
  for (const pick of picks) {
    const status = pick.gameResult ?? 'PENDING';
    const gameTime = pick.gameTime ?? pick.startTime;
    if (status !== 'PENDING' && status !== '') continue;
    if (!gameTime) continue;
    if (gradedIds.has(buildRetroPickId(pick))) continue;
    if (!GRADEABLE_TYPES.has(pick.betType ?? '')) continue;

    const normKey = normalizeSportKey(pick);
    if (!isGradeReady(gameTime, normKey)) continue;

    const pickLine: number | null = pick.pickedLine ?? pick.line ?? null;
    const needsLine =
      pick.betType === 'Spread' || pick.betType === 'spreads' ||
      pick.betType === 'Total' || pick.betType === 'totals';

    if (!needsLine || pickLine !== null) continue;

    const gradingNote = 'legacy game-line pick missing stored line; result unresolvable';
    markPickGrade(picks, pick, {
      sportKey: normKey,
      gameResult: 'MISSING_SCORE',
      actualScore: null,
      actualStat: null,
      gradedAt: new Date().toISOString(),
      gradingSource: 'LEGACY_PICK_RECORD',
      gradingNotes: gradingNote,
      autoGraded: true,
    });
    existingRetro.push({
      pickId: buildRetroPickId(pick),
      date: pick.date ?? (gameTime ?? '').split('T')[0],
      matchup: pick.matchup,
      sport: pick.sport,
      betType: pick.betType,
      side: pick.side,
      line: null,
      grade: pick.grade,
      score: pick.score,
      signals: pick.signalTypes ?? pick.signals ?? [],
      gameResult: 'MISSING_SCORE',
      actualScore: null,
      margin: null,
      clvActual: null,
      missedSignals: [],
      autoGraded: true,
      recordBucket: getPickRecordBucket(pick),
      gradingNote,
    });
    gradedIds.add(buildRetroPickId(pick));
    missingScoreCount++;
    structurallyResolved++;
  }

  const toGrade = picks.filter((p: any) => {
    // gameTime is the correct field name (startTime was old name)
    const gameTime = p.gameTime ?? p.startTime;
    if (!gameTime) return false;
    if (gradedIds.has(buildRetroPickId(p))) return false;
    if (!GRADEABLE_TYPES.has(p.betType ?? '')) return false;

    // Only attempt to grade picks that are genuinely unresolved
    const status = p.gameResult ?? 'PENDING';
    if (status !== 'PENDING' && status !== '') return false;

    // Time-based gate: only grade if the game should be definitively over.
    // If isGradeReady() returns false the game may still be live — never attempt.
    const normKey = normalizeSportKey(p);
    if (!isGradeReady(gameTime, normKey)) return false;

    return true;
  });

  // Pre-fetch completed scores from the Odds API once per sport key.
  // This fills the oddsApiScoreCache used by getGameScore() for exact-match
  // grading.  Cost: 2 credits per unique sport key (far cheaper than ESPN
  // scraping and more reliable for sports with bad ESPN mappings).
  if (toGrade.length > 0) {
    const sportKeys = [...new Set(toGrade.map(normalizeSportKey))];
    // Guard the Odds API score prefetch (2 credits per sport key).
    // If the daily or per-run cap is exhausted, skip the prefetch — ESPN
    // fallback sources still run and grading continues without penalty.
    const gradingGuard = new CreditBudgetGuard();
    const scoreCheck = gradingGuard.canSpend('scores', sportKeys.length);
    if (!scoreCheck.allowed) {
      console.warn(`[CreditGuard] Grading score prefetch blocked: ${scoreCheck.reason} (estimated ${scoreCheck.estimatedCost} credits, ${sportKeys.length} sports) — ESPN fallback active`);
    } else {
      gradingGuard.spend('scores', sportKeys.length);
      await prefetchOddsApiScores(sportKeys);
    }
  }

  for (const pick of toGrade) {
    try {
      // Only grade bet types that evaluatePick can actually score.
      // Props, alt lines, SGPs, and any non-standard type require player-level
      // stats or are structurally ungradeble — leave them as PENDING forever.
      if (!GRADEABLE_TYPES.has(pick.betType ?? '')) continue;

      // Spread / Total picks without a stored line can't be evaluated.
      const pickLine: number | null = pick.pickedLine ?? pick.line ?? null;
      if ((pick.betType === 'Spread' || pick.betType === 'Total' ||
           pick.betType === 'spreads' || pick.betType === 'totals') &&
          pickLine === null) continue;

      const [away, home] = (pick.matchup ?? '').split(' @ ');
      if (!away || !home) continue;

      const normKey = normalizeSportKey(pick);

      const score = await getGameScore(
        normKey,
        home.trim(), away.trim(),
        pick.gameTime ?? pick.startTime ?? pick.date,
        pick.eventId ?? pick.id ?? undefined,   // passed to Odds API cache lookup
      );

      if (!score || !score.final) {
        // Score not found — but the game-duration window has passed, so this
        // should be over. Mark as MISSING_SCORE so it's excluded from W/L stats
        // rather than counting as a loss or sitting as PENDING indefinitely.
        // We NEVER silently grade a missing-score pick as a loss.
        const pickIdx2 = picks.findIndex((p: any) => buildRetroPickId(p) === buildRetroPickId(pick));
        if (pickIdx2 >= 0 &&
            (picks[pickIdx2].gameResult === 'PENDING' || !picks[pickIdx2].gameResult)) {
          picks[pickIdx2].gameResult  = 'MISSING_SCORE';
          picks[pickIdx2].sportKey = normalizeSportKey(pick);
          picks[pickIdx2].actualStat  = null;
          picks[pickIdx2].autoGraded  = true;
          picks[pickIdx2].gradedAt = new Date().toISOString();
          picks[pickIdx2].gradingSource = 'ODDS_API_OR_ESPN_SCOREBOARD';
          picks[pickIdx2].gradingNotes = 'score unavailable from all 4 sources after game-end window';
        }
        existingRetro.push({
          pickId:       buildRetroPickId(pick),
          date:         pick.date ?? (pick.startTime ?? '').split('T')[0],
          matchup:      pick.matchup,
          sport:        pick.sport,
          betType:      pick.betType,
          side:         pick.side,
          line:         pick.pickedLine ?? pick.line ?? null,
          grade:        pick.grade,
          score:        pick.score,
          signals:      pick.signals ?? [],
          gameResult:   'MISSING_SCORE',
          actualScore:  null,
          margin:       null,
          clvActual:    null,
          missedSignals:[],
          autoGraded:   true,
          recordBucket: getPickRecordBucket(pick),
          gradingNote:  'score unavailable from all 4 sources after game-end window',
        });
        missingScoreCount++;
        continue;
      }

      const result = evaluatePick(
        pick.betType ?? '', pick.side ?? '',
        pickLine,
        home.trim(), away.trim(),
        score.homeScore, score.awayScore
      );

      // Update picks log
      const pickIdx = picks.findIndex((p: any) => buildRetroPickId(p) === buildRetroPickId(pick));
      if (pickIdx >= 0) {
        picks[pickIdx].gameResult = result;
        picks[pickIdx].sportKey = normalizeSportKey(pick);
        picks[pickIdx].actualScore = `${score.homeScore}-${score.awayScore}`;
        picks[pickIdx].actualStat = null;
        picks[pickIdx].autoGraded = true;
        picks[pickIdx].gradedAt = new Date().toISOString();
        picks[pickIdx].gradingSource = 'ODDS_API_OR_ESPN_SCOREBOARD';
        picks[pickIdx].gradingNotes = 'graded from final game score';
      }

      // Build retro result with missed signal analysis
      const missedSignals = analyzeMissedSignals(pick, result);

      existingRetro.push({
        pickId: buildRetroPickId(pick),
        date: pick.date ?? pick.startTime?.split('T')[0],
        matchup: pick.matchup,
        sport: pick.sport,
        betType: pick.betType,
        side: pick.side,
        line: pickLine,
        grade: pick.grade,
        score: pick.score,
        signals: pick.signals ?? [],
        gameResult: result,
        actualScore: `${score.homeScore}-${score.awayScore}`,
        margin: null,
        clvActual: null,
        missedSignals,
        autoGraded: true,
        recordBucket: getPickRecordBucket(pick),
      });

      newlyGraded++;
      if (getPickRecordBucket(pick) === 'official') officialGraded++;
      else trackedGraded++;
    } catch { /* individual grading errors are non-fatal */ }
  }

  const nbaPropSummary = await gradePendingNBAPropPicks(
    picks,
    existingRetro,
    gradedIds,
    cutoff,
  );
  newlyGraded += nbaPropSummary.graded;
  missingScoreCount += nbaPropSummary.missing;
  voidCount += nbaPropSummary.void;
  officialGraded += nbaPropSummary.officialGraded;
  trackedGraded += nbaPropSummary.trackedGraded;

  const mlbPropSummary = await gradePendingMLBPropPicks(
    picks,
    existingRetro,
    gradedIds,
    cutoff,
  );
  newlyGraded += mlbPropSummary.graded;
  missingScoreCount += mlbPropSummary.missing;
  voidCount += mlbPropSummary.void;
  officialGraded += mlbPropSummary.officialGraded;
  trackedGraded += mlbPropSummary.trackedGraded;

  const nhlPropSummary = await gradePendingNHLPropPicks(
    picks,
    existingRetro,
    gradedIds,
    cutoff,
  );
  newlyGraded += nhlPropSummary.graded;
  missingScoreCount += nhlPropSummary.missing;
  voidCount += nhlPropSummary.void;
  officialGraded += nhlPropSummary.officialGraded;
  trackedGraded += nhlPropSummary.trackedGraded;

  if (newlyGraded > 0 || missingScoreCount > 0 || voidCount > 0) {
    savePicks(picks);
    saveRetroResults(existingRetro);
  }

  const pendingGradeablePicks = picks.filter((p: any) =>
    (p.gameResult ?? 'PENDING') === 'PENDING' &&
    (
      GRADEABLE_TYPES.has(p.betType ?? '') ||
      (
        normalizeSportKey(p) === 'basketball_nba' &&
        isPlayerPropPick(p) &&
        inferSupportedNBAPropType(p) !== null
      ) ||
      (
        normalizeSportKey(p) === 'baseball_mlb' &&
        isPlayerPropPick(p) &&
        inferSupportedMLBPropType(p) !== null
      ) ||
      (
        normalizeSportKey(p) === 'icehockey_nhl' &&
        isPlayerPropPick(p) &&
        inferSupportedNHLPropType(p) !== null
      )
    ) &&
    Boolean(p.gameTime ?? p.startTime)
  );
  const officialPending = pendingGradeablePicks.filter(p => getPickRecordBucket(p) === 'official').length;
  const trackedPending = pendingGradeablePicks.length - officialPending;

  return {
    checked: structurallyResolved + toGrade.length + nbaPropSummary.checked + mlbPropSummary.checked + nhlPropSummary.checked,
    graded: newlyGraded,
    pending: pendingGradeablePicks.length,
    missing: missingScoreCount,
    void: voidCount,
    officialGraded,
    trackedGraded,
    officialPending,
    trackedPending,
  };
}

// ------------------------------------
// Analyze what signals were MISSING on a losing pick
// ------------------------------------

function analyzeMissedSignals(pick: any, result: 'WIN' | 'LOSS' | 'PUSH'): string[] {
  if (result !== 'LOSS') return [];

  const presentSignals = new Set((pick.signals ?? []).map((s: string) => s.toUpperCase()));
  const fullReasoning = (pick.fullReasoning ?? []).join(' ').toUpperCase();
  const missed: string[] = [];

  // Check for signals that commonly protect against losses
  if (!presentSignals.has('BACK_TO_BACK') && !fullReasoning.includes('B2B') && !fullReasoning.includes('BACK TO BACK')) {
    missed.push('B2B_NOT_CHECKED');
  }
  if (!presentSignals.has('KEY_PLAYER_OUT') && !fullReasoning.includes('INJURY') && !fullReasoning.includes('OUT')) {
    missed.push('INJURY_NOT_CHECKED');
  }
  if (!presentSignals.has('CONFIRMED_RLM') && !presentSignals.has('SHARP_INTEL')) {
    missed.push('NO_SHARP_SIGNAL');
  }
  if (!presentSignals.has('FORM_ADVANTAGE') && !presentSignals.has('HOT_STREAK')) {
    missed.push('NO_FORM_SIGNAL');
  }
  if (!fullReasoning.includes('POWER') && !fullReasoning.includes('RATING')) {
    missed.push('NO_POWER_RATING');
  }

  return missed;
}

// ------------------------------------
// Build full retro analysis report
// ------------------------------------

// Bet types that evaluatePick can actually score (must match GRADEABLE_TYPES in autoGradePicks)
const REPORT_GRADEABLE = new Set([
  'Moneyline', 'h2h', 'Spread', 'spreads', 'Total', 'totals',
]);

export function buildRetroReport(): RetroReport {
  const results = loadRetroResults();
  const pickBucketById = new Map(
    loadPicks()
      .map((pick: any) => [buildRetroPickId(pick), getPickRecordBucket(pick)] as const)
      .filter(([pickId]) => Boolean(pickId))
  );
  const isOfficialRetro = (result: RetroResult) =>
    (result.recordBucket ?? pickBucketById.get(result.pickId) ?? 'official') === 'official';
  // Only count bet types that evaluatePick can score.
  // Props, alt lines, unrecognised types, and Total/Spread with no line
  // were either never gradeable or were stored as PUSH incorrectly — exclude them.
  // MISSING_SCORE and VOID are excluded from W/L stats — never count as losses.
  // PENDING = game not yet attempted; also excluded.
  const graded = results.filter(r =>
    isOfficialRetro(r) &&
    r.gameResult !== 'PENDING' &&
    r.gameResult !== 'MISSING_SCORE' &&
    r.gameResult !== 'VOID' &&
    REPORT_GRADEABLE.has(r.betType) &&
    !(r.gameResult === 'PUSH' && r.line === null &&
      (r.betType === 'Total' || r.betType === 'spreads' ||
       r.betType === 'Spread' || r.betType === 'totals'))
  );

  // Count non-gradeable for transparency in the report output
  const missingScoreCount = results.filter(r => isOfficialRetro(r) && r.gameResult === 'MISSING_SCORE').length;
  const voidCount         = results.filter(r => isOfficialRetro(r) && r.gameResult === 'VOID').length;

  const wins = graded.filter(r => r.gameResult === 'WIN').length;
  const losses = graded.filter(r => r.gameResult === 'LOSS').length;
  const pushes = graded.filter(r => r.gameResult === 'PUSH').length;
  const wl = wins + losses;
  const winRate = wl > 0 ? Math.round((wins / wl) * 1000) / 10 : 0;

  // By grade
  const byGrade: Record<string, any> = {};
  for (const r of graded) {
    if (!byGrade[r.grade]) byGrade[r.grade] = { wins: 0, losses: 0, pushes: 0 };
    if (r.gameResult === 'WIN') byGrade[r.grade].wins++;
    else if (r.gameResult === 'LOSS') byGrade[r.grade].losses++;
    else byGrade[r.grade].pushes++;
  }
  for (const g of Object.keys(byGrade)) {
    const { wins: w, losses: l } = byGrade[g];
    byGrade[g].winRate = (w + l) > 0 ? Math.round((w / (w + l)) * 1000) / 10 : 0;
  }

  // By sport
  const bySport: Record<string, any> = {};
  for (const r of graded) {
    if (!bySport[r.sport]) bySport[r.sport] = { wins: 0, losses: 0, pushes: 0 };
    if (r.gameResult === 'WIN') bySport[r.sport].wins++;
    else if (r.gameResult === 'LOSS') bySport[r.sport].losses++;
    else bySport[r.sport].pushes++;
  }
  for (const s of Object.keys(bySport)) {
    const { wins: w, losses: l } = bySport[s];
    bySport[s].winRate = (w + l) > 0 ? Math.round((w / (w + l)) * 1000) / 10 : 0;
  }

  // By bet type
  const byBetType: Record<string, any> = {};
  for (const r of graded) {
    const bt = r.betType ?? 'Unknown';
    if (!byBetType[bt]) byBetType[bt] = { wins: 0, losses: 0, pushes: 0 };
    if (r.gameResult === 'WIN') byBetType[bt].wins++;
    else if (r.gameResult === 'LOSS') byBetType[bt].losses++;
    else byBetType[bt].pushes++;
  }
  for (const bt of Object.keys(byBetType)) {
    const { wins: w, losses: l } = byBetType[bt];
    byBetType[bt].winRate = (w + l) > 0 ? Math.round((w / (w + l)) * 1000) / 10 : 0;
  }

  // Signal performance analysis
  const signalTypes = new Set<string>();
  for (const r of graded) {
    for (const s of r.signals) signalTypes.add(s.toUpperCase());
  }

  const signalPerformance: SignalPerformance[] = [];
  for (const sig of signalTypes) {
    const withSignal = graded.filter(r =>
      r.signals.some(s => s.toUpperCase() === sig)
    );
    const withoutSignal = graded.filter(r =>
      !r.signals.some(s => s.toUpperCase() === sig)
    );

    if (withSignal.length < 3) continue; // need at least 3 samples

    const sigWins = withSignal.filter(r => r.gameResult === 'WIN').length;
    const sigLosses = withSignal.filter(r => r.gameResult === 'LOSS').length;
    const sigWL = sigWins + sigLosses;
    const sigWinRate = sigWL > 0 ? Math.round((sigWins / sigWL) * 1000) / 10 : 0;

    const withoutWins = withoutSignal.filter(r => r.gameResult === 'WIN').length;
    const withoutWL = withoutSignal.filter(r => ['WIN','LOSS'].includes(r.gameResult)).length;
    const withoutWinRate = withoutWL > 0 ? Math.round((withoutWins / withoutWL) * 1000) / 10 : winRate;

    const lift = sigWinRate - withoutWinRate;
    const avgScoreWith = withSignal.length > 0
      ? Math.round(withSignal.reduce((s, r) => s + (r.score ?? 0), 0) / withSignal.length)
      : 0;
    const avgScoreWithout = withoutSignal.length > 0
      ? Math.round(withoutSignal.reduce((s, r) => s + (r.score ?? 0), 0) / withoutSignal.length)
      : 0;

    // Recommended weight: 1.0 = neutral, >1 = boost, <1 = penalize
    const recommendedWeight =
      lift >= 10 ? 1.4 :
      lift >= 5  ? 1.2 :
      lift >= 0  ? 1.0 :
      lift >= -5 ? 0.8 : 0.6;

    signalPerformance.push({
      signalType: sig,
      wins: sigWins,
      losses: sigLosses,
      pushes: withSignal.filter(r => r.gameResult === 'PUSH').length,
      winRate: sigWinRate,
      avgScoreWhenPresent: avgScoreWith,
      avgScoreWhenAbsent: avgScoreWithout,
      liftVsBaseline: Math.round(lift * 10) / 10,
      shouldBoost: lift >= 5,
      shouldPenalize: lift <= -5,
      recommendedWeight,
    });
  }

  signalPerformance.sort((a, b) => b.liftVsBaseline - a.liftVsBaseline);

  // Top missed signals on losses
  const missedCounts: Record<string, number> = {};
  for (const r of graded.filter(r => r.gameResult === 'LOSS')) {
    for (const m of r.missedSignals) {
      missedCounts[m] = (missedCounts[m] ?? 0) + 1;
    }
  }
  const topMissed = Object.entries(missedCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([sig, count]) => `${sig} (missing on ${count} losses)`);

  // Build weight adjustments
  const weightAdjustments: Record<string, number> = {};
  for (const sp of signalPerformance) {
    if (sp.recommendedWeight !== 1.0 && (sp.wins + sp.losses) >= 5) {
      weightAdjustments[sp.signalType] = sp.recommendedWeight;
    }
  }
  if (Object.keys(weightAdjustments).length > 0) {
    saveSignalWeights(weightAdjustments);
  }

  // Generate insights
  const insights: string[] = [];

  if (wl >= 10) {
    const bestGrade = Object.entries(byGrade)
      .filter(([, d]) => (d.wins + d.losses) >= 3)
      .sort((a, b) => b[1].winRate - a[1].winRate)[0];
    if (bestGrade) insights.push(`Grade ${bestGrade[0]} is your best performing grade at ${bestGrade[1].winRate}% win rate`);

    const bestSport = Object.entries(bySport)
      .filter(([, d]) => (d.wins + d.losses) >= 3)
      .sort((a, b) => b[1].winRate - a[1].winRate)[0];
    if (bestSport) insights.push(`${bestSport[0]} is your most profitable sport at ${bestSport[1].winRate}% win rate`);

    const bestBetType = Object.entries(byBetType)
      .filter(([, d]) => (d.wins + d.losses) >= 3)
      .sort((a, b) => b[1].winRate - a[1].winRate)[0];
    if (bestBetType) insights.push(`${bestBetType[0]} bets are performing best at ${bestBetType[1].winRate}%`);

    const topSignal = signalPerformance.find(s => s.shouldBoost);
    if (topSignal) insights.push(`Signal ${topSignal.signalType} is your strongest predictor (+${topSignal.liftVsBaseline}% lift)`);

    const worstSignal = [...signalPerformance].reverse().find(s => s.shouldPenalize);
    if (worstSignal) insights.push(`Signal ${worstSignal.signalType} may be noise (${worstSignal.liftVsBaseline}% lift) -- consider reducing weight`);
  }

  if (topMissed.length > 0) {
    insights.push(`Most common missing factor on losses: ${topMissed[0]}`);
  }

  if (wl < 10) {
    insights.push(`Only ${wl} graded picks -- need 30+ for statistically meaningful analysis`);
  }

  const autoGradedAnalyzed = graded.filter(r => r.autoGraded).length;

  return {
    dateAnalyzed: new Date().toISOString(),
    picksAnalyzed: graded.length,
    autoGraded: autoGradedAnalyzed,
    missingScoreCount,
    voidCount,
    overallRecord: { wins, losses, pushes, winRate },
    byGrade,
    bySport,
    byBetType,
    signalPerformance,
    topMissedSignals: topMissed,
    weightAdjustments,
    insights,
  };
}

// ------------------------------------
// Print retro report to console
// ------------------------------------

export function printRetroReport(report: RetroReport): void {
  console.log('\n');
  console.log('=================================================================');
  console.log('  RETROSPECTIVE ANALYSIS -- What We Got Right and Wrong');
  console.log('=================================================================');
  console.log(`  Picks analyzed  : ${report.picksAnalyzed}`);
  console.log(`  Auto-graded     : ${report.autoGraded} of ${report.picksAnalyzed}`);
  console.log(`  Overall record  : ${report.overallRecord.wins}-${report.overallRecord.losses}-${report.overallRecord.pushes}  (${report.overallRecord.winRate}% win rate)`);
  if ((report.missingScoreCount ?? 0) > 0) {
    console.log(`  Missing scores  : ${report.missingScoreCount}  (excluded from record — never counted as losses)`);
  }
  if ((report.voidCount ?? 0) > 0) {
    console.log(`  Voided          : ${report.voidCount}  (cancelled/postponed — excluded from record)`);
  }

  if (report.picksAnalyzed < 5) {
    console.log('\n  Not enough graded picks for meaningful analysis yet.');
    console.log('  Results auto-populate each morning from Odds API scores (with ESPN fallback).');
    console.log('  You can also enter results manually via GO.bat option 12.\n');
    return;
  }

  // By grade
  console.log('\n  -- BY GRADE ------------------------------------');
  for (const [grade, data] of Object.entries(report.byGrade).sort()) {
    const total = data.wins + data.losses;
    if (total < 2) continue;
    const icon = data.winRate >= 55 ? '[+]' : data.winRate >= 50 ? '[~]' : '[-]';
    console.log(`  ${icon} Grade ${grade.padEnd(4)} ${data.wins}-${data.losses}  ${data.winRate}%`);
  }

  // By sport
  console.log('\n  -- BY SPORT ------------------------------------');
  for (const [sport, data] of Object.entries(report.bySport)) {
    const total = data.wins + data.losses;
    if (total < 2) continue;
    const icon = data.winRate >= 55 ? '[+]' : data.winRate >= 50 ? '[~]' : '[-]';
    const label = sport
      .replace('basketball_','').replace('americanfootball_','')
      .replace('icehockey_','').replace('baseball_','')
      .toUpperCase();
    console.log(`  ${icon} ${label.padEnd(10)} ${data.wins}-${data.losses}  ${data.winRate}%`);
  }

  // By bet type
  console.log('\n  -- BY BET TYPE ---------------------------------');
  for (const [bt, data] of Object.entries(report.byBetType)) {
    const total = data.wins + data.losses;
    if (total < 2) continue;
    const icon = data.winRate >= 55 ? '[+]' : data.winRate >= 50 ? '[~]' : '[-]';
    console.log(`  ${icon} ${bt.padEnd(12)} ${data.wins}-${data.losses}  ${data.winRate}%`);
  }

  // Signal performance
  if (report.signalPerformance.length > 0) {
    console.log('\n  -- SIGNAL PERFORMANCE (min 3 samples) ----------');
    for (const sp of report.signalPerformance.slice(0, 8)) {
      const icon = sp.shouldBoost ? '[+]' : sp.shouldPenalize ? '[-]' : '[~]';
      const lift = sp.liftVsBaseline >= 0 ? `+${sp.liftVsBaseline}%` : `${sp.liftVsBaseline}%`;
      console.log(`  ${icon} ${sp.signalType.padEnd(25)} ${sp.wins}-${sp.losses}  ${sp.winRate}%  lift: ${lift}`);
    }
  }

  // Missed signals on losses
  if (report.topMissedSignals.length > 0) {
    console.log('\n  -- MOST COMMON MISSING FACTORS ON LOSSES -------');
    for (const m of report.topMissedSignals) {
      console.log(`  [!] ${m}`);
    }
  }

  // Weight adjustments applied
  if (Object.keys(report.weightAdjustments).length > 0) {
    console.log('\n  -- SIGNAL WEIGHT ADJUSTMENTS APPLIED -----------');
    for (const [sig, weight] of Object.entries(report.weightAdjustments)) {
      const direction = weight > 1 ? 'boosted' : 'reduced';
      console.log(`  [*] ${sig}: weight ${direction} to ${weight}x`);
    }
    console.log('  These adjustments will apply to todays scoring.');
  }

  // Insights
  if (report.insights.length > 0) {
    console.log('\n  -- KEY INSIGHTS --------------------------------');
    for (const insight of report.insights) {
      console.log(`  >> ${insight}`);
    }
  }

  console.log('');
}

// ------------------------------------
// Apply learned signal weights to a score
// Called from topTenBets and propScorer
// ------------------------------------

export function applyLearnedWeights(
  baseScore: number,
  presentSignals: string[],
  weights: Record<string, number>
): number {
  if (Object.keys(weights).length === 0) return baseScore;

  let multiplier = 1.0;
  let applied = 0;

  for (const sig of presentSignals) {
    const w = weights[sig.toUpperCase()];
    if (w) {
      multiplier = (multiplier + w) / 2; // blend, don't stack
      applied++;
    }
  }

  if (applied === 0) return baseScore;
  return Math.max(0, Math.min(100, Math.round(baseScore * multiplier)));
}

// ------------------------------------
// CLV Auto-Tuning Feedback Loop
// Analyzes which signals produced best Closing Line Value
// ------------------------------------

export interface CLVSignalAnalysis {
  signalCombo: string[];     // list of signals that were present
  avgCLV: number;            // average CLV when this combo present
  sampleSize: number;
  clvEdge: number;           // how much better than baseline CLV
  recommendedBoost: number;  // multiplier to apply: 0.8 - 1.5
}

export interface CLVWeightReport {
  dateAnalyzed: string;
  totalPicksWithCLV: number;
  baselineCLV: number;        // avg CLV across all picks
  topCombos: CLVSignalAnalysis[];
  bottomCombos: CLVSignalAnalysis[];
  signalCLVMap: Record<string, number>;  // signal -> avg CLV when present
  autoAdjustments: Record<string, number>; // signal -> recommended weight multiplier
}

export function buildCLVWeightReport(): CLVWeightReport {
  const picks = loadPicks();
  const picksWithCLV = picks.filter((p: any) => p.clvActual !== null && p.clvActual !== undefined);

  const totalPicksWithCLV = picksWithCLV.length;

  // Baseline CLV = average across all picks with CLV recorded
  const baselineCLV = totalPicksWithCLV > 0
    ? Math.round(
        (picksWithCLV.reduce((s: number, p: any) => s + (p.clvActual ?? 0), 0) / totalPicksWithCLV) * 100
      ) / 100
    : 0;

  // Per-signal CLV analysis
  const signalCLVAccum: Record<string, { sum: number; count: number }> = {};

  for (const pick of picksWithCLV) {
    const signals: string[] = (pick.signals ?? []).map((s: string) => s.toUpperCase());
    for (const sig of signals) {
      if (!signalCLVAccum[sig]) signalCLVAccum[sig] = { sum: 0, count: 0 };
      signalCLVAccum[sig].sum += pick.clvActual ?? 0;
      signalCLVAccum[sig].count++;
    }
  }

  const signalCLVMap: Record<string, number> = {};
  const autoAdjustments: Record<string, number> = {};

  for (const [sig, { sum, count }] of Object.entries(signalCLVAccum)) {
    if (count < 3) continue; // need minimum samples
    const avgCLV = Math.round((sum / count) * 100) / 100;
    signalCLVMap[sig] = avgCLV;

    const clvEdge = avgCLV - baselineCLV;
    let boost: number;
    if (clvEdge > 3) boost = 1.4;
    else if (clvEdge > 1) boost = 1.2;
    else if (clvEdge > -1) boost = 1.0;
    else if (clvEdge < -3) boost = 0.7;
    else boost = 0.8;

    if (boost !== 1.0) autoAdjustments[sig] = boost;
  }

  // Build top/bottom combos -- single-signal analysis
  const allAnalyses: CLVSignalAnalysis[] = Object.entries(signalCLVMap).map(([sig, avgCLV]) => ({
    signalCombo: [sig],
    avgCLV,
    sampleSize: signalCLVAccum[sig]?.count ?? 0,
    clvEdge: Math.round((avgCLV - baselineCLV) * 100) / 100,
    recommendedBoost: autoAdjustments[sig] ?? 1.0,
  }));

  allAnalyses.sort((a, b) => b.clvEdge - a.clvEdge);
  const topCombos = allAnalyses.slice(0, 5);
  const bottomCombos = [...allAnalyses].reverse().slice(0, 5);

  const report: CLVWeightReport = {
    dateAnalyzed: new Date().toISOString(),
    totalPicksWithCLV,
    baselineCLV,
    topCombos,
    bottomCombos,
    signalCLVMap,
    autoAdjustments,
  };

  // Save CLV weights
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(CLV_WEIGHTS_FILE, JSON.stringify(autoAdjustments, null, 2));
  } catch { /* non-fatal */ }

  // Merge CLV adjustments into signal_weights.json
  try {
    const existingWeights = loadSignalWeights();
    const merged: Record<string, number> = { ...existingWeights };
    for (const [sig, boost] of Object.entries(autoAdjustments)) {
      const existing = existingWeights[sig] ?? 1.0;
      // Average the two weight sources
      merged[sig] = Math.round(((existing + boost) / 2) * 100) / 100;
    }
    if (Object.keys(merged).length > 0) {
      saveSignalWeights(merged);
    }
  } catch { /* non-fatal */ }

  return report;
}

export function loadCLVWeights(): Record<string, number> {
  if (!fs.existsSync(CLV_WEIGHTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CLV_WEIGHTS_FILE, 'utf-8')); }
  catch { return {}; }
}
