// ============================================================
// src/commands/runReset.ts
// Clean-slate reset for picks, W/L records, and learned weights.
//
// SAFETY:
//   1. Requires --confirm flag (passed by server only when ?confirm=RESET)
//   2. Creates a timestamped backup before touching any file
//   3. Appends an entry to reset_log.json after each run
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

const SNAPSHOT_DIR  = process.env.SNAPSHOT_DIR ?? './snapshots';
const BACKUP_ROOT   = path.join(SNAPSHOT_DIR, 'reset_backups');
const RESET_LOG     = path.join(SNAPSHOT_DIR, 'reset_log.json');

interface ResetSummary {
  cleared: string[];
  kept:    string[];
  errors:  string[];
}

// ── Helpers ───────────────────────────────────────────────────

function loadResetLog(): any[] {
  try {
    if (fs.existsSync(RESET_LOG)) return JSON.parse(fs.readFileSync(RESET_LOG, 'utf-8'));
  } catch { /* non-fatal */ }
  return [];
}

function appendResetLog(entry: object): void {
  try {
    const log = loadResetLog();
    log.unshift(entry); // newest first
    if (log.length > 50) log.splice(50); // cap at 50 entries
    fs.writeFileSync(RESET_LOG, JSON.stringify(log, null, 2));
  } catch { /* non-fatal */ }
}

function backupFile(filename: string, backupDir: string): { ok: boolean; error?: string } {
  const src = path.join(SNAPSHOT_DIR, filename);
  const dst = path.join(backupDir, filename);
  try {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      return { ok: true };
    }
    return { ok: true }; // file didn't exist — nothing to back up
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
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

// ── Files to reset ────────────────────────────────────────────

const RESET_FILES: Array<{ name: string; empty: any }> = [
  { name: 'picks_log.json',      empty: [] },
  { name: 'retro_analysis.json', empty: [] },
  { name: 'signal_weights.json', empty: {} },
  { name: 'clv_weights.json',    empty: {} },
  { name: 'pnl_record.json',     empty: null },
];

// ── Main export ───────────────────────────────────────────────

export function runReset(): void {
  // ── Safety gate: require --confirm flag ───────────────────
  const confirmed = process.argv.includes('--confirm');
  if (!confirmed) {
    console.log('\n');
    console.log('=================================================================');
    console.log('  RESET BLOCKED — CONFIRMATION REQUIRED');
    console.log('=================================================================');
    console.log('  This command permanently clears picks, W/L records, and');
    console.log('  learned weights. It must be triggered from the dashboard');
    console.log('  Danger Zone with confirmation enabled.\n');
    console.log('  If running from CLI, add the --confirm flag:');
    console.log('  node dist/index.js reset --confirm\n');
    return;
  }

  console.log('\n');
  console.log('=================================================================');
  console.log('  PICKS & RECORDS RESET');
  console.log('=================================================================');
  console.log('  Confirmation received. Starting backup...\n');

  if (!fs.existsSync(SNAPSHOT_DIR)) {
    console.log('  No snapshot directory found — nothing to reset.\n');
    return;
  }

  // ── Step 1: Create timestamped backup ─────────────────────
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const backupDir = path.join(BACKUP_ROOT, `reset_${ts}`);
  const backupErrors: string[] = [];

  try {
    fs.mkdirSync(backupDir, { recursive: true });
  } catch (err: any) {
    console.log(`  [!] Could not create backup directory: ${err?.message ?? String(err)}`);
    console.log('  RESET ABORTED — no changes made.\n');
    return;
  }

  console.log(`  Backup directory: ${backupDir}`);

  const backedUp: string[] = [];
  for (const { name } of RESET_FILES) {
    const result = backupFile(name, backupDir);
    if (result.ok) {
      const src = path.join(SNAPSHOT_DIR, name);
      if (fs.existsSync(src)) backedUp.push(name);
    } else {
      backupErrors.push(`${name}: ${result.error}`);
    }
  }

  // Write manifest inside backup folder
  try {
    const manifest = {
      timestamp:   new Date().toISOString(),
      backupDir,
      filesBackedUp: backedUp,
      errors:      backupErrors,
      triggeredBy: 'dashboard-danger-zone',
    };
    fs.writeFileSync(path.join(backupDir, 'reset_manifest.json'), JSON.stringify(manifest, null, 2));
  } catch { /* non-fatal */ }

  if (backedUp.length > 0) {
    console.log(`  Backed up ${backedUp.length} file(s): ${backedUp.join(', ')}`);
  } else {
    console.log('  (no files existed yet to back up)');
  }
  if (backupErrors.length > 0) {
    console.log(`  [!] Backup errors: ${backupErrors.join('; ')}`);
  }

  // ── Step 2: Clear files ────────────────────────────────────
  console.log('\n  Clearing files...\n');
  const summary: ResetSummary = { cleared: [], kept: [], errors: [] };
  for (const { name, empty } of RESET_FILES) {
    clearFile(name, empty, summary);
  }

  // ── Step 3: Append to reset log ───────────────────────────
  appendResetLog({
    timestamp:    new Date().toISOString(),
    backupDir,
    filesCleared: summary.cleared,
    filesBackedUp: backedUp,
    errors:       summary.errors,
    triggeredBy:  'dashboard-danger-zone',
  });

  // ── Step 4: Print summary ──────────────────────────────────
  console.log('  -- CLEARED -----------------------------------------------');
  if (summary.cleared.length > 0) {
    for (const f of summary.cleared) {
      console.log(`  [✓] ${f}`);
    }
  } else {
    console.log('  (none — files may not exist yet)');
  }

  console.log('\n  -- BACKED UP (before clearing) ---------------------------');
  if (backedUp.length > 0) {
    for (const f of backedUp) {
      console.log(`  [✓] ${f}  →  reset_backups/reset_${ts}/${f}`);
    }
  } else {
    console.log('  (no files existed yet — nothing to back up)');
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
  console.log(`  Backup saved  : reset_backups/reset_${ts}/`);
  console.log('  Reset log     : reset_log.json (entry appended)');
  console.log('');
  console.log('  All future picks will be tracked fresh from this point.');
  console.log('  Run a morning scan to begin building a clean record.\n');
}
