// ============================================================
// src/services/matchupHistory.ts
// Historical H2H Matchup Database
// Tracks head-to-head records from ESPN schedule data
// Saves/loads from snapshots/h2h_records.json with 7-day TTL
// ============================================================

import https from 'https';
import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const H2H_FILE = path.join(SNAPSHOT_DIR, 'h2h_records.json');
const TTL_MS = 7 * 24 * 3600 * 1000; // 7 days

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
// Types
// ------------------------------------

export interface H2HRecord {
  team1: string;
  team2: string;
  sportKey: string;
  games: number;
  team1Wins: number;
  team2Wins: number;
  atsTeam1Wins: number;  // team1 covers spread (straight-up proxy)
  atsTeam2Wins: number;
  overHits: number;
  underHits: number;
  avgTotal: number;
  lastUpdated: string;
}

export interface H2HReport {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  record: H2HRecord | null;
  atsTrend: 'home_covers' | 'away_covers' | 'neutral';
  totalTrend: 'over' | 'under' | 'neutral';
  scoreBonus: number;     // 0-12 bonus when H2H trend aligns
  detail: string;
}

// ------------------------------------
// Storage helpers
// ------------------------------------

function loadH2HRecords(): Record<string, H2HRecord> {
  if (!fs.existsSync(H2H_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(H2H_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveH2HRecords(records: Record<string, H2HRecord>): void {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(H2H_FILE, JSON.stringify(records, null, 2));
  } catch { /* ignore */ }
}

function h2hKey(team1: string, team2: string, sportKey: string): string {
  // Canonical key: alphabetical order so A|B and B|A map to same key
  const sorted = [team1, team2].sort();
  return `${sorted[0]}|${sorted[1]}|${sportKey}`;
}

// ------------------------------------
// Team ID cache
// ------------------------------------

const teamIdCache = new Map<string, string>();

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

// ------------------------------------
// Fetch H2H games from ESPN schedule
// ------------------------------------

async function fetchH2HRecord(
  sportKey: string,
  team1: string,
  team2: string
): Promise<H2HRecord | null> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;

  const [team1Id, team2Id] = await Promise.all([
    getTeamId(sportKey, team1).catch(() => null),
    getTeamId(sportKey, team2).catch(() => null),
  ]);

  if (!team1Id || !team2Id) return null;

  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];

  let totalGames = 0;
  let team1Wins = 0;
  let team2Wins = 0;
  let totalCombinedScore = 0;
  let scoredGames = 0;

  for (const year of years) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/teams/${team1Id}/schedule?season=${year}&seasontype=2`;
      const data = await fetchJson(url);
      const events: any[] = data?.events ?? [];

      for (const event of events) {
        const comp = event?.competitions?.[0];
        if (!comp) continue;

        // Check if this was a game vs team2
        const competitors: any[] = comp.competitors ?? [];
        const vsTeam2 = competitors.find((c: any) =>
          c?.id === team2Id || c?.team?.id === team2Id
        );
        if (!vsTeam2) continue;

        // Must be a completed game
        if (comp?.status?.type?.completed !== true) continue;

        const thisTeam = competitors.find((c: any) =>
          c?.id === team1Id || c?.team?.id === team1Id
        );
        if (!thisTeam) continue;

        const score1 = parseFloat(thisTeam?.score ?? '0');
        const score2 = parseFloat(vsTeam2?.score ?? '0');

        if (score1 === 0 && score2 === 0) continue;

        totalGames++;
        if (score1 > score2) team1Wins++;
        else if (score2 > score1) team2Wins++;

        const combined = score1 + score2;
        if (combined > 0) {
          totalCombinedScore += combined;
          scoredGames++;
        }
      }
    } catch { /* continue to next year */ }
  }

  if (totalGames === 0) return null;

  const avgTotal = scoredGames > 0 ? Math.round((totalCombinedScore / scoredGames) * 10) / 10 : 0;

  return {
    team1,
    team2,
    sportKey,
    games: totalGames,
    team1Wins,
    team2Wins,
    atsTeam1Wins: team1Wins,   // using SU wins as proxy since no historical lines
    atsTeam2Wins: team2Wins,
    overHits: 0,   // no historical lines to compute
    underHits: 0,
    avgTotal,
    lastUpdated: new Date().toISOString(),
  };
}

// ------------------------------------
// Main export
// ------------------------------------

export async function buildH2HMap(
  events: Array<{ eventId: string; sportKey: string; homeTeam: string; awayTeam: string }>
): Promise<Map<string, H2HReport>> {
  const result = new Map<string, H2HReport>();
  const records = loadH2HRecords();
  let dirty = false;

  for (const event of events) {
    try {
      const key = h2hKey(event.homeTeam, event.awayTeam, event.sportKey);
      const cached = records[key];
      const isStale = !cached ||
        (Date.now() - new Date(cached.lastUpdated).getTime()) > TTL_MS;

      let record: H2HRecord | null = cached ?? null;

      if (isStale) {
        try {
          const fetched = await fetchH2HRecord(event.sportKey, event.homeTeam, event.awayTeam);
          if (fetched) {
            records[key] = fetched;
            record = fetched;
            dirty = true;
          }
        } catch { /* keep old cached if fetch fails */ }
      }

      if (!record || record.games < 3) {
        result.set(event.eventId, {
          eventId: event.eventId,
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          record: null,
          atsTrend: 'neutral',
          totalTrend: 'neutral',
          scoreBonus: 0,
          detail: 'Insufficient H2H history',
        });
        continue;
      }

      // Determine ATS trend (SU wins proxy)
      const homeIsTeam1 = record.team1 === event.homeTeam;
      const homeWins = homeIsTeam1 ? record.team1Wins : record.team2Wins;
      const awayWins = homeIsTeam1 ? record.team2Wins : record.team1Wins;
      const homeWinPct = record.games > 0 ? homeWins / record.games : 0.5;

      let atsTrend: 'home_covers' | 'away_covers' | 'neutral' = 'neutral';
      if (homeWinPct > 0.65) atsTrend = 'home_covers';
      else if (homeWinPct < 0.35) atsTrend = 'away_covers';

      // Determine total trend based on avg combined score vs (no line available — use 0 as unknown)
      // For total trend, we compare avgTotal against a neutral benchmark
      // Since we don't have current line here, we just report the trend directionally
      let totalTrend: 'over' | 'under' | 'neutral' = 'neutral';
      let totalDetail = '';

      // We'll leave totalTrend neutral here and compare to line at scoring time
      // But we can note if avg total is notably high or low
      if (record.avgTotal > 0) {
        totalDetail = `avg combined score: ${record.avgTotal}`;
      }

      // Score bonus
      let scoreBonus = 0;
      const parts: string[] = [];

      if (atsTrend !== 'neutral' && record.games >= 5) {
        scoreBonus += 10;
        const coverTeam = atsTrend === 'home_covers' ? event.homeTeam : event.awayTeam;
        const coverPct = atsTrend === 'home_covers'
          ? Math.round(homeWinPct * 100) : Math.round((1 - homeWinPct) * 100);
        parts.push(`${coverTeam} wins ${coverPct}% of H2H matchups (${record.games} games)`);
      }

      if (totalDetail) parts.push(totalDetail);

      const detail = parts.length > 0
        ? parts.join(' | ')
        : `H2H: ${homeWins}-${awayWins} in last ${record.games} meetings`;

      result.set(event.eventId, {
        eventId: event.eventId,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        record,
        atsTrend,
        totalTrend,
        scoreBonus,
        detail,
      });
    } catch {
      // Non-fatal
    }
  }

  if (dirty) saveH2HRecords(records);

  return result;
}

// ------------------------------------
// H2H total trend check with current line
// Called from scoring to apply total trend bonus
// ------------------------------------

export function getH2HTotalTrend(
  record: H2HRecord | null,
  currentLine: number | null
): { trend: 'over' | 'under' | 'neutral'; scoreBonus: number } {
  if (!record || record.avgTotal === 0 || currentLine === null) {
    return { trend: 'neutral', scoreBonus: 0 };
  }

  if (record.avgTotal > currentLine + 2) return { trend: 'over', scoreBonus: 8 };
  if (record.avgTotal < currentLine - 2) return { trend: 'under', scoreBonus: 8 };
  return { trend: 'neutral', scoreBonus: 0 };
}
