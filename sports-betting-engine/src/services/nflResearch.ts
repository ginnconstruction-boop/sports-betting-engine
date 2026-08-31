import { UpcomingEvent } from '../api/oddsApiClient';
import { MarketBoardError, MarketQuote } from './nflMarketBoard';
import { parseWorkloadEvidence, summarizeWorkloadEvidence, WorkloadEvidence } from './nflWorkloadContext';
import type { NflForecastInput } from './nflForecast';

export const NFL_RESEARCH_VERSION = 'nfl-observed-baseline-v1';
export const NFL_CORE_STATS: Record<string, { field: string; category: string }> = {
  player_pass_yds: { field: 'passingYards', category: 'passing' },
  player_rush_yds: { field: 'rushingYards', category: 'rushing' },
  player_reception_yds: { field: 'receivingYards', category: 'receiving' },
  player_receptions: { field: 'receptions', category: 'receiving' },
};
export const ESPN_NFL = 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl';
export const nflName = (s: string) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();
export function nflSeason(date: string | number): number {
  const d = new Date(date);
  return d.getUTCFullYear() - (d.getUTCMonth() < 7 ? 1 : 0);
}
export function nflNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const s = String(value).replace(/,/g, '').trim();
  return /^-?\d+(\.\d+)?$/.test(s) && Number.isFinite(Number(s)) ? Number(s) : null;
}

// Public ESPN feeds are best-effort, not a contracted data service. Never use a
// stale success after an error, or follow arbitrary provider-supplied URLs.
export async function fetchNflJson(url: string): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`NFL data source returned HTTP ${response.status}`);
  return response.json();
}
type Fetcher = (url: string) => Promise<any>;
export interface NflPlayer {
  id: string; name: string; teamId: string; team: string; position: string;
  rosterStatus: string; injuries: Array<{ status: string; date: string | null }>;
  fetchedAt: string; source: string;
}
export interface NflObservation {
  eventId: string; date: string; teamId: string; opponent: string; value: number;
  opportunity?: number | null;
}

export function parseNflLogs(payload: any, season: number, market: string, before: number): NflObservation[] {
  const stat = NFL_CORE_STATS[market];
  if (!stat || String(payload?.filters?.find((f: any) => f.name === 'season')?.value) !== String(season)) return [];
  const index = (payload.names ?? []).indexOf(stat.field);
  const opportunityIndex = (payload.names ?? []).indexOf(stat.category === 'passing' ? 'passingAttempts' : stat.category === 'rushing' ? 'rushingAttempts' : 'receivingTargets');
  if (index < 0) return [];
  const seen = new Set<string>();
  const observations: NflObservation[] = [];
  for (const type of payload.seasonTypes ?? []) for (const category of type.categories ?? []) {
    // ESPN's splitType=2 is regular season. Do not mix preseason/playoffs/totals.
    if (String(category.splitType) !== '2' || category.type !== 'event') continue;
    for (const row of category.events ?? []) {
      const e = payload.events?.[row.eventId];
      const date = Date.parse(e?.gameDate ?? '');
      const value = nflNumber(row.stats?.[index]);
      if (!e || !['W', 'L', 'T'].includes(e.gameResult) || !Number.isFinite(date)
        || date >= before || nflSeason(date) !== season || value === null || seen.has(row.eventId)) continue;
      seen.add(row.eventId);
      observations.push({ eventId: row.eventId, date: new Date(date).toISOString(),
        teamId: String(e.team?.id ?? ''), opponent: e.opponent?.displayName ?? 'Unknown', value,
        opportunity: opportunityIndex >= 0 ? nflNumber(row.stats?.[opportunityIndex]) : null });
    }
  }
  return observations.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
export function summarizeNflLogs(rows: NflObservation[], line: number) {
  const values = rows.map(r => r.value).sort((a, b) => a - b);
  const n = values.length;
  const over = values.filter(v => v > line).length, under = values.filter(v => v < line).length;
  const opportunities = rows.map(r => r.opportunity).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return { games: n, mean: n ? values.reduce((a, b) => a + b, 0) / n : null,
    median: n ? (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2 : null,
    over, under, pushes: n - over - under,
    historicalOverRateExcludingPushes: over + under ? over / (over + under) : null,
    opportunityGames: opportunities.length,
    meanOpportunities: opportunities.length ? opportunities.reduce((a, b) => a + b, 0) / opportunities.length : null,
    latestGame: rows[0]?.date ?? null, recent: rows.slice(0, 5) };
}

export function parseNflDepth(data: any, player: NflPlayer, season: number) {
  if (data?.season?.year !== season || String(data.team?.id) !== player.teamId) return [];
  const rows: Array<{ formation: string; position: string; listedOrder: number }> = [];
  for (const chart of data.depthchart ?? []) for (const [position, block] of Object.entries(chart.positions ?? {}) as Array<[string, any]>) {
    const matches = (block.athletes ?? []).map((a: any, i: number) => ({ a, i }))
      .filter(({ a }: any) => String(a.id) === player.id && nflName(a.displayName) === nflName(player.name));
    if (matches.length === 1) rows.push({ formation: chart.name ?? 'Unknown', position, listedOrder: matches[0].i + 1 });
  }
  return rows;
}

export class NflResearch {
  private cache = new Map<string, { at: number; value: any }>();
  private pending = new Map<string, Promise<any>>();
  constructor(private get: Fetcher = fetchNflJson, private now = () => Date.now()) {}
  private async cached(url: string, ttl = 5 * 60_000): Promise<any> {
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < ttl) return hit.value;
    if (this.pending.has(url)) return this.pending.get(url);
    const p = this.get(url).then(value => {
      for (const [key, item] of this.cache) if (this.now() - item.at > 3600_000) this.cache.delete(key);
      this.cache.set(url, { at: this.now(), value }); return value;
    }).finally(() => this.pending.delete(url));
    this.pending.set(url, p); return p;
  }
  async player(event: UpcomingEvent, name: string): Promise<NflPlayer> {
    const teamsPayload = await this.cached(`${ESPN_NFL}/teams`, 3600_000);
    const teams = teamsPayload?.sports?.[0]?.leagues?.[0]?.teams?.map((t: any) => t.team) ?? [];
    const matches: NflPlayer[] = [];
    for (const teamName of [event.homeTeam, event.awayTeam]) {
      const candidates = teams.filter((t: any) => nflName(t.displayName) === nflName(teamName));
      if (candidates.length !== 1) throw new MarketBoardError('NFL team identity could not be verified.', 422);
      const team = candidates[0];
      const source = `${ESPN_NFL}/teams/${team.id}/roster`;
      const roster = await this.cached(source);
      if (roster?.season?.year !== nflSeason(event.commenceTime) || String(roster.team?.id) !== String(team.id))
        throw new MarketBoardError('Current-season roster is unavailable or mismatched.', 422);
      for (const group of roster.athletes ?? []) for (const a of group.items ?? []) {
        if (nflName(a.displayName) !== nflName(name)) continue;
        matches.push({ id: String(a.id), name: a.displayName, teamId: String(team.id), team: team.displayName,
          position: a.position?.abbreviation ?? 'Unknown', rosterStatus: a.status?.name ?? 'Unknown',
          injuries: (a.injuries ?? []).map((i: any) => ({ status: i.status ?? i.type?.description ?? 'Reported', date: i.date ?? null })),
          fetchedAt: new Date(this.cache.get(source).at).toISOString(), source });
      }
    }
    if (matches.length !== 1 || !/^\d+$/.test(matches[0].id))
      throw new MarketBoardError('Player is missing or ambiguous on current game rosters. No name/initial guess was made.', 422);
    return matches[0];
  }
  async analyze(event: UpcomingEvent, quote: MarketQuote) {
    if (!NFL_CORE_STATS[quote.market] || quote.line === null || !['Over', 'Under'].includes(quote.side))
      throw new MarketBoardError('History research supports passing yards, rushing yards, receiving yards and receptions only.');
    const player = await this.player(event, quote.participant);
    const season = nflSeason(event.commenceTime);
    const depthSource = `${ESPN_NFL}/teams/${player.teamId}/depthcharts`;
    let depth = [], depthAsOf: string | null = null;
    try { const data = await this.cached(depthSource); depth = parseNflDepth(data, player, season); depthAsOf = data.timestamp ?? null; }
    catch { /* Depth feed is optional context, never proof of a starting role. */ }
    // Stop at request time as well as kickoff. No future event can enter a baseline.
    const cutoff = Math.min(this.now(), Date.parse(event.commenceTime));
    const seasons = [];
    for (const year of [season, season - 1]) {
      const source = `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${player.id}/gamelog?season=${year}`;
      const payload = await this.cached(source);
      const rows = parseNflLogs(payload, year, quote.market, cutoff);
      seasons.push({ season: year, source, ...summarizeNflLogs(rows, quote.line),
        otherTeamGames: rows.filter(r => r.teamId !== player.teamId).length });
    }
    return { version: NFL_RESEARCH_VERSION, mode: 'historical_research', player, market: quote.market,
      line: quote.line, asOf: new Date(this.now()).toISOString(), seasons,
      depth: { rows: depth, source: depthSource, sourceTimestamp: depthAsOf },
      opportunityLabel: NFL_CORE_STATS[quote.market].category === 'receiving' ? 'targets' : 'attempts',
      warnings: ['Historical observations, not a forecast, win probability, calibrated edge or betting recommendation.',
        'Depth-chart listed order is provisional, not confirmed game-day participation. Snap share and game-day availability still require verification.',
        'Missing rows are excluded, not zero-filled. This may omit zero-opportunity games and bias historical averages.',
        'Last season is shown separately; injuries, team changes, role changes and opponent strength are not modeled.',
        ...(player.injuries.length ? player.injuries.map(i => `Roster injury: ${i.status}${i.date ? ` (reported ${i.date})` : ''}; verify current status.`) : ['No listed roster injury does not confirm health.'])] };
  }
  async matchEvent(event: UpcomingEvent): Promise<string> {
    const date = Date.parse(event.commenceTime);
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
    const data = await this.cached(`${ESPN_NFL}/scoreboard?dates=${day(date - 86400_000)}-${day(date + 86400_000)}&limit=100`);
    const matches = (data.events ?? []).filter((e: any) => {
      const c = e.competitions?.[0];
      return Math.abs(Date.parse(e.date) - date) <= 2 * 3600_000
        && nflName(c?.competitors?.find((t: any) => t.homeAway === 'home')?.team?.displayName) === nflName(event.homeTeam)
        && nflName(c?.competitors?.find((t: any) => t.homeAway === 'away')?.team?.displayName) === nflName(event.awayTeam);
    });
    if (matches.length !== 1 || !/^\d+$/.test(matches[0].id)) throw new MarketBoardError('Unique ESPN game could not be verified; paper pick not saved.', 422);
    if (Number(matches[0].season?.type) !== 2) throw new MarketBoardError('Paper testing is limited to regular-season NFL games.', 422);
    return matches[0].id;
  }
  async forecastInputs(event: UpcomingEvent, name: string, market: string): Promise<NflForecastInput> {
    if (!NFL_CORE_STATS[market]) throw new MarketBoardError('Unsupported NFL forecast market.');
    const asOf = new Date(this.now()).toISOString();
    const player = await this.player(event, name);
    const season = nflSeason(event.commenceTime), observations: NflObservation[] = [], sources = [];
    const cutoff = Math.min(Date.parse(asOf), Date.parse(event.commenceTime));
    for (const year of [season - 2, season - 1, season]) {
      const url = `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${player.id}/gamelog?season=${year}`;
      const payload = await this.cached(url);
      // Explicit season identity is required, including genuinely empty current seasons.
      if (String(payload?.filters?.find((f: any) => f.name === 'season')?.value) !== String(year))
        throw new MarketBoardError(`NFL ${year} game-log season could not be verified; forecast unavailable.`, 422);
      observations.push(...parseNflLogs(payload, year, market, cutoff));
      sources.push({ url, season: year, fetchedAt: new Date(this.cache.get(url).at).toISOString() });
    }
    const source = `${ESPN_NFL}/teams/${player.teamId}/depthcharts`;
    let depth = { rows: [], source, sourceTimestamp: null as string | null };
    try {
      const data = await this.cached(source);
      depth = { rows: parseNflDepth(data, player, season), source, sourceTimestamp: data.timestamp ?? null };
    } catch { /* An unavailable depth chart blocks issuance downstream. */ }
    const workloadContext = await this.workloadContext(player, observations, market, cutoff);
    return { player, observations, asOf, depth, sources, workloadContext };
  }
  async workloadContext(player: NflPlayer, observations: NflObservation[], market: string, cutoff: number) {
    // Explicitly bounded to five recent listed appearances. No paid odds calls.
    const rows = [...observations].filter(r => r.teamId === player.teamId && Date.parse(r.date) < cutoff)
      .sort((a,b) => Date.parse(b.date) - Date.parse(a.date)).slice(0,5);
    const verified: WorkloadEvidence[] = [], unavailable: Array<{eventId: string; reason: string}> = [];
    // Two-at-a-time limits load on the best-effort public feed.
    for (let i = 0; i < rows.length; i += 2) {
      await Promise.all(rows.slice(i, i + 2).map(async row => {
        const source = `${ESPN_NFL}/summary?event=${row.eventId}`;
        try {
          const data = await this.summary(row.eventId);
          const fetchedAt = new Date(this.cache.get(source).at).toISOString();
          verified.push(parseWorkloadEvidence(data, row, player, market, cutoff, fetchedAt, source));
        } catch { unavailable.push({ eventId: row.eventId, reason: 'Source missing, conflicting or unverified; no value assumed.' }); }
      }));
    }
    verified.sort((a,b) => Date.parse(b.date) - Date.parse(a.date));
    unavailable.sort((a,b) => a.eventId.localeCompare(b.eventId));
    return { ...summarizeWorkloadEvidence(verified, rows.length), unavailable };
  }
  async summary(id: string) {
    if (!/^\d+$/.test(id)) throw new Error('Invalid ESPN event ID');
    return this.cached(`${ESPN_NFL}/summary?event=${id}`, 60_000);
  }
}
