import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { UpcomingEvent } from '../api/oddsApiClient';
import { MarketBoardError, MarketQuote } from './nflMarketBoard';
import { ESPN_NFL, NFL_CORE_STATS, NFL_RESEARCH_VERSION, NflPlayer, NflResearch, nflName, nflNumber, nflSeason } from './nflResearch';

export const PAPER_RULES = 'regulation-periods_full-game-includes-ot_v1';
export type PaperResult = 'PENDING' | 'REVIEW' | 'WIN' | 'LOSS' | 'PUSH';
export interface NflPaperPick {
  id: string; event: UpcomingEvent; espnEventId: string; quote: MarketQuote;
  player?: NflPlayer; season: number; version: string; rules: string; savedAt: string;
  result: PaperResult; note: string; actual?: number; gradedAt?: string; source?: string;
  latestPregame?: { price: number; updatedAt: string; observedAt: string };
}
export function supportedPaperMarket(market: string): boolean {
  return !!NFL_CORE_STATS[market] || /^(h2h|spreads|totals)(_(q[1-4]|h[12]))?$/.test(market);
}
export function paperProfit(result: PaperResult, price: number): number {
  return result === 'WIN' ? (price > 0 ? price / 100 : 100 / Math.abs(price)) : result === 'LOSS' ? -1 : 0;
}
function compared(value: number, line: number, side: string): PaperResult {
  if (value === line) return 'PUSH';
  return (side === 'Over' ? value > line : value < line) ? 'WIN' : 'LOSS';
}

// Conservative paper settlement only. Missing player/category/period never becomes zero.
// No sportsbook DNP/early-injury promotions are inferred from a box score.
export function gradeNflPaper(pick: NflPaperPick, data: any): { result: PaperResult; note: string; actual?: number } {
  const review = (note: string) => ({ result: 'REVIEW' as const, note });
  if (pick.rules !== PAPER_RULES || !supportedPaperMarket(pick.quote.market)) return review('Unsupported paper rule or market.');
  const game = data?.header?.competitions?.[0];
  const home = game?.competitors?.find((c: any) => c.homeAway === 'home');
  const away = game?.competitors?.find((c: any) => c.homeAway === 'away');
  if (data?.header?.league?.slug !== 'nfl' || Number(data?.header?.season?.type) !== 2
    || Number(data?.header?.season?.year) !== pick.season || String(game?.id) !== pick.espnEventId
    || nflName(home?.team?.displayName) !== nflName(pick.event.homeTeam)
    || nflName(away?.team?.displayName) !== nflName(pick.event.awayTeam)
    || !Number.isFinite(Date.parse(game?.date ?? ''))
    || Math.abs(Date.parse(game.date) - Date.parse(pick.event.commenceTime)) > 2 * 3600_000)
    return review('Source game identity, season or kickoff does not match.');
  if (game.status?.type?.completed !== true || game.status?.type?.state !== 'post')
    return { result: 'PENDING', note: 'Awaiting a completed game.' };
  if (!['STATUS_FINAL', 'STATUS_FINAL_OVERTIME'].includes(game.status.type.name)) return review('Unusual final status; verify manually.');
  const q = pick.quote, core = NFL_CORE_STATS[q.market];
  if (core) {
    if (!pick.player || q.line === null || !['Over', 'Under'].includes(q.side)) return review('Missing player identity, side or line.');
    const blocks = (data.boxscore?.players ?? []).filter((b: any) => String(b.team?.id) === pick.player.teamId);
    if (blocks.length !== 1) return review('Player team box score missing or ambiguous.');
    const stats = blocks[0].statistics?.filter((s: any) => s.name === core.category) ?? [];
    if (stats.length !== 1) return review('Player stat category missing or ambiguous.');
    const rows = (stats[0].athletes ?? []).filter((r: any) => String(r.athlete?.id) === pick.player.id);
    if (rows.length !== 1 || nflName(rows[0].athlete?.displayName) !== nflName(pick.player.name))
      return review('Player row missing or ambiguous. Verify participation; no zero or DNP assumption.');
    const index = (stats[0].keys ?? []).indexOf(core.field);
    const actual = index >= 0 ? nflNumber(rows[0].stats?.[index]) : null;
    if (actual === null) return review('Numeric player result missing.');
    return { result: compared(actual, q.line, q.side), actual,
      note: 'Paper result from final player box score, including overtime; sportsbook participation rules require separate verification.' };
  }
  const [market, period] = q.market.split('_');
  const periods: Record<string, number[]> = { q1: [0], q2: [1], q3: [2], q4: [3], h1: [0, 1], h2: [2, 3] };
  function score(team: any): number | null {
    if (!period) return nflNumber(team?.score);
    const all = team?.linescores;
    if (!Array.isArray(all) || all.length < 4) return null;
    const every = all.map((s: any) => nflNumber(s.value ?? s.displayValue));
    if (every.some(v => v === null || v < 0 || !Number.isInteger(v))
      || every.reduce((a, b) => a + b, 0) !== nflNumber(team.score)
      || all.some((s: any, i: number) => s.period != null && Number(s.period) !== i + 1)) return null;
    const scores = periods[period].map(i => nflNumber(team?.linescores?.[i]?.value ?? team?.linescores?.[i]?.displayValue));
    return scores.some(v => v === null) ? null : scores.reduce((a, b) => a + b, 0);
  }
  const hs = score(home), as = score(away);
  if (hs === null || as === null) return review('Final score or required regulation-period scores missing.');
  let result: PaperResult, actual: number;
  if (market === 'totals') {
    if (q.line === null || !['Over', 'Under'].includes(q.side)) return review('Missing total line or invalid side.');
    actual = hs + as; result = compared(actual, q.line, q.side);
  } else {
    const isHome = nflName(q.side) === nflName(pick.event.homeTeam);
    if (!isHome && nflName(q.side) !== nflName(pick.event.awayTeam)) return review('Unknown selected team; three-way markets unsupported.');
    if (market === 'spreads' && q.line === null) return review('Missing spread.');
    actual = (isHome ? hs - as : as - hs) + (market === 'spreads' ? q.line : 0);
    result = actual === 0 ? 'PUSH' : actual > 0 ? 'WIN' : 'LOSS';
  }
  return { result, actual, note: period ? 'Paper regulation-period result; overtime excluded. Two-way ties push. Not sportsbook settlement.'
    : 'Paper full-game result includes overtime. Two-way ties push. Not sportsbook settlement.' };
}

export function nflPaperReport(picks: NflPaperPick[]) {
  const buckets = new Map<string, any>();
  for (const p of picks) {
    const key = `${p.season} | ${p.quote.market} | ${p.version}`;
    const b = buckets.get(key) ?? { season: p.season, market: p.quote.market, version: p.version,
      tracked: 0, wins: 0, losses: 0, pushes: 0, pending: 0, review: 0, profitUnits: 0, uniqueEvents: new Set() };
    b.tracked++; b.uniqueEvents.add(p.event.id);
    if (p.result === 'WIN') b.wins++;
    else if (p.result === 'LOSS') b.losses++;
    else if (p.result === 'PUSH') b.pushes++;
    else if (p.result === 'REVIEW') b.review++;
    else b.pending++;
    b.profitUnits += paperProfit(p.result, p.quote.price); buckets.set(key, b);
  }
  return { buckets: [...buckets.values()].map(b => ({ ...b, uniqueEvents: b.uniqueEvents.size,
    winRate: b.wins + b.losses ? b.wins / (b.wins + b.losses) : null,
    roi: b.wins + b.losses + b.pushes ? b.profitUnits / (b.wins + b.losses + b.pushes) : null })),
    note: 'Manual paper selections, flat 1-unit risk each, not real bets or an unbiased model backtest. Related picks are correlated. Pushes excluded from win rate, included in settled-stake ROI. No calibrated model probability or true closing line is available.' };
}

export class NflPaperLedger {
  private grading: Promise<any> | null = null;
  constructor(private file: string, private research: Pick<NflResearch, 'matchEvent' | 'player' | 'summary'>, private now = () => Date.now()) {}
  read(): NflPaperPick[] {
    if (!fs.existsSync(this.file)) return [];
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (data.schema !== 1 || !Array.isArray(data.picks)) throw new Error('Invalid NFL paper ledger; refusing to overwrite it.');
    return data.picks;
  }
  private write(picks: NflPaperPick[]) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ schema: 1, picks }, null, 2), { flag: 'wx' });
    fs.renameSync(tmp, this.file);
  }
  async save(event: UpcomingEvent, quote: MarketQuote, rules: string) {
    const validate = () => {
      const age = this.now() - Date.parse(quote.updatedAt ?? '');
      if (!supportedPaperMarket(quote.market) || rules !== PAPER_RULES) throw new MarketBoardError('Unsupported market or paper rules not acknowledged.');
      if (!Number.isFinite(age) || age > 15 * 60_000 || age < -60_000
        || Date.parse(event.commenceTime) <= this.now()) throw new MarketBoardError('Quote is stale or kickoff has passed; paper pick not saved.', 409);
    };
    validate();
    const espnEventId = await this.research.matchEvent(event);
    const player = NFL_CORE_STATS[quote.market] ? await this.research.player(event, quote.participant) : undefined;
    validate(); // Network requests must not allow a save after kickoff.
    const picks = this.read();
    const existing = picks.find(p => p.event.id === event.id && p.quote.market === quote.market
      && nflName(p.quote.participant) === nflName(quote.participant) && p.quote.side === quote.side && p.quote.line === quote.line);
    if (existing) return { pick: existing, duplicate: true };
    const pick: NflPaperPick = { id: randomUUID(), event: { ...event }, espnEventId, quote: { ...quote }, player,
      season: nflSeason(event.commenceTime), version: NFL_RESEARCH_VERSION, rules,
      savedAt: new Date(this.now()).toISOString(), result: 'PENDING', note: 'Manual paper selection; no money wagered and no model probability attached.' };
    this.write([...picks, pick]); return { pick, duplicate: false };
  }
  observe(eventId: string, quotes: MarketQuote[]) {
    const picks = this.read(); let changed = false;
    for (const p of picks) {
      if (p.event.id !== eventId || this.now() >= Date.parse(p.event.commenceTime)) continue;
      const q = quotes.find(q => q.market === p.quote.market && q.participant === p.quote.participant
        && q.side === p.quote.side && q.line === p.quote.line && q.bookKey === p.quote.bookKey);
      const stamp = Date.parse(q?.updatedAt ?? '');
      if (!q || !Number.isFinite(stamp) || this.now() - stamp > 15 * 60_000 || stamp > this.now() + 60_000
        || stamp >= Date.parse(p.event.commenceTime) || stamp <= Date.parse(p.latestPregame?.updatedAt ?? p.quote.updatedAt ?? '')) continue;
      p.latestPregame = { price: q.price, updatedAt: q.updatedAt, observedAt: new Date(this.now()).toISOString() }; changed = true;
    }
    if (changed) this.write(picks);
  }
  async grade() {
    if (this.grading) return this.grading;
    this.grading = this.gradeBatch().finally(() => { this.grading = null; }); return this.grading;
  }
  private async gradeBatch() {
    const eligible = this.read().filter(p => ['PENDING', 'REVIEW'].includes(p.result)
      && Date.parse(p.event.commenceTime) + 4 * 3600_000 < this.now());
    // Bound each button press to ten games, never fan out over the whole season.
    const games = [...new Set(eligible.map(p => p.espnEventId))].slice(0, 10);
    const updates = new Map<string, any>();
    for (const id of games) {
      try {
        const data = await this.research.summary(id);
        for (const p of eligible.filter(p => p.espnEventId === id)) updates.set(p.id, {
          ...gradeNflPaper(p, data), gradedAt: new Date(this.now()).toISOString(), source: `${ESPN_NFL}/summary?event=${id}` });
      } catch {
        for (const p of eligible.filter(p => p.espnEventId === id)) updates.set(p.id, { result: 'REVIEW', note: 'NFL result source unavailable. Retry later; no loss or zero assumed.' });
      }
    }
    // Re-read after awaits so concurrent saves/quote observations are preserved.
    const picks = this.read().map(p => updates.has(p.id) && ['PENDING', 'REVIEW'].includes(p.result) ? { ...p, ...updates.get(p.id) } : p);
    if (updates.size) this.write(picks);
    return { checked: updates.size, remainingGames: Math.max(0, new Set(eligible.map(p => p.espnEventId)).size - games.length),
      picks, report: nflPaperReport(picks) };
  }
}
