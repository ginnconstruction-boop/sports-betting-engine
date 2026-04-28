// ============================================================
// src/services/creditBudgetGuard.ts
// Per-run and per-day hard-cap layer on top of creditTracker.ts
//
// creditTracker handles:
//   - monthly budget (20,000 credits)
//   - tier system: GREEN / YELLOW / ORANGE / RED
//   - advisory daily-target / headroom
//
// CreditBudgetGuard adds:
//   - per-run hard cap  (default: 200 credits)
//   - per-day hard cap  (default: 500 credits, persisted in guard_day.json)
//   - canSpend() / spend() API with typed cost categories
//   - deterministic reason codes on every blocked call
//
// Usage (in a scan runner):
//   const guard = new CreditBudgetGuard();
//   const check = guard.canSpend('odds', sportKeys.length);
//   if (!check.allowed) { console.log(`Skipped: ${check.reason}`); return; }
//   guard.spend('odds', sportKeys.length);
//   const results = await getOddsForAllSports(sportKeys, ...);
// ============================================================

import * as fs   from 'fs';
import * as path from 'path';
import { getBudgetTier, getDailyStats, isBudgetAllowed } from './creditTracker';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const GUARD_FILE   = path.join(SNAPSHOT_DIR, 'guard_day.json');

// ── Cost table (credits per call, per sport/item) ─────────────────────────────
// Based on The Odds API pricing (conservative estimates):
//   events   = 0  — free endpoint, no credits consumed
//   odds     = 1  — standard game-line odds, ~1 credit per sport
//   scores   = 2  — score lookups, 2 credits per sport
//   props    = 4  — player-prop markets, ~4 credits per sport (estimated)
//   injuries = 1  — ESPN injury scraper costs are minimal; tracked for visibility
//   news     = 1  — news endpoint, ~1 credit per call
export const CREDIT_COSTS: Record<CreditCostType, number> = {
  events:   0,
  odds:     1,
  scores:   2,
  props:    4,
  injuries: 1,
  news:     1,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type CreditCostType =
  | 'events'
  | 'odds'
  | 'props'
  | 'scores'
  | 'injuries'
  | 'news';

export type GuardBlockReason =
  | 'credit_budget_exhausted'        // monthly tier = RED
  | 'run_credit_budget_exhausted'    // this run has hit maxCreditsPerRun
  | 'daily_credit_budget_exhausted'  // today has hit maxCreditsPerDay
  | 'nonessential_call_skipped';     // tier YELLOW/ORANGE blocks optional/standard calls

export interface CreditBudgetDecision {
  /** Whether this call is allowed. */
  allowed:       boolean;
  /** Reason code when allowed = false. */
  reason?:       GuardBlockReason;
  /** Estimated credits this call would consume. */
  estimatedCost: number;
  /** Credits already spent by the current run at check time. */
  runSpentSoFar: number;
  /** Credits already spent today (guard counter) at check time. */
  daySpentSoFar: number;
}

export interface GuardOptions {
  /** Hard cap on credits spent within a single run. Default: 200. */
  maxCreditsPerRun?: number;
  /** Hard cap on credits spent in a calendar day. Default: 500. */
  maxCreditsPerDay?: number;
}

export interface GuardSnapshot {
  runSpent:     number;
  runCap:       number;
  daySpent:     number;
  dayCap:       number;
  tier:         string;
  headroom:     number;
  dailyTarget:  number;
}

// ── Internal persistence for per-day counter ──────────────────────────────────

interface GuardDayState {
  date:         string;   // 'YYYY-MM-DD'
  creditsSpent: number;   // guard-counted spend, resets each day
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadGuardDay(): GuardDayState {
  try {
    if (!fs.existsSync(GUARD_FILE)) return { date: todayStr(), creditsSpent: 0 };
    const raw = JSON.parse(fs.readFileSync(GUARD_FILE, 'utf-8')) as GuardDayState;
    // Reset if a new calendar day has started
    if (raw.date !== todayStr()) return { date: todayStr(), creditsSpent: 0 };
    return raw;
  } catch {
    return { date: todayStr(), creditsSpent: 0 };
  }
}

function saveGuardDay(state: GuardDayState): void {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(GUARD_FILE, JSON.stringify(state, null, 2));
  } catch { /* non-fatal — guard is advisory, never blocks on I/O error */ }
}

// ── CreditBudgetGuard class ───────────────────────────────────────────────────

/**
 * Instantiate once per run (in the command file, before any API calls).
 * Use canSpend() to check, spend() to register, snapshot() to inspect.
 */
export class CreditBudgetGuard {
  private readonly maxPerRun: number;
  private readonly maxPerDay: number;
  private runSpent = 0;

  constructor(options: GuardOptions = {}) {
    this.maxPerRun = options.maxCreditsPerRun ?? 200;
    this.maxPerDay = options.maxCreditsPerDay ?? 500;
  }

  /**
   * Check whether a call is allowed. Does NOT register spend.
   *
   * @param type   - Category of API call being made
   * @param count  - Number of sports / items in the call (default: 1)
   * @returns CreditBudgetDecision with allowed flag and reason code
   */
  canSpend(type: CreditCostType, count = 1): CreditBudgetDecision {
    const estimatedCost = CREDIT_COSTS[type] * count;
    const dayState      = loadGuardDay();

    const decide = (
      allowed: boolean,
      reason?: GuardBlockReason
    ): CreditBudgetDecision => ({
      allowed,
      reason,
      estimatedCost,
      runSpentSoFar: this.runSpent,
      daySpentSoFar: dayState.creditsSpent,
    });

    // 1. Monthly tier check (RED = hard stop)
    const tier = getBudgetTier();
    if (tier === 'RED') {
      return decide(false, 'credit_budget_exhausted');
    }

    // 2. Per-run hard cap
    if (this.runSpent + estimatedCost > this.maxPerRun) {
      return decide(false, 'run_credit_budget_exhausted');
    }

    // 3. Per-day hard cap
    if (dayState.creditsSpent + estimatedCost > this.maxPerDay) {
      return decide(false, 'daily_credit_budget_exhausted');
    }

    // 4. Tier-based call-type gating (YELLOW/ORANGE block optional/standard calls)
    //    Map credit cost types to the urgency levels creditTracker understands.
    const urgencyMap: Record<CreditCostType, 'essential' | 'standard' | 'optional'> = {
      events:   'essential',
      odds:     'essential',
      scores:   'standard',
      props:    'optional',
      injuries: 'standard',
      news:     'optional',
    };
    if (!isBudgetAllowed(urgencyMap[type])) {
      return decide(false, 'nonessential_call_skipped');
    }

    return decide(true);
  }

  /**
   * Register credits as spent. Call this after canSpend() returns allowed=true
   * and BEFORE the API call goes out (so the budget is reserved even if the
   * call throws).
   *
   * @param type   - Category of API call
   * @param count  - Number of sports / items in the call (default: 1)
   */
  spend(type: CreditCostType, count = 1): void {
    const cost     = CREDIT_COSTS[type] * count;
    this.runSpent += cost;
    const dayState = loadGuardDay();
    dayState.creditsSpent += cost;
    saveGuardDay(dayState);
  }

  /**
   * Returns a read-only snapshot of the guard's current state.
   * Safe to call at any time; does not mutate any state.
   */
  snapshot(): GuardSnapshot {
    const dayState = loadGuardDay();
    const stats    = getDailyStats();
    return {
      runSpent:    this.runSpent,
      runCap:      this.maxPerRun,
      daySpent:    dayState.creditsSpent,
      dayCap:      this.maxPerDay,
      tier:        getBudgetTier(),
      headroom:    stats.headroom,
      dailyTarget: stats.dailyTarget,
    };
  }

  /**
   * Prints a compact guard status line to console.
   * Intended as a one-liner appended to the existing printCreditStatus() block.
   */
  printStatus(): void {
    const snap = this.snapshot();
    console.log(`  ── CREDIT GUARD ──────────────────────────────────`);
    console.log(`  Tier              : ${snap.tier}`);
    console.log(`  Run spend         : ${snap.runSpent} / ${snap.runCap}  (run cap)`);
    console.log(`  Day spend (guard) : ${snap.daySpent} / ${snap.dayCap}  (day cap)`);
    console.log(`  Daily headroom    : ${snap.headroom} credits toward target (${snap.dailyTarget}/day)`);
    console.log('');
  }
}
