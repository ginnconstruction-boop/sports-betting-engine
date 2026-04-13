// ============================================================
// runFixResults.ts
// Utility to clear wrong results from a specific date
// Resets gameResult back to PENDING so you can re-enter
// ============================================================
import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const PICKS_FILE = path.join(SNAPSHOT_DIR, 'picks_log.json');

export async function runFixResults(): Promise<void> {
  if (!fs.existsSync(PICKS_FILE)) {
    console.log('\n  No picks log found.\n');
    return;
  }

  const picks = JSON.parse(fs.readFileSync(PICKS_FILE, 'utf-8'));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (p: string): Promise<string> => new Promise(r => rl.question(p, r));

  console.log('\n  =============================================');
  console.log('  RESULT CORRECTION TOOL');
  console.log('  Resets wrong results back to PENDING');
  console.log('  so you can re-enter them correctly');
  console.log('  =============================================\n');

  // Show all graded picks grouped by date
  const graded = picks.filter((p: any) => p.gameResult !== 'PENDING');
  if (graded.length === 0) {
    console.log('  No graded picks found.\n');
    rl.close(); return;
  }

  // Group by date
  const byDate: Record<string, any[]> = {};
  for (const p of graded) {
    const d = (p.date ?? p.gameTime ?? '').slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(p);
  }

  console.log('  Graded picks by date:');
  const dates = Object.keys(byDate).sort();
  dates.forEach((d, i) => {
    const count = byDate[d].length;
    const wins = byDate[d].filter((p: any) => p.gameResult === 'WIN').length;
    const losses = byDate[d].filter((p: any) => p.gameResult === 'LOSS').length;
    console.log(`  ${i + 1}. ${d}  --  ${count} picks  (${wins}W ${losses}L)`);
  });

  const dateChoice = await question('\n  Enter date number to reset (or press Enter to cancel): ');
  const dateIdx = parseInt(dateChoice) - 1;
  if (isNaN(dateIdx) || dateIdx < 0 || dateIdx >= dates.length) {
    console.log('  Cancelled.\n');
    rl.close(); return;
  }

  const chosenDate = dates[dateIdx];
  const picksOnDate = byDate[chosenDate];

  console.log(`\n  Picks from ${chosenDate}:`);
  picksOnDate.forEach((p: any, i: number) => {
    const priceStr = p.pickedPrice > 0 ? `+${p.pickedPrice}` : `${p.pickedPrice}`;
    console.log(`  ${i + 1}. [${p.gameResult}] ${p.matchup} | ${p.betType} ${p.side} ${priceStr} [${p.grade}]`);
  });

  const pickChoice = await question('\n  Enter pick number to reset (or A for all picks on this date, Enter to cancel): ');

  let toReset: any[] = [];
  if (pickChoice.trim().toUpperCase() === 'A') {
    toReset = picksOnDate;
  } else {
    const pickIdx = parseInt(pickChoice) - 1;
    if (!isNaN(pickIdx) && pickIdx >= 0 && pickIdx < picksOnDate.length) {
      toReset = [picksOnDate[pickIdx]];
    } else {
      console.log('  Cancelled.\n');
      rl.close(); return;
    }
  }

  const confirm = await question(`\n  Reset ${toReset.length} pick(s) back to PENDING? (Y/N): `);
  if (confirm.trim().toUpperCase() !== 'Y') {
    console.log('  Cancelled.\n');
    rl.close(); return;
  }

  // Reset the picks
  const resetIds = new Set(toReset.map((p: any) => p.pickId));
  let resetCount = 0;
  for (const pick of picks) {
    if (resetIds.has(pick.pickId)) {
      pick.gameResult = 'PENDING';
      pick.autoGraded = false;
      resetCount++;
    }
  }

  fs.writeFileSync(PICKS_FILE, JSON.stringify(picks, null, 2));

  // Also clear from retro analysis file so wrong results don't affect signal weights
  const RETRO_FILE = path.join(SNAPSHOT_DIR, 'retro_analysis.json');
  if (fs.existsSync(RETRO_FILE)) {
    try {
      const retro = JSON.parse(fs.readFileSync(RETRO_FILE, 'utf-8'));
      const resetIdArr = Array.from(resetIds) as string[];
      const filtered = retro.filter((r: any) => !resetIdArr.includes(r.pickId));
      const removedRetro = retro.length - filtered.length;
      fs.writeFileSync(RETRO_FILE, JSON.stringify(filtered, null, 2));
      if (removedRetro > 0) console.log(`  Cleared ${removedRetro} entry(s) from retro analysis.`);
    } catch { /* retro file may not exist yet */ }
  }

  console.log(`\n  Reset ${resetCount} pick(s) to PENDING.`);
  console.log('  Run option 16 to re-enter the correct results.\n');

  rl.close();
}
