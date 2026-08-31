import { getUpcomingEvents, getEventMarkets, UpcomingEvent } from '../api/oddsApiClient';
import { RawEvent, QuotaUsage } from '../types/odds';
import { NFL } from '../config/productionFocus';
import { NFL_MARKET_GROUPS, NFL_BOARD_WINDOW_DAYS, isNflMarketGroup } from '../config/nflMarkets';

export interface MarketQuote {
  market: string; participant: string; side: string; line: number | null;
  price: number; book: string; bookKey: string; updatedAt: string | null; stale: boolean;
}

export function flattenNflQuotes(event: RawEvent, requested: readonly string[], now = Date.now()): MarketQuote[] {
  const rows: MarketQuote[] = [];
  for (const book of event.bookmakers ?? []) {
    for (const market of book.markets ?? []) {
      if (!requested.includes(market.key)) continue;
      const updatedAt = market.last_update || book.last_update || null;
      const timestamp = Date.parse(updatedAt ?? '');
      for (const outcome of market.outcomes ?? []) {
        if (!Number.isFinite(outcome.price) || Math.abs(outcome.price) < 100) continue;
        if (outcome.point != null && !Number.isFinite(outcome.point)) continue;
        rows.push({
          market: market.key, participant: outcome.description ?? '', side: outcome.name,
          line: outcome.point ?? null, price: outcome.price, book: book.title, bookKey: book.key,
          updatedAt, stale: !Number.isFinite(timestamp) || now - timestamp > 15 * 60_000 || timestamp > now + 60_000,
        });
      }
    }
  }
  return rows.sort((a, b) => a.market.localeCompare(b.market) || a.participant.localeCompare(b.participant)
    || a.side.localeCompare(b.side) || (a.line ?? 0) - (b.line ?? 0) || b.price - a.price);
}

export class MarketBoardError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type Dependencies = {
  upcoming: () => Promise<UpcomingEvent[]>;
  odds: (eventId: string, markets: string[]) => Promise<{ event: RawEvent | null; quota: QuotaUsage }>;
  now: () => number;
};

// On demand only. No polling, full-season pulls, synthesized odds, or pick-log writes.
export class NflMarketBoard {
  private eventCache: { items: UpcomingEvent[]; at: number } | null = null;
  private eventRequest: Promise<UpcomingEvent[]> | null = null;
  private cache = new Map<string, { at: number; data: any }>();
  private inFlight = new Map<string, Promise<any>>();
  constructor(private deps: Dependencies = {
    upcoming: () => getUpcomingEvents(NFL),
    odds: (eventId, markets) => getEventMarkets(NFL, eventId, markets),
    now: () => Date.now(),
  }) {}

  async events(): Promise<UpcomingEvent[]> {
    const now = this.deps.now();
    if (!this.eventCache || now - this.eventCache.at >= 60_000) {
      if (!this.eventRequest) {
        this.eventRequest = this.deps.upcoming().then(items => {
          this.eventCache = { items, at: this.deps.now() };
          return items;
        }).finally(() => { this.eventRequest = null; });
      }
      await this.eventRequest;
    }
    const cutoff = this.deps.now() + NFL_BOARD_WINDOW_DAYS * 86400_000;
    return this.eventCache.items.filter(e => e.sportKey === NFL
      && Date.parse(e.commenceTime) > this.deps.now() && Date.parse(e.commenceTime) <= cutoff)
      .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  }

  async quotes(eventId: string, group: string) {
    if (!isNflMarketGroup(group)) throw new MarketBoardError('Unknown NFL market group.');
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(eventId)) throw new MarketBoardError('Invalid event ID.');
    const event = (await this.events()).find(e => e.id === eventId);
    if (!event) throw new MarketBoardError('Select an upcoming NFL game in the next 14 days. Started games are excluded.');
    const key = `${eventId}:${group}`;
    const now = this.deps.now();
    for (const [oldKey, entry] of this.cache) if (now - entry.at >= 5 * 60_000) this.cache.delete(oldKey);
    const cached = this.cache.get(key);
    if (cached) return { ...cached.data, cached: true };
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    if (this.inFlight.size) throw new MarketBoardError('Another market request is running. Please wait before loading another category.', 409);
    const request = this.fetch(event, group).finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, request);
    return request;
  }

  private async fetch(event: UpcomingEvent, group: keyof typeof NFL_MARKET_GROUPS) {
    const spec = NFL_MARKET_GROUPS[group];
    const result = await this.deps.odds(event.id, [...spec.markets]);
    if (!result.event) throw new MarketBoardError('Market request was blocked by the credit budget or returned no event. No recommendation was generated.', 503);
    if (result.event.id !== event.id || result.event.sport_key !== NFL
      || result.event.home_team !== event.homeTeam || result.event.away_team !== event.awayTeam
      || !Number.isFinite(Date.parse(result.event.commence_time))) throw new MarketBoardError('Provider returned a mismatched event.', 502);
    if (Date.parse(result.event.commence_time) <= this.deps.now()) throw new MarketBoardError('The game has started. Pregame market request discarded.', 409);
    const quotes = flattenNflQuotes(result.event, spec.markets, this.deps.now());
    const returned = new Set(quotes.map(q => q.market));
    const data = {
      event, group, label: spec.label, fetchedAt: new Date(this.deps.now()).toISOString(),
      quotes, missingMarkets: spec.markets.filter(m => !returned.has(m)),
      remainingCredits: result.quota.remainingRequests, cached: false,
      status: quotes.length ? 'quotes_available' : 'not_posted',
      note: 'Bookmaker quotes only — not model picks, guaranteed availability, or validated edges. Quarter/half markets are not auto-graded. Check settlement rules and final price at your sportsbook.',
    };
    this.cache.set(`${event.id}:${group}`, { at: this.deps.now(), data });
    return data;
  }
}
