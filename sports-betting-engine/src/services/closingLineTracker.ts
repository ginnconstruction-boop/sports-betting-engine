// ============================================================
// src/services/closingLineTracker.ts
// Closing Line Value (CLV) tracker
// The gold standard for measuring if your system has real edge
//
// HOW IT WORKS:
// 1. Morning scan saves Top 10 picks to a picks log
// 2. After games start, run "clv" command to fetch closing lines
// 3. Compare your pick's price vs closing price
// 4. Track CLV over time -- positive CLV = real edge
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { getOddsBySport } from '../api/oddsApiClient';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const PICKS_FILE = path.join(SNAPSHOT_DIR, 'picks_log.json');
const CLV_FILE = path.join(SNAPSHOT_DIR, 'clv_record.json');

// ------------------------------------
// Types
// ------------------------------------

export interface PickRecord {
  pickId: string;
  date: string;                // ISO date of when pick was made
  sport: string;
  sportKey: string;
  eventId: string;
  matchup: string;
  gameTime: string;            // ISO game start time
  betType: string;             // Moneyline / Spread / Total
  marketType?: string;         // game_line / player_prop / parlay
  side: string;                // team or Over/Under
  pickedPrice: number;         // price when you made the pick
  pickedLine: number | null;   // line when you made the pick
  pickedBook: string;          // which book had the best price
  grade: string;               // A+, A, B+ etc from scoring
  score: number;               // 0-100 score at time of pick
  // Filled in after game starts
  closingPrice: number | null;
  closingLine: number | null;
  clvPrice: number | null;     // pickedPrice - closingPrice (positive = beat the line)
  clvLine: number | null;      // pickedLine vs closingLine
  closingFetched: boolean;
  closingFetchedAt: string;
  // Optional: game result tracking (manual entry)
  gameResult: 'WIN' | 'LOSS' | 'PUSH' | 'PENDING' | 'MISSING_SCORE' | 'VOID';
  notes: string;
  kellyPct?: number;             // quarter-Kelly stake % at time of pick
  finalDecisionLabel?: 'BET' | 'LEAN' | 'MONITOR' | 'PASS' | 'BEST_PRICE_ONLY';
  recommendedLabel?: 'BET' | 'LEAN' | 'MONITOR' | 'PASS' | 'BEST_PRICE_ONLY';
  finalGrade?: string;
  riskGrade?: 'LOW' | 'MODERATE' | 'HIGH';
  isPriceOnlyCandidate?: boolean;
  savedAsRecommendation?: boolean;
  forcedTierCap?: 'LEAN' | 'MONITOR';
  isBestBet?: boolean;
}

export interface CLVSummary {
  totalPicks: number;
  closingLineFetched: number;
  avgCLVPrice: number;          // average price CLV across all tracked bets
  avgCLVLine: number;           // average line CLV
  positiveClvCount: number;     // how many bets beat the closing line
  positiveClvPct: number;       // % of bets that beat closing line
  bySport: Record<string, { picks: number; avgCLV: number }>;
  byMarket: Record<string, { picks: number; avgCLV: number }>;
  byGrade: Record<string, { picks: number; avgCLV: number }>;
  recentTrend: 'IMPROVING' | 'DECLINING' | 'STABLE' | 'INSUFFICIENT_DATA';
}

// ------------------------------------
// Storage helpers
// ------------------------------------

function ensureDir(): void {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
}

function loadPicks(): PickRecord[] {
  ensureDir();
  if (!fs.existsSync(PICKS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(PICKS_FILE, 'utf-8'));
  } catch { return []; }
}

function savePicks(picks: PickRecord[]): void {
  ensureDir();
  fs.writeFileSync(PICKS_FILE, JSON.stringify(picks, null, 2));
}

function loadCLVRecord(): CLVSummary | null {
  if (!fs.existsSync(CLV_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CLV_FILE, 'utf-8'));
  } catch { return null; }
}

function saveCLVRecord(summary: CLVSummary): void {
  ensureDir();
  fs.writeFileSync(CLV_FILE, JSON.stringify(summary, null, 2));
}

function generatePickId(): string {
  return `pick_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ------------------------------------
// Save Top 10 picks from a run
// Call this after every morning/midday scan
// ------------------------------------

export function savePicksFromTopTen(
  bets: Array<{
    sport: string;
    sportKey?: string;
    eventId?: string;
    matchup: string;
    startTime: string;
    betType: string;
    side: string;
    bestPrice: number;
    bestLine: number | null;
    bestBook: string;
    grade: string;
    score: number;
    kellyPct?: number;
    marketType?: string;
    finalDecisionLabel?: 'BET' | 'LEAN' | 'MONITOR' | 'PASS' | 'BEST_PRICE_ONLY';
    recommendedLabel?: 'BET' | 'LEAN' | 'MONITOR' | 'PASS' | 'BEST_PRICE_ONLY';
    finalGrade?: string;
    riskGrade?: 'LOW' | 'MODERATE' | 'HIGH';
    isPriceOnlyCandidate?: boolean;
    savedAsRecommendation?: boolean;
    forcedTierCap?: 'LEAN' | 'MONITOR';
    isBestBet?: boolean;
  }>
): PickRecord[] {
  const existing = loadPicks();
  const existingIds = new Set(existing.map(p => `${p.matchup}_${p.betType}_${p.side}`));
  const today = new Date().toISOString().split('T')[0];
  const newPicks: PickRecord[] = [];

  for (const bet of bets) {
    const key = `${bet.matchup}_${bet.betType}_${bet.side}`;
    // Don't duplicate picks from same day
    const alreadyToday = existing.some(p =>
      p.date.startsWith(today) && p.matchup === bet.matchup &&
      p.betType === bet.betType && p.side === bet.side
    );
    if (alreadyToday) continue;

    const pick: PickRecord = {
      pickId: generatePickId(),
      date: new Date().toISOString(),
      sport: bet.sport,
      sportKey: bet.sportKey ?? '',
      eventId: bet.eventId ?? '',
      matchup: bet.matchup,
      gameTime: bet.startTime,
      betType: bet.betType,
      marketType: bet.marketType ?? 'game_line',
      side: bet.side,
      pickedPrice: bet.bestPrice,
      pickedLine: bet.bestLine,
      pickedBook: bet.bestBook,
      grade: bet.grade,
      score: bet.score,
      closingPrice: null,
      closingLine: null,
      clvPrice: null,
      clvLine: null,
      closingFetched: false,
      closingFetchedAt: '',
      gameResult: 'PENDING',
      notes: '',
      kellyPct: bet.kellyPct,
      finalDecisionLabel: bet.finalDecisionLabel,
      recommendedLabel: bet.recommendedLabel,
      finalGrade: bet.finalGrade,
      riskGrade: bet.riskGrade,
      isPriceOnlyCandidate: bet.isPriceOnlyCandidate,
      savedAsRecommendation: bet.savedAsRecommendation,
      forcedTierCap: bet.forcedTierCap,
      isBestBet: bet.isBestBet,
    };
    newPicks.push(pick);
  }

  if (newPicks.length > 0) {
    savePicks([...existing, ...newPicks]);
    console.log(`  ? Saved ${newPicks.length} new picks to CLV tracker`);
  }

  return newPicks;
}


// ------------------------------------
// Save prop picks (options 11, 4 NBA/NFL props)
// ------------------------------------

export function savePropPicks(props: Array<{
  playerName: string;
  market: string;
  side: string;
  line: number | null;
  bestUserPrice: number;
  bestUserBook: string;
  matchup: string;
  gameTime: string;
  sport: string;
  score: number;
  grade: string;
  eventId?: string;
}>): void {
  const existing = loadPicks();
  const today = new Date().toISOString().split('T')[0];
  const newPicks: PickRecord[] = [];

  for (const prop of props) {
    if (!prop.bestUserPrice) continue;
    // Allow null line (e.g. first-scorer props) -- use market+side as dedup key
    const lineStr = prop.line !== null && prop.line !== undefined ? String(prop.line) : 'null';
    const sideKey = `${prop.playerName} ${prop.market} ${prop.side} ${lineStr}`;
    if (existing.some(p => p.date.startsWith(today) && p.side === sideKey)) continue;

    newPicks.push({
      pickId: generatePickId(),
      date: new Date().toISOString(),
      sport: prop.sport,
      sportKey: prop.sport === 'NBA' ? 'basketball_nba'
               : prop.sport === 'NFL' ? 'americanfootball_nfl'
               : prop.sport === 'MLB' ? 'baseball_mlb'
               : prop.sport === 'NHL' ? 'icehockey_nhl'
               : prop.sport ?? 'basketball_nba',
      eventId: prop.eventId ?? '',
      matchup: prop.matchup,
      gameTime: prop.gameTime,
      betType: 'Player Prop',
      marketType: 'player_prop',
      side: sideKey,
      pickedPrice: prop.bestUserPrice,
      pickedLine: prop.line,
      pickedBook: prop.bestUserBook,
      grade: prop.grade,
      score: prop.score,
      closingPrice: null, closingLine: null,
      clvPrice: null, clvLine: null,
      closingFetched: false, closingFetchedAt: '',
      gameResult: 'PENDING',
      notes: `${prop.market} ${prop.side}${prop.line !== null && prop.line !== undefined ? ' ' + prop.line : ''}`,
      savedAsRecommendation: false,
    });
  }

  if (newPicks.length > 0) {
    ensureDir();
    fs.writeFileSync(PICKS_FILE, JSON.stringify([...existing, ...newPicks], null, 2));
    console.log(`  [OK] Saved ${newPicks.length} prop pick(s) to tracking log.`);
  }
}

// ------------------------------------
// Save parlay picks (options 12-15)
// ------------------------------------

export function saveParlayPicks(parlays: Array<{
  legs: Array<{
    playerName?: string; market?: string; altLine?: number;
    standardLine?: number; side?: string; altPrice?: number;
    outcomeName?: string; matchup?: string;
  }>;
  parlayPrice: number;
  hitRate?: number;
  grade: string;
  tier?: string;
  correlationType?: string;
  matchup?: string;
  sport?: string;
  gameTime?: string;
  eventId?: string;
  parlayType: 'ALT_LINE' | 'SGP';
}>): void {
  const existing = loadPicks();
  const today = new Date().toISOString().split('T')[0];
  const newPicks: PickRecord[] = [];

  for (const parlay of parlays) {
    const legDesc = parlay.legs.map(l =>
      l.playerName
        ? `${l.playerName} ${l.market ?? ''} ${l.side ?? ''} ${l.altLine ?? l.standardLine ?? ''}`
        : (l.outcomeName ?? '')
    ).filter(Boolean).join(' + ');

    const matchup = parlay.matchup ?? parlay.legs[0]?.matchup ?? 'Parlay';
    if (existing.some(p => p.date.startsWith(today) && p.side === legDesc)) continue;

    const priceStr = parlay.parlayPrice > 0 ? `+${parlay.parlayPrice}` : `${parlay.parlayPrice}`;

    newPicks.push({
      pickId: generatePickId(),
      date: new Date().toISOString(),
      sport: parlay.sport ?? 'NBA',
      sportKey: parlay.sport === 'NFL' ? 'americanfootball_nfl' : 'basketball_nba',
      eventId: parlay.eventId ?? '',
      matchup,
      gameTime: parlay.gameTime ?? new Date().toISOString(),
      betType: parlay.parlayType === 'ALT_LINE' ? 'Alt Line Parlay' : 'SGP Parlay',
      marketType: 'parlay',
      side: legDesc,
      pickedPrice: parlay.parlayPrice,
      pickedLine: null,
      pickedBook: 'FanDuel',
      grade: parlay.grade,
      score: Math.round(parlay.hitRate ?? 50),
      closingPrice: null, closingLine: null,
      clvPrice: null, clvLine: null,
      closingFetched: false, closingFetchedAt: '',
      gameResult: 'PENDING',
      notes: `${parlay.parlayType} ${parlay.correlationType ?? ''} @ ${priceStr} (${parlay.hitRate ?? '?'}% hit rate)`,
      savedAsRecommendation: false,
    });
  }

  if (newPicks.length > 0) {
    ensureDir();
    fs.writeFileSync(PICKS_FILE, JSON.stringify([...existing, ...newPicks], null, 2));
    console.log(`  [OK] Saved ${newPicks.length} parlay pick(s) to tracking log.`);
  }
}

// ------------------------------------
// Fetch closing lines for picks where game has started
// Run this after games start to capture closing lines
// Uses minimal API credits -- one call per sport with pending picks
// ------------------------------------

export async function fetchClosingLines(): Promise<void> {
  const picks = loadPicks();
  const now = new Date();

  // Find picks where game has started but closing line not yet fetched
  const pending = picks.filter(p =>
    !p.closingFetched &&
    p.gameResult === 'PENDING' &&
    new Date(p.gameTime) < now &&
    p.sportKey
  );

  if (pending.length === 0) {
    console.log('\n  No pending picks need closing lines yet.');
    console.log('  Run this after your games have started.\n');
    return;
  }

  console.log(`\n  Fetching closing lines for ${pending.length} picks...`);

  // Group by sport to minimize API calls
  const bySport = new Map<string, PickRecord[]>();
  for (const pick of pending) {
    const list = bySport.get(pick.sportKey) ?? [];
    list.push(pick);
    bySport.set(pick.sportKey, list);
  }

  let updated = 0;

  for (const [sportKey, sportPicks] of bySport) {
    try {
      const { events } = await getOddsBySport(sportKey, ['h2h', 'spreads', 'totals']);

      for (const pick of sportPicks) {
        // Find matching event
        const event = events.find(e =>
          e.home_team.includes(pick.matchup.split(' @ ')[1]?.split(' ').pop() ?? '') ||
          e.away_team.includes(pick.matchup.split(' @ ')[0]?.split(' ').pop() ?? '')
        );

        if (!event) continue;

        const marketKeyMap: Record<string, string> = {
          'Moneyline': 'h2h',
          'Spread': 'spreads',
          'Total': 'totals',
        };
        const marketKey = marketKeyMap[pick.betType];
        if (!marketKey) continue;

        // Find the market and outcome across all books
        const prices: number[] = [];
        const lines: number[] = [];

        for (const bm of event.bookmakers ?? []) {
          const market = bm.markets?.find(m => m.key === marketKey);
          if (!market) continue;
          const outcome = market.outcomes?.find(o =>
            o.name.toLowerCase().includes(pick.side.toLowerCase().split(' ').pop() ?? '') ||
            pick.side.toLowerCase().includes(o.name.toLowerCase().split(' ').pop() ?? '')
          );
          if (outcome?.price) prices.push(outcome.price);
          if (outcome?.point) lines.push(outcome.point);
        }

        if (prices.length === 0) continue;

        // Closing line = consensus (average) at time of fetch
        const closingPrice = Math.round(
          prices.reduce((a, b) => a + b, 0) / prices.length
        );
        const closingLine = lines.length > 0
          ? Math.round((lines.reduce((a, b) => a + b, 0) / lines.length) * 2) / 2
          : null;

        // CLV = how much better your price was vs closing
        const clvPrice = pick.pickedPrice - closingPrice;
        const clvLine = (pick.pickedLine !== null && closingLine !== null)
          ? pick.pickedLine - closingLine
          : null;

        // Update pick
        const idx = picks.findIndex(p => p.pickId === pick.pickId);
        if (idx >= 0) {
          picks[idx] = {
            ...picks[idx],
            closingPrice,
            closingLine,
            clvPrice,
            clvLine,
            closingFetched: true,
            closingFetchedAt: new Date().toISOString(),
          };
          updated++;
        }
      }
    } catch (err) {
      console.log(`  Could not fetch closing lines for ${sportKey}: ${String(err)}`);
    }
  }

  savePicks(picks);
  console.log(`  Updated ${updated} picks with closing lines\n`);

  // Rebuild summary
  buildAndSaveCLVSummary(picks);
  printCLVSummary();
}

// ------------------------------------
// Build CLV summary statistics
// ------------------------------------

function buildAndSaveCLVSummary(picks: PickRecord[]): void {
  const tracked = picks.filter(p => p.closingFetched && p.clvPrice !== null);

  if (tracked.length === 0) {
    saveCLVRecord({
      totalPicks: picks.length,
      closingLineFetched: 0,
      avgCLVPrice: 0,
      avgCLVLine: 0,
      positiveClvCount: 0,
      positiveClvPct: 0,
      bySport: {},
      byMarket: {},
      byGrade: {},
      recentTrend: 'INSUFFICIENT_DATA',
    });
    return;
  }

  const clvPrices = tracked.map(p => p.clvPrice as number);
  const avgCLVPrice = Math.round(
    (clvPrices.reduce((a, b) => a + b, 0) / clvPrices.length) * 10
  ) / 10;

  const clvLines = tracked
    .filter(p => p.clvLine !== null)
    .map(p => p.clvLine as number);
  const avgCLVLine = clvLines.length > 0
    ? Math.round((clvLines.reduce((a, b) => a + b, 0) / clvLines.length) * 10) / 10
    : 0;

  const positiveClvCount = clvPrices.filter(c => c > 0).length;
  const positiveClvPct = Math.round((positiveClvCount / tracked.length) * 100);

  // By sport
  const bySport: Record<string, { picks: number; avgCLV: number }> = {};
  for (const pick of tracked) {
    const s = pick.sport;
    if (!bySport[s]) bySport[s] = { picks: 0, avgCLV: 0 };
    bySport[s].picks++;
    bySport[s].avgCLV = Math.round(
      ((bySport[s].avgCLV * (bySport[s].picks - 1) + (pick.clvPrice ?? 0)) / bySport[s].picks) * 10
    ) / 10;
  }

  // By market
  const byMarket: Record<string, { picks: number; avgCLV: number }> = {};
  for (const pick of tracked) {
    const m = pick.betType;
    if (!byMarket[m]) byMarket[m] = { picks: 0, avgCLV: 0 };
    byMarket[m].picks++;
    byMarket[m].avgCLV = Math.round(
      ((byMarket[m].avgCLV * (byMarket[m].picks - 1) + (pick.clvPrice ?? 0)) / byMarket[m].picks) * 10
    ) / 10;
  }

  // By grade
  const byGrade: Record<string, { picks: number; avgCLV: number }> = {};
  for (const pick of tracked) {
    const g = pick.grade;
    if (!byGrade[g]) byGrade[g] = { picks: 0, avgCLV: 0 };
    byGrade[g].picks++;
    byGrade[g].avgCLV = Math.round(
      ((byGrade[g].avgCLV * (byGrade[g].picks - 1) + (pick.clvPrice ?? 0)) / byGrade[g].picks) * 10
    ) / 10;
  }

  // Trend: compare last 10 vs prior 10
  let trend: CLVSummary['recentTrend'] = 'INSUFFICIENT_DATA';
  if (tracked.length >= 20) {
    const last10 = tracked.slice(-10).map(p => p.clvPrice ?? 0);
    const prior10 = tracked.slice(-20, -10).map(p => p.clvPrice ?? 0);
    const last10Avg = last10.reduce((a, b) => a + b, 0) / 10;
    const prior10Avg = prior10.reduce((a, b) => a + b, 0) / 10;
    trend = last10Avg > prior10Avg + 2 ? 'IMPROVING'
          : last10Avg < prior10Avg - 2 ? 'DECLINING'
          : 'STABLE';
  }

  const summary: CLVSummary = {
    totalPicks: picks.length,
    closingLineFetched: tracked.length,
    avgCLVPrice,
    avgCLVLine,
    positiveClvCount,
    positiveClvPct,
    bySport,
    byMarket,
    byGrade,
    recentTrend: trend,
  };

  saveCLVRecord(summary);
}

// ------------------------------------
// Print CLV report
// ------------------------------------

export function printCLVSummary(): void {
  const picks = loadPicks();
  const tracked = picks.filter(p => p.closingFetched);

  buildAndSaveCLVSummary(picks);
  const summary = loadCLVRecord();
  if (!summary) { console.log('No CLV data yet.'); return; }

  console.log('\n');
  console.log('+==============================================================+');
  console.log('|              CLOSING LINE VALUE (CLV) REPORT                |');
  console.log('+==============================================================+');
  console.log(`\n  Total picks logged    : ${summary.totalPicks}`);
  console.log(`  Closing lines fetched : ${summary.closingLineFetched}`);
  console.log(`  Pending               : ${summary.totalPicks - summary.closingLineFetched}`);

  if (summary.closingLineFetched === 0) {
    console.log('\n  No closing lines fetched yet.');
    console.log('  Run a morning scan to log picks, then run "clv" after games start.\n');
    return;
  }

  const clvIcon = summary.avgCLVPrice > 2 ? '[G]' : summary.avgCLVPrice > 0 ? '[Y]' : '[R]';
  const trendIcon =
    summary.recentTrend === 'IMPROVING' ? '[^]' :
    summary.recentTrend === 'DECLINING' ? '[v]' : '??';

  console.log('\n  --- Overall CLV ------------------------------------------');
  console.log(`  ${clvIcon} Avg CLV (price)  : ${summary.avgCLVPrice > 0 ? '+' : ''}${summary.avgCLVPrice} pts`);
  console.log(`  ${clvIcon} Avg CLV (line)   : ${summary.avgCLVLine > 0 ? '+' : ''}${summary.avgCLVLine} pts`);
  console.log(`  Beat closing line : ${summary.positiveClvCount}/${summary.closingLineFetched} (${summary.positiveClvPct}%)`);
  console.log(`  ${trendIcon} Trend           : ${summary.recentTrend}`);

  console.log('\n  --- By Sport ---------------------------------------------');
  for (const [sport, data] of Object.entries(summary.bySport)) {
    const icon = data.avgCLV > 2 ? '[G]' : data.avgCLV > 0 ? '[Y]' : '[R]';
    console.log(`  ${icon} ${sport.padEnd(12)} ${data.picks} picks  Avg CLV: ${data.avgCLV > 0 ? '+' : ''}${data.avgCLV}`);
  }

  console.log('\n  --- By Bet Type ------------------------------------------');
  for (const [market, data] of Object.entries(summary.byMarket)) {
    const icon = data.avgCLV > 2 ? '[G]' : data.avgCLV > 0 ? '[Y]' : '[R]';
    console.log(`  ${icon} ${market.padEnd(14)} ${data.picks} picks  Avg CLV: ${data.avgCLV > 0 ? '+' : ''}${data.avgCLV}`);
  }

  console.log('\n  --- By Grade ---------------------------------------------');
  for (const [grade, data] of Object.entries(summary.byGrade).sort()) {
    const icon = data.avgCLV > 2 ? '[G]' : data.avgCLV > 0 ? '[Y]' : '[R]';
    console.log(`  ${icon} Grade ${grade.padEnd(4)}     ${data.picks} picks  Avg CLV: ${data.avgCLV > 0 ? '+' : ''}${data.avgCLV}`);
  }

  console.log('\n  --- Recent Picks -----------------------------------------');
  const recent = picks.slice(-10).reverse();
  for (const pick of recent) {
    const clv = pick.clvPrice !== null
      ? `CLV: ${pick.clvPrice > 0 ? '+' : ''}${pick.clvPrice}`
      : 'CLV: pending';
    const icon = pick.clvPrice === null ? '?' : pick.clvPrice > 0 ? '[G]' : '[R]';
    console.log(`  ${icon} ${pick.date.slice(0,10)}  ${pick.matchup.slice(0,30).padEnd(30)}  ${pick.side.slice(0,15).padEnd(15)}  ${clv}`);
  }

  console.log('\n  --- What This Means --------------------------------------');
  if (summary.avgCLVPrice > 3) {
    console.log('  [G] STRONG EDGE: You are consistently beating the closing line.');
    console.log('     This means the system is identifying real value. Keep going.');
  } else if (summary.avgCLVPrice > 0) {
    console.log('  [Y] POSITIVE CLV: Slight edge vs closing line -- model is working.');
    console.log('     More picks needed to confirm. Stay the course.');
  } else {
    console.log('  [R] NEGATIVE CLV: Not beating the closing line yet.');
    console.log('     Review which sports/markets are dragging the average down.');
  }

  console.log('\n  CLV Benchmark: +2 or better = sharp-level edge\n');
}

// ------------------------------------
// List all logged picks
// ------------------------------------

export function listPicks(): void {
  const picks = loadPicks();
  if (picks.length === 0) {
    console.log('\n  No picks logged yet. Run a morning scan to start tracking.\n');
    return;
  }

  // Sort newest first
  const sorted = [...picks].sort((a, b) =>
    new Date(b.date ?? b.gameTime ?? 0).getTime() -
    new Date(a.date ?? a.gameTime ?? 0).getTime()
  );

  console.log(`\n  Total picks logged: ${picks.length}`);
  console.log(`  Showing all picks newest first\n`);

  let lastDate = '';
  for (const pick of sorted) {
    const dateStr = (pick.date ?? pick.gameTime ?? '').slice(0, 10);

    // Print date header when date changes
    if (dateStr !== lastDate) {
      console.log(`\n  -- ${dateStr} -------------------------------------`);
      lastDate = dateStr;
    }

    // Sanitize fields that may be undefined
    const book  = (pick.pickedBook && pick.pickedBook !== 'undefined') ? pick.pickedBook : 'Unknown';
    const price = (typeof pick.pickedPrice === 'number' && isFinite(pick.pickedPrice))
      ? `${pick.pickedPrice > 0 ? '+' : ''}${pick.pickedPrice}`
      : 'n/a';
    const line  = pick.pickedLine !== null && pick.pickedLine !== undefined
      ? ` (${pick.pickedLine > 0 ? '+' : ''}${pick.pickedLine})`
      : '';
    const result = pick.gameResult !== 'PENDING' ? ` [${pick.gameResult}]` : ' [pending]';
    const clv = pick.clvPrice !== null && pick.clvPrice !== undefined
      ? `  CLV ${pick.clvPrice > 0 ? '+' : ''}${pick.clvPrice}`
      : '';

    console.log(`  [${pick.grade ?? '?'}] ${pick.matchup}`);
    console.log(`        ${pick.betType ?? 'Bet'} -- ${pick.side ?? ''}${line} @ ${book} ${price}${result}${clv}`);
  }
  console.log('');
}
