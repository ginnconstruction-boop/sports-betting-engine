import * as fs from 'fs';
import * as path from 'path';
import {createHash,randomUUID} from 'crypto';

export const COLLEGE_CONTEXT_EVIDENCE_VERSION='college-context-evidence-v1';
export type ContextDomain='qb'|'roster'|'returning_production'|'transfers'|'coaching'|'talent'|'fcs'|'injuries'|'weather'|'current_season'|'market';
export type ContextIngestionReason='SUCCESS'|'PARTIAL_SUCCESS'|'NO_PROVIDER_CONFIGURED'|'NO_SOURCE_ATTEMPTED'|'SOURCE_RETURNED_EMPTY'|
  'SOURCE_FIELD_UNAVAILABLE'|'SOURCE_HTTP_ERROR'|'SOURCE_RATE_LIMITED'|'SOURCE_AUTH_FAILED'|'PARSER_FAILED'|'TEAM_MATCH_FAILED'|'STALE_SOURCE'|
  'CONFLICTING_SOURCES'|'VALIDATION_FAILED'|'STORE_FAILED'|'LOAD_FAILED'|'DATA_PROVIDER_UNAVAILABLE';
export type QbStatus='CONFIRMED'|'EXPECTED'|'COMPETITION'|'QUESTIONABLE'|'OUT'|'UNKNOWN';
export type AvailabilityStatus='OUT'|'DOUBTFUL'|'QUESTIONABLE'|'PROBABLE'|'AVAILABLE'|'UNKNOWN';
export type ContextReliability='HIGH'|'MEDIUM'|'LOW'|'INSUFFICIENT';
export type VerificationStatus='VERIFIED'|'CORROBORATED'|'REPORTED'|'CONFLICTED'|'UNVERIFIED';
export interface ContextSource {
  name:string;url:string;tier:1|2|3|4;reliability:Exclude<ContextReliability,'INSUFFICIENT'>;
  publishedAt:string;retrievedAt:string;
}
export interface CollegeContextRecord {
  id:string;schema:1;teamId:string;teamName:string;season:number;eventId:string|null;playerId:string|null;
  domain:ContextDomain;field:string;value:unknown;effectiveFrom:string;effectiveTo:string|null;
  source:ContextSource;verification:VerificationStatus;rawPayloadHash:string;
}
export type NewCollegeContextRecord=Omit<CollegeContextRecord,'id'|'schema'>;
export interface ResolvedContextField {
  field:string;value:unknown;status:'AVAILABLE'|'MISSING'|'STALE'|'CONFLICT';reliability:ContextReliability;
  records:CollegeContextRecord[];diagnosticReason:ContextIngestionReason|null;
}
export interface ContextSection {
  status:'complete'|'partial'|'missing'|'conflict';coverage:number;reliability:ContextReliability;
  fields:Record<string,ResolvedContextField>;
}
export type ContextPipelineStage='PASS'|'PARTIAL'|'FAIL'|'UNKNOWN';
export interface ContextPipelineDiagnostic {
  forecastAt:string;sourceResult:string;sourceName:string|null;latestSourceRetrievedAt:string|null;
  stages:{SOURCE_SUCCESS:ContextPipelineStage;NORMALIZATION_SUCCESS:ContextPipelineStage;ENTITY_MATCH_SUCCESS:ContextPipelineStage;
    CONTEXT_ATTACHED:ContextPipelineStage;FIELD_VALID:ContextPipelineStage;FRESH_AT_FORECAST_TIME:ContextPipelineStage};
  validFields:number;requiredFields:number;freshFields:number;
}

export const QB_STATUS_ORDER:Record<QbStatus,number>={CONFIRMED:5,EXPECTED:4,COMPETITION:3,QUESTIONABLE:2,OUT:1,UNKNOWN:0};
export const AVAILABILITY_STATUS_ORDER:Record<AvailabilityStatus,number>={AVAILABLE:5,PROBABLE:4,QUESTIONABLE:3,DOUBTFUL:2,OUT:1,UNKNOWN:0};
export const CONTEXT_COMPLETENESS_POLICY={version:'college-context-coverage-v1',weights:{roster:.03,qb:.20,returningProduction:.15,transfers:.15,
  coaching:.10,talentDepth:.12,injuries:.10,weather:.10,currentSample:.05}} as const;
const RELIABILITY_SCORE:Record<ContextReliability,number>={INSUFFICIENT:0,LOW:1,MEDIUM:2,HIGH:3};
const DOMAIN_TTL:Record<ContextDomain,number>={qb:72*3600_000,roster:30*86400_000,returning_production:180*86400_000,
  transfers:30*86400_000,coaching:180*86400_000,talent:180*86400_000,fcs:30*86400_000,injuries:24*3600_000,weather:6*3600_000,
  current_season:24*3600_000,market:6*3600_000};
const REQUIRED={
  roster:['roster.currentSeasonAvailable'],
  qb:['qb.status','qb.starterName'],
  returningProduction:['returning.overallPct','returning.offensePct','returning.defensePct'],
  transfers:['transfers.additions','transfers.departures','transfers.quality'],
  coaching:['coaching.headCoach','coaching.newHeadCoach','coaching.offensiveCoordinator','coaching.newOc','coaching.defensiveCoordinator','coaching.newDc','coaching.playCallerContinuity'],
  talentDepth:['talent.rosterComposite','talent.depthTier','talent.classification'],
  injuries:['injuries.teamStatus'],
  weather:['weather.temperatureF','weather.feelsLikeF','weather.windMph','weather.gustMph','weather.precipitationProbability','weather.precipitationMm','weather.humidityPct','weather.indoor'],
  currentSeason:['current.gamesPlayed','current.lastOpponent','current.lastScore','current.pointsPerGame','current.yardsPerGame','current.pointsAllowedPerGame','current.yardsAllowedPerGame','current.primaryQb','current.qbAttempts'],
} as const;
const INGESTION_FIELDS:Record<ContextDomain,string>={qb:'qb.ingestionStatus',roster:'roster.ingestionStatus',returning_production:'returning.ingestionStatus',
  transfers:'transfers.ingestionStatus',coaching:'coaching.ingestionStatus',talent:'talent.ingestionStatus',fcs:'fcs.ingestionStatus',injuries:'injuries.ingestionStatus',
  weather:'weather.ingestionStatus',current_season:'current.ingestionStatus',market:'market.ingestionStatus'};
export const SOURCE_STATUS_FIELDS:Record<ContextDomain,string>={qb:'qb.sourceStatus',roster:'roster.sourceStatus',returning_production:'returning.sourceStatus',
  transfers:'transfers.sourceStatus',coaching:'coaching.sourceStatus',talent:'talent.sourceStatus',fcs:'fcs.sourceStatus',injuries:'injuries.sourceStatus',
  weather:'weather.sourceStatus',current_season:'current.sourceStatus',market:'market.sourceStatus'};
const INGESTION_FAILURES=new Set<ContextIngestionReason>(['NO_PROVIDER_CONFIGURED','SOURCE_RETURNED_EMPTY','SOURCE_FIELD_UNAVAILABLE','SOURCE_HTTP_ERROR',
  'SOURCE_RATE_LIMITED','SOURCE_AUTH_FAILED','PARSER_FAILED','TEAM_MATCH_FAILED','VALIDATION_FAILED','STORE_FAILED','LOAD_FAILED','DATA_PROVIDER_UNAVAILABLE']);

function stable(value:any):string {
  if(Array.isArray(value))return'['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function finiteDate(value:string){return typeof value==='string'&&Number.isFinite(Date.parse(value));}
function validValue(value:unknown){
  if(value===undefined)return false;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value==='string')return value.length>0&&value.length<=1000;
  if(typeof value==='boolean')return true;if(value===null)return false;
  try{return stable(value).length<=20_000;}catch{return false;}
}
export function validateContextRecord(row:NewCollegeContextRecord){
  if(!/^\d+$/.test(row.teamId)||!row.teamName||!Number.isInteger(row.season)||row.season<2023||row.season>2100)throw Error('Invalid context team/season');
  if(row.eventId!==null&&!/^\d+$/.test(row.eventId)||row.playerId!==null&&!row.playerId)throw Error('Invalid context event/player identity');
  if(!row.domain||!row.field||!validValue(row.value)||!finiteDate(row.effectiveFrom)||row.effectiveTo!==null&&!finiteDate(row.effectiveTo))throw Error('Invalid context field/effective date');
  const source=row.source;
  if(!source||!source.name||!/^https:\/\//.test(source.url)||![1,2,3,4].includes(source.tier)||!['HIGH','MEDIUM','LOW'].includes(source.reliability)
    ||!finiteDate(source.publishedAt)||!finiteDate(source.retrievedAt))throw Error('Invalid context source');
  if(Date.parse(source.publishedAt)>Date.parse(source.retrievedAt)||Date.parse(row.effectiveFrom)>Date.parse(source.retrievedAt)
    ||row.effectiveTo!==null&&Date.parse(row.effectiveTo)<=Date.parse(row.effectiveFrom))throw Error('Future or reversed context dates');
  if(!['VERIFIED','CORROBORATED','REPORTED','CONFLICTED','UNVERIFIED'].includes(row.verification)||!/^[a-f0-9]{64}$/.test(row.rawPayloadHash))throw Error('Invalid verification/payload hash');
  if(row.field==='qb.status'&&!Object.hasOwn(QB_STATUS_ORDER,String(row.value)))throw Error('Invalid QB status');
  if(row.field==='injury.status'&&!Object.hasOwn(AVAILABILITY_STATUS_ORDER,String(row.value)))throw Error('Invalid injury status');
}
function directory(root:string){return path.join(root,'college_context','evidence-v1');}
export function loadCollegeContextRecords(root:string):CollegeContextRecord[]{
  const index=path.join(directory(root),'index.json');if(!fs.existsSync(index))return[];
  const data=JSON.parse(fs.readFileSync(index,'utf8'));
  if(data.schema!==1||data.version!==COLLEGE_CONTEXT_EVIDENCE_VERSION||!Array.isArray(data.records))throw Error('Invalid college context evidence index');
  return data.records.map((row:any)=>{const {id,schema,...incoming}=row;validateContextRecord(incoming);if(schema!==1||id!==createHash('sha256').update(stable(incoming)).digest('hex'))throw Error('Context record integrity failure');return row;});
}
/** Atomic append-only index plus a content-addressed copy of every field record. */
export function appendCollegeContextRecords(root:string,incoming:NewCollegeContextRecord[]){
  if(!Array.isArray(incoming)||incoming.length>50_000)throw Error('Expected at most 50000 context records');
  const existing=loadCollegeContextRecords(root),byId=new Map(existing.map(r=>[r.id,r])),dir=directory(root);fs.mkdirSync(path.join(dir,'records'),{recursive:true});
  for(const row of incoming){validateContextRecord(row);const id=createHash('sha256').update(stable(row)).digest('hex'),record:CollegeContextRecord={id,schema:1,...structuredClone(row)};
    const prior=byId.get(id);if(prior)continue;byId.set(id,record);
    const bytes=JSON.stringify(record,null,2),file=path.join(dir,'records',id+'.json');try{fs.writeFileSync(file,bytes,{flag:'wx'});}catch(e:any){if(e.code!=='EEXIST'||fs.readFileSync(file,'utf8')!==bytes)throw e;}
  }
  const records=[...byId.values()].sort((a,b)=>Date.parse(a.source.retrievedAt)-Date.parse(b.source.retrievedAt)||a.id.localeCompare(b.id));
  const tmp=path.join(dir,randomUUID()+'.tmp');fs.writeFileSync(tmp,JSON.stringify({schema:1,version:COLLEGE_CONTEXT_EVIDENCE_VERSION,records},null,2),{flag:'wx'});
  fs.renameSync(tmp,path.join(dir,'index.json'));return{added:records.length-existing.length,total:records.length};
}
export function materializeCollegeContextRecords(incoming:NewCollegeContextRecord[]):CollegeContextRecord[]{
  return incoming.map(row=>{validateContextRecord(row);return{id:createHash('sha256').update(stable(row)).digest('hex'),schema:1,...structuredClone(row)};});
}
export function hashCollegeContextPayload(payload:unknown){return createHash('sha256').update(stable(payload)).digest('hex');}
export function archiveCollegeContextPayload(root:string,payload:unknown){
  const hash=hashCollegeContextPayload(payload),dir=path.join(directory(root),'raw');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,hash+'.json');try{fs.writeFileSync(file,JSON.stringify(payload),{flag:'wx'});}catch(e:any){if(e.code!=='EEXIST')throw e;}
  return hash;
}
function applicable(row:CollegeContextRecord,teamId:string,season:number,eventId:string,asOf:number){
  return row.teamId===teamId&&row.season===season&&(row.eventId===null||row.eventId===eventId)
    &&Date.parse(row.source.publishedAt)<=asOf&&Date.parse(row.source.retrievedAt)<=asOf&&Date.parse(row.effectiveFrom)<=asOf
    &&(row.effectiveTo===null||Date.parse(row.effectiveTo)>asOf);
}
function isUnknown(value:unknown){return value===null||value==='UNKNOWN'||value==='UNKNOWN_FCS'||value==='unavailable';}
export function resolveContextField(records:CollegeContextRecord[],args:{teamId:string;season:number;eventId:string;field:string;asOf:number}):ResolvedContextField{
  const domain=(Object.entries(INGESTION_FIELDS).find(([,field])=>field.split('.')[0]===args.field.split('.')[0])?.[0]??
    (args.field.startsWith('injury.')?'injuries':args.field.startsWith('fcs.')?'fcs':null)) as ContextDomain|null;
  const diagnostic=domain?records.filter(r=>r.field===INGESTION_FIELDS[domain]&&applicable(r,args.teamId,args.season,args.eventId,args.asOf))
    .sort((a,b)=>Date.parse(b.source.retrievedAt)-Date.parse(a.source.retrievedAt))[0]:undefined;
  const fieldDiagnostic=records.filter(r=>r.field===`${args.field}.diagnostic`&&applicable(r,args.teamId,args.season,args.eventId,args.asOf))
    .sort((a,b)=>Date.parse(b.source.retrievedAt)-Date.parse(a.source.retrievedAt))[0];
  const missingReason=():ContextIngestionReason=>fieldDiagnostic&&INGESTION_FAILURES.has(fieldDiagnostic.value as ContextIngestionReason)
    ?fieldDiagnostic.value as ContextIngestionReason:diagnostic&&INGESTION_FAILURES.has(diagnostic.value as ContextIngestionReason)
      ?diagnostic.value as ContextIngestionReason:diagnostic?'SOURCE_RETURNED_EMPTY':'NO_SOURCE_ATTEMPTED';
  const known=records.filter(r=>r.field===args.field&&applicable(r,args.teamId,args.season,args.eventId,args.asOf));
  if(!known.length)return{field:args.field,value:null,status:'MISSING',reliability:'INSUFFICIENT',records:[],diagnosticReason:missingReason()};
  const fresh=known.filter(r=>args.asOf-Date.parse(r.source.retrievedAt)<=DOMAIN_TTL[r.domain]);
  if(!fresh.length)return{field:args.field,value:null,status:'STALE',reliability:'INSUFFICIENT',records:known,diagnosticReason:'STALE_SOURCE'};
  const allOrdered=[...fresh].sort((a,b)=>Date.parse(b.source.retrievedAt)-Date.parse(a.source.retrievedAt)),bySource=new Map<string,CollegeContextRecord>();
  for(const row of allOrdered){const key=`${row.source.name}|${row.source.url}`;if(!bySource.has(key))bySource.set(key,row);}const latestBySource=[...bySource.values()];
  const ordered=latestBySource.sort((a,b)=>a.source.tier-b.source.tier||RELIABILITY_SCORE[b.source.reliability]-RELIABILITY_SCORE[a.source.reliability]
    ||Date.parse(b.source.retrievedAt)-Date.parse(a.source.retrievedAt));
  const top=ordered[0],peers=ordered.filter(r=>r.source.tier===top.source.tier&&r.source.reliability===top.source.reliability);
  const values=new Set(peers.map(r=>stable(r.value)));
  if(values.size>1||peers.some(r=>r.verification==='CONFLICTED'))return{field:args.field,value:null,status:'CONFLICT',reliability:'LOW',records:allOrdered,diagnosticReason:'CONFLICTING_SOURCES'};
  if(isUnknown(top.value))return{field:args.field,value:top.value,status:'MISSING',reliability:top.source.reliability,records:allOrdered,diagnosticReason:missingReason()};
  return{field:args.field,value:top.value,status:'AVAILABLE',reliability:top.source.reliability,records:allOrdered,diagnosticReason:null};
}
function section(records:CollegeContextRecord[],args:{teamId:string;season:number;eventId:string;asOf:number},fields:readonly string[]):ContextSection{
  const resolved=Object.fromEntries(fields.map(field=>[field,resolveContextField(records,{...args,field})]));
  const available=Object.values(resolved).filter(f=>f.status==='AVAILABLE'),conflict=Object.values(resolved).some(f=>f.status==='CONFLICT');
  const coverage=available.length/fields.length,reliability=available.length?available.reduce((min,f)=>RELIABILITY_SCORE[f.reliability]<RELIABILITY_SCORE[min]?f.reliability:min,'HIGH' as ContextReliability):'INSUFFICIENT';
  return{status:conflict?'conflict':coverage===1?'complete':coverage>0?'partial':'missing',coverage,reliability,fields:resolved};
}
function stage(ok:boolean|null,partial=false):ContextPipelineStage{return ok===null?'UNKNOWN':ok?(partial?'PARTIAL':'PASS'):'FAIL';}
function pipeline(records:CollegeContextRecord[],args:{teamId:string;season:number;eventId:string;asOf:number},domain:ContextDomain,value:ContextSection):ContextPipelineDiagnostic{
  const relevant=records.filter(row=>row.domain===domain&&applicable(row,args.teamId,args.season,args.eventId,args.asOf));
  const latest=(field:string)=>relevant.filter(row=>row.field===field).sort((a,b)=>Date.parse(b.source.retrievedAt)-Date.parse(a.source.retrievedAt))[0];
  const sourceRow=latest(SOURCE_STATUS_FIELDS[domain]),ingestionRow=latest(INGESTION_FIELDS[domain]);
  const sourceResult=String(sourceRow?.value??ingestionRow?.value??'NO_SOURCE_ATTEMPTED');
  const sourceOk=['SUCCESS','PARTIAL_SUCCESS','AVAILABLE'].includes(sourceResult),sourceFailed=!sourceOk&&sourceResult!=='NO_SOURCE_ATTEMPTED';
  const normalized=relevant.filter(row=>row.field!==SOURCE_STATUS_FIELDS[domain]&&row.field!==INGESTION_FIELDS[domain]
    &&!row.field.endsWith('.diagnostic')&&!row.field.endsWith('providerChecked'));
  const valid=Object.values(value.fields).filter(field=>field.status==='AVAILABLE').length;
  const fresh=Object.values(value.fields).filter(field=>field.status==='AVAILABLE'&&field.records.some(row=>args.asOf-Date.parse(row.source.retrievedAt)<=DOMAIN_TTL[row.domain])).length;
  const matchFailed=sourceResult==='TEAM_MATCH_FAILED'||String(ingestionRow?.value)==='TEAM_MATCH_FAILED';
  const latestSource=(sourceRow??ingestionRow??normalized[0])?.source??null;
  return{forecastAt:new Date(args.asOf).toISOString(),sourceResult,sourceName:latestSource?.name??null,latestSourceRetrievedAt:latestSource?.retrievedAt??null,
    stages:{SOURCE_SUCCESS:stage(sourceOk?true:sourceFailed?false:null,sourceResult==='PARTIAL_SUCCESS'),
      NORMALIZATION_SUCCESS:stage(normalized.length?true:sourceOk?false:null),ENTITY_MATCH_SUCCESS:stage(matchFailed?false:normalized.length?true:null),
      CONTEXT_ATTACHED:stage(valid?true:sourceOk?false:null,valid>0&&valid<Object.keys(value.fields).length),
      FIELD_VALID:stage(valid===Object.keys(value.fields).length?true:valid?true:false,valid>0&&valid<Object.keys(value.fields).length),
      FRESH_AT_FORECAST_TIME:stage(fresh===Object.keys(value.fields).length?true:fresh?true:false,fresh>0&&fresh<Object.keys(value.fields).length)},
    validFields:valid,requiredFields:Object.keys(value.fields).length,freshFields:fresh};
}
function qualityItem(status:ResolvedContextField['status']|ContextSection['status']){
  return status==='AVAILABLE'||status==='complete'?'AVAILABLE':status==='partial'?'PARTIAL':status==='conflict'||status==='CONFLICT'?'CONFLICT':status==='STALE'?'STALE':'MISSING';
}
function qualityGroup(items:Record<string,string>){
  const values=Object.values(items);return{available:values.filter(value=>value==='AVAILABLE').length,partial:values.filter(value=>value==='PARTIAL').length,
    missing:values.filter(value=>!['AVAILABLE','PARTIAL'].includes(value)).length,total:values.length,items};
}
function value(section:ContextSection,field:string){return section.fields[field]?.status==='AVAILABLE'?section.fields[field].value:null;}
export function resolveCollegeTeamContext(records:CollegeContextRecord[],args:{teamId:string;teamName:string;season:number;eventId:string;asOf:number;currentGames:number}){
  const common={teamId:args.teamId,season:args.season,eventId:args.eventId,asOf:args.asOf};
  const roster=section(records,common,REQUIRED.roster),qb=section(records,common,REQUIRED.qb),returningProduction=section(records,common,REQUIRED.returningProduction),
    transfers=section(records,common,REQUIRED.transfers),coaching=section(records,common,REQUIRED.coaching),talentDepth=section(records,common,REQUIRED.talentDepth),
    injuries=section(records,common,REQUIRED.injuries),weather=section(records,common,REQUIRED.weather),currentSeason=section(records,common,REQUIRED.currentSeason);
  const sections={roster,qb,returningProduction,transfers,coaching,talentDepth,injuries,weather,currentSeason},w=CONTEXT_COMPLETENESS_POLICY.weights;
  const currentSample=Math.min(1,Math.max(0,args.currentGames)/3),allFields=Object.values(sections).flatMap(section=>Object.values(section.fields)),
    unweightedFieldCoverage=allFields.length?allFields.filter(field=>field.status==='AVAILABLE').length/allFields.length:0,
    legacyCompleteness=roster.coverage*w.roster+qb.coverage*w.qb+returningProduction.coverage*w.returningProduction+transfers.coverage*w.transfers
      +coaching.coverage*w.coaching+talentDepth.coverage*w.talentDepth+injuries.coverage*w.injuries+weather.coverage*w.weather+currentSeason.coverage*currentSample*w.currentSample;
  const present=Object.values(sections).filter(s=>s.coverage>0),reliability:ContextReliability=present.length
    ?present.reduce((min,s)=>RELIABILITY_SCORE[s.reliability]<RELIABILITY_SCORE[min]?s.reliability:min,'HIGH' as ContextReliability):'INSUFFICIENT';
  const fcsTier=resolveContextField(records,{...common,field:'fcs.tier'}),starter=value(qb,'qb.starterName');
  const qbTransfers=resolveContextField(records,{...common,field:'transfers.qbAdditions'}).value as Array<{name?:string;previousSchool?:string}>|null;
  const matchingTransfer=Array.isArray(qbTransfers)&&starter?qbTransfers.find(item=>String(item.name??'').toLowerCase()===String(starter).toLowerCase()):undefined;
  const playerRows=records.filter(r=>r.domain==='injuries'&&r.playerId&&applicable(r,args.teamId,args.season,args.eventId,args.asOf)),players=[...new Set(playerRows.map(r=>r.playerId!))].map(playerId=>{
    const latest=(field:string)=>playerRows.filter(r=>r.playerId===playerId&&r.field===field).sort((a,b)=>Date.parse(b.source.retrievedAt)-Date.parse(a.source.retrievedAt))[0];
    return{playerId,name:latest('injury.playerName')?.value??null,position:latest('injury.position')?.value??null,status:latest('injury.status')?.value??'UNKNOWN',lastVerifiedAt:latest('injury.status')?.source.retrievedAt??null};});
  const pipelineDiagnostics={roster:pipeline(records,common,'roster',roster),qb:pipeline(records,common,'qb',qb),
    returningProduction:pipeline(records,common,'returning_production',returningProduction),transfers:pipeline(records,common,'transfers',transfers),
    coaching:pipeline(records,common,'coaching',coaching),talentDepth:pipeline(records,common,'talent',talentDepth),
    injuries:pipeline(records,common,'injuries',injuries),weather:pipeline(records,common,'weather',weather),currentSeason:pipeline(records,common,'current_season',currentSeason)};
  const dataCompleteness={version:'college-context-categories-v1',weighted:false,
    critical:qualityGroup({startingQb:qualityItem(qb.fields['qb.starterName'].status),qbAvailability:qualityItem(qb.fields['qb.status'].status),
      verifiedRoster:qualityItem(roster.status),currentSeasonSample:qualityItem(currentSeason.fields['current.gamesPlayed'].status),majorInjuries:qualityItem(injuries.status)}),
    high:qualityGroup({returningProduction:qualityItem(returningProduction.status),transfers:qualityItem(transfers.status),talentDepth:qualityItem(talentDepth.status),coaching:qualityItem(coaching.status)}),
    medium:qualityGroup({weather:qualityItem(weather.status)}),note:'Category counts are descriptive only. No statistical weights or point values are applied.'};
  return{version:COLLEGE_CONTEXT_EVIDENCE_VERSION,teamId:args.teamId,teamName:args.teamName,asOf:new Date(args.asOf).toISOString(),sections,pipelineDiagnostics,dataCompleteness,
    completeness:Number((legacyCompleteness*100).toFixed(1)),completenessMethod:'Deprecated legacy weighted display value; never used by the decision engine.',
    unweightedFieldCoverage:Number((unweightedFieldCoverage*100).toFixed(1)),reliability,currentSampleCoverage:Number((currentSample*100).toFixed(1)),fcsTier,
    qb:{starter,status:value(qb,'qb.status')??'UNKNOWN',returningStarter:resolveContextField(records,{...common,field:'qb.returningStarter'}).value,
      transfer:matchingTransfer?true:resolveContextField(records,{...common,field:'qb.transfer'}).value,previousSchool:matchingTransfer?.previousSchool??resolveContextField(records,{...common,field:'qb.previousSchool'}).value,
      depthChartStatus:resolveContextField(records,{...common,field:'qb.depthChartStatus'}).value,careerStarts:resolveContextField(records,{...common,field:'qb.careerStarts'}).value,
      priorSeasonStarts:resolveContextField(records,{...common,field:'qb.priorSeasonStarts'}).value,currentSeasonStarts:resolveContextField(records,{...common,field:'qb.currentSeasonStarts'}).value,
      injuryStatus:resolveContextField(records,{...common,field:'qb.injuryStatus'}).value},
    returning:{overall:value(returningProduction,'returning.overallPct'),offense:value(returningProduction,'returning.offensePct'),defense:value(returningProduction,'returning.defensePct')},
    transfer:{additions:value(transfers,'transfers.additions'),departures:value(transfers,'transfers.departures'),quality:value(transfers,'transfers.quality')},
    coaching:{headCoach:value(coaching,'coaching.headCoach'),newHeadCoach:value(coaching,'coaching.newHeadCoach'),oc:value(coaching,'coaching.offensiveCoordinator'),
      newOc:value(coaching,'coaching.newOc'),dc:value(coaching,'coaching.defensiveCoordinator'),newDc:value(coaching,'coaching.newDc'),playCallerContinuity:value(coaching,'coaching.playCallerContinuity')},
    talent:{rosterComposite:value(talentDepth,'talent.rosterComposite'),depthTier:value(talentDepth,'talent.depthTier'),classification:value(talentDepth,'talent.classification')},
    injury:{teamStatus:value(injuries,'injuries.teamStatus'),players},weather:{temperatureF:value(weather,'weather.temperatureF'),feelsLikeF:value(weather,'weather.feelsLikeF'),
      windMph:value(weather,'weather.windMph'),gustMph:value(weather,'weather.gustMph'),precipitationProbability:value(weather,'weather.precipitationProbability'),
      precipitationMm:value(weather,'weather.precipitationMm'),humidityPct:value(weather,'weather.humidityPct'),indoor:value(weather,'weather.indoor'),
      flags:resolveContextField(records,{...common,field:'weather.flags'}).value},
    currentSeason:{gamesPlayed:value(currentSeason,'current.gamesPlayed'),lastOpponent:value(currentSeason,'current.lastOpponent'),lastScore:value(currentSeason,'current.lastScore'),
      pointsPerGame:value(currentSeason,'current.pointsPerGame'),yardsPerGame:value(currentSeason,'current.yardsPerGame'),pointsAllowedPerGame:value(currentSeason,'current.pointsAllowedPerGame'),
      yardsAllowedPerGame:value(currentSeason,'current.yardsAllowedPerGame'),primaryQb:value(currentSeason,'current.primaryQb'),qbAttempts:value(currentSeason,'current.qbAttempts')},
    contextAdjustedMargin:null,contextAdjustmentReason:'Unavailable — football-context point coefficients are not validated.'};
}
export function contextBlendWeights(week:number|null,currentGames:number,completeness:number){
  const priorEquivalent=week===null||week<=1?6:week<=3?5:week<=6?3:2,currentEquivalent=Math.max(0,currentGames),denominator=priorEquivalent+currentEquivalent;
  const currentSeasonWeight=denominator?currentEquivalent/denominator:0,rosterContextWeight=Math.min(.5,Math.max(0,completeness)/100*.5);
  return{version:'college-context-blend-v1-unfitted',calibrated:false,priorSeasonWeight:1-currentSeasonWeight,currentSeasonWeight,rosterContextWeight,
    note:'Diagnostic structure only; weights do not alter projected points.'};
}
