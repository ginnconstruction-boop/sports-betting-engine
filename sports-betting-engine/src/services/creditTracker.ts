// ============================================================
// src/services/creditTracker.ts
// Monthly credit budget tracker for The Odds API
//
// Budget  : 20,000 credits / month
// Buffer  : 1,500 credits  — hard reserve, never touched
// Usable  : 18,500 credits — spread evenly across the month
//
// TIERS (based on lastKnownRemaining from API headers):
//   GREEN  > 5,000  — full access, all call types allowed
//   YELLOW 3,000–5,000  — skip optional prop pulls
//   ORANGE 1,500–3,000  — essential game-line calls only
//   RED    < 1,500  — hard stop, no new API calls
//
// DAILY TARGET logic:
//   (usableRemaining) / (daysLeftInMonth) = target credits/day
//   Engine uses headroom = target - todayUsed to decide whether
//   to allow opportunistic prop discovery calls.
//
// State file: ${SNAPSHOT_DIR}/credit_log.json
//   Resets automatically when the calendar month changes.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR  = process.env.SNAPSHOT_DIR ?? './snapshots';
const CREDIT_FILE   = path.join(SNAPSHOT_DIR, 'credit_log.json');

// ── Budget constants ──────────────────────────────────────────

export const MONTHLY_BUDGET  = 20_000;
const HARD_BUFFER    = 1_500;   // emergency reserve — never spend below this
const WARN_THRESHOLD = 3_000;   // YELLOW — skip optional calls
const SOFT_STOP      = 1_500;   // ORANGE — essential only (same as buffer edge)
const HARD_STOP      =   500;   // RED    — full brake

// ── Types ─────────────────────────────────────────────────────

export type BudgetTier = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';

/**
 * Call urgency levels — passed to isBudgetAllowed().
 *
 *   essential : Main game odds, score lookups, quota-free endpoints.
 *               Always allowed unless RED.
 *   standard  : Props, event market lookups, CLV checks.
 *               Blocked in ORANGE and RED.
 *   optional  : Speculative prop discovery, alt lines, participants.
 *               Blocked in YELLOW, ORANGE, and RED.
 */
export type CallType = 'essential' | 'standard' | 'optional';

interface DailyEntry {
  date: string;                     // 'YYYY-MM-DD'
  creditsAtDayStart: number | null;
  creditsAtDayEnd:   number | null;
  estimatedUsed:     number;
}

interface CreditState {
  month:                string;           // 'YYYY-MM' — resets on new month
  monthlyBudget:        number;
  hardBuffer:           number;
  lastKnownRemaining:   number | null;
  lastUpdated:          string | null;
  dailyLog:             DailyEntry[];
}

// ── Helpers ───────────────────────────────────────────────────

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);   // 'YYYY-MM'
}

function today(): string {
  return new Date().toISOString().slice(0, 10);  // 'YYYY-MM-DD'
}

function daysRemainingInMonth(): number {
  const now     = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1, lastDay - now.getDate() + 1);
}

// ── Load / save ───────────────────────────────────────────────

function freshState(): CreditState {
  return {
    month:              currentMonth(),
    monthlyBudget:      MONTHLY_BUDGET,
    hardBuffer:         HARD_BUFFER,
    lastKnownRemaining: null,
    lastUpdated:        null,
    dailyLog:           [],
  };
}

function loadState(): CreditState {
  if (!fs.existsSync(CREDIT_FILE)) return freshState();
  try {
    const state: CreditState = JSON.parse(fs.readFileSync(CREDIT_FILE, 'utf-8'));
    // Auto-reset when the calendar month rolls over
    if (state.month !== currentMonth()) return freshState();
    return state;
  } catch {
    return freshState();
  }
}

function saveState(state: CreditState): void {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(CREDIT_FILE, JSON.stringify(state, null, 2));
  } catch { /* non-fatal — credit tracking is advisory */ }
}

// ── Public: record an API response ───────────────────────────

/**
 * Call this every time an Odds API response comes in.
 * Pass the `x-requests-remaining` header value parsed as a number.
 * Stores the new remaining count and updates daily usage delta.
 */
export function recordApiResponse(remaining: number): void {
  const state    = loadState();
  const todayStr = today();

  // Ensure a daily entry exists for today
  let dayEntry = state.dailyLog.find(d => d.date === todayStr);
  if (!dayEntry) {
    dayEntry = {
      date:               todayStr,
      creditsAtDayStart:  state.lastKnownRemaining ?? remaining,
      creditsAtDayEnd:    null,
      estimatedUsed:      0,
    };
    state.dailyLog.push(dayEntry);
  }

  // Delta = credits consumed by the call that just completed
  if (state.lastKnownRemaining !== null && remaining < state.lastKnownRemaining) {
    dayEntry.estimatedUsed += (state.lastKnownRemaining - remaining);
  }
  dayEntry.creditsAtDayEnd = remaining;

  state.lastKnownRemaining = remaining;
  state.lastUpdated        = new Date().toISOString();

  saveState(state);
}

// ── Public: tier check ────────────────────────────────────────

/**
 * Returns the current budget tier based on last known remaining credits.
 * Returns GREEN if the remaining count has never been recorded (first run).
 */
export function getBudgetTier(): BudgetTier {
  const { lastKnownRemaining } = loadState();
  if (lastKnownRemaining === null) return 'GREEN';
  if (lastKnownRemaining <= HARD_STOP)    return 'RED';
  if (lastKnownRemaining <= SOFT_STOP)    return 'ORANGE';
  if (lastKnownRemaining <= WARN_THRESHOLD) return 'YELLOW';
  return 'GREEN';
}

/**
 * Returns true if a call of the given type is allowed under the current budget tier.
 *
 *   GREEN  → all call types allowed
 *   YELLOW → essential + standard allowed; optional blocked
 *   ORANGE → essential only
 *   RED    → everything blocked
 */
export function isBudgetAllowed(callType: CallType): boolean {
  const tier = getBudgetTier();
  if (tier === 'RED')    return false;
  if (tier === 'ORANGE') return callType === 'essential';
  if (tier === 'YELLOW') return callType !== 'optional';
  return true; // GREEN
}

// ── Public: daily stats ───────────────────────────────────────

export interface DailyStats {
  month:                  string;
  monthlyBudget:          number;
  lastKnownRemaining:     number | null;
  estimatedUsedThisMonth: number;
  usableRemaining:        number;   // remaining minus hard buffer
  daysLeft:               number;
  dailyTarget:            number;   // credits/day to exhaust usable budget by month-end
  todayUsed:              number;
  headroom:               number;   // today's unused allowance
  tier:                   BudgetTier;
}

/**
 * Returns current credit usage stats for display or decision-making.
 * headroom > 0 means there is budget to make additional optional calls today.
 */
export function getDailyStats(): DailyStats {
  const state              = loadState();
  const remaining          = state.lastKnownRemaining ?? MONTHLY_BUDGET;
  const usableRemaining    = Math.max(0, remaining - HARD_BUFFER);
  const daysLeft           = daysRemainingInMonth();
  const dailyTarget        = Math.floor(usableRemaining / daysLeft);

  const todayStr           = today();
  const todayEntry         = state.dailyLog.find(d => d.date === todayStr);
  const todayUsed          = todayEntry?.estimatedUsed ?? 0;
  const headroom           = Math.max(0, dailyTarget - todayUsed);

  return {
    month:                  state.month,
    monthlyBudget:          MONTHLY_BUDGET,
    lastKnownRemaining:     state.lastKnownRemaining,
    estimatedUsedThisMonth: MONTHLY_BUDGET - remaining,
    usableRemaining,
    daysLeft,
    dailyTarget,
    todayUsed,
    headroom,
    tier:                   getBudgetTier(),
  };
}

// ── Public: console output ────────────────────────────────────

/**
 * Prints a formatted credit status block to the console.
 * Call at the end of each scan to give full visibility.
 *
 * Example:
 *   ── CREDIT BUDGET ────────────────────────────────────
 *   [OK] Status           : GREEN
 *   Monthly budget        : 20,000 credits
 *   Remaining             : 18,350  (91% left)
 *   Used this month       : ~1,650  (9%)
 *   Days left             : 24
 *   Daily target          : 696 credits/day
 *   Today used            : 142  |  Headroom: 554
 *   Hard buffer           : 1,500  (never touched)
 */
export function printCreditStatus(): void {
  const stats   = getDailyStats();
  const tierTag = { GREEN: '[OK]  ', YELLOW: '[!]   ', ORANGE: '[!!]  ', RED: '[STOP]' }[stats.tier];

  const remaining  = stats.lastKnownRemaining;
  const usedPct    = remaining !== null
    ? Math.round(((MONTHLY_BUDGET - remaining) / MONTHLY_BUDGET) * 100)
    : 0;
  const leftPct    = 100 - usedPct;
  const used       = MONTHLY_BUDGET - (remaining ?? MONTHLY_BUDGET);

  console.log('\n  ── CREDIT BUDGET ────────────────────────────────');
  console.log(`  ${tierTag} Status           : ${stats.tier}`);
  console.log(`  Monthly budget    : ${stats.monthlyBudget.toLocaleString()} credits`);
  console.log(
    `  Remaining         : ${remaining !== null ? remaining.toLocaleString() : 'unknown'}` +
    (remaining !== null ? `  (${leftPct}% left)` : '')
  );
  console.log(`  Used this month   : ~${used.toLocaleString()}  (${usedPct}%)`);
  console.log(`  Days left         : ${stats.daysLeft}`);
  console.log(`  Daily target      : ${stats.dailyTarget.toLocaleString()} credits/day`);
  console.log(`  Today used        : ${stats.todayUsed.toLocaleString()}  |  Headroom: ${stats.headroom.toLocaleString()}`);
  console.log(`  Hard buffer       : ${HARD_BUFFER.toLocaleString()}  (never touched)`);

  if (stats.tier === 'YELLOW') {
    console.log(`  [!] Optional API calls will be skipped to protect budget.`);
  }
  if (stats.tier === 'ORANGE') {
    console.log(`  [!!] Low budget — only essential game-line calls are allowed.`);
  }
  if (stats.tier === 'RED') {
    console.log(`  [STOP] Budget exhausted — all API calls are blocked.`);
    console.log(`         Check usage at: https://the-odds-api.com/account`);
  }
  console.log('');
}
