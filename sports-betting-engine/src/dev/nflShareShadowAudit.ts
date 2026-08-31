// Bounded public-data audit. Never reads keys, odds, current injuries or ledgers.
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { fetchNflJson, parseNflLogs } from '../services/nflResearch';
import { eligibleNflHistory } from '../services/nflForecast';
import { parseWorkloadEvidence } from '../services/nflWorkloadContext';
import { evaluateNflShareShadow } from '../services/nflShadowEvaluation';
import { NflEvidenceArchive } from '../services/nflEvidence';

async function main() {
  const protocolFile = path.resolve('research/NFL_SHADOW_PROTOCOL_2026_08_31.json');
  const raw = fs.readFileSync(protocolFile, 'utf8'), protocol = JSON.parse(raw);
  const output = path.resolve('research/nfl-share-shadow-2026-08-31');
  fs.mkdirSync(output, { recursive: true });
  const resultFile = path.join(output, 'report.json');
  if (fs.existsSync(resultFile)) throw new Error('Frozen report already exists; refusing to rerun/overwrite it.');
  const archive = new NflEvidenceArchive(path.join(output, 'sources'));
  const requestCache = new Map<string, {data: any; fetchedAt: string; hash: string}>();
  const failures = new Map<string, string>(); let requests = 0;
  const get = async (url: string) => {
    if (requestCache.has(url)) return requestCache.get(url);
    if (failures.has(url)) throw new Error(failures.get(url));
    if (requests >= protocol.maxSourceRequests) throw new Error('Protocol request ceiling reached.');
    requests++;
    try {
      const data = await fetchNflJson(url), fetchedAt = new Date().toISOString();
      const evidence = archive.record({ url, fetchedAt, data });
      const value = { data, fetchedAt, hash: evidence.hash }; requestCache.set(url,value); return value;
    } catch { failures.set(url, 'Public source unavailable'); throw new Error('Public source unavailable'); }
  };
  const records = [];
  const protocolHash = createHash('sha256').update(raw).digest('hex');
  // Preserves the design fingerprint before downloading/evaluating any outcomes.
  const registration = archive.record({ protocol, protocolHash, registeredAt: new Date().toISOString() });
  for (const player of protocol.cohort) {
    const observations = [], sourceHashes = [], unavailable = [];
    try {
      for (const season of protocol.seasons) {
        const url = `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${player.id}/gamelog?season=${season}`;
        const s = await get(url), payload = s.data;
        if (String(payload.filters?.find((f:any) => f.name === 'season')?.value) !== String(season)) throw new Error('Season not verified');
        // ESPN game logs omit athlete metadata. Exact ID AND name are checked
        // against every training box-score row by parseWorkloadEvidence below.
        sourceHashes.push(s.hash); observations.push(...parseNflLogs(payload,season,player.market,Date.parse(protocol.evaluationEnd)));
      }
      const { rows, excluded } = eligibleNflHistory(observations,player.teamId,Date.parse(protocol.evaluationEnd),player.market);
      const enriched = [];
      for (let i = 0; i < rows.length; i += 3) {
        await Promise.all(rows.slice(i,i+3).map(async row => {
          const url = `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${row.eventId}`;
          try {
            const s = await get(url), evidence = parseWorkloadEvidence(s.data,row,player,player.market,Date.parse(protocol.evaluationEnd),s.fetchedAt,url);
            sourceHashes.push(s.hash); enriched.push({...row,teamOpportunity:evidence.teamOpportunity});
          } catch {
            enriched.push({...row}); unavailable.push({eventId:row.eventId,reason:'Workload source failed verification; retained as missing, not silently dropped.'});
          }
        }));
      }
      const evaluation = evaluateNflShareShadow(enriched,Date.parse(protocol.evaluationStart),Date.parse(protocol.evaluationEnd));
      records.push({ ...player, status:evaluation.tested?'evaluated':'insufficient_data', usableGameLogs:rows.length,
        excludedLogs:excluded, missingWorkload:unavailable.sort((a,b)=>a.eventId.localeCompare(b.eventId)),
        sources:[...new Set(sourceHashes)].sort(), observations:enriched.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)), ...evaluation });
      console.log(JSON.stringify({player:player.name,market:player.market,tested:evaluation.tested,excluded:evaluation.excluded.length,
        meanMae:evaluation.meanMae,workloadMae:evaluation.workloadMae,shadowMae:evaluation.shadowMae}));
    } catch (e) { records.push({...player,status:'unavailable',reason:(e as Error).message});console.log(`${player.name} ${player.market}: unavailable`); }
  }
  const report = {protocolHash,registration:registration.hash,createdAt:new Date().toISOString(),mode:'shadow_stat_research_only',
    requests,oddsCreditsUsed:0,sourceFailures:[...failures.keys()],records,restrictions:protocol.restrictions,promoted:false};
  fs.writeFileSync(resultFile,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({report:resultFile,requests,sourceFailures:failures.size,records:records.length,promoted:false}));
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1;});
