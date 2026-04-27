// ============================================================
// src/services/atsHistorical.ts
// Historical ATS backfill — Option 3
//
// DATA SOURCE : The Odds API historical odds endpoint (spreads)
//               + ESPN scores for final results
// COST        : ~10 credits per date × number of dates requested
//               Typical full-season backfill ≈ 200–400 credits
//
// PURPOSE     : Provides a multi-season ATS baseline for each team.
//               Kept SEPARATE from atsTracker.ts (live/organic data)
//               so the two datasets can be compared on the dashboard.
//
// STORED IN   : ${SNAPSHOT_DIR}/ats_historical.json
//
// TRIGGERED   : Manually from the dashboard via POST /api/ats/backfill
//               NOT run automatically — costs real credits.
//
// COMPARING   : Live (atsTracker) shows recent form / your scan data.
//               Historical (here) shows full-season baseline.
//               Divergence = signal.
// ============================================================

import https from 'https';
import * as fs   from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR      = process.env.SNAPSHOT_DIR ?? './snapshots';
const ATS_HISTORICAL_FILE = path.join(SNAPSHOT_DIR, 'ats_historical.json');
const ODDS_API_KEY      = process.env.ODDS_API_KEY ?? '';
const BASE_URL          = 'https://api.the-odds-api.com/v4';

// ── Types ─────────────────────────────────────────────────────

export interface HistoricalATSEntry {
  wins:   number;
  losses: number;
  pushes: number;
}

export interface HistoricalTeamRecord {
  team:        string;
  sportKey:    string;
  homeRecord:  HistoricalATSEntry;
  awayRecord:  HistoricalATSEntry;
  overall:     HistoricalATSEntry;
  gamesLogged: number;
  seasonCovered: string;     // e.g. "2025-26"
  lastUpdated: string;
}

export interface HistoricalGameResult {
  eventId:     string;
  sportKey:    string;
  gameDate:    string;
  homeTeam:    string;
  awayTeam:    string;
  homeSpread:  number;
  homeScore:   number;
  awayScore:   number;
  homeCovered: boolean;
  awayCovered: boolean;
  push:        boolean;
  source:      'odds_api_historical';
}

export interface HistoricalATSStore {
  lastBackfilled:     string;
  sportsBackfilled:   string[];
  datesCovered:       string[];     // ISO date strings of dates processed
  gameResults:        HistoricalGameResult[];
  teamRecords:        Record<string, HistoricalTeamRecord>;
  creditsUsed:        number;       // approximate credits consumed by backfill
}

export interface BackfillResult {
  sport:       string;
  gamesAdded:  number;
  datesProcessed: number;
  creditsUsed: number;
  errors:      string[];
}

// ── Helpers ───────────────────────────────────────────────────

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'SBE/1.0', 'Accept': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function loadStore(): HistoricalATSStore {
  if (!fs.existsSync(ATS_HISTORICAL_FILE)) {
    return {
      lastBackfilled:   '',
      sportsBackfilled: [],
      datesCovered:     [],
      gameResults:      [],
      teamRecords:      {},
      creditsUsed:      0,
    };
  }
  try {
    return JSON.parse(fs.readFileSync(ATS_HISTORICAL_FILE, 'utf-8')) as HistoricalATSStore;
  } catch {
    return {
      lastBackfilled:   '',
      sportsBackfilled: [],
      datesCovered:     [],
      gameResults:      [],
      teamRecords:      {},
      creditsUsed:      0,
    };
  }
}

function saveStore(store: HistoricalATSStore): void {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(ATS_HISTORICAL_FILE, JSON.stringify(store, null, 2));
  } catch { /* non-fatal */ }
}

function teamKey(team: string, sportKey: string): string {
  return `${team.toLowerCase().replace(/\s+/g, '_')}__${sportKey}`;
}

function computeCover(
  homeScore: number,
  awayScore: number,
  homeSpread: number
): { homeCovered: boolean; awayCovered: boolean; push: boolean } {
  const coverResult = (homeScore - awayScore) + homeSpread;
  const push        = coverResult === 0;
  return {
    homeCovered: !push && coverResult > 0,
    awayCovered: !push && coverResult < 0,
    push,
  };
}

// ── ESPN score lookup (reused from retroAnalysis pattern) ─────

const ESPN_LEAGUES: Record<string, { sport: string; league: string }> = {
  basketball_nba:         { sport: 'basketball', league: 'nba' },
  baseball_mlb:           { sport: 'baseball',   league: 'mlb' },
  americanfootball_nfl:   { sport: 'football',   league: 'nfl' },
  americanfootball_ncaaf: { sport: 'football',   league: 'college-football' },
  basketball_ncaab:       { sport: 'basketball', league: 'mens-college-basketball' },
  icehockey_nhl:          { sport: 'hockey',     league: 'nhl' },
};

async function getScoreFromESPN(
  sportKey: string,
  homeTeam: string,
  awayTeam: string,
  gameDate: string
): Promise<{ homeScore: number; awayScore: number } | null> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;

  try {
    const dateStr = gameDate.replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/scoreboard?dates=${dateStr}&limit=30`;
    const data = await fetchJson(url);
    const events: any[] = data?.events ?? [];

    const normLast = (s: string) => (s.split(' ').pop() ?? '').toLowerCase();
    const hLast = normLast(homeTeam);
    const aLast = normLast(awayTeam);

    for (const event of events) {
      const comp = event?.competitions?.[0];
      if (comp?.status?.type?.completed !== true) continue;

      const competitors: any[] = comp.competitors ?? [];
      const names = competitors.flatMap((c: any) => [
        c?.team?.displayName ?? '',
        c?.team?.shortDisplayName ?? '',
        c?.team?.abbreviation ?? '',
      ]).map((n: string) => n.toLowerCase());

      const matched = names.some(n => n.includes(hLast)) && names.some(n => n.includes(aLast));
      if (!matched) continue;

      const home = competitors.find((c: any) => c?.homeAway === 'home');
      const away = competitors.find((c: any) => c?.homeAway === 'away');
      const hs   = parseFloat(home?.score ?? '0');
      const as_  = parseFloat(away?.score ?? '0');
      if (hs === 0 && as_ === 0) continue;
      return { homeScore: hs, awayScore: as_ };
    }
  } catch { /* non-fatal */ }
  return null;
}

// ── Historical odds fetch ──────────────────────────────────────

interface HistoricalOddsEvent {
  id:           string;
  home_team:    string;
  away_team:    string;
  commence_time: string;
  bookmakers:   any[];
}

async function fetchHistoricalOdds(
  sportKey: string,
  isoDate: string
): Promise<{ events: HistoricalOddsEvent[]; creditsUsed: number }> {
  if (!ODDS_API_KEY) throw new Error('ODDS_API_KEY not set');

  // Use noon on the game date as the snapshot timestamp
  const timestamp = `${isoDate}T12:00:00Z`;
  const url =
    `${BASE_URL}/historical/sports/${sportKey}/odds` +
    `?apiKey=${ODDS_API_KEY}` +
    `&regions=us` +
    `&markets=spreads` +
    `&oddsFormat=american` +
    `&date=${encodeURIComponent(timestamp)}`;

  const data = await fetchJson(url);

  // Extract credit usage from response headers not available via https module;
  // Odds API historical endpoint costs ~10 credits per request
  const events: HistoricalOddsEvent[] = data?.data ?? [];
  return { events, creditsUsed: 10 };
}

function extractHomeSpreadFromBookmakers(
  homeTeam: string,
  bookmakers: any[]
): number | null {
  const homeLast = (homeTeam.split(' ').pop() ?? '').toLowerCase();
  const prices: number[] = [];

  for (const bk of bookmakers) {
    const market = (bk?.markets ?? []).find((m: any) => m.key === 'spreads');
    if (!market) continue;
    const homeSide = (market.outcomes ?? []).find(
      (o: any) => (o.name ?? '').toLowerCase().includes(homeLast)
    );
    if (homeSide?.point !== undefined && homeSide.point !== null) {
      prices.push(homeSide.point);
    }
  }

  if (prices.length === 0) return null;
  // Consensus = median
  prices.sort((a, b) => a - b);
  return prices[Math.floor(prices.length / 2)];
}

// ── Rebuild team records ───────────────────────────────────────

function rebuildTeamRecords(
  gameResults: HistoricalGameResult[],
  seasonLabel: string
): Record<string, HistoricalTeamRecord> {
  const records: Record<string, HistoricalTeamRecord> = {};

  const getRecord = (team: string, sportKey: string): HistoricalTeamRecord => {
    const key = teamKey(team, sportKey);
    if (!records[key]) {
      records[key] = {
        team,
        sportKey,
        homeRecord:  { wins: 0, losses: 0, pushes: 0 },
        awayRecord:  { wins: 0, losses: 0, pushes: 0 },
        overall:     { wins: 0, losses: 0, pushes: 0 },
        gamesLogged: 0,
        seasonCovered: seasonLabel,
        lastUpdated:  new Date().toISOString(),
      };
    }
    return records[key];
  };

  const add = (e: HistoricalATSEntry, covered: boolean, push: boolean) => {
    if (push)        e.pushes++;
    else if (covered) e.wins++;
    else             e.losses++;
  };

  for (const g of gameResults) {
    const homeRec = getRecord(g.homeTeam, g.sportKey);
    add(homeRec.homeRecord, g.homeCovered, g.push);
    add(homeRec.overall,    g.homeCovered, g.push);
    homeRec.gamesLogged++;

    const awayRec = getRecord(g.awayTeam, g.sportKey);
    add(awayRec.awayRecord, g.awayCovered, g.push);
    add(awayRec.overall,    g.awayCovered, g.push);
    awayRec.gamesLogged++;
  }

  return records;
}

// ── Public: run backfill for a sport + date range ─────────────

/**
 * Runs a historical ATS backfill for the given sport across a range of dates.
 *
 * Each date costs ~10 credits. To limit cost, pass a small date range first
 * (e.g. last 30 game days of the previous season).
 *
 * gameDates: array of 'YYYY-MM-DD' strings to process.
 * seasonLabel: e.g. "2024-25" — stored with records for display.
 *
 * Returns a BackfillResult with games added and credits consumed.
 */
export async function runHistoricalBackfill(
  sportKey: string,
  gameDates: string[],
  seasonLabel: string = 'Historical'
): Promise<BackfillResult> {
  const store      = loadStore();
  const processed  = new Set(store.gameResults.map(g => g.eventId));
  const errors: string[] = [];

  let gamesAdded      = 0;
  let datesProcessed  = 0;
  let creditsConsumed = 0;

  console.log(`  [ATS HISTORICAL] Backfilling ${sportKey} — ${gameDates.length} dates (~${gameDates.length * 10} credits)`);

  for (const date of gameDates) {
    if (store.datesCovered.includes(`${sportKey}:${date}`)) {
      continue; // already processed
    }

    try {
      const { events, creditsUsed } = await fetchHistoricalOdds(sportKey, date);
      creditsConsumed += creditsUsed;
      datesProcessed++;

      for (const event of events) {
        if (processed.has(event.id)) continue;

        const homeSpread = extractHomeSpreadFromBookmakers(event.home_team, event.bookmakers);
        if (homeSpread === null) continue;

        const gameDate = (event.commence_time ?? date).split('T')[0];

        // Get ESPN score for this game
        const score = await getScoreFromESPN(sportKey, event.home_team, event.away_team, gameDate);
        if (!score) continue;

        const { homeCovered, awayCovered, push } = computeCover(
          score.homeScore, score.awayScore, homeSpread
        );

        store.gameResults.push({
          eventId:     event.id,
          sportKey,
          gameDate,
          homeTeam:    event.home_team,
          awayTeam:    event.away_team,
          homeSpread,
          homeScore:   score.homeScore,
          awayScore:   score.awayScore,
          homeCovered,
          awayCovered,
          push,
          source:      'odds_api_historical',
        });

        processed.add(event.id);
        gamesAdded++;
      }

      store.datesCovered.push(`${sportKey}:${date}`);

      // Brief pause between API calls to be respectful
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      errors.push(`${date}: ${err?.message ?? String(err)}`);
    }
  }

  // Update store
  if (!store.sportsBackfilled.includes(sportKey)) {
    store.sportsBackfilled.push(sportKey);
  }
  store.teamRecords    = rebuildTeamRecords(store.gameResults, seasonLabel);
  store.lastBackfilled = new Date().toISOString();
  store.creditsUsed   += creditsConsumed;
  saveStore(store);

  console.log(`  [ATS HISTORICAL] Done — ${gamesAdded} games added, ${creditsConsumed} credits used`);
  if (errors.length > 0) {
    console.log(`  [ATS HISTORICAL] ${errors.length} errors:`, errors.slice(0, 3).join('; '));
  }

  return { sport: sportKey, gamesAdded, datesProcessed, creditsUsed: creditsConsumed, errors };
}

// ── Public: build report for dashboard ───────────────────────

export interface HistoricalReportRow {
  team:        string;
  sport:       string;
  homeRecord:  string;  // "28-22 (56%)"
  awayRecord:  string;
  overall:     string;
  gamesLogged: number;
  season:      string;
}

export function buildHistoricalReport(): {
  lastBackfilled: string;
  totalGames:     number;
  sportsBackfilled: string[];
  creditsUsed:    number;
  rows:           HistoricalReportRow[];
  dataSource:     string;
  isEmpty:        boolean;
} {
  const store = loadStore();

  const fmt = (e: HistoricalATSEntry): string => {
    const total = e.wins + e.losses;
    if (total === 0) return '—';
    const pct = Math.round((e.wins / total) * 100);
    return `${e.wins}-${e.losses}${e.pushes > 0 ? `-${e.pushes}` : ''} (${pct}%)`;
  };

  const rows: HistoricalReportRow[] = Object.values(store.teamRecords)
    .filter(r => r.gamesLogged >= 3)
    .map(r => ({
      team:        r.team,
      sport:       r.sportKey.replace('basketball_','').replace('americanfootball_','').replace('icehockey_','').toUpperCase(),
      homeRecord:  fmt(r.homeRecord),
      awayRecord:  fmt(r.awayRecord),
      overall:     fmt(r.overall),
      gamesLogged: r.gamesLogged,
      season:      r.seasonCovered,
    }))
    .sort((a, b) => a.team.localeCompare(b.team));

  return {
    lastBackfilled:   store.lastBackfilled || 'Never',
    totalGames:       store.gameResults.length,
    sportsBackfilled: store.sportsBackfilled,
    creditsUsed:      store.creditsUsed,
    rows,
    dataSource:       'Historical (Odds API backfill — manually triggered)',
    isEmpty:          store.gameResults.length === 0,
  };
}

// ── Public: load raw store ────────────────────────────────────

export function loadATSHistorical(): HistoricalATSStore {
  return loadStore();
}
