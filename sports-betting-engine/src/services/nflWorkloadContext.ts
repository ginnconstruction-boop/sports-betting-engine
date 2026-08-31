import { NFL_CORE_STATS, NflObservation, nflName, nflNumber, nflSeason } from './nflResearch';

export interface WorkloadEvidence {
  eventId: string; date: string; teamId: string; playerId: string;
  opportunity: number; teamOpportunity: number; share: number;
  source: string; fetchedAt: string;
}

/** Completed regular-season box scores only. Never read the summary's injury
 * section: even historical summaries can embed CURRENT injuries/rosters. */
export function parseWorkloadEvidence(data: any, row: NflObservation,
  player: { id: string; name: string; teamId: string }, market: string,
  cutoff: number, fetchedAt: string, source: string): WorkloadEvidence {
  const fail = () => { throw new Error('Workload game, player, stat or team total could not be verified.'); };
  const core = NFL_CORE_STATS[market], game = data?.header?.competitions?.[0];
  const date = Date.parse(game?.date ?? '');
  if (!core || !Number.isFinite(cutoff) || !Number.isFinite(date) || !Number.isFinite(Date.parse(row.date)) || date >= cutoff
    || data?.header?.league?.slug !== 'nfl' || Number(data.header?.season?.type) !== 2
    || Number(data.header?.season?.year) !== nflSeason(row.date)
    || String(game?.id) !== row.eventId || Math.abs(date - Date.parse(row.date)) > 60_000
    || game.status?.type?.completed !== true || game.status?.type?.state !== 'post'
    || !['STATUS_FINAL', 'STATUS_FINAL_OVERTIME'].includes(game.status?.type?.name)
    || row.teamId !== player.teamId || !Number.isFinite(Date.parse(fetchedAt))) fail();
  const competitors = game.competitors ?? [];
  const own = competitors.filter((c: any) => String(c.team?.id) === player.teamId);
  const opponent = competitors.filter((c: any) => String(c.team?.id) !== player.teamId);
  if (own.length !== 1 || opponent.length !== 1 || nflName(opponent[0].team?.displayName) !== nflName(row.opponent)) fail();
  const blocks = (data.boxscore?.players ?? []).filter((b: any) => String(b.team?.id) === player.teamId);
  if (blocks.length !== 1) fail();
  const categories = (blocks[0].statistics ?? []).filter((s: any) => s.name === core.category);
  if (categories.length !== 1) fail();
  const category = categories[0], keys = category.keys ?? [];
  const key = core.category === 'passing' ? 'completions/passingAttempts'
    : core.category === 'rushing' ? 'rushingAttempts' : 'receivingTargets';
  if (keys.filter((k: string) => k === key).length !== 1 || keys.filter((k: string) => k === core.field).length !== 1) fail();
  const index = keys.indexOf(key), valueIndex = keys.indexOf(core.field);
  const opportunity = (stats: any[]) => {
    const value = stats?.[index];
    if (core.category !== 'passing') return nflNumber(value);
    if (typeof value !== 'string' || !/^\d+\/\d+$/.test(value)) return null;
    const [completions, attempts] = value.split('/').map(Number);
    return completions <= attempts ? attempts : null;
  };
  const athletes = category.athletes ?? [], ids = athletes.map((a: any) => String(a.athlete?.id ?? ''));
  if (!ids.length || ids.some((id: string) => !/^\d+$/.test(id)) || new Set(ids).size !== ids.length) fail();
  const matches = athletes.filter((a: any) => String(a.athlete?.id) === player.id);
  if (matches.length !== 1 || nflName(matches[0].athlete?.displayName) !== nflName(player.name)) fail();
  const amounts = athletes.map((a: any) => opportunity(a.stats));
  const total = opportunity(category.totals), individual = opportunity(matches[0].stats);
  if (amounts.some((n: any) => !Number.isInteger(n) || n < 0) || !Number.isInteger(total) || total <= 0
    || amounts.reduce((a: number, b: number) => a + b, 0) !== total
    || individual !== row.opportunity || individual < 0 || individual > total
    || nflNumber(matches[0].stats?.[valueIndex]) !== row.value) fail();
  return { eventId: row.eventId, date: row.date, teamId: player.teamId, playerId: player.id,
    opportunity: individual, teamOpportunity: total, share: individual / total, source, fetchedAt };
}

export function summarizeWorkloadEvidence(rows: WorkloadEvidence[], requested: number) {
  const total = rows.reduce((s, r) => s + r.teamOpportunity, 0);
  return { requestedGames: requested, verifiedGames: rows.length,
    pooledOpportunityShare: total > 0 ? rows.reduce((s, r) => s + r.opportunity, 0) / total : null,
    meanTeamOpportunities: rows.length ? total / rows.length : null, rows,
    note: 'Descriptive share of recorded team attempts/targets, NOT snap share or routes. Only listed player games are sampled; absent rows are not zero-filled. Revised box scores are not point-in-time archives. This context does not change the live forecast or unlock recommendations.' };
}

/** Fixed SHADOW candidate. No quote, target-game workload, injury field or
 * post-cutoff observation may enter this function. Not wired to issuance. */
export function nflShareShadowForecast(rows: Array<NflObservation & { teamOpportunity?: number }>) {
  const ordered = [...rows].sort((a,b) => Date.parse(a.date) - Date.parse(b.date)).slice(-20);
  if (ordered.length < 8 || ordered.some(r => !Number.isFinite(r.value) || !Number.isInteger(r.opportunity)
    || r.opportunity < 0 || !Number.isInteger(r.teamOpportunity) || r.teamOpportunity <= 0
    || r.opportunity > r.teamOpportunity)) return null;
  const recent = ordered.slice(-5), sum = (rs: typeof ordered, key: 'value' | 'opportunity' | 'teamOpportunity') => rs.reduce((s,r) => s + r[key], 0);
  const allOpp = sum(ordered, 'opportunity'), recentOpp = sum(recent, 'opportunity');
  if (allOpp <= 0 || recentOpp <= 0) return null;
  const share = .6 * recentOpp / sum(recent, 'teamOpportunity') + .4 * allOpp / sum(ordered, 'teamOpportunity');
  const teamVolume = .6 * sum(recent, 'teamOpportunity') / recent.length + .4 * sum(ordered, 'teamOpportunity') / ordered.length;
  const efficiency = .4 * sum(recent, 'value') / recentOpp + .6 * sum(ordered, 'value') / allOpp;
  return { projection: share * teamVolume * efficiency, share, teamVolume, efficiency, trainingGames: ordered.length };
}
