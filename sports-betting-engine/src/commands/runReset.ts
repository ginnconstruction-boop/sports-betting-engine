// ============================================================
// src/commands/runReset.ts
// Clean-slate reset for picks, W/L records, and learned weights.
//
// CLEARS:
//   picks_log.json       — all saved picks history
//   retro_analysis.json  — all W/L graded results
//   signal_weights.json  — learned signal weights (derived from bad data)
//   clv_weights.json     — CLV weight adjustments
//   pnl_record.json      — P&L totals
//
// KEEPS (intentionally):
//   ats_live.json        — real ATS game results (valid market data)
//   ats_historical.json  — historical backfill data
//   credit_log.json      — real credit usage tracking
//   scan_history.json    — scan run log
//   snapshots/*.json     — raw odds snapshots
// ============================================================

import * as fs   from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';

interface ResetSummary {
  cleared: string[];
  kept:    string[];
  errors:  string[];
}

function clearFile(filename: string, emptyValue: any, summary: ResetSummary): void {
  const filePath = path.join(SNAPSHOT_DIR, filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(emptyValue, null, 2));
      summary.cleared.push(filename);
    } else {
      summary.kept.push(`${filename} (did not exist)`);
    }
  } catch (err: any) {
    summary.errors.push(`${filename}: ${err?.message ?? String(err)}`);
  }
}

export function runReset(): void {
  console.log('\n');
  console.log('=================================================================');
  console.log('  PICKS & RECORDS RESET');
  console.log('=================================================================');
  console.log('  Clearing picks log, W/L records, and learned weights...\n');

  if (!fs.existsSync(SNAPSHOT_DIR)) {
    console.log('  No snapshot directory found — nothing to reset.\n');
    return;
  }

  const summary: ResetSummary = { cleared: [], kept: [], errors: [] };

  // ── Clear picks and results ────────────────────────────────
  clearFile('picks_log.json',      [],   summary);
  clearFile('retro_analysis.json', [],   summary);
  clearFile('signal_weights.json', {},   summary);
  clearFile('clv_weights.json',    {},   summary);
  clearFile('pnl_record.json',     null, summary);

  // ── Print summary ──────────────────────────────────────────
  console.log('  -- CLEARED -----------------------------------------------');
  if (summary.cleared.length > 0) {
    for (const f of summary.cleared) {
      console.log(`  [✓] ${f}`);
    }
  } else {
    console.log('  (none — files may not exist yet)');
  }

  console.log('\n  -- KEPT (unchanged) --------------------------------------');
  const kept = [
    'ats_live.json        (ATS game results — valid market data)',
    'ats_historical.json  (historical backfill)',
    'credit_log.json      (monthly credit tracking)',
    'scan_history.json    (scan run log)',
    'morning_scan_*.json  (raw odds snapshots)',
  ];
  for (const f of kept) {
    console.log(`  [—] ${f}`);
  }

  if (summary.errors.length > 0) {
    console.log('\n  -- ERRORS ------------------------------------------------');
    for (const e of summary.errors) {
      console.log(`  [!] ${e}`);
    }
  }

  console.log('\n  ── RESET COMPLETE ─────────────────────────────────────────');
  console.log('  Picks log     : empty (0 picks)');
  console.log('  W/L record    : 0 - 0 - 0');
  console.log('  Signal weights: reset to defaults');
  console.log('  P&L           : cleared to zero');
  console.log('');
  console.log('  All future picks will be tracked fresh from this point.');
  console.log('  Run a morning scan to begin building a clean record.\n');
}
