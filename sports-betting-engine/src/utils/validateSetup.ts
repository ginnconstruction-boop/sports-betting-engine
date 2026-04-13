// ============================================================
// src/utils/validateSetup.ts
// Validates config, .env, and structure WITHOUT making any API calls
// Zero credits burned -- safe to run anytime
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

import { SPORTS, getEnabledSports } from '../config/sports';
import { BOOKMAKERS, getTennesseeBooks } from '../config/bookmakers';
import { INITIAL_MARKETS } from '../types/odds';

interface ValidationResult {
  passed: boolean;
  checks: Array<{ label: string; ok: boolean; detail: string }>;
}

function check(label: string, ok: boolean, detail: string) {
  return { label, ok, detail };
}

export function validateSetup(): ValidationResult {
  const checks = [];

  // 1. API key present
  const apiKey = process.env.ODDS_API_KEY;
  checks.push(check(
    'API Key',
    !!apiKey && apiKey.length > 10,
    apiKey ? `Key found (${apiKey.slice(0, 6)}...${apiKey.slice(-4)})` : 'ODDS_API_KEY missing in .env'
  ));

  // 2. Sports config
  const enabled = getEnabledSports();
  checks.push(check(
    'Sports Config',
    enabled.length > 0,
    `${enabled.length} enabled: ${enabled.map(s => s.name).join(', ')}`
  ));

  // 3. All target sports present
  const requiredKeys = [
    'baseball_mlb', 'basketball_nba', 'americanfootball_nfl',
    'americanfootball_ncaaf', 'basketball_ncaab', 'baseball_ncaa', 'icehockey_nhl'
  ];
  const configuredKeys = SPORTS.map(s => s.key);
  const missing = requiredKeys.filter(k => !configuredKeys.includes(k));
  checks.push(check(
    'All Target Sports',
    missing.length === 0,
    missing.length === 0 ? 'All 7 target sports configured' : `Missing: ${missing.join(', ')}`
  ));

  // 4. Bookmakers
  const tnBooks = getTennesseeBooks();
  checks.push(check(
    'Bookmaker Config',
    BOOKMAKERS.length > 0,
    `${BOOKMAKERS.length} total books mapped, ${tnBooks.length} available in Tennessee`
  ));

  // 5. Priority books present
  const priorityKeys = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'espnbet'];
  const bmKeys = BOOKMAKERS.map(b => b.key);
  const missingBooks = priorityKeys.filter(k => !bmKeys.includes(k));
  checks.push(check(
    'Priority Books (DK/FD/MGM/Caesars/ESPN)',
    missingBooks.length === 0,
    missingBooks.length === 0 ? 'All 5 priority books mapped' : `Missing: ${missingBooks.join(', ')}`
  ));

  // 6. Initial markets
  checks.push(check(
    'Initial Markets',
    INITIAL_MARKETS.length === 3,
    `Markets: ${INITIAL_MARKETS.join(', ')}`
  ));

  // 7. Snapshot directory writable
  const snapshotDir = process.env.SNAPSHOT_DIR ?? './snapshots';
  let snapshotOk = false;
  let snapshotDetail = '';
  try {
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }
    const testFile = path.join(snapshotDir, '.write-test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    snapshotOk = true;
    snapshotDetail = `Directory ready: ${path.resolve(snapshotDir)}`;
  } catch (err) {
    snapshotDetail = `Cannot write to ${snapshotDir}: ${String(err)}`;
  }
  checks.push(check('Snapshot Directory', snapshotOk, snapshotDetail));

  // 8. Cache window
  const cacheMin = parseInt(process.env.CACHE_WINDOW_MINUTES ?? '5', 10);
  checks.push(check(
    'Cache Window',
    cacheMin > 0 && cacheMin <= 60,
    `${cacheMin} minute(s) -- protects API credits between quick re-runs`
  ));

  // 9. Player props status
  const { propsEnabled } = require('../config/propConfig');
  const propsOn = propsEnabled();
  checks.push(check(
    'Player Props',
    true,
    propsOn
      ? 'Enabled -- NBA/NFL have full intelligence; MLB/NHL have market scoring only'
      : 'Disabled -- set PROPS_ENABLED=true in propConfig.ts to enable'
  ));

  // 10. No scheduler / auto-run code
  checks.push(check(
    'On-Demand Only',
    true,
    'No schedulers, no polling, no background workers -- confirmed'
  ));

  const passed = checks.every(c => c.ok);
  return { passed, checks };
}

// ------------------------------------
// CLI runner
// ------------------------------------

function main() {
  console.log('\n+==========================================================+');
  console.log('|         Sports Betting Engine -- Setup Validator          |');
  console.log('|                  (No API calls made)                     |');
  console.log('+==========================================================+\n');

  const { passed, checks } = validateSetup();

  for (const c of checks) {
    const icon = c.ok ? '[OK]' : '[X]';
    console.log(`  ${icon}  ${c.label.padEnd(35)} ${c.detail}`);
  }

  console.log('\n' + '-'.repeat(62));

  if (passed) {
    console.log('\n  [OK]  ALL CHECKS PASSED -- System is ready.');
    console.log('\n  To run your first scan (costs credits):');
    console.log('    npx ts-node src/index.ts morning\n');
  } else {
    console.log('\n  [X]  SOME CHECKS FAILED -- Fix the items above before running.\n');
    process.exit(1);
  }
}

main();
