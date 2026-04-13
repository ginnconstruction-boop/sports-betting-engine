// ============================================================
// src/services/weeklySummary.ts
// #10 -- Weekly performance summary
// Shows record, ROI, best/worst sport, grade performance
// ============================================================

import * as fs from 'fs';
import { sendAlerts } from './alertService';
import * as path from 'path';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const PICKS_FILE = path.join(SNAPSHOT_DIR, 'picks_log.json');
const PNL_FILE = path.join(SNAPSHOT_DIR, 'pnl_record.json');

function loadFile(file: string): any {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return null; }
}

function fmtMoney(n: number): string {
  return `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`;
}

export function printWeeklySummary(): void {
  const picks = loadFile(PICKS_FILE) ?? [];
  const pnl = loadFile(PNL_FILE);

  // Filter to last 7 days
  const cutoff = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
  const weekPicks = picks.filter((p: any) => p.date >= cutoff);
  const weekGraded = weekPicks.filter((p: any) => p.gameResult !== 'PENDING');

  const wins = weekGraded.filter((p: any) => p.gameResult === 'WIN').length;
  const losses = weekGraded.filter((p: any) => p.gameResult === 'LOSS').length;
  const pushes = weekGraded.filter((p: any) => p.gameResult === 'PUSH').length;

  let weekProfit = 0;
  for (const p of weekGraded) {
    if (p.gameResult === 'WIN') {
      weekProfit += p.pickedPrice > 0
        ? (p.pickedPrice / 100) * 100
        : (100 / Math.abs(p.pickedPrice)) * 100;
    } else if (p.gameResult === 'LOSS') {
      weekProfit -= 100;
    }
  }

  const weekROI = weekGraded.length > 0
    ? (weekProfit / (weekGraded.length * 100)) * 100 : 0;

  console.log('\n');
  console.log('+==============================================================+');
  console.log('|              WEEKLY PERFORMANCE SUMMARY                     |');
  const weekStr = `Week of ${new Date(cutoff).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  console.log(`|  ${weekStr.padEnd(60)}|`);
  console.log('+==============================================================+');

  console.log(`\n  This week's picks   : ${weekPicks.length}`);
  console.log(`  Graded              : ${weekGraded.length}`);
  console.log(`  Pending             : ${weekPicks.length - weekGraded.length}`);

  if (weekGraded.length === 0) {
    console.log('\n  No graded picks this week yet.');
    console.log('  Enter results via GO.bat -> option 8\n');
    return;
  }

  const winPct = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';
  const profitIcon = weekProfit >= 0 ? '[G]' : '[R]';
  const roiIcon = weekROI >= 5 ? '[G]' : weekROI >= 0 ? '[Y]' : '[R]';

  console.log(`\n  --- This Week --------------------------------------------`);
  console.log(`  Record   : ${wins}-${losses}-${pushes}  (${winPct}% win rate)`);
  console.log(`  ${profitIcon} Profit  : ${fmtMoney(weekProfit)}`);
  console.log(`  ${roiIcon} ROI     : ${weekROI.toFixed(1)}%`);

  // Best and worst sport this week
  const bySport: Record<string, { w: number; l: number; profit: number }> = {};
  for (const p of weekGraded) {
    if (!bySport[p.sport]) bySport[p.sport] = { w: 0, l: 0, profit: 0 };
    if (p.gameResult === 'WIN') {
      bySport[p.sport].w++;
      bySport[p.sport].profit += p.pickedPrice > 0
        ? (p.pickedPrice / 100) * 100
        : (100 / Math.abs(p.pickedPrice)) * 100;
    } else if (p.gameResult === 'LOSS') {
      bySport[p.sport].l++;
      bySport[p.sport].profit -= 100;
    }
  }

  const sportEntries = Object.entries(bySport).sort((a, b) => b[1].profit - a[1].profit);
  if (sportEntries.length > 0) {
    const best = sportEntries[0];
    const worst = sportEntries[sportEntries.length - 1];
    console.log(`\n  --- Sport Performance ------------------------------------`);
    for (const [sport, data] of sportEntries) {
      const icon = data.profit >= 0 ? '[G]' : '[R]';
      console.log(`  ${icon} ${sport.padEnd(14)} ${data.w}-${data.l}  ${fmtMoney(data.profit)}`);
    }
    if (best[0] !== worst[0]) {
      console.log(`\n  ? Best sport  : ${best[0]} (${fmtMoney(best[1].profit)})`);
      console.log(`  [v] Worst sport : ${worst[0]} (${fmtMoney(worst[1].profit)})`);
    }
  }

  // Grade performance this week
  const byGrade: Record<string, { w: number; l: number }> = {};
  for (const p of weekGraded) {
    if (!byGrade[p.grade]) byGrade[p.grade] = { w: 0, l: 0 };
    if (p.gameResult === 'WIN') byGrade[p.grade].w++;
    else if (p.gameResult === 'LOSS') byGrade[p.grade].l++;
  }

  if (Object.keys(byGrade).length > 0) {
    console.log(`\n  --- Grade Performance ------------------------------------`);
    for (const [grade, data] of Object.entries(byGrade).sort()) {
      const total = data.w + data.l;
      const pct = total > 0 ? ((data.w / total) * 100).toFixed(0) : '0';
      const icon = data.w > data.l ? '[G]' : data.w === data.l ? '[Y]' : '[R]';
      console.log(`  ${icon} Grade ${grade.padEnd(4)}  ${data.w}-${data.l}  (${pct}% win rate)`);
    }
  }

  // All-time context
  if (pnl) {
    console.log(`\n  --- All-Time Context -------------------------------------`);
    const atIcon = pnl.roi >= 0 ? '[G]' : '[R]';
    console.log(`  ${atIcon} All-time record : ${pnl.wins}-${pnl.losses}-${pnl.pushes}`);
    console.log(`  ${atIcon} All-time ROI    : ${pnl.roi.toFixed(1)}%  |  Profit: ${fmtMoney(pnl.totalProfit)}`);
  }

  console.log(`\n  --- Recommendation ---------------------------------------`);
  if (weekROI >= 10) {
    console.log('  [HOT] Exceptional week. System is firing on all cylinders.');
    console.log('     Consider staying consistent with same bet sizing.');
  } else if (weekROI >= 0) {
    console.log('  [G] Positive week. Model is working -- stay the course.');
  } else if (weekROI >= -10) {
    console.log('  [Y] Slight down week. Normal variance -- keep going.');
    if (sportEntries.length > 1) {
      const worst = sportEntries[sportEntries.length - 1];
      console.log(`     Consider cutting ${worst[0]} from your card this week.`);
    }
  } else {
    console.log('  [R] Tough week. Review which grades are underperforming.');
    console.log('     Stick to BET tier only until form returns.');
  }
  console.log('');
}
