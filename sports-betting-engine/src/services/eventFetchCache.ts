// ============================================================
// src/services/eventFetchCache.ts
// Zero-credit event discovery cache — wraps getUpcomingEvents().
//
// Problem this solves:
//   getOddsForAllSports() fetches odds for every enabled sport, spending
//   ~1 credit per sport even when a sport is off-season or has no games
//   in the relevant time window.
//
//   GET /v4/sports/{sport}/events costs 0 credits.  Calling it first for
//   every sport lets us skip the credit-bearing odds call entirely for
//   sports with no upcoming games.
//
// How to use (in a scan runner):
//
//   const eventCache = new EventFetchCache();
//   await eventCache.prefetch(sportKeys);
//
//   // Only pull odds for sports that actually have games soon
//   const activeSports = eventCache.filterActive(sportKeys, windowHours);
//   const { results } = await getOddsForAllSports(activeSports, ...);
//
//   // Later, check eligibility before a credit-bearing per-event call
//   if (eventCache.hasEventsInWindow(sportKey, 6)) { ... }
//
// Cache TTL: 10 minutes (event schedules don't change frequently;
//            no need to refetch within a single run).
// ============================================================

import { getUpcomingEvents, UpcomingEvent } from '../api/oddsApiClient';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EventWindowSummary {
  sportKey:    string;
  totalEvents: number;
  /** Events whose commenceTime is within the next windowHours. */
  inWindowEvents: UpcomingEvent[];
  /** True when at least 1 event is within the window. */
  hasActiveGames: boolean;
}

// ── Cache entry ───────────────────────────────────────────────────────────────

interface CacheEntry {
  events:    UpcomingEvent[];
  fetchedAt: number;
}

// ── EventFetchCache class ─────────────────────────────────────────────────────

/**
 * Instantiate once per run in the scan runner (before any odds call).
 * All methods are synchronous after prefetch() completes.
 */
export class EventFetchCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(options: { ttlMs?: number } = {}) {
    this.ttlMs = options.ttlMs ?? CACHE_TTL_MS;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private isFresh(entry: CacheEntry): boolean {
    return Date.now() - entry.fetchedAt < this.ttlMs;
  }

  private hoursUntil(iso: string): number {
    return (new Date(iso).getTime() - Date.now()) / 3_600_000;
  }

  // ── Public: prefetch ────────────────────────────────────────────────────────

  /**
   * Fetch upcoming events for all sportKeys that aren't already cached.
   * Cost: 0 credits per sport.  Fetches sequentially to avoid hammering
   * the API; each call is fast (~100ms) since no odds data is returned.
   *
   * Failed sports are silently skipped — a fetch error for one sport
   * should never block the rest of the run.
   */
  async prefetch(sportKeys: string[]): Promise<void> {
    const needed = sportKeys.filter(sk => {
      const entry = this.cache.get(sk);
      return !entry || !this.isFresh(entry);
    });

    if (needed.length === 0) return;

    const results = await Promise.allSettled(
      needed.map(sk =>
        getUpcomingEvents(sk)
          .then(events => ({ sk, events }))
          .catch(() => ({ sk, events: [] as UpcomingEvent[] }))
      )
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        this.cache.set(r.value.sk, {
          events:    r.value.events,
          fetchedAt: Date.now(),
        });
      }
    }
  }

  // ── Public: query ────────────────────────────────────────────────────────────

  /**
   * Returns all cached events for a sport.
   * Returns empty array if the sport was never fetched or errored.
   */
  getEvents(sportKey: string): UpcomingEvent[] {
    return this.cache.get(sportKey)?.events ?? [];
  }

  /**
   * Returns events whose commenceTime is within the next windowHours.
   * windowHours = 0 means "any future event".
   */
  getEventsInWindow(sportKey: string, windowHours: number): UpcomingEvent[] {
    const events = this.getEvents(sportKey);
    if (windowHours <= 0) {
      return events.filter(e => this.hoursUntil(e.commenceTime) > 0);
    }
    return events.filter(e => {
      const h = this.hoursUntil(e.commenceTime);
      return h > 0 && h <= windowHours;
    });
  }

  /**
   * Returns true when a sport has at least one event starting within
   * windowHours.  Used to skip credit-bearing calls for off-season sports.
   */
  hasEventsInWindow(sportKey: string, windowHours: number): boolean {
    return this.getEventsInWindow(sportKey, windowHours).length > 0;
  }

  /**
   * Filters a list of sportKeys down to only those with at least one
   * event in the next windowHours.
   *
   * This is the primary integration point in scan runners:
   *
   *   const activeSports = eventCache.filterActive(sportKeys, 24);
   *   // activeSports has no off-season sports → no wasted credits
   *   await getOddsForAllSports(activeSports, ...);
   *
   * If a sport was never fetched (prefetch skipped or errored), it is
   * INCLUDED by default — conservative: don't skip sports we can't confirm.
   */
  filterActive(sportKeys: string[], windowHours: number): string[] {
    return sportKeys.filter(sk => {
      const entry = this.cache.get(sk);
      // Not in cache → include (safe fallback: pull odds for unknowns)
      if (!entry || !this.isFresh(entry)) return true;
      // In cache → include only if there are games in window
      return this.hasEventsInWindow(sk, windowHours);
    });
  }

  /**
   * Returns a window summary for each sport — useful for print output
   * and deciding whether to spend credits on secondary data.
   */
  summarize(sportKeys: string[], windowHours: number): EventWindowSummary[] {
    return sportKeys.map(sk => {
      const events       = this.getEvents(sk);
      const inWindowEvts = this.getEventsInWindow(sk, windowHours);
      return {
        sportKey:       sk,
        totalEvents:    events.length,
        inWindowEvents: inWindowEvts,
        hasActiveGames: inWindowEvts.length > 0,
      };
    });
  }

  /**
   * Prints a compact event-coverage summary to console.
   * Called at the top of a scan to confirm which sports have games.
   */
  printSummary(sportKeys: string[], windowHours: number): void {
    const summaries = this.summarize(sportKeys, windowHours);
    const active   = summaries.filter(s => s.hasActiveGames);
    const skipped  = summaries.filter(s => !s.hasActiveGames && this.cache.has(s.sportKey));
    const unknown  = summaries.filter(s => !this.cache.has(s.sportKey));

    console.log(
      `  [EVENTS] ${active.length} sports with games in next ${windowHours}h` +
      (skipped.length > 0 ? ` | ${skipped.length} off-season (skipping odds call)` : '') +
      (unknown.length > 0 ? ` | ${unknown.length} unverified (included)` : '')
    );

    for (const s of active) {
      const nextGame = s.inWindowEvents[0];
      const h = nextGame ? ((new Date(nextGame.commenceTime).getTime() - Date.now()) / 3_600_000).toFixed(1) : '?';
      console.log(`    ${s.sportKey.padEnd(32)} ${s.inWindowEvents.length} game(s) — next in ~${h}h`);
    }
    if (skipped.length > 0) {
      console.log(`    Skipped (no games): ${skipped.map(s => s.sportKey).join(', ')}`);
    }
  }
}
