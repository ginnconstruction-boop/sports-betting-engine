import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
import type {NflPaperPick} from '../services/nflPaper';
import {CollegeEdgeResearchRow,DEFAULT_COLLEGE_EDGE_RESEARCH_CONFIG,renderCollegeEdgeResearchReport,runCollegeEdgeResearch} from '../services/collegeEdgeResearch';
import {collegeDivision} from '../services/collegeContext';

const repository=path.resolve(__dirname,'../..');
const archiveRoot=path.join(repository,'snapshots','college-model-v1');
const read=(file:string)=>JSON.parse(fs.readFileSync(file,'utf8'));
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');

function scheduleContext(){
  const result=new Map<string,any>(),directory=path.join(archiveRoot,'sources');
  for(const name of fs.readdirSync(directory).filter(name=>name.startsWith('2025-')).sort()){
    const payload=read(path.join(directory,name));
    for(const event of payload?.data?.events??[])result.set(String(event.id),event);
  }
  return result;
}

const median=(values:number[])=>{const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
function representativeSpread(row:any,asOf:string){
  const seen=new Set<string>(),quotes:any[]=[];
  for(const item of [...(row.assessed??[]),...(row.selected??[])]){const q=item?.quote;if(q?.market!=='spreads'||q.participant||q.stale||!Number.isFinite(q.line)
      ||!Number.isFinite(q.price)||Math.abs(q.price)<100||!q.bookKey||!Number.isFinite(Date.parse(q.updatedAt))||Date.parse(q.updatedAt)>Date.parse(asOf))continue;
    const key=[q.bookKey,q.side,q.line,q.price,q.updatedAt].join('|');if(!seen.has(key)){seen.add(key);quotes.push(q);}}
  const pairs:any[]=[];
  for(const bookKey of [...new Set(quotes.map(q=>String(q.bookKey)))].sort()){
    const book=quotes.filter(q=>q.bookKey===bookKey),homes=book.filter(q=>q.side===row.event.homeTeam),aways=book.filter(q=>q.side===row.event.awayTeam);
    if(homes.length!==1||aways.length!==1||homes[0].line!==-aways[0].line)continue;pairs.push({bookKey,home:homes[0],away:aways[0]});
  }
  if(!pairs.length)return null;const consensus=median(pairs.map(p=>p.home.line)),edge=row.projection.homeMargin+consensus;
  if(edge===0)return null;const side=edge>0?'home':'away';
  const pair=[...pairs].sort((a,b)=>Math.abs(a.home.line-consensus)-Math.abs(b.home.line-consensus)
    ||Date.parse(b[side].updatedAt)-Date.parse(a[side].updatedAt)||a.bookKey.localeCompare(b.bookKey))[0];
  return {quote:pair[side],homeLine:pair.home.line,consensusHomeLine:consensus,books:pairs.length,side};
}

export function reconstructedRows():CollegeEdgeResearchRow[]{
  const registered=read(path.join(archiveRoot,'registered-protocol.json'));
  const frozen=registered.protocol.oddsAudit.dates.map((date:string)=>read(path.join(archiveRoot,'frozen',`${date}.json`)));
  const holdout=read(path.join(archiveRoot,'holdout-report.json')).rows??[];
  const outcomeByEspn=new Map<string,any>(holdout.map((row:any)=>[String(row.id),row]));
  const schedule=scheduleContext();
  return frozen.flatMap((day:any)=>(day.rows??[]).flatMap((frozenRow:any)=>{
    if(!frozenRow?.projection||!frozenRow?.identity)return[];const representative=representativeSpread(frozenRow,day.asOf);if(!representative)return[];
    const score=outcomeByEspn.get(String(frozenRow.identity.espnEventId)),event=schedule.get(String(frozenRow.identity.espnEventId));if(!score)return[];
    const home=event?.competitions?.[0]?.competitors?.find((x:any)=>x.homeAway==='home')?.team;
    const away=event?.competitions?.[0]?.competitors?.find((x:any)=>x.homeAway==='away')?.team;
    const hd=collegeDivision(2025,String(home?.conferenceId??'')),ad=collegeDivision(2025,String(away?.conferenceId??''));
    const matchup=hd==='UNKNOWN'||ad==='UNKNOWN'?'UNKNOWN':hd===ad?`${hd} vs ${ad}`:'FBS vs FCS';
    const q=representative.quote;
    return [{observationId:`reconstructed-all-sides:${day.date}:${frozenRow.event.id}:${q.bookKey}:${q.side}:${q.line}:${q.price}`,
      gameId:String(frozenRow.identity.espnEventId),evidenceClass:'RECONSTRUCTED_FORECAST' as const,
      sourceLabel:'six-date-2025-all-model-sides-consensus-adjacent-exact-quote',homeTeam:frozenRow.event.homeTeam,awayTeam:frozenRow.event.awayTeam,
      kickoff:frozenRow.event.commenceTime,forecastAt:day.asOf,inputsAsOf:frozenRow.projection.asOf,modelVersion:frozenRow.projection.version,
      modelHomeMargin:frozenRow.projection.homeMargin,actualHomeMargin:Number.isFinite(score?.margin)?score.margin:null,marketHomeSpread:representative.homeLine,
      americanPrice:q.price,archivedResult:null,quoteUpdatedAt:q.updatedAt,week:Number.isInteger(event?.week?.number)?event.week.number:null,
      homeConference:String(home?.conferenceId??'')||null,awayConference:String(away?.conferenceId??'')||null,matchupClass:matchup,
      neutralSite:typeof frozenRow.identity.neutralSite==='boolean'?frozenRow.identity.neutralSite:null,contextCritical:null,
      comparisonHomeSpread:null,comparisonKind:null}];
  }));
}

function syntheticRows():CollegeEdgeResearchRow[]{
  const report=read(path.join(archiveRoot,'holdout-report.json'));
  return (report.rows??[]).map((row:any)=>({observationId:`derived-margin:${row.id}`,gameId:String(row.id),
    evidenceClass:'SYNTHETIC_DERIVED_RESEARCH' as const,sourceLabel:'chronological-2025-score-replay',homeTeam:'NOT_STORED_IN_REPORT',awayTeam:'NOT_STORED_IN_REPORT',
    kickoff:row.date,forecastAt:row.projection.asOf,inputsAsOf:row.projection.asOf,modelVersion:row.projection.version,
    modelHomeMargin:row.projection.homeMargin,actualHomeMargin:row.margin,marketHomeSpread:null,americanPrice:null,archivedResult:null,
    week:null,homeConference:null,awayConference:null,matchupClass:null,neutralSite:row.projection.neutral,contextCritical:null,
    comparisonHomeSpread:null,comparisonKind:null}));
}

/** Optional adapter for an exported deployed ledger. It never fetches, grades, or mutates picks. */
export function archivedLiveRows(picks:NflPaperPick[]):CollegeEdgeResearchRow[]{
  return picks.flatMap(p=>{
    const f=p.collegeForecast,identity=p.verifiedEvent,q=p.quote,e=p.resultEvidence;
    if(p.origin!=='model'||q.market!=='spreads'||!f||!identity||!Number.isFinite(q.line))return[];
    const marketHomeSpread=q.side===p.event.homeTeam?q.line:q.side===p.event.awayTeam?-(q.line as number):null;
    const actualHomeMargin=Number.isFinite(e?.homeFinalScore)&&Number.isFinite(e?.awayFinalScore)?(e!.homeFinalScore as number)-(e!.awayFinalScore as number):null;
    const checks:any=f.safety?.checks??{},critical={canonicalIds:checks.canonicalIds,providerLine:checks.providerLine,venueKnown:checks.venueKnown,
      qbKnown:checks.qbKnown,injuriesVerified:checks.injuriesVerified,criticalContextComplete:checks.criticalContextComplete};
    const observations=(p.collegeLineObservations??[]).filter(o=>o.nearClose&&o.bookKey===q.bookKey&&o.side===q.side)
      .sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
    const comparison=observations[0],comparisonHomeSpread=comparison?(comparison.side===p.event.homeTeam?comparison.line:-comparison.line):null;
    return [{observationId:`live:${p.id}`,gameId:p.espnEventId,evidenceClass:'ARCHIVED_LIVE_FORECAST' as const,sourceLabel:'immutable-deployed-paper-ledger',
      homeTeam:p.event.homeTeam,awayTeam:p.event.awayTeam,kickoff:p.event.commenceTime,forecastAt:p.savedAt,inputsAsOf:f.projection.asOf,
      resolvedAt:e?.eventCompletionTimestamp??p.gradedAt??null,modelVersion:p.version,modelHomeMargin:f.projection.homeMargin,actualHomeMargin,
      marketHomeSpread,americanPrice:q.price,archivedResult:p.result as any,quoteUpdatedAt:q.updatedAt,
      week:identity.week??null,homeConference:identity.homeConferenceId??null,awayConference:identity.awayConferenceId??null,
      matchupClass:f.safety?.mismatch?.isMismatch?'FBS vs FCS':f.safety?.mismatch?.homeDivision&&f.safety?.mismatch?.awayDivision
        ?`${f.safety.mismatch.homeDivision} vs ${f.safety.mismatch.awayDivision}`:null,neutralSite:identity.neutralSite,contextCritical:critical,
      comparisonHomeSpread,comparisonKind:comparison?'LATEST_PRE_KICK_PROXY':null}];
  });
}

function optionalLiveRows(){
  const arg=process.argv.find(value=>value.startsWith('--live-ledger='));if(!arg)return [];
  const file=path.resolve(arg.slice('--live-ledger='.length)),payload=read(file),picks=Array.isArray(payload)?payload:(payload.picks??[]);
  return archivedLiveRows(picks);
}
function requestedTimestamp(){const arg=process.argv.find(value=>value.startsWith('--generated-at='));return arg?arg.slice('--generated-at='.length):new Date().toISOString();}

function writeExclusive(file:string,contents:string){fs.writeFileSync(file,contents,{flag:'wx'});}
function main(){
  const rows=[...reconstructedRows(),...syntheticRows(),...optionalLiveRows()],generatedAt=requestedTimestamp();
  const config=read(path.join(repository,'research','college-edge-research-v1-config.json')) as typeof DEFAULT_COLLEGE_EDGE_RESEARCH_CONFIG;
  const applicationVersion=String(read(path.join(repository,'package.json')).version??'NOT_RECORDED');
  const artifact=runCollegeEdgeResearch(rows,{generatedAt,config,applicationVersion});
  const runId=`${artifact.schemaVersion}-${artifact.datasetHash.slice(0,12)}-${generatedAt.replace(/[:.]/g,'-')}`;
  const outputRoot=path.join(repository,'research','results','college-edge-research-v1');fs.mkdirSync(outputRoot,{recursive:true});
  const directory=path.join(outputRoot,runId);
  const dates=read(path.join(archiveRoot,'registered-protocol.json')).protocol.oddsAudit.dates as string[];
  const sources=['configuration-lock.json','registered-protocol.json','odds-audit-report.json','holdout-report.json',
    ...dates.map(date=>`frozen/${date}.json`),...fs.readdirSync(path.join(archiveRoot,'sources')).filter(name=>name.startsWith('2025-')).sort().map(name=>`sources/${name}`)];
  const manifest={runId,generatedAt:artifact.generatedAt,datasetHash:artifact.datasetHash,configurationHash:artifact.configurationHash,
    evidencePolicy:artifact.evidencePolicy,evidenceClassification:{reconstructed:'Frozen model replay plus archived pregame sportsbook quotes; not an untouched live forecast.',
      syntheticDerived:'Chronological score-model replay without a sportsbook line; projection-error research only.',archivedLive:'Included only when an explicit exported immutable ledger is supplied.'},
    quoteSelectionRule:'For every forecasted game, form valid fresh symmetric book pairs; compute the median home spread; choose the model side from that median; use the exact side/price from the pair nearest the median, then newest timestamp, then book key. No result or existing recommendation gate is consulted.',
    codeHashes:{engine:sha(fs.readFileSync(path.join(repository,'src','services','collegeEdgeResearch.ts'))),adapter:sha(fs.readFileSync(__filename)),
      configurationFile:sha(fs.readFileSync(path.join(repository,'research','college-edge-research-v1-config.json')))},
    sourceFiles:Object.fromEntries(sources.map(name=>{const file=path.join(archiveRoot,name);return [name,{sha256:sha(fs.readFileSync(file)),bytes:fs.statSync(file).size}];})),
    liveLedgerIncluded:rows.some(row=>row.evidenceClass==='ARCHIVED_LIVE_FORECAST'),reproductionCommand:`npm run research:college-edge -- --generated-at=${artifact.generatedAt}`};
  const files={'artifact.json':JSON.stringify(artifact,null,2),'report.md':renderCollegeEdgeResearchReport(artifact),'manifest.json':JSON.stringify(manifest,null,2)};
  let reproducibilityVerified=false;
  if(fs.existsSync(directory)){
    for(const [name,contents] of Object.entries(files)){const file=path.join(directory,name);if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==contents)
      throw new Error(`Immutable research run collision at ${file}; inputs, code, or output changed.`);}reproducibilityVerified=true;
  }else{fs.mkdirSync(directory,{recursive:false});for(const [name,contents] of Object.entries(files))writeExclusive(path.join(directory,name),contents);}
  console.log(JSON.stringify({directory,reproducibilityVerified,inventory:artifact.datasetInventory,evidence:Object.fromEntries(Object.entries(artifact.evidence).map(([k,v]:any)=>[k,{counts:v.counts,overall:v.overall,monotonicity:v.monotonicity}]))},null,2));
}

if(require.main===module)main();
