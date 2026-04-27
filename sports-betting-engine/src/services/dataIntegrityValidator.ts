// ============================================================
// src/services/dataIntegrityValidator.ts
// Phase A — Data Integrity Validator.
//
// Runs BEFORE qualifyCandidates. Verifies that each candidate's
// matchup and team data corresponds to a real game in today's
// fetched event list.  Candidates that cannot be matched are
// discarded entirely — they never reach the qualification gate.
//
// Matching strategy (any match passes the candidate through):
//   1. Exact matchup string match (case-insensitive, normalised)
//   2. Both team last-word fragments appear in the candidate matchup
//   3. Props only — candidate.team matches a home or away team
//
// When todayEvents is empty (data source unavailable) all
// candidates are passed through rather than discarding the whole
// slate due to a missing feed.
//
// IMPORTANT:
//   - This is the ONLY step that discards candidates.
//   - Discarded candidates are logged individually as
//     data_integrity_error and counted in the summary.
//   - Valid candidates are passed downstream as-is (no clone needed).
// ============================================================

import { DecisionCandidate } from './decisionTypes';

// ============================================================
// Types
// ============================================================

export interface TodayEvent {
  matchup:  string;
  homeTeam: string;
  awayTeam: string;
  eventId?: string;
}

export interface ValidationResult {
  valid:      DecisionCandidate[];
  dropped:    number;
  droppedIds: string[];
}

// ============================================================
// Internal helpers
// ============================================================

/** Lowercase + collapse runs of whitespace. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Last word of a name — "Boston Celtics" → "celtics". */
function lastWord(s: string): string {
  return norm(s).split(' ').pop() ?? norm(s);
}

function candidateMatchesEvent(
  candidate: DecisionCandidate,
  event:     TodayEvent
): boolean {
  const cMatchup  = norm(candidate.matchup);
  const evMatchup = norm(event.matchup);
  const homeFull  = norm(event.homeTeam);
  const awayFull  = norm(event.awayTeam);
  const homeLast  = lastWord(event.homeTeam);
  const awayLast  = lastWord(event.awayTeam);

  // Rule 1: Exact matchup string
  if (cMatchup === evMatchup) return true;

  // Rule 2: Both team fragments appear in the candidate matchup string
  const homeHit = cMatchup.includes(homeLast) || cMatchup.includes(homeFull);
  const awayHit = cMatchup.includes(awayLast) || cMatchup.includes(awayFull);
  if (homeHit && awayHit) return true;

  // Rule 3: Props — candidate.team belongs to one of today's sides
  if (candidate.marketType === 'player_prop' && candidate.team) {
    const cTeam     = norm(candidate.team);
    const cTeamLast = lastWord(candidate.team);
    const matchesHome =
      homeFull.includes(cTeam) || cTeam.includes(homeFull) ||
      homeLast === cTeamLast;
    const matchesAway =
      awayFull.includes(cTeam) || cTeam.includes(awayFull) ||
      awayLast === cTeamLast;
    if (matchesHome || matchesAway) return true;
  }

  return false;
}

function isValid(
  candidate:   DecisionCandidate,
  todayEvents: TodayEvent[]
): boolean {
  // No event list available — pass all candidates rather than
  // silently dropping the entire slate.
  if (todayEvents.length === 0) return true;
  return todayEvents.some(ev => candidateMatchesEvent(candidate, ev));
}

// ============================================================
// Public API
// ============================================================

/**
 * Filters candidates to those verifiable against today's event list.
 *
 * Returns:
 *   valid      — candidates matched to a known event (passed downstream)
 *   dropped    — count of discarded candidates
 *   droppedIds — id strings of discarded candidates
 *
 * Input candidates are not cloned; valid[] contains original references.
 */
export function validateDataIntegrity(
  candidates:  DecisionCandidate[],
  todayEvents: TodayEvent[]
): ValidationResult {
  const valid:      DecisionCandidate[] = [];
  const droppedIds: string[]            = [];

  for (const candidate of candidates) {
    if (isValid(candidate, todayEvents)) {
      valid.push(candidate);
    } else {
      droppedIds.push(candidate.id);
    }
  }

  return {
    valid,
    dropped:    droppedIds.length,
    droppedIds,
  };
}

/**
 * Logs a [VALIDATION] summary line plus individual error entries
 * for any discarded candidates.
 *
 * Example output:
 *   [VALIDATION] dropped: 2 (data integrity) | valid: 18
 *     → data_integrity_error: Chicago Bulls vs Celtics__Spread__Bulls -3
 *     → data_integrity_error: ...
 */
export function printValidationSummary(result: ValidationResult): void {
  console.log(
    `  [VALIDATION] dropped: ${result.dropped} (data integrity) | ` +
    `valid: ${result.valid.length}`
  );
  for (const id of result.droppedIds) {
    console.log(`    → data_integrity_error: ${id}`);
  }
}
