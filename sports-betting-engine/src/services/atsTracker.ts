// ============================================================
// src/services/atsTracker.ts
// Live ATS (Against The Spread) tracker — Option 1
//
// DATA SOURCE : Our own morning scan snapshots (spreads) +
//               Odds API completed scores (results)
// COST        : 0 extra credits — uses data already collected
//
// TIMEFRAMES  :
//   Weekly  — last 7 days   (momentum / immediate hot-cold)
//   Monthly — last 30 days  (primary recency signal)
//   Season  — last 180 days (current year proxy)
//   All-Time — everything in our database
//
// STORED IN   : ${SNAPSHOT_DIR}/ats_live.json
//
// AUTO-RUNS after each morning scan via updateATSTracker().
// Dashboard reads via buildATSReport() and getATSDivergenceSummary().
// Scoring engine reads via getATSSignalForScoring().
//
// NOTE: This is the LIVE tracker — it builds from YOUR scans.
//       The separate atsHistorical.ts covers the API backfill (Option 3).
//       Comparing the two datasets reveals divergence signals.
// ============================================================

import * as fs   from 'fs';
import * as path from 'path';
import { EventSummary }     from '../types/odds';
import { getCompletedScores, CompletedScore } from '../api/oddsApiClient';
import { CreditBudgetGuard } from './creditBudgetGuard';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const ATS_LIVE_FILE = path.join(SNAPSHOT_DIR, 'ats_live.json');

// ── Types ─────────────────────────────────────────────────────

export interface ATSEntry {
  wins:   number;
  losses: number;
  pushes: number;
}

export interface ATSTimeframes {
  weekly:  ATSEntry;   // last 7 days
  monthly: ATSEntry;   // last 30 days
  season:  ATSEntry;   // last 180 days
  allTime: ATSEntry;   // all data in our database
}

export interface TeamATSRecord {
  team:      string;
  sportKey:  string;
  home:      ATSTimeframes;
  away:      ATSTimeframes;
  overall:   ATSTimeframes;
  lastGame:  string | null;   // ISO date of most recent graded game
  lastUpdated: string;
}

export interface ATSGameResult {
  eventId:      string;
  sportKey:     string;
  gameDate:     string;    // YYYY-MM-DD
  homeTeam:     string;
  awayTeam:     string;
  homeSpread:   number;    // consensus closing spread (home perspective)
  homeScore:    number;
  awayScore:    number;
  homeMargin:   number;    // homeScore - awayScore
  homeCovered:  boolean;
  awayCovered:  boolean;
  push:         boolean;
  computedAt:   string;
}

export interface ATSLiveStore {
  lastUpdated:        string;
  processedEventIds:  string[];       // avoid double-counting
  gameResults:        ATSGameResult[];
  teamRecords:        Record<string, TeamATSRecord>; // key: team__sportKey
}

export interface ATSDivergenceEntry {
  team:          string;
  sportKey:      string;
  split:         'home' | 'away' | 'overall';
  weeklyPct:     number | null;
  monthlyPct:    number | null;
  seasonPct:     number | null;
  allTimePct:    number | null;
  divergence:    number | null;    // monthlyPct - allTimePct
  signal:        'HOT' | 'COLD' | 'NEUTRAL' | 'INSUFFICIENT_DATA';
}

// ── Helpers ───────────────────────────────────────────────────

function winPct(e: ATSEntry): number | null {
  const total = e.wins + e.losses;
  if (total === 0) return null;
  return Math.round((e.wins / total) * 1000) / 10;
}

function emptyEntry(): ATSEntry {
  return { wins: 0, losses: 0, pushes: 0 };
}

function emptyTimeframes(): ATSTimeframes {
  return {
    weekly:  emptyEntry(),
    monthly: emptyEntry(),
    season:  emptyEntry(),
    allTime: emptyEntry(),
  };
}

function daysBetween(dateA: string, dateB: Date): number {
  const a = new Date(dateA);
  return (dateB.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

/** Normalize team name for key use — removes spaces, lowercases */
function teamKey(team: string, sportKey: string): string {
  return `${team.toLowerCase().replace(/\s+/g, '_')}__${sportKey}`;
}

/** Extract home team's consensus spread from an EventSummary */
function extractHomeSpread(summary: EventSummary): number | null {
  const market = summary.aggregatedMarkets?.['spreads'];
  if (!market) return null;
  const homeLast = (summary.homeTeam.split(' ').pop() ?? '').toLowerCase();
  const homeSide = market.sides.find(s =>
    s.outcomeName.toLowerCase().includes(homeLast)
  );
  return homeSide?.consensusLine ?? null;
}

// ── Load / save ───────────────────────────────────────────────

function loadStore(): ATSLiveStore {
  if (!fs.existsSync(ATS_LIVE_FILE)) {
    return { lastUpdated: new Date().toISOString(), processedEventIds: [], gameResults: [], teamRecords: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(ATS_LIVE_FILE, 'utf-8')) as ATSLiveStore;
  } catch {
    return { lastUpdated: new Date().toISOString(), processedEventIds: [], gameResults: [], teamRecords: {} };
  }
}

function saveStore(store: ATSLiveStore): void {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(ATS_LIVE_FILE, JSON.stringify(store, null, 2));
  } catch { /* non-fatal */ }
}

// ── Load recent morning scan snapshots ───────────────────────

/**
 * Loads all MORNING_SCAN snapshot files written in the last `daysBack` days.
 * Returns a flat map of eventId → { spread, homeTeam, awayTeam, sportKey, gameDate }.
 */
function loadRecentSpreadMap(daysBack = 30): Map<string, {
  homeTeam:  string;
  awayTeam:  string;
  sportKey:  string;
  gameDate:  string;
  homeSpread: number;
}> {
  const spreadMap = new Map<string, { homeTeam: string; awayTeam: string; sportKey: string; gameDate: string; homeSpread: number }>();

  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) return spreadMap;
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

    const files = fs.readdirSync(SNAPSHOT_DIR)
      .filter(f => f.startsWith('morning_scan_') && f.endsWith('.json'))
      .filter(f => {
        try {
          const stat = fs.statSync(path.join(SNAPSHOT_DIR, f));
          return stat.mtimeMs >= cutoff;
        } catch { return false; }
      });

    for (const file of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, file), 'utf-8'));
        const summaries: EventSummary[] = raw?.eventSummaries ?? [];

        for (const s of summaries) {
          const homeSpread = extractHomeSpread(s);
          if (homeSpread === null) continue;

          const gameDate = s.startTime
            ? s.startTime.split('T')[0]
            : new Date().toISOString().split('T')[0];

          spreadMap.set(s.eventId, {
            homeTeam:  s.homeTeam,
            awayTeam:  s.awayTeam,
            sportKey:  s.sportKey,
            gameDate,
            homeSpread,
          });
        }
      } catch { /* skip malformed snapshot */ }
    }
  } catch { /* non-fatal */ }

  return spreadMap;
}

// ── Cover calculation ─────────────────────────────────────────

/**
 * Computes whether the home team covered the spread.
 * homeSpread is from the home team's perspective (negative = favorite).
 *
 * Formula: coverResult = (homeScore - awayScore) + homeSpread
 *   > 0 → home covered
 *   < 0 → away covered
 *   = 0 → push
 */
function computeCover(
  homeScore: number,
  awayScore: number,
  homeSpread: number
): { homeCovered: boolean; awayCovered: boolean; push: boolean } {
  const homeMargin  = homeScore - awayScore;
  const coverResult = homeMargin + homeSpread;
  const push        = coverResult === 0;
  return {
    homeCovered: !push && coverResult > 0,
    awayCovered: !push && coverResult < 0,
    push,
  };
}

// ── Rebuild team records from game results ────────────────────

function rebuildTeamRecords(gameResults: ATSGameResult[]): Record<string, TeamATSRecord> {
  const records: Record<string, TeamATSRecord> = {};
  const now = new Date();

  // Helper to get or init a TeamATSRecord
  const getRecord = (team: string, sportKey: string): TeamATSRecord => {
    const key = teamKey(team, sportKey);
    if (!records[key]) {
      records[key] = {
        team,
        sportKey,
        home:    emptyTimeframes(),
        away:    emptyTimeframes(),
        overall: emptyTimeframes(),
        lastGame: null,
        lastUpdated: new Date().toISOString(),
      };
    }
    return records[key];
  };

  // Helper to accumulate into a timeframe set
  const accumulate = (tf: ATSTimeframes, covered: boolean, push: boolean, daysAgo: number) => {
    const add = (e: ATSEntry) => {
      if (push)        e.pushes++;
      else if (covered) e.wins++;
      else             e.losses++;
    };
    add(tf.allTime);
    if (daysAgo <= 180) add(tf.season);
    if (daysAgo <= 30)  add(tf.monthly);
    if (daysAgo <= 7)   add(tf.weekly);
  };

  for (const g of gameResults) {
    const daysAgo = daysBetween(g.gameDate, now);

    // Home team record
    const homeRec = getRecord(g.homeTeam, g.sportKey);
    accumulate(homeRec.home,    g.homeCovered, g.push, daysAgo);
    accumulate(homeRec.overall, g.homeCovered, g.push, daysAgo);
    if (!homeRec.lastGame || g.gameDate > homeRec.lastGame) homeRec.lastGame = g.gameDate;

    // Away team record
    const awayRec = getRecord(g.awayTeam, g.sportKey);
    accumulate(awayRec.away,    g.awayCovered, g.push, daysAgo);
    accumulate(awayRec.overall, g.awayCovered, g.push, daysAgo);
    if (!awayRec.lastGame || g.gameDate > awayRec.lastGame) awayRec.lastGame = g.gameDate;
  }

  return records;
}

// ── Public: main update function ──────────────────────────────

/**
 * Processes new completed games from the Odds API and updates the live ATS store.
 *
 * Call this at the end of each morning scan (after autoGradePicks).
 * Uses snapshots for spread data — no additional credits beyond the scores fetch.
 *
 * Returns the number of newly processed games.
 */
export async function updateATSTracker(): Promise<number> {
  const store      = loadStore();
  const processed  = new Set(store.processedEventIds);
  const spreadMap  = loadRecentSpreadMap(30);

  // Collect sport keys that appear in our spread map
  const sportKeys  = [...new Set([...spreadMap.values()].map(v => v.sportKey))];

  let newGames = 0;

  for (const sportKey of sportKeys) {
    try {
      const atsGuard = new CreditBudgetGuard();
      const scoreCheck = atsGuard.canSpend('scores', 1);
      if (!scoreCheck.allowed) {
        console.warn(`[CreditGuard] ATS score fetch blocked: ${scoreCheck.reason}`);
        return 0;
      }
      atsGuard.spend('scores', 1);
      const scores: CompletedScore[] = await getCompletedScores(sportKey, 3);

      for (const score of scores) {
        if (processed.has(score.id)) continue;

        const spreadEntry = spreadMap.get(score.id);
        if (!spreadEntry) continue; // no spread data for this game — skip

        const { homeCovered, awayCovered, push } = computeCover(
          score.homeScore, score.awayScore, spreadEntry.homeSpread
        );

        const result: ATSGameResult = {
          eventId:     score.id,
          sportKey:    spreadEntry.sportKey,
          gameDate:    spreadEntry.gameDate,
          homeTeam:    spreadEntry.homeTeam,
          awayTeam:    spreadEntry.awayTeam,
          homeSpread:  spreadEntry.homeSpread,
          homeScore:   score.homeScore,
          awayScore:   score.awayScore,
          homeMargin:  score.homeScore - score.awayScore,
          homeCovered,
          awayCovered,
          push,
          computedAt:  new Date().toISOString(),
        };

        store.gameResults.push(result);
        store.processedEventIds.push(score.id);
        processed.add(score.id);
        newGames++;
      }
    } catch { /* individual sport failure is non-fatal */ }
  }

  if (newGames > 0) {
    store.teamRecords = rebuildTeamRecords(store.gameResults);
    store.lastUpdated = new Date().toISOString();
    saveStore(store);
    console.log(`  [ATS TRACKER] ${newGames} new game(s) processed — store updated`);
  } else {
    console.log(`  [ATS TRACKER] No new games to process`);
  }

  return newGames;
}

// ── Public: get ATS signal for scoring engine ────────────────

export interface ATSSignal {
  team:           string;
  sportKey:       string;
  isHome:         boolean;
  monthlyCoverPct: number | null;
  seasonCoverPct:  number | null;
  signalLabel:    'RUNNING_HOT' | 'RUNNING_COLD' | 'NEUTRAL' | 'INSUFFICIENT_DATA';
  scoreAdjustment: number;   // -8 to +8 points applied to final bet score
  sampleSize:     number;
}

/**
 * Returns an ATS signal for a given team/matchup.
 * Used by the scoring engine to adjust bet scores based on recent cover trends.
 */
export function getATSSignalForScoring(
  team: string,
  sportKey: string,
  isHome: boolean
): ATSSignal {
  const store = loadStore();
  const key   = teamKey(team, sportKey);
  const rec   = store.teamRecords[key];

  const noSignal: ATSSignal = {
    team, sportKey, isHome,
    monthlyCoverPct:  null,
    seasonCoverPct:   null,
    signalLabel:      'INSUFFICIENT_DATA',
    scoreAdjustment:  0,
    sampleSize:       0,
  };

  if (!rec) return noSignal;

  const split    = isHome ? rec.home : rec.away;
  const monthly  = winPct(split.monthly);
  const season   = winPct(split.season);
  const sample   = split.monthly.wins + split.monthly.losses;

  if (sample < 3) return { ...noSignal, sampleSize: sample };

  // Signal thresholds
  let label: ATSSignal['signalLabel'] = 'NEUTRAL';
  let adj   = 0;

  if (monthly !== null) {
    if (monthly >= 70) { label = 'RUNNING_HOT';  adj = +8; }
    else if (monthly >= 60) { label = 'RUNNING_HOT';  adj = +4; }
    else if (monthly <= 30) { label = 'RUNNING_COLD'; adj = -8; }
    else if (monthly <= 40) { label = 'RUNNING_COLD'; adj = -4; }
  }

  return {
    team,
    sportKey,
    isHome,
    monthlyCoverPct:  monthly,
    seasonCoverPct:   season,
    signalLabel:      label,
    scoreAdjustment:  adj,
    sampleSize:       sample,
  };
}

// ── Public: validated outcome signal for signalWeightingEngine ─

export interface ATSOutcomeSignal {
  /** Categorized signal label. */
  signal:     'ATS_STRONG' | 'ATS_WEAK' | 'ATS_NEUTRAL';
  /** Season or all-time game count — used to enforce the minimum-sample gate. */
  sampleSize: number;
  /** Monthly cover % used as the rolling window signal (null if too thin). */
  coverPct:   number | null;
}

/**
 * Returns a validated ATS outcome signal for the outcomeSignalEngine.
 *
 * MINIMUM SAMPLE:
 *   Requires ≥ 20 games in the season or all-time record.
 *   Monthly-only samples are too thin for a valid structural signal.
 *
 * ROLLING WINDOW (recent performance preferred):
 *   Primary  — monthly cover % when the monthly bucket has ≥ 5 games.
 *   Fallback — season cover % when monthly is thin but season has ≥ 10 games.
 *   If neither window has enough games the result is ATS_NEUTRAL.
 *
 * THRESHOLDS:
 *   ≥ 60% cover → ATS_STRONG
 *   ≤ 40% cover → ATS_WEAK
 *   Otherwise   → ATS_NEUTRAL
 */
export function getATSOutcomeSignal(
  team:     string,
  sportKey: string,
  isHome:   boolean,
): ATSOutcomeSignal {
  const neutral: ATSOutcomeSignal = { signal: 'ATS_NEUTRAL', sampleSize: 0, coverPct: null };

  const store = loadStore();
  const key   = teamKey(team, sportKey);
  const rec   = store.teamRecords[key];
  if (!rec) return neutral;

  const split = isHome ? rec.home : rec.away;

  // Total-sample gate: require ≥ 20 in season or all-time bucket
  const seasonTotal  = split.season.wins  + split.season.losses;
  const allTimeTotal = split.allTime.wins + split.allTime.losses;
  const totalSample  = Math.max(seasonTotal, allTimeTotal);
  if (totalSample < 20) return { ...neutral, sampleSize: totalSample };

  // Rolling signal: prefer monthly, fall back to season
  const monthlyCount = split.monthly.wins + split.monthly.losses;
  let coverPct: number | null = null;
  if (monthlyCount >= 5) {
    coverPct = winPct(split.monthly);
  } else if (seasonTotal >= 10) {
    coverPct = winPct(split.season);
  }
  if (coverPct === null) return { ...neutral, sampleSize: totalSample };

  let signal: ATSOutcomeSignal['signal'] = 'ATS_NEUTRAL';
  if (coverPct >= 60) signal = 'ATS_STRONG';
  else if (coverPct <= 40) signal = 'ATS_WEAK';

  return { signal, sampleSize: totalSample, coverPct };
}

// ── Public: build full report for dashboard ───────────────────

export interface ATSReportRow {
  team:        string;
  sport:       string;
  homeWeekly:  string;   // "4-0 (100%)" or "—"
  homeMonthly: string;
  homeSeason:  string;
  homeAllTime: string;
  awayWeekly:  string;
  awayMonthly: string;
  awaySeason:  string;
  awayAllTime: string;
  weeklyTrend: 'HOT' | 'COLD' | 'NEUTRAL' | 'INSUFFICIENT_DATA';
  monthlyTrend:'HOT' | 'COLD' | 'NEUTRAL' | 'INSUFFICIENT_DATA';
  lastGame:    string | null;
}

function formatEntry(e: ATSEntry): string {
  const total = e.wins + e.losses + e.pushes;
  if (total === 0) return '—';
  const pct = winPct(e);
  const pctStr = pct !== null ? ` (${pct}%)` : '';
  return `${e.wins}-${e.losses}${e.pushes > 0 ? `-${e.pushes}` : ''}${pctStr}`;
}

function trendFromEntry(e: ATSEntry): 'HOT' | 'COLD' | 'NEUTRAL' | 'INSUFFICIENT_DATA' {
  const total = e.wins + e.losses;
  if (total < 3) return 'INSUFFICIENT_DATA';
  const pct = (e.wins / total) * 100;
  if (pct >= 65) return 'HOT';
  if (pct <= 35) return 'COLD';
  return 'NEUTRAL';
}

/**
 * Returns a sorted list of ATS report rows for the dashboard.
 * Only includes teams with at least 3 graded games.
 */
export function buildATSReport(): {
  lastUpdated:   string;
  totalGames:    number;
  rows:          ATSReportRow[];
  dataSource:    string;
} {
  const store = loadStore();

  const rows: ATSReportRow[] = Object.values(store.teamRecords)
    .filter(r => {
      const totalOverall = r.overall.allTime.wins + r.overall.allTime.losses;
      return totalOverall >= 3;
    })
    .map(r => ({
      team:        r.team,
      sport:       r.sportKey.replace('basketball_', '').replace('americanfootball_', '').replace('icehockey_', '').toUpperCase(),
      homeWeekly:  formatEntry(r.home.weekly),
      homeMonthly: formatEntry(r.home.monthly),
      homeSeason:  formatEntry(r.home.season),
      homeAllTime: formatEntry(r.home.allTime),
      awayWeekly:  formatEntry(r.away.weekly),
      awayMonthly: formatEntry(r.away.monthly),
      awaySeason:  formatEntry(r.away.season),
      awayAllTime: formatEntry(r.away.allTime),
      weeklyTrend: trendFromEntry(r.overall.weekly),
      monthlyTrend:trendFromEntry(r.overall.monthly),
      lastGame:    r.lastGame,
    }))
    .sort((a, b) => {
      // Sort by monthly trend strength (HOT first) then alphabetically
      const order = { HOT: 0, NEUTRAL: 1, INSUFFICIENT_DATA: 2, COLD: 3 };
      return (order[a.monthlyTrend] - order[b.monthlyTrend]) || a.team.localeCompare(b.team);
    });

  return {
    lastUpdated:  store.lastUpdated,
    totalGames:   store.gameResults.length,
    rows,
    dataSource:   'Live (built from your morning scan snapshots)',
  };
}

// ── Public: divergence between timeframes ────────────────────

/**
 * Returns teams where monthly cover rate diverges significantly from
 * their all-time average — the signal you can't see with just one number.
 * Threshold: 15+ percentage points difference.
 */
export function getATSDivergenceSummary(): ATSDivergenceEntry[] {
  const store   = loadStore();
  const entries: ATSDivergenceEntry[] = [];

  for (const rec of Object.values(store.teamRecords)) {
    for (const split of ['home', 'away', 'overall'] as const) {
      const tf     = rec[split];
      const monthly  = winPct(tf.monthly);
      const allTime  = winPct(tf.allTime);
      const weekly   = winPct(tf.weekly);
      const season   = winPct(tf.season);

      const mSample  = tf.monthly.wins + tf.monthly.losses;
      const atSample = tf.allTime.wins + tf.allTime.losses;

      if (mSample < 3 || atSample < 5) continue;
      if (monthly === null || allTime === null) continue;

      const divergence = Math.round((monthly - allTime) * 10) / 10;
      if (Math.abs(divergence) < 15) continue; // only flag meaningful gaps

      let signal: ATSDivergenceEntry['signal'] = 'NEUTRAL';
      if (divergence >= 15)  signal = 'HOT';
      if (divergence <= -15) signal = 'COLD';

      entries.push({
        team:       rec.team,
        sportKey:   rec.sportKey,
        split,
        weeklyPct:  weekly,
        monthlyPct: monthly,
        seasonPct:  season,
        allTimePct: allTime,
        divergence,
        signal,
      });
    }
  }

  // Sort by absolute divergence descending
  return entries.sort((a, b) => Math.abs(b.divergence ?? 0) - Math.abs(a.divergence ?? 0));
}

// ── Public: load raw store ───────────────────────────────────

export function loadATSLive(): ATSLiveStore {
  return loadStore();
}
