// ============================================================
// src/services/winLossTracker.ts
// Win/Loss tracker -- manual result entry + P&L reporting
// Ties into CLV tracker so everything lives in one place
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { PickRecord } from './closingLineTracker';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const PICKS_FILE = path.join(SNAPSHOT_DIR, 'picks_log.json');
const PNL_FILE = path.join(SNAPSHOT_DIR, 'pnl_record.json');

// ------------------------------------
// Types
// ------------------------------------

export interface PNLRecord {
  totalPicks: number;
  gradedPicks: number;
  wins: number;
  losses: number;
  pushes: number;
  winPct: number;
  // Assumes flat $100 per bet unless overridden
  totalWagered: number;
  totalProfit: number;
  roi: number;              // profit / wagered * 100
  avgOdds: number;          // average price across all graded picks
  // Breakdown
  bySport: Record<string, SportRecord>;
  byMarket: Record<string, SportRecord>;
  byGrade: Record<string, SportRecord>;
  byBook: Record<string, SportRecord>;
  // Streaks
  currentStreak: { type: 'W' | 'L' | 'P' | '-'; count: number };
  longestWinStreak: number;
  longestLossStreak: number;
  // Monthly
  byMonth: Record<string, SportRecord>;
  lastUpdated: string;
}

export interface SportRecord {
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  profit: number;
  roi: number;
  winPct: number;
}

// ------------------------------------
// Helpers
// ------------------------------------

function ensureDir(): void {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
}

function loadPicks(): PickRecord[] {
  ensureDir();
  if (!fs.existsSync(PICKS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PICKS_FILE, 'utf-8')); }
  catch { return []; }
}

function savePicks(picks: PickRecord[]): void {
  ensureDir();
  fs.writeFileSync(PICKS_FILE, JSON.stringify(picks, null, 2));
}

function loadPNL(): PNLRecord | null {
  if (!fs.existsSync(PNL_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(PNL_FILE, 'utf-8')); }
  catch { return null; }
}

function savePNL(record: PNLRecord): void {
  ensureDir();
  fs.writeFileSync(PNL_FILE, JSON.stringify(record, null, 2));
}

function calcProfit(result: 'WIN' | 'LOSS' | 'PUSH', price: number, stake = 100): number {
  if (result === 'PUSH') return 0;
  if (result === 'LOSS') return -stake;
  // WIN
  if (price > 0) return (price / 100) * stake;
  return (100 / Math.abs(price)) * stake;
}

function fmtMoney(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function emptyRecord(): SportRecord {
  return { picks: 0, wins: 0, losses: 0, pushes: 0, profit: 0, roi: 0, winPct: 0 };
}

function updateRecord(rec: SportRecord, result: 'WIN' | 'LOSS' | 'PUSH', profit: number): SportRecord {
  const updated = { ...rec };
  updated.picks++;
  if (result === 'WIN') updated.wins++;
  else if (result === 'LOSS') updated.losses++;
  else updated.pushes++;
  updated.profit = Math.round((updated.profit + profit) * 100) / 100;
  const graded = updated.wins + updated.losses;
  updated.winPct = graded > 0 ? Math.round((updated.wins / graded) * 1000) / 10 : 0;
  updated.roi = updated.picks > 0
    ? Math.round((updated.profit / (updated.picks * 100)) * 10000) / 100
    : 0;
  return updated;
}

// ------------------------------------
// Mark a single pick result
// ------------------------------------

export function markResult(
  pickId: string,
  result: 'WIN' | 'LOSS' | 'PUSH',
  stake = 100
): boolean {
  const picks = loadPicks();
  const idx = picks.findIndex(p => p.pickId === pickId);
  if (idx < 0) {
    console.log(`  Pick ${pickId} not found.`);
    return false;
  }

  const pick = picks[idx];
  const safePrice = (typeof pick.pickedPrice === 'number' && isFinite(pick.pickedPrice) && pick.pickedPrice !== 0)
    ? pick.pickedPrice : -110;
  const profit = calcProfit(result, safePrice, stake);

  picks[idx] = { ...pick, gameResult: result };
  savePicks(picks);

  const icon = result === 'WIN' ? '[G]' : result === 'LOSS' ? '[R]' : '[ ]';
  console.log(`  ${icon} Marked: ${pick.matchup} | ${pick.side} | ${result} | ${fmtMoney(profit)}`);

  rebuildPNL();
  return true;
}

// ------------------------------------
// Interactive result entry -- prompts for each pending pick
// ------------------------------------

export async function enterResults(): Promise<void> {
  const picks = loadPicks();
  const now = new Date();

  // Find picks where game has passed and result is still pending
  // Include picks with missing/invalid gameTime -- show everything pending
  const pending = picks.filter(p => {
    if (p.gameResult !== 'PENDING') return false;
    if (!p.gameTime) return true; // no time = show it anyway
    const gameTime = new Date(p.gameTime);
    if (isNaN(gameTime.getTime())) return true; // invalid time = show it
    // Show if game was within last 7 days (catches any recent missed entries)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return gameTime < now && gameTime > sevenDaysAgo;
  });

  if (pending.length === 0) {
    console.log('\n  No pending results to enter.');
    console.log('  All picks are either graded or not yet started.\n');
    return;
  }

  console.log(`\n  ${pending.length} picks need results entered.`);
  console.log('  Enter W (win), L (loss), P (push), or S (skip)\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve));

  let entered = 0;

  for (const pick of pending) {
    const dateStr = new Date(pick.gameTime).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    const priceStr = pick.pickedPrice > 0 ? `+${pick.pickedPrice}` : `${pick.pickedPrice}`;
    const lineStr = pick.pickedLine !== null ? ` (${pick.pickedLine > 0 ? '+' : ''}${pick.pickedLine})` : '';

    console.log(`\n  =============================================`);
    console.log(`  DATE   : ${dateStr}`);
    console.log(`  GAME   : ${pick.matchup}  [${pick.sport}]`);
    console.log(`  BET    : ${pick.betType.toUpperCase()} -- ${pick.side}`);
    console.log(`  BOOK   : ${pick.pickedBook}  @  ${priceStr}${lineStr}`);
    console.log(`  GRADE  : ${pick.grade}  (Score: ${pick.score}/100)`);
    // Show top reasoning signals if stored
    const reasons: string[] = (pick as any).fullReasoning ?? (pick as any).signals ?? [];
    if (reasons.length > 0) {
      console.log(`  WHY    :`);
      reasons.slice(0, 3).forEach((r: string) => console.log(`           ${r}`));
    }
    console.log(`  =============================================`);

    const answer = await question('  Result (W/L/P/S): ');
    const normalized = answer.trim().toUpperCase();

    if (normalized === 'W') { markResult(pick.pickId, 'WIN'); entered++; }
    else if (normalized === 'L') { markResult(pick.pickId, 'LOSS'); entered++; }
    else if (normalized === 'P') { markResult(pick.pickId, 'PUSH'); entered++; }
    else console.log('  Skipped.');
  }

  rl.close();
  console.log(`\n  Entered ${entered} results.\n`);

  if (entered > 0) printPNLReport();
}

// ------------------------------------
// Rebuild full P&L from all graded picks
// ------------------------------------

export function rebuildPNL(): PNLRecord {
  const picks = loadPicks();
  const graded = picks.filter(p => p.gameResult !== 'PENDING');

  const record: PNLRecord = {
    totalPicks: picks.length,
    gradedPicks: graded.length,
    wins: 0,
    losses: 0,
    pushes: 0,
    winPct: 0,
    totalWagered: graded.length * 100,
    totalProfit: 0,
    roi: 0,
    avgOdds: 0,
    bySport: {},
    byMarket: {},
    byGrade: {},
    byBook: {},
    byMonth: {},
    currentStreak: { type: '-', count: 0 },
    longestWinStreak: 0,
    longestLossStreak: 0,
    lastUpdated: new Date().toISOString(),
  };

  let totalOdds = 0;
  let currentStreakType: 'W' | 'L' | 'P' | '-' = '-';
  let currentStreakCount = 0;
  let winStreak = 0, lossStreak = 0;
  let maxWinStreak = 0, maxLossStreak = 0;

  for (const pick of graded) {
    const result = pick.gameResult as 'WIN' | 'LOSS' | 'PUSH';
    // Sanitize price -- if missing or NaN, default to -110
    const safePrice = (typeof pick.pickedPrice === 'number' && isFinite(pick.pickedPrice) && pick.pickedPrice !== 0)
      ? pick.pickedPrice : -110;
    const safeBook = pick.pickedBook && pick.pickedBook !== 'undefined' ? pick.pickedBook : 'Unknown';
    const safeGrade = pick.grade ?? 'B';
    const safeSport = pick.sport ?? 'Unknown';
    const safeBetType = pick.betType ?? 'Unknown';
    const safeDate = pick.date ?? new Date().toISOString();
    const profit = calcProfit(result, safePrice);
    const month = safeDate.slice(0, 7); // YYYY-MM

    // Totals
    if (result === 'WIN') record.wins++;
    else if (result === 'LOSS') record.losses++;
    else record.pushes++;
    record.totalProfit = Math.round((record.totalProfit + profit) * 100) / 100;
    totalOdds += safePrice;

    // Breakdowns
    record.bySport[safeSport] = updateRecord(record.bySport[safeSport] ?? emptyRecord(), result, profit);
    record.byMarket[safeBetType] = updateRecord(record.byMarket[safeBetType] ?? emptyRecord(), result, profit);
    record.byGrade[safeGrade] = updateRecord(record.byGrade[safeGrade] ?? emptyRecord(), result, profit);
    record.byBook[safeBook] = updateRecord(record.byBook[safeBook] ?? emptyRecord(), result, profit);
    record.byMonth[month] = updateRecord(record.byMonth[month] ?? emptyRecord(), result, profit);

    // Streaks
    if (result === currentStreakType) {
      currentStreakCount++;
    } else {
      currentStreakType = result;
      currentStreakCount = 1;
    }
    if (result === 'WIN') { winStreak++; lossStreak = 0; maxWinStreak = Math.max(maxWinStreak, winStreak); }
    else if (result === 'LOSS') { lossStreak++; winStreak = 0; maxLossStreak = Math.max(maxLossStreak, lossStreak); }
    else { winStreak = 0; lossStreak = 0; }
  }

  const gradedWL = record.wins + record.losses;
  record.winPct = gradedWL > 0 ? Math.round((record.wins / gradedWL) * 1000) / 10 : 0;
  record.roi = graded.length > 0
    ? Math.round((record.totalProfit / record.totalWagered) * 10000) / 100
    : 0;
  record.avgOdds = graded.length > 0 ? Math.round(totalOdds / graded.length) : 0;
  record.currentStreak = { type: currentStreakType, count: currentStreakCount };
  record.longestWinStreak = maxWinStreak;
  record.longestLossStreak = maxLossStreak;

  savePNL(record);
  return record;
}

// ------------------------------------
// Print full P&L report
// ------------------------------------

export function printPNLReport(): void {
  const record = rebuildPNL();
  const profitIcon = record.totalProfit >= 0 ? '[G]' : '[R]';
  const roiIcon = record.roi >= 5 ? '[G]' : record.roi >= 0 ? '[Y]' : '[R]';

  console.log('\n');
  console.log('+==============================================================+');
  console.log('|                 WIN / LOSS / P&L REPORT                     |');
  console.log(`|  Last updated: ${record.lastUpdated.slice(0,16).replace('T',' ').padEnd(46)}|`);
  console.log('+==============================================================+');

  console.log(`\n  Total picks logged  : ${record.totalPicks}`);
  console.log(`  Graded picks        : ${record.gradedPicks}`);
  console.log(`  Pending             : ${record.totalPicks - record.gradedPicks}`);

  if (record.gradedPicks === 0) {
    console.log('\n  No graded picks yet.');
    console.log('  Run "results" from the menu to enter game outcomes.\n');
    return;
  }

  console.log('\n  --- Overall Record ---------------------------------------');
  console.log(`  Record    : ${record.wins}-${record.losses}-${record.pushes}  (${fmtPct(record.winPct)} win rate)`);
  console.log(`  ${profitIcon} Profit    : ${fmtMoney(record.totalProfit)}  on ${fmtMoney(record.totalWagered)} wagered ($100/bet flat)`);
  console.log(`  ${roiIcon} ROI       : ${fmtPct(record.roi)}`);
  console.log(`  Avg odds  : ${record.avgOdds > 0 ? '+' : ''}${record.avgOdds}`);

  const streak = record.currentStreak;
  const streakIcon = streak.type === 'W' ? '[HOT]' : streak.type === 'L' ? '??' : '??';
  console.log(`  ${streakIcon} Streak    : ${streak.count} ${streak.type === 'W' ? 'wins' : streak.type === 'L' ? 'losses' : 'pushes'} in a row`);
  console.log(`  Best run  : ${record.longestWinStreak}W streak  |  Worst: ${record.longestLossStreak}L streak`);

  console.log('\n  --- By Sport ---------------------------------------------');
  for (const [sport, data] of Object.entries(record.bySport).sort((a,b) => b[1].profit - a[1].profit)) {
    const icon = data.profit >= 0 ? '[G]' : '[R]';
    console.log(`  ${icon} ${sport.padEnd(14)} ${data.wins}-${data.losses}-${data.pushes}  ${fmtPct(data.winPct).padStart(6)}  ${fmtMoney(data.profit).padStart(10)}  ROI: ${fmtPct(data.roi)}`);
  }

  console.log('\n  --- By Bet Type ------------------------------------------');
  for (const [market, data] of Object.entries(record.byMarket).sort((a,b) => b[1].profit - a[1].profit)) {
    const icon = data.profit >= 0 ? '[G]' : '[R]';
    console.log(`  ${icon} ${market.padEnd(14)} ${data.wins}-${data.losses}-${data.pushes}  ${fmtPct(data.winPct).padStart(6)}  ${fmtMoney(data.profit).padStart(10)}  ROI: ${fmtPct(data.roi)}`);
  }

  console.log('\n  --- By Grade ---------------------------------------------');
  for (const [grade, data] of Object.entries(record.byGrade).sort()) {
    const icon = data.profit >= 0 ? '[G]' : '[R]';
    console.log(`  ${icon} Grade ${grade.padEnd(4)}     ${data.wins}-${data.losses}-${data.pushes}  ${fmtPct(data.winPct).padStart(6)}  ${fmtMoney(data.profit).padStart(10)}  ROI: ${fmtPct(data.roi)}`);
  }

  console.log('\n  --- By Book ----------------------------------------------');
  for (const [book, data] of Object.entries(record.byBook).sort((a,b) => b[1].profit - a[1].profit)) {
    const icon = data.profit >= 0 ? '[G]' : '[R]';
    console.log(`  ${icon} ${book.padEnd(16)} ${data.wins}-${data.losses}-${data.pushes}  ${fmtPct(data.winPct).padStart(6)}  ${fmtMoney(data.profit).padStart(10)}`);
  }

  console.log('\n  --- By Month ---------------------------------------------');
  for (const [month, data] of Object.entries(record.byMonth).sort()) {
    const icon = data.profit >= 0 ? '[G]' : '[R]';
    console.log(`  ${icon} ${month}    ${data.wins}-${data.losses}-${data.pushes}  ${fmtPct(data.winPct).padStart(6)}  ${fmtMoney(data.profit).padStart(10)}  ROI: ${fmtPct(data.roi)}`);
  }

  console.log('\n  --- What This Means --------------------------------------');
  if (record.roi >= 10) {
    console.log('  [G] EXCEPTIONAL: 10%+ ROI is elite-level performance.');
  } else if (record.roi >= 5) {
    console.log('  [G] STRONG: 5%+ ROI is sharply profitable long-term.');
  } else if (record.roi >= 0) {
    console.log('  [Y] POSITIVE: Keep building sample size to confirm edge.');
  } else {
    console.log('  [R] NEGATIVE ROI: Review which sports/grades are losing.');
    console.log('     Consider cutting markets with worst ROI from your card.');
  }
  console.log('  ROI Benchmark: 5%+ = strong edge | 0-5% = marginal | <0% = losing\n');
}
