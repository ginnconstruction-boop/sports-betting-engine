// ============================================================
// src/api/oddsApiClient.ts
// Single source of truth for all Odds API requests
// On-demand only -- no polling, no schedulers
// ============================================================

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as dotenv from 'dotenv';
import { RawEvent, RawApiResponse, MarketKey, QuotaUsage, CacheEntry } from '../types/odds';
import { logger } from '../utils/logger';
import { recordApiResponse, isBudgetAllowed, getBudgetTier } from '../services/creditTracker';

dotenv.config();

const BASE_URL = 'https://api.the-odds-api.com/v4';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '10000', 10);
const CACHE_WINDOW_MS =
  parseInt(process.env.CACHE_WINDOW_MINUTES || '5', 10) * 60 * 1000;

// In-memory cache -- keyed by sportKey
const cache = new Map<string, CacheEntry>();

// Quota tracker for this process session
let sessionQuota: QuotaUsage = {
  requestsMade: 0,
  remainingRequests: null,
  usedRequests: null,
};

// ------------------------------------
// Axios instance
// ------------------------------------

function createClient(): AxiosInstance {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    throw new Error('ODDS_API_KEY is not set in environment variables.');
  }

  return axios.create({
    baseURL: BASE_URL,
    timeout: DEFAULT_TIMEOUT_MS,
    params: {
      apiKey,
    },
  });
}

// ------------------------------------
// Header parsing
// ------------------------------------

function parseQuotaHeaders(headers: Record<string, string>): Partial<QuotaUsage> {
  const remaining = headers['x-requests-remaining'];
  const used = headers['x-requests-used'];
  return {
    remainingRequests: remaining ? parseInt(remaining, 10) : null,
    usedRequests: used ? parseInt(used, 10) : null,
  };
}

function updateSessionQuota(partial: Partial<QuotaUsage>): void {
  sessionQuota.requestsMade += 1;
  if (partial.remainingRequests !== null && partial.remainingRequests !== undefined) {
    sessionQuota.remainingRequests = partial.remainingRequests;
    // Feed into monthly credit tracker so budget tiers stay current
    recordApiResponse(partial.remainingRequests);
  }
  if (partial.usedRequests !== null && partial.usedRequests !== undefined) {
    sessionQuota.usedRequests = partial.usedRequests;
  }
}

// ------------------------------------
// Retry logic
// ------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        // Don't retry on auth errors or quota exceeded
        if (status === 401 || status === 403 || status === 422 || status === 429) {
          throw err;
        }
      }
      if (attempt < retries) {
        logger.warn(`Request failed, retrying in ${delayMs}ms... (attempt ${attempt + 1}/${retries})`);
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }
  throw lastError;
}

// ------------------------------------
// Error handler
// ------------------------------------

function handleApiError(err: unknown, context: string): never {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data;

    if (status === 401 || status === 403) {
      throw new Error(`[${context}] Invalid or unauthorized API key. Check ODDS_API_KEY.`);
    }
    if (status === 429) {
      throw new Error(`[${context}] Quota exceeded. Remaining: ${sessionQuota.remainingRequests ?? 'unknown'}`);
    }
    if (status === 422) {
      throw new Error(`[${context}] Unsupported request parameters: ${JSON.stringify(data)}`);
    }
    if (status === 404) {
      throw new Error(`[${context}] Resource not found (sport may be out of season or invalid key).`);
    }
    if (err.code === 'ECONNABORTED') {
      throw new Error(`[${context}] Request timed out after ${DEFAULT_TIMEOUT_MS}ms.`);
    }

    throw new Error(`[${context}] API error ${status}: ${JSON.stringify(data)}`);
  }
  throw new Error(`[${context}] Unexpected error: ${String(err)}`);
}

// ------------------------------------
// Public API
// ------------------------------------

/**
 * Fetch list of active sports from the API.
 * Used for validation and dynamic sport discovery.
 */
export async function getActiveSports(): Promise<unknown[]> {
  const client = createClient();
  try {
    const response: AxiosResponse = await withRetry(() =>
      client.get('/sports', { params: { all: false } })
    );
    const quota = parseQuotaHeaders(response.headers as Record<string, string>);
    updateSessionQuota(quota);
    logger.debug('Active sports fetched', { count: response.data?.length });
    return response.data ?? [];
  } catch (err) {
    handleApiError(err, 'getActiveSports');
  }
}

/**
 * Fetch odds for a single sport.
 * Respects cache window -- set forceRefresh=true to bypass.
 *
 * NOTE: Player prop markets are NOT included here by default.
 * Props must be explicitly passed in the markets array.
 */
export async function getOddsBySport(
  sportKey: string,
  markets: MarketKey[] = ['h2h', 'spreads', 'totals'],
  regions = 'us',
  oddsFormat = 'american',
  bookmakers?: string,
  forceRefresh = false
): Promise<{ events: RawEvent[]; quota: QuotaUsage }> {

  // Cache check
  if (!forceRefresh) {
    const cached = cache.get(sportKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_WINDOW_MS) {
      const ageSeconds = Math.round((Date.now() - cached.fetchedAt) / 1000);
      logger.info(`[CACHE HIT] ${sportKey} -- using cached data (${ageSeconds}s old)`);
      return { events: cached.data, quota: sessionQuota };
    }
  }

  const client = createClient();

  const params: Record<string, string> = {
    regions,
    markets: markets.join(','),
    oddsFormat,
  };

  if (bookmakers) {
    params.bookmakers = bookmakers;
  }

  logger.info(`[FETCH] ${sportKey} -- markets: ${markets.join(', ')}`);

  try {
    const response: AxiosResponse = await withRetry(() =>
      client.get(`/sports/${sportKey}/odds`, { params })
    );

    const quota = parseQuotaHeaders(response.headers as Record<string, string>);
    updateSessionQuota(quota);

    const events: RawEvent[] = response.data ?? [];

    // Store in cache
    cache.set(sportKey, {
      data: events,
      fetchedAt: Date.now(),
      sportKey,
    });

    logger.info(
      `[FETCH OK] ${sportKey} -- ${events.length} events | ` +
      `Remaining quota: ${sessionQuota.remainingRequests ?? 'unknown'}`
    );

    return { events, quota: { ...sessionQuota } };
  } catch (err) {
    handleApiError(err, `getOddsBySport(${sportKey})`);
  }
}

/**
 * Fetch odds for multiple sports in sequence.
 * Each sport is fetched ONCE -- no duplicates within a run.
 * Failed sports are logged and skipped without breaking the run.
 */
export async function getOddsForAllSports(
  sportKeys: string[],
  markets: MarketKey[] = ['h2h', 'spreads', 'totals'],
  forceRefresh = false
): Promise<{
  results: Map<string, RawEvent[]>;
  errors: Map<string, string>;
  quota: QuotaUsage;
}> {
  const results = new Map<string, RawEvent[]>();
  const errors = new Map<string, string>();

  for (const sportKey of sportKeys) {
    try {
      const { events } = await getOddsBySport(
        sportKey,
        markets,
        'us',
        'american',
        undefined,
        forceRefresh
      );
      results.set(sportKey, events);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[SKIP] ${sportKey} -- ${message}`);
      errors.set(sportKey, message);
    }
  }

  logger.info(
    `[BATCH DONE] ${results.size} sports fetched, ${errors.size} failed | ` +
    `Session requests made: ${sessionQuota.requestsMade} | ` +
    `Remaining quota: ${sessionQuota.remainingRequests ?? 'unknown'}`
  );

  return { results, errors, quota: { ...sessionQuota } };
}

/**
 * Fetch detailed markets for a specific event.
 * Use for targeted prop or alternate line pulls -- credit-expensive.
 * Blocked when budget tier is ORANGE or RED (standard call type).
 */
export async function getEventMarkets(
  sportKey: string,
  eventId: string,
  markets: MarketKey[],
  bookmakers?: string,
  oddsFormat = 'american'
): Promise<{ event: RawEvent | null; quota: QuotaUsage }> {
  // Budget guard — props are a 'standard' call, blocked in ORANGE/RED
  if (!isBudgetAllowed('standard')) {
    const tier = getBudgetTier();
    logger.warn(`[BUDGET GUARD] getEventMarkets blocked — tier: ${tier}. Skipping ${sportKey}/${eventId}`);
    return { event: null, quota: { ...sessionQuota } };
  }

  const client = createClient();

  const params: Record<string, string> = {
    regions: 'us',
    markets: markets.join(','),
    oddsFormat,
  };

  if (bookmakers) {
    params.bookmakers = bookmakers;
  }

  logger.info(`[EVENT FETCH] ${sportKey}/${eventId} -- markets: ${markets.join(', ')}`);

  try {
    const response: AxiosResponse = await withRetry(() =>
      client.get(`/sports/${sportKey}/events/${eventId}/odds`, { params })
    );

    const quota = parseQuotaHeaders(response.headers as Record<string, string>);
    updateSessionQuota(quota);

    logger.info(
      `[EVENT FETCH OK] ${eventId} | Remaining quota: ${sessionQuota.remainingRequests ?? 'unknown'}`
    );

    return { event: response.data ?? null, quota: { ...sessionQuota } };
  } catch (err) {
    handleApiError(err, `getEventMarkets(${sportKey}/${eventId})`);
  }
}

// ============================================================
// Upcoming events (FREE — 0 credits)
// ============================================================

export interface UpcomingEvent {
  id:           string;
  sportKey:     string;
  commenceTime: string;
  homeTeam:     string;
  awayTeam:     string;
}

/**
 * Fetch upcoming event IDs for a sport WITHOUT pulling odds.
 * Cost: 0 credits.  Use to discover events before deciding which
 * ones to spend credits on (e.g., only pull props for events
 * starting within the next 6 hours).
 *
 * Endpoint: GET /v4/sports/{sport}/events
 */
export async function getUpcomingEvents(sportKey: string): Promise<UpcomingEvent[]> {
  const client = createClient();
  logger.info(`[EVENTS] ${sportKey} — fetching upcoming events (free)`);
  try {
    const response: AxiosResponse = await withRetry(() =>
      client.get(`/sports/${sportKey}/events`, {
        params: { regions: 'us', oddsFormat: 'american' },
      })
    );
    const quota = parseQuotaHeaders(response.headers as Record<string, string>);
    updateSessionQuota(quota);

    const raw: any[] = response.data ?? [];
    return raw.map(e => ({
      id:           e.id,
      sportKey:     e.sport_key,
      commenceTime: e.commence_time,
      homeTeam:     e.home_team,
      awayTeam:     e.away_team,
    }));
  } catch (err) {
    handleApiError(err, `getUpcomingEvents(${sportKey})`);
  }
}

// ============================================================
// Completed scores (2 credits per sport per call)
// ============================================================

export interface CompletedScore {
  id:           string;   // matches event ID used throughout the app
  sportKey:     string;
  commenceTime: string;
  completed:    boolean;
  homeTeam:     string;
  awayTeam:     string;
  homeScore:    number;
  awayScore:    number;
}

/**
 * Fetch completed game scores for a sport.
 * Cost: 2 credits per call regardless of daysFrom value.
 * daysFrom=3 covers games from the last 3 days (weekend catch-up).
 *
 * Returns only completed events with valid non-zero scores.
 * The id field matches the event IDs stored by the scan pipeline,
 * enabling exact-match grading without fuzzy team-name logic.
 *
 * Endpoint: GET /v4/sports/{sport}/scores?daysFrom={n}
 */
export async function getCompletedScores(
  sportKey: string,
  daysFrom: number = 3
): Promise<CompletedScore[]> {
  // Essential call — needed for pick grading; allowed unless RED
  if (!isBudgetAllowed('essential')) {
    const tier = getBudgetTier();
    logger.warn(`[BUDGET GUARD] getCompletedScores blocked — tier: ${tier}`);
    return [];
  }

  const client = createClient();
  logger.info(`[SCORES] ${sportKey} — daysFrom: ${daysFrom}  (~2 credits)`);

  try {
    const response: AxiosResponse = await withRetry(() =>
      client.get(`/sports/${sportKey}/scores`, {
        params: { daysFrom },
      })
    );
    const quota = parseQuotaHeaders(response.headers as Record<string, string>);
    updateSessionQuota(quota);

    logger.info(
      `[SCORES OK] ${sportKey} — remaining quota: ${sessionQuota.remainingRequests ?? 'unknown'}`
    );

    const raw: any[] = response.data ?? [];
    const results: CompletedScore[] = [];

    for (const e of raw) {
      if (!e.completed) continue;

      const scores: Array<{ name: string; score: string }> = e.scores ?? [];
      if (scores.length < 2) continue;

      // Map scores to home/away — the array order isn't guaranteed; match by team name
      const homeEntry = scores.find(
        s => (s.name ?? '').toLowerCase() === (e.home_team ?? '').toLowerCase()
      ) ?? scores[0];
      const awayEntry = scores.find(
        s => (s.name ?? '').toLowerCase() === (e.away_team ?? '').toLowerCase()
      ) ?? scores[1];

      const homeScore = parseFloat(homeEntry?.score ?? '0');
      const awayScore = parseFloat(awayEntry?.score ?? '0');

      // Skip 0-0 (game not yet complete or data missing)
      if (homeScore === 0 && awayScore === 0) continue;

      results.push({
        id:           e.id,
        sportKey:     e.sport_key,
        commenceTime: e.commence_time,
        completed:    true,
        homeTeam:     e.home_team,
        awayTeam:     e.away_team,
        homeScore,
        awayScore,
      });
    }

    logger.info(`[SCORES] ${sportKey} — ${results.length} completed games found`);
    return results;
  } catch (err) {
    handleApiError(err, `getCompletedScores(${sportKey})`);
  }
}

/**
 * Get the current session quota snapshot.
 */
export function getSessionQuota(): QuotaUsage {
  return { ...sessionQuota };
}

/**
 * Returns the number of sport keys not currently satisfied by the in-memory
 * cache.  Use this before guard.spend() so credits reflect real API usage
 * rather than theoretical worst-case.
 */
export function countUncachedSports(sportKeys: string[]): number {
  return sportKeys.filter(sk => {
    const entry = cache.get(sk);
    return !entry || Date.now() - entry.fetchedAt >= CACHE_WINDOW_MS;
  }).length;
}

/**
 * Clear the in-memory cache for a sport (or all sports).
 */
export function clearCache(sportKey?: string): void {
  if (sportKey) {
    cache.delete(sportKey);
    logger.debug(`Cache cleared for ${sportKey}`);
  } else {
    cache.clear();
    logger.debug('Full cache cleared');
  }
}
