import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { UpcomingEvent } from '../api/oddsApiClient';
import type { NflForecastInput } from './nflForecast';

export interface GameAvailability {
  eventId: string; playerId: string; teamId: string;
  status: 'active' | 'inactive' | 'unknown';
  source: string; sourceKind: 'official_game_status'; publishedAt: string; fetchedAt: string;
}
export function availabilityReasons(a: GameAvailability | undefined, input: NflForecastInput, event: UpcomingEvent, now: number): string[] {
  if (!a) return ['Verified game-specific availability is missing; an active roster/depth slot is not enough.'];
  const published = Date.parse(a.publishedAt), fetched = Date.parse(a.fetchedAt), kickoff = Date.parse(event.commenceTime);
  if (a.eventId !== event.id || a.playerId !== input.player.id || a.teamId !== input.player.teamId
    || a.sourceKind !== 'official_game_status' || !a.source.startsWith('https://')
    || !Number.isFinite(published) || !Number.isFinite(fetched) || published > fetched || fetched > now
    || now - fetched > 10 * 60_000 || published < kickoff - 6 * 3600_000 || published >= kickoff)
    return ['Game-availability identity, source or timestamps are unverified/stale.'];
  return a.status === 'active' ? [] : ['Game-specific player availability is ' + a.status + '; no automatic paper selection.'];
}
/** Append-only source evidence, including blocked forecasts. No source IDs
 * are inferred from names. Team membership is time-scoped to this snapshot,
 * not retroactively assigned to prior games or treated as a transaction log. */
export class NflEvidenceArchive {
  constructor(private dir: string) {}
  record(payload: unknown): { hash: string; file: string } {
    const bytes = JSON.stringify({ schema: 1, payload });
    const hash = createHash('sha256').update(bytes).digest('hex');
    const file = path.join(this.dir, hash + '.json');
    fs.mkdirSync(this.dir, { recursive: true });
    try { fs.writeFileSync(file, bytes, { flag: 'wx' }); }
    catch (e: any) {
      if (e.code !== 'EEXIST' || fs.readFileSync(file, 'utf8') !== bytes) throw new Error('Forecast evidence could not be preserved; no recommendation issued.');
    }
    return { hash, file: path.basename(file) };
  }
  read(hash: string): any {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid evidence fingerprint.');
    const bytes = fs.readFileSync(path.join(this.dir, hash + '.json'), 'utf8');
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Evidence integrity check failed.');
    const data = JSON.parse(bytes);
    if (data.schema !== 1) throw new Error('Unsupported evidence schema.');
    return data.payload;
  }
}
export function nflInputCoverage(input: NflForecastInput) {
  return { playerIdentity: 'Exact ESPN player/team IDs; snapshot membership, not full transaction history.',
    availability: input.availability ? 'Game-specific evidence supplied; freshness checked separately.' : 'Missing verified game-specific availability.',
    workload: 'Attempts/targets and recorded production only.',
    missingFeatures: ['cross-provider ID feed', 'historical transactions', 'dated practice reports', 'snap share',
      'routes', 'red-zone opportunities', 'teammate absences', 'starting QB/line/coaching changes',
      'opponent-adjusted EPA/success/pressure', 'neutral-situation pace', 'verified venue/roof weather'],
    modelChangesEnabled: false };
}
