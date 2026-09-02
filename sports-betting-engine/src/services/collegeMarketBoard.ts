import { getUpcomingEvents, getEventMarkets, UpcomingEvent } from '../api/oddsApiClient';
import { NCAAF } from '../config/productionFocus';
import { RawEvent, QuotaUsage } from '../types/odds';
import { flattenNflQuotes, MarketBoardError } from './nflMarketBoard';
import { randomUUID } from 'crypto';

export const COLLEGE_WINDOW_DAYS = 14;
export const COLLEGE_MARKETS = ['spreads', 'totals'];
type Dependencies = {
  upcoming: () => Promise<UpcomingEvent[]>;
  odds: (id: string, markets: string[]) => Promise<{ event: RawEvent | null; quota: QuotaUsage }>;
  now: () => number;
};

// Quote discovery does not issue picks. Explicit paper saves use a server-held
// quote ID, never a client-supplied line/price or an inferred college forecast.
export class CollegeMarketBoard {
  private schedule: { at: number; items: UpcomingEvent[] } | null = null;
  private discovery: Promise<void> | null = null;
  private cache = new Map<string, { at: number; data: any }>();
  private pending = new Map<string, Promise<any>>();
  constructor(private deps: Dependencies = {
    upcoming: () => getUpcomingEvents(NCAAF),
    odds: (id, markets) => getEventMarkets(NCAAF, id, markets), now: Date.now,
  }) {}

  async events() {
    if (!this.schedule || this.deps.now() - this.schedule.at >= 60_000) {
      if (!this.discovery) this.discovery = this.deps.upcoming().then(items => {
        this.schedule = { at: this.deps.now(), items };
      }).finally(() => { this.discovery = null; });
      await this.discovery;
    }
    const now = this.deps.now();
    return this.schedule.items.filter(e => e.sportKey === NCAAF && Date.parse(e.commenceTime) > now
      && Date.parse(e.commenceTime) <= now + COLLEGE_WINDOW_DAYS * 86400_000)
      .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  }

  async quotes(eventId: string) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(eventId)) throw new MarketBoardError('Invalid college game ID.');
    const event = (await this.events()).find(e => e.id === eventId);
    if (!event) throw new MarketBoardError('Select an upcoming college football game in the next 14 days.');
    for (const [key, entry] of this.cache) if (this.deps.now() - entry.at >= 5 * 60_000) this.cache.delete(key);
    const hit = this.cache.get(eventId);
    if (hit) return { ...hit.data, cached: true };
    if (this.pending.has(eventId)) return this.pending.get(eventId);
    if (this.pending.size) throw new MarketBoardError('Another college odds request is running. Please wait.', 409);
    const request = this.fetch(event).finally(() => { this.pending.delete(eventId); });
    this.pending.set(eventId, request);
    return request;
  }
  selection(eventId:string,quoteId:string) {
    const hit=this.cache.get(eventId),now=this.deps.now();
    if(!hit||now-hit.at>=5*60_000)throw new MarketBoardError('College quote session expired. Load posted odds again.',409);
    if(Date.parse(hit.data.event.commenceTime)<=now)throw new MarketBoardError('College kickoff has passed.',409);
    const matches=hit.data.quotes.filter((q:any)=>q.quoteId===quoteId);
    if(matches.length!==1)throw new MarketBoardError('Choose an exact posted college quote.');
    return {event:{...hit.data.event},quote:{...matches[0]}};
  }

  private async fetch(event: UpcomingEvent) {
    const result = await this.deps.odds(event.id, [...COLLEGE_MARKETS]);
    const raw = result.event;
    if (!raw) throw new MarketBoardError('College odds request blocked by the credit budget or no event returned.', 503);
    if (raw.id !== event.id || raw.sport_key !== NCAAF || raw.home_team !== event.homeTeam
      || raw.away_team !== event.awayTeam || !Number.isFinite(Date.parse(raw.commence_time)))
      throw new MarketBoardError('College feed returned a mismatched game.', 502);
    const now = this.deps.now();
    if (Date.parse(raw.commence_time) <= now || Date.parse(raw.commence_time) > now + COLLEGE_WINDOW_DAYS * 86400_000)
      throw new MarketBoardError('The college game is no longer in the upcoming 14-day window.', 409);
    const quotes = flattenNflQuotes(raw, COLLEGE_MARKETS, now).filter(q => q.line !== null && !q.participant
      && (q.market === 'totals' ? ['Over', 'Under'].includes(q.side) : [raw.home_team, raw.away_team].includes(q.side)))
      .map(q=>({...q,quoteId:randomUUID()}));
    const data = { event: { ...event, commenceTime: raw.commence_time }, quotes,
      fetchedAt: new Date(now).toISOString(), cached: false, remainingCredits: result.quota.remainingRequests,
      missingMarkets: COLLEGE_MARKETS.filter(m => !quotes.some(q => q.market === m)),
      status: quotes.length ? 'quotes_available' : 'not_posted',
      note: 'Posted college spreads and totals only. No forecast, pick or result record is created.' };
    this.cache.set(event.id, { at: now, data });
    return data;
  }
}
