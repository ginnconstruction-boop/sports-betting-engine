import * as fs from 'fs';
import * as path from 'path';
import { randomUUID, createHash } from 'crypto';
import { UpcomingEvent } from '../api/oddsApiClient';
import { MarketBoardError, MarketQuote } from './nflMarketBoard';
import { ESPN_NFL, NFL_CORE_STATS, NFL_RESEARCH_VERSION, NflPlayer, NflResearch, nflName, nflNumber, nflSeason } from './nflResearch';
import type { NflForecast } from './nflForecast';
import { NflEvidenceArchive } from './nflEvidence';

export const PAPER_RULES = 'regulation-periods_full-game-includes-ot_v1';
export type PaperResult = 'PENDING' | 'REVIEW' | 'WIN' | 'LOSS' | 'PUSH';
export interface NflPaperPick {
  verifiedEvent?: { espnEventId: string; homeTeamId: string; awayTeamId: string; neutralSite: boolean | null; source: string; fetchedAt: string };
  id: string; event: UpcomingEvent; espnEventId: string; quote: MarketQuote;
  player?: NflPlayer; season: number; version: string; rules: string; savedAt: string;
  result: PaperResult; note: string; actual?: number; gradedAt?: string; source?: string;
  latestPregame?: { price: number; updatedAt: string; observedAt: string };
  closeWindow?: { price: number; line: number | null; bookKey: string; updatedAt: string; observedAt: string; method: 'observed_last_5_minutes_not_verified_final_close' };
  settlementScope?: { bookKey: string; ruleVersion: string; sportsbookRulesVerified: false };
  gradingAudit?: Array<{ result: PaperResult; actual?: number; note: string; checkedAt: string; source: string; sourceHash: string; evidenceHash?: string }>;
  lastResultCheck?: { at: string; status: 'graded' | 'unavailable' | 'review' };
  origin?: 'manual' | 'model';
  forecast?: NflForecast;
  modelProbability?: number;
  modelPushProbability?: number;
  estimatedEV?: number;
  selectionReasons?: string[];
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
    const origin = p.origin ?? 'manual';
    const key = `${p.season} | ${p.quote.market} | ${p.version} | ${origin}`;
    const b = buckets.get(key) ?? { season: p.season, market: p.quote.market, version: p.version, origin,
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
    note: 'Paper selections, flat 1-unit risk each, not real bets or an unbiased backtest. Manual and automatically logged model picks are separate. Related picks are correlated. Pushes excluded from win rate, included in settled-stake ROI. Model estimates remain uncalibrated; pregame observations are not verified closing lines.' };
}

/** Shared persistence/audit lifecycle; each league supplies its own identity,
 * supported markets, settlement rules and grading. No model coefficients transfer. */
export interface FootballPaperProfile {
  sportKey: string; label: string; version: string; rules: string; sourceBase: string;
  evidenceKind: string; archiveDirectory: string;
  supports: (market: string) => boolean;
  grade: typeof gradeNflPaper;
  verifyEvent?: (event: UpcomingEvent) => Promise<NonNullable<NflPaperPick['verifiedEvent']>>;
}
const NFL_PAPER_PROFILE: FootballPaperProfile = {
  sportKey: 'americanfootball_nfl', label: 'NFL', version: NFL_RESEARCH_VERSION, rules: PAPER_RULES,
  sourceBase: ESPN_NFL, evidenceKind: 'nfl_settlement_source_v1', archiveDirectory: 'nfl_settlement_evidence',
  supports: supportedPaperMarket, grade: gradeNflPaper,
};

export class NflPaperLedger {
  private grading: Promise<any> | null = null;
  private settlementArchive: NflEvidenceArchive;
  constructor(private file: string, private research: Pick<NflResearch, 'matchEvent' | 'player' | 'summary'>, private now = () => Date.now(),
    private profile: FootballPaperProfile = NFL_PAPER_PROFILE) {
    this.settlementArchive = new NflEvidenceArchive(path.join(path.dirname(file), profile.archiveDirectory));
  }
  exportRecord() {
    const picks = this.read();
    const evidence: Record<string, unknown> = {}, missingEvidence: string[] = [], omittedEvidence: string[] = [];
    let sourceBytes = 0;
    for (const hash of new Set(picks.flatMap(p => (p.gradingAudit ?? []).map(a => a.evidenceHash).filter(Boolean)))) {
      try {
        const payload=this.settlementArchive.read(hash), bytes=Buffer.byteLength(JSON.stringify(payload));
        if(sourceBytes + bytes > 25 * 1024 * 1024) { omittedEvidence.push(hash); continue; }
        evidence[hash]=payload;sourceBytes+=bytes;
      }
      catch { missingEvidence.push(hash); }
    }
    return { schema: 1, sportKey: this.profile.sportKey, exportedAt: new Date(this.now()).toISOString(), picks, evidence, missingEvidence, omittedEvidence,
      note: `${this.profile.label} paper-only export. Includes original forecasts/quotes and up to 25 MiB of settlement source snapshots; omitted hashes are listed and require a server-disk backup. Does not include the separate official ledger or old reset backups. Missing/legacy evidence cannot be reconstructed by this export.` };
  }
  replay(id: string) {
    const pick = this.read().find(p => p.id === id);
    if (!pick) throw new MarketBoardError('Paper pick not found.', 404);
    const audits = (pick.gradingAudit ?? []).map(a => {
      if (!a.evidenceHash) return { checkedAt: a.checkedAt, status: 'legacy_evidence_unavailable', savedResult: a.result };
      try {
        const evidence = this.settlementArchive.read(a.evidenceHash);
        const bytesHash = createHash('sha256').update(JSON.stringify(evidence.data)).digest('hex');
        if (evidence.kind !== this.profile.evidenceKind || evidence.espnEventId !== pick.espnEventId
          || evidence.source !== a.source || bytesHash !== a.sourceHash) throw new Error('Mismatched source evidence.');
        const replay = this.profile.grade(pick, evidence.data);
        return { checkedAt: a.checkedAt, status: replay.result === a.result && replay.actual === a.actual ? 'matched' : 'mismatch',
          savedResult: a.result, savedActual: a.actual, replay, evidenceHash: a.evidenceHash };
      } catch { return { checkedAt: a.checkedAt, status: 'evidence_unavailable_or_corrupt', savedResult: a.result }; }
    });
    return { id, audits, note: 'Read-only replay using archived box scores and the current paper grader. No provider requests and no record changes. It verifies reproducibility, not sportsbook-specific settlement.' };
  }
  read(): NflPaperPick[] {
    if (!fs.existsSync(this.file)) return [];
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (data.schema !== 1 || !Array.isArray(data.picks)) throw new Error('Invalid NFL paper ledger; refusing to overwrite it.');
    if(data.picks.some((p:any)=>p.event?.sportKey!==this.profile.sportKey)) throw new Error('Paper ledger contains a different sport; refusing to mix or overwrite records.');
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
      if (event.sportKey !== this.profile.sportKey || !this.profile.supports(quote.market) || rules !== this.profile.rules)
        throw new MarketBoardError('Unsupported sport/market or paper rules not acknowledged.');
      if(!Number.isFinite(Date.parse(event.commenceTime)) || !Number.isFinite(quote.price) || Math.abs(quote.price)<100
        || (quote.market !== 'h2h' && !quote.market.startsWith('h2h_') && !Number.isFinite(quote.line)))
        throw new MarketBoardError('Invalid exact quote or kickoff.');
      if (!Number.isFinite(age) || age > 15 * 60_000 || age < -60_000
        || Date.parse(event.commenceTime) <= this.now()) throw new MarketBoardError('Quote is stale or kickoff has passed; paper pick not saved.', 409);
    };
    validate();
    const verifiedEvent = this.profile.verifyEvent ? await this.profile.verifyEvent(event) : undefined;
    const espnEventId = verifiedEvent?.espnEventId ?? await this.research.matchEvent(event);
    const player = NFL_CORE_STATS[quote.market] ? await this.research.player(event, quote.participant) : undefined;
    validate(); // Network requests must not allow a save after kickoff.
    const picks = this.read();
    const existing = picks.find(p => (p.origin ?? 'manual') === 'manual' && p.event.id === event.id && p.quote.market === quote.market
      && nflName(p.quote.participant) === nflName(quote.participant) && p.quote.side === quote.side && p.quote.line === quote.line);
    if (existing) return { pick: existing, duplicate: true };
    const pick: NflPaperPick = { id: randomUUID(), origin: 'manual', event: { ...event }, espnEventId, quote: { ...quote }, player,
      season: nflSeason(event.commenceTime), version: this.profile.version, rules, ...(verifiedEvent?{verifiedEvent}:{}),
      savedAt: new Date(this.now()).toISOString(), result: 'PENDING', note: 'Manual paper selection; no money wagered and no model probability attached.' };
    pick.settlementScope = { bookKey: quote.bookKey, ruleVersion: rules, sportsbookRulesVerified: false };
    this.write([...picks, pick]); return { pick, duplicate: false };
  }
  modelPick(eventId: string, participant: string, market: string, version: string) {
    return this.read().find(p => p.origin === 'model' && p.event.id === eventId && p.version === version
      && p.quote.market === market && nflName(p.quote.participant) === nflName(participant));
  }
  async saveModel(event: UpcomingEvent, quote: MarketQuote, forecast: NflForecast,
    assessment: { probability: number; pushProbability: number; estimatedEV: number; eligible: boolean }, rules: string) {
    if(this.profile.sportKey!=='americanfootball_nfl' || event.sportKey!=='americanfootball_nfl')
      throw new MarketBoardError('NFL forecast models cannot issue college selections.');
    const existing = this.modelPick(event.id, quote.participant, quote.market, forecast.version);
    if (existing) return { pick: existing, duplicate: true };
    const verify = () => {
      const age = this.now() - Date.parse(quote.updatedAt ?? '');
      const inputAge = this.now() - Date.parse(forecast.asOf);
      if (rules !== PAPER_RULES || !assessment.eligible || forecast.reasons.length
        || quote.market !== forecast.market || nflName(quote.participant) !== nflName(forecast.player.name)
        || !Number.isFinite(assessment.probability) || !Number.isFinite(assessment.pushProbability)
        || assessment.probability < 0 || assessment.pushProbability < 0 || assessment.probability + assessment.pushProbability > 1)
        throw new MarketBoardError('Model selection is not eligible for paper issuance.');
      if (!Number.isFinite(age) || age > 15 * 60_000 || age < -60_000 || !Number.isFinite(inputAge)
        || inputAge > 5 * 60_000 || inputAge < -60_000 || Date.parse(event.commenceTime) <= this.now())
        throw new MarketBoardError('Quote/input expired or kickoff passed before logging; no recommendation issued.', 409);
    };
    verify();
    const espnEventId = await this.research.matchEvent(event);
    verify();
    // One immutable model pick per event/player/market/version, across sides,
    // books and alternative lines. Concurrent requests re-check after awaits.
    const picks = this.read();
    const concurrent = picks.find(p => p.origin === 'model' && p.event.id === event.id && p.version === forecast.version
      && p.quote.market === quote.market && nflName(p.quote.participant) === nflName(quote.participant));
    if (concurrent) return { pick: concurrent, duplicate: true };
    const pick: NflPaperPick = { id: randomUUID(), origin: 'model', event: { ...event }, espnEventId,
      quote: { ...quote }, player: forecast.player, season: nflSeason(event.commenceTime), version: forecast.version,
      rules, savedAt: new Date(this.now()).toISOString(), result: 'PENDING', forecast,
      modelProbability: assessment.probability, modelPushProbability: assessment.pushProbability, estimatedEV: assessment.estimatedEV,
      selectionReasons: ['Passed fixed data/role gates and player rolling-baseline diagnostic.',
        'Highest estimated EV among fresh loaded quotes at configured accessible books.',
        'Experimental residual probability and fixed paper thresholds; no real wager placed.'],
      note: 'Automatically logged experimental paper recommendation; original forecast and quote are immutable.' };
    pick.settlementScope = { bookKey: quote.bookKey, ruleVersion: rules, sportsbookRulesVerified: false };
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
      const kickoff = Date.parse(p.event.commenceTime);
      if (kickoff - this.now() <= 5 * 60_000 && kickoff - stamp <= 5 * 60_000 && stamp <= this.now())
        p.closeWindow = { ...p.latestPregame, line: q.line, bookKey: q.bookKey, method: 'observed_last_5_minutes_not_verified_final_close' };
    }
    if (changed) this.write(picks);
  }
  async grade(recheckSettled = false) {
    if (this.grading) return this.grading;
    this.grading = this.gradeBatch(recheckSettled).finally(() => { this.grading = null; }); return this.grading;
  }
  private async gradeBatch(recheckSettled: boolean) {
    const eligible = this.read().filter(p => (recheckSettled
      ? ['WIN', 'LOSS', 'PUSH'].includes(p.result) && this.now() - Date.parse(p.event.commenceTime) < 14 * 86400_000
      : ['PENDING', 'REVIEW'].includes(p.result)) && Date.parse(p.event.commenceTime) + 4 * 3600_000 < this.now())
      .sort((a,b) => Date.parse(a.lastResultCheck?.at ?? a.gradedAt ?? a.savedAt) - Date.parse(b.lastResultCheck?.at ?? b.gradedAt ?? b.savedAt));
    // Bound each button press to ten games, never fan out over the whole season.
    const games = [...new Set(eligible.map(p => p.espnEventId))].slice(0, 10);
    const updates = new Map<string, any>();
    let sourceFailures = 0;
    for (const id of games) {
      try {
        const data = await this.research.summary(id);
        // Persist the actual grading source BEFORE changing any result. A hash
        // alone cannot reproduce a result after the public source changes.
        const evidence = this.settlementArchive.record({ kind: this.profile.evidenceKind, espnEventId: id,
          source: `${this.profile.sourceBase}/summary?event=${id}`, data });
        for (const p of eligible.filter(p => p.espnEventId === id)) {
          const grade = this.profile.grade(p, data), checkedAt = new Date(this.now()).toISOString();
          const source = `${this.profile.sourceBase}/summary?event=${id}`;
          const sourceHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
          const previous = p.gradingAudit ?? (['WIN','LOSS','PUSH'].includes(p.result)
            ? [{ result: p.result, actual: p.actual, note: p.note, checkedAt: p.gradedAt ?? p.savedAt,
                source: p.source ?? 'legacy', sourceHash: 'legacy_unavailable' }] : []);
          if (recheckSettled && ['REVIEW','PENDING'].includes(grade.result)) {
            sourceFailures++;
            updates.set(p.id, { lastResultCheck: { at: checkedAt, status: 'review' } });
            continue; // Incomplete data is not a correction of a settled result.
          }
          const unchanged = p.result === grade.result && p.actual === grade.actual && previous.at(-1)?.sourceHash === sourceHash;
          updates.set(p.id, { ...grade, gradedAt: checkedAt, source,
            lastResultCheck: { at: checkedAt, status: 'graded' },
            gradingAudit: unchanged && previous.at(-1)?.evidenceHash ? previous : [...previous, { ...grade, checkedAt, source, sourceHash, evidenceHash: evidence.hash }] });
        }
      } catch {
        for (const p of eligible.filter(p => p.espnEventId === id)) {
          sourceFailures++;
          updates.set(p.id, { ...(recheckSettled ? {} : { result: 'REVIEW', note: `${this.profile.label} result source unavailable. Retry later; no loss or zero assumed.` }),
            lastResultCheck: { at: new Date(this.now()).toISOString(), status: 'unavailable' } });
        }
      }
    }
    // Re-read after awaits so concurrent saves/quote observations are preserved.
    const picks = this.read().map(p => updates.has(p.id) && (recheckSettled || ['PENDING', 'REVIEW'].includes(p.result)) ? { ...p, ...updates.get(p.id) } : p);
    if (updates.size) this.write(picks);
    return { checked: updates.size, remainingGames: Math.max(0, new Set(eligible.map(p => p.espnEventId)).size - games.length),
      sourceFailures, picks, report: nflPaperReport(picks) };
  }
}
