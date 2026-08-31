import { MarketQuote } from './nflMarketBoard';
import { UpcomingEvent } from '../api/oddsApiClient';

export const MARKET_BASELINE_VERSION = 'exact-two-sided-ex-target-v1';
export const priceProbability = (price: number): number | null =>
  Number.isFinite(price) && Math.abs(price) >= 100 ? price > 0 ? 100 / (100 + price) : -price / (100 - price) : null;

/** Same event, participant, period and exact line only. No names/lines are
 * interpolated. Equal book weighting is a benchmark, not learned reliability.
 * Two-sided no-vig odds estimate probability CONDITIONAL ON NO PUSH. */
export function exactMarketBaseline(event: UpcomingEvent, target: MarketQuote, quotes: MarketQuote[], now = Date.now()) {
  const reasons: string[] = [];
  const match = /^(h2h|spreads|totals)(_(q[1-4]|h[12]))?$/.exec(target.market);
  const ou = target.market.startsWith('player_') || match?.[1] === 'totals';
  const pairSide = ou ? target.side === 'Over' ? 'Under' : target.side === 'Under' ? 'Over' : null
    : target.side === event.homeTeam ? event.awayTeam : target.side === event.awayTeam ? event.homeTeam : null;
  const supported = !!match || ['player_pass_yds','player_rush_yds','player_reception_yds','player_receptions'].includes(target.market);
  const fresh = (q: MarketQuote) => {
    const stamp = Date.parse(q.updatedAt ?? '');
    return !q.stale && Number.isFinite(stamp) && stamp <= now && now - stamp <= 15 * 60_000
      && stamp < Date.parse(event.commenceTime) && priceProbability(q.price) !== null;
  };
  const lineValid = match?.[1] === 'h2h' ? target.line === null : Number.isFinite(target.line);
  if (!supported || !pairSide || !lineValid) reasons.push('Unsupported or malformed exact two-sided market.');
  if (!fresh(target) || !Number.isFinite(Date.parse(event.commenceTime)) || Date.parse(event.commenceTime) <= now)
    reasons.push('Target quote is stale, future-dated or no longer pregame.');
  const referenceBooks: Array<{ bookKey: string; probability: number; updatedAt: string; overround: number }> = [];
  if (!reasons.length) for (const book of new Set(quotes.map(q => q.bookKey))) {
    if (book === target.bookKey) continue; // never use target book on either side
    const same = quotes.filter(q => q.bookKey === book && q.market === target.market && q.participant === target.participant && fresh(q));
    const a = same.filter(q => q.side === target.side && q.line === target.line);
    const oppositeLine = match?.[1] === 'spreads' ? -target.line : target.line;
    const b = same.filter(q => q.side === pairSide && q.line === oppositeLine);
    if (a.length !== 1 || b.length !== 1) continue; // duplicate/ambiguous offers fail closed
    const stamp = Date.parse(a[0].updatedAt), oppositeStamp = Date.parse(b[0].updatedAt);
    if (stamp !== oppositeStamp || Math.abs(stamp - Date.parse(target.updatedAt)) > 2 * 60_000) continue;
    const p = priceProbability(a[0].price), other = priceProbability(b[0].price);
    if (p + other < 1 || p + other > 1.25) continue;
    referenceBooks.push({ bookKey: book, probability: p / (p + other), updatedAt: a[0].updatedAt, overround: p + other - 1 });
  }
  if (referenceBooks.length < 3) reasons.push('Need three other fresh, exact-line, two-sided books; no pooled-line substitute.');
  const probability = reasons.length ? null : referenceBooks.reduce((sum, b) => sum + b.probability, 0) / referenceBooks.length;
  return { version: MARKET_BASELINE_VERSION, eventId: event.id, targetBook: target.bookKey,
    market: target.market, participant: target.participant, side: target.side, line: target.line,
    conditionalNoPushProbability: probability, breakEvenProbability: priceProbability(target.price),
    conditionalPriceAdvantage: probability === null ? null : probability - priceProbability(target.price),
    referenceBooks, reasons, status: probability === null ? 'unavailable' : 'descriptive_baseline',
    note: 'Market-derived, equal-weight no-vig benchmark; not an independent football forecast, validated edge or unconditional EV. Overtime scope follows the exact provider market key; sportsbook rule differences still require verification.' };
}
