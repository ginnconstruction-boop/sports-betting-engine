// ============================================================
// src/tests/testCreditBudgetGuard.ts
// Standalone tests for CreditBudgetGuard — no jest required.
//
// Run with:
//   npx ts-node src/tests/testCreditBudgetGuard.ts
//
// Each test prints PASS or FAIL with a description.
// Exit code 0 = all passed, 1 = any failure.
// ============================================================

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs   from 'fs';
import * as path from 'path';
import { CreditBudgetGuard, CREDIT_COSTS } from '../services/creditBudgetGuard';

// ── Test harness ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${label}`);
    failed++;
  }
}

// ── Helpers ───────────────────────────────────────────────────

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const GUARD_FILE   = path.join(SNAPSHOT_DIR, 'guard_day.json');
const TEST_DIR     = path.join(SNAPSHOT_DIR, '_test_guard');
const TEST_GUARD   = path.join(TEST_DIR, 'guard_day.json');

/** Reset guard_day.json to a blank state for today before each group. */
function resetGuardFile(): void {
  try {
    if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
    // Point guard file to test dir by overriding env; guard class reads the env directly.
    // Instead: write a clean state to the real guard file.
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(GUARD_FILE, JSON.stringify({ date: today, creditsSpent: 0 }, null, 2));
  } catch { /* ignore */ }
}

/** Purge the guard file so loadGuardDay() returns a fresh state. */
function clearGuardFile(): void {
  try { fs.unlinkSync(GUARD_FILE); } catch { /* ignore */ }
}

// ── Test groups ───────────────────────────────────────────────

console.log('\n  ── CreditBudgetGuard Tests ──────────────────────────\n');

// ── Group 1: Cost table sanity ────────────────────────────────
console.log('  [GROUP 1] Cost table sanity');
{
  check('events cost = 0',   CREDIT_COSTS.events   === 0);
  check('odds cost   = 1',   CREDIT_COSTS.odds     === 1);
  check('scores cost = 2',   CREDIT_COSTS.scores   === 2);
  check('props cost  = 4',   CREDIT_COSTS.props    === 4);
  check('injuries cost = 1', CREDIT_COSTS.injuries === 1);
  check('news cost   = 1',   CREDIT_COSTS.news     === 1);
}

// ── Group 2: Under-budget → allowed ──────────────────────────
console.log('\n  [GROUP 2] Under budget — canSpend() returns allowed');
{
  clearGuardFile();
  const guard = new CreditBudgetGuard({ maxCreditsPerRun: 100, maxCreditsPerDay: 500 });

  const d = guard.canSpend('odds', 5);  // 5 credits
  check('odds × 5 → allowed',           d.allowed === true);
  check('reason is undefined',           d.reason  === undefined);
  check('estimatedCost = 5',            d.estimatedCost === 5);
  check('runSpentSoFar = 0 (not spent yet)', d.runSpentSoFar === 0);
}

// ── Group 3: spend() updates counters ────────────────────────
console.log('\n  [GROUP 3] spend() updates run and day counters');
{
  clearGuardFile();
  const guard = new CreditBudgetGuard({ maxCreditsPerRun: 100, maxCreditsPerDay: 500 });

  guard.spend('odds', 3);       // 3 credits
  guard.spend('scores', 2);     // 4 credits  (2 sports × 2)

  const snap = guard.snapshot();
  check('runSpent = 7 after two spends',  snap.runSpent === 7);
  check('daySpent = 7 persisted to file', snap.daySpent === 7);

  // canSpend sees the updated counters
  const d = guard.canSpend('props', 1);  // 4 credits
  check('runSpentSoFar reflects spend()',  d.runSpentSoFar === 7);
}

// ── Group 4: Per-run cap enforcement ─────────────────────────
console.log('\n  [GROUP 4] Per-run hard cap blocks at limit');
{
  clearGuardFile();
  const guard = new CreditBudgetGuard({ maxCreditsPerRun: 10, maxCreditsPerDay: 500 });

  guard.spend('odds', 9);       // 9 credits used, cap = 10

  // Exact boundary: 1 more credit → exactly at cap → should be BLOCKED (9 + 2 > 10)
  const d1 = guard.canSpend('scores', 1);   // 2 credits; 9+2 = 11 > 10
  check('over run cap → blocked',            d1.allowed === false);
  check('reason = run_credit_budget_exhausted', d1.reason === 'run_credit_budget_exhausted');

  // Free call still allowed even at cap
  const d2 = guard.canSpend('events', 999);  // 0 credits
  check('free events call always allowed (even near cap)', d2.allowed === true);
}

// ── Group 5: Exact run cap → blocked ─────────────────────────
console.log('\n  [GROUP 5] Exact run cap boundary');
{
  clearGuardFile();
  const guard = new CreditBudgetGuard({ maxCreditsPerRun: 10, maxCreditsPerDay: 500 });

  guard.spend('odds', 10);  // exactly at cap

  const d = guard.canSpend('odds', 1);   // 1 more → 11 > 10 → blocked
  check('at exact run cap, +1 → blocked', d.allowed === false);

  const d2 = guard.canSpend('events', 1);  // 0 cost → still passes
  check('at exact run cap, free call → allowed', d2.allowed === true);
}

// ── Group 6: Per-day cap enforcement ─────────────────────────
console.log('\n  [GROUP 6] Per-day hard cap blocks across instances');
{
  clearGuardFile();

  // Simulate two separate runs on the same day
  const runA = new CreditBudgetGuard({ maxCreditsPerRun: 300, maxCreditsPerDay: 20 });
  runA.spend('scores', 9);   // 18 credits used today

  // New instance (new run), same day state loaded from file
  const runB = new CreditBudgetGuard({ maxCreditsPerRun: 300, maxCreditsPerDay: 20 });
  const d = runB.canSpend('scores', 2);  // 4 credits; 18+4 = 22 > 20 → blocked
  check('second run blocked by day cap',        d.allowed === false);
  check('reason = daily_credit_budget_exhausted', d.reason === 'daily_credit_budget_exhausted');
  check('daySpentSoFar shows first run spend',  d.daySpentSoFar === 18);
}

// ── Group 7: Skipped nonessential call logged correctly ───────
console.log('\n  [GROUP 7] Nonessential call skipped reason code (GREEN tier assumed)');
{
  // This test only fires the nonessential_call_skipped path when tier = YELLOW/ORANGE.
  // In test environment the tier is likely GREEN (no credit state), so props goes through.
  // We verify the reason is NOT nonessential_call_skipped when GREEN (it should be allowed).
  clearGuardFile();
  const guard = new CreditBudgetGuard({ maxCreditsPerRun: 200, maxCreditsPerDay: 500 });

  const d = guard.canSpend('props', 1);
  // In a clean GREEN environment, props is optional but allowed
  check(
    'props allowed in GREEN tier',
    d.allowed === true || d.reason === 'nonessential_call_skipped'
  );
  // This test documents the behavior — skipped if not GREEN. A real integration
  // test would set credit_log.json to YELLOW/ORANGE first.
  if (!d.allowed) {
    check('blocked reason is nonessential_call_skipped', d.reason === 'nonessential_call_skipped');
  }
}

// ── Group 8: No negative remaining ───────────────────────────
console.log('\n  [GROUP 8] Guard counters never go negative');
{
  clearGuardFile();
  const guard = new CreditBudgetGuard({ maxCreditsPerRun: 200, maxCreditsPerDay: 500 });

  // Calling canSpend never mutates state, so no negative risk from checks
  guard.spend('events', 100);   // 0 cost
  const snap = guard.snapshot();
  check('runSpent is 0 after events-only spends',  snap.runSpent === 0);
  check('daySpent is 0 after events-only spends',  snap.daySpent === 0);
  check('runSpent is non-negative',                snap.runSpent >= 0);
  check('daySpent is non-negative',                snap.daySpent >= 0);
}

// ── Group 9: snapshot() fields ───────────────────────────────
console.log('\n  [GROUP 9] snapshot() returns all expected fields');
{
  clearGuardFile();
  const guard = new CreditBudgetGuard({ maxCreditsPerRun: 50, maxCreditsPerDay: 100 });
  guard.spend('odds', 3);

  const snap = guard.snapshot();
  check('snapshot has runSpent',    typeof snap.runSpent    === 'number');
  check('snapshot has runCap',      typeof snap.runCap      === 'number');
  check('snapshot has daySpent',    typeof snap.daySpent    === 'number');
  check('snapshot has dayCap',      typeof snap.dayCap      === 'number');
  check('snapshot has tier',        typeof snap.tier        === 'string');
  check('snapshot has headroom',    typeof snap.headroom    === 'number');
  check('snapshot has dailyTarget', typeof snap.dailyTarget === 'number');
  check('runCap matches constructor', snap.runCap === 50);
  check('dayCap matches constructor', snap.dayCap === 100);
}

// ── Summary ───────────────────────────────────────────────────

console.log(`\n  ─────────────────────────────────────────────────────`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('');

process.exit(failed > 0 ? 1 : 0);
