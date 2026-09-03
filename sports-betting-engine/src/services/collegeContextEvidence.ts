import * as fs from 'fs';
import * as path from 'path';
import {createHash,randomUUID} from 'crypto';

export const COLLEGE_CONTEXT_EVIDENCE_VERSION='college-context-evidence-v1';
export type ContextDomain='qb'|'roster'|'returning_production'|'transfers'|'coaching'|'talent'|'fcs'|'injuries'|'weather';
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
  records:CollegeContextRecord[];
}
export interface ContextSection {
  status:'complete'|'partial'|'missing'|'conflict';coverage:number;reliability:ContextReliability;
  fields:Record<string,ResolvedContextField>;
}

export const QB_STATUS_ORDER:Record<QbStatus,number>={CONFIRMED:5,EXPECTED:4,COMPETITION:3,QUESTIONABLE:2,OUT:1,UNKNOWN:0};
export const AVAILABILITY_STATUS_ORDER:Record<AvailabilityStatus,number>={AVAILABLE:5,PROBABLE:4,QUESTIONABLE:3,DOUBTFUL:2,OUT:1,UNKNOWN:0};
export const CONTEXT_COMPLETENESS_POLICY={version:'college-context-coverage-v1',weights:{roster:.03,qb:.20,returningProduction:.15,transfers:.15,
  coaching:.10,talentDepth:.12,injuries:.10,weather:.10,currentSample:.05}} as const;
const RELIABILITY_SCORE:Record<ContextReliability,number>={INSUFFICIENT:0,LOW:1,MEDIUM:2,HIGH:3};
const DOMAIN_TTL:Record<ContextDomain,number>={qb:72*3600_000,roster:30*86400_000,returning_production:180*86400_000,
  transfers:30*86400_000,coaching:180*86400_000,talent:180*86400_000,fcs:30*86400_000,injuries:24*3600_000,weather:6*3600_000};
const REQUIRED={
  roster:['roster.currentSeasonAvailable'],
  qb:['qb.status','qb.starterName'],
  returningProduction:['returning.overallPct','returning.offensePct','returning.defensePct'],
  transfers:['transfers.additions','transfers.departures','transfers.quality'],
  coaching:['coaching.headCoach','coaching.newHeadCoach','coaching.offensiveCoordinator','coaching.newOc','coaching.defensiveCoordinator','coaching.newDc','coaching.playCallerContinuity'],
  talentDepth:['talent.rosterComposite','talent.depthTier','talent.classification'],
  injuries:['injuries.teamStatus'],
  weather:['weather.temperatureF','weather.feelsLikeF','weather.windMph','weather.gustMph','weather.precipitationProbability','weather.precipitationMm','weather.humidityPct','weather.indoor'],
} as const;

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
  if(!Array.isArray(incoming)||incoming.length>5000)throw Error('Expected at most 5000 context records');
  const existing=loadCollegeContextRecords(root),byId=new Map(existing.map(r=>[r.id,r])),dir=directory(root);fs.mkdirSync(path.join(dir,'records'),{recursive:true});
  for(const row of incoming){validateContextRecord(row);const id=createHash('sha256').update(stable(row)).digest('hex'),record:CollegeContextRecord={id,schema:1,...structuredClone(row)};
    const prior=byId.get(id);if(prior)continue;byId.set(id,record);
    const bytes=JSON.stringify(record,null,2),file=path.join(dir,'records',id+'.json');try{fs.writeFileSync(file,bytes,{flag:'wx'});}catch(e:any){if(e.code!=='EEXIST'||fs.readFileSync(file,'utf8')!==bytes)throw e;}
  }
  const records=[...byId.values()].sort((a,b)=>Date.parse(a.source.retrievedAt)-Date.parse(b.source.retrievedAt)||a.id.localeCompare(b.id));
  const tmp=path.join(dir,randomUUID()+'.tmp');fs.writeFileSync(tmp,JSON.stringify({schema:1,version:COLLEGE_CONTEXT_EVIDENCE_VERSION,records},null,2),{flag:'wx'});
  fs.renameSync(tmp,path.join(dir,'index.json'));return{added:records.length-existing.length,total:records.length};
}
export function archiveCollegeContextPayload(root:string,payload:unknown){
  const bytes=stable(payload),hash=createHash('sha256').update(bytes).digest('hex'),dir=path.join(directory(root),'raw');fs.mkdirSync(dir,{recursive:true});
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
  const known=records.filter(r=>r.field===args.field&&applicable(r,args.teamId,args.season,args.eventId,args.asOf));
  if(!known.length)return{field:args.field,value:null,status:'MISSING',reliability:'INSUFFICIENT',records:[]};
  const fresh=known.filter(r=>args.asOf-Date.parse(r.source.retrievedAt)<=DOMAIN_TTL[r.domain]);
  if(!fresh.length)return{field:args.field,value:null,status:'STALE',reliability:'INSUFFICIENT',records:known};
  const allOrdered=[...fresh].sort((a,b)=>Date.parse(b.source.retrievedAt)-Date.parse(a.source.retrievedAt)),bySource=new Map<string,CollegeContextRecord>();
  for(const row of allOrdered){const key=`${row.source.name}|${row.source.url}`;if(!bySource.has(key))bySource.set(key,row);}const latestBySource=[...bySource.values()];
  const ordered=latestBySource.sort((a,b)=>a.source.tier-b.source.tier||RELIABILITY_SCORE[b.source.reliability]-RELIABILITY_SCORE[a.source.reliability]
    ||Date.parse(b.source.retrievedAt)-Date.parse(a.source.retrievedAt));
  const top=ordered[0],peers=ordered.filter(r=>r.source.tier===top.source.tier&&r.source.reliability===top.source.reliability);
  const values=new Set(peers.map(r=>stable(r.value)));
  if(values.size>1||peers.some(r=>r.verification==='CONFLICTED'))return{field:args.field,value:null,status:'CONFLICT',reliability:'LOW',records:allOrdered};
  if(isUnknown(top.value))return{field:args.field,value:top.value,status:'MISSING',reliability:top.source.reliability,records:allOrdered};
  return{field:args.field,value:top.value,status:'AVAILABLE',reliability:top.source.reliability,records:allOrdered};
}
function section(records:CollegeContextRecord[],args:{teamId:string;season:number;eventId:string;asOf:number},fields:readonly string[]):ContextSection{
  const resolved=Object.fromEntries(fields.map(field=>[field,resolveContextField(records,{...args,field})]));
  const available=Object.values(resolved).filter(f=>f.status==='AVAILABLE'),conflict=Object.values(resolved).some(f=>f.status==='CONFLICT');
  const coverage=available.length/fields.length,reliability=available.length?available.reduce((min,f)=>RELIABILITY_SCORE[f.reliability]<RELIABILITY_SCORE[min]?f.reliability:min,'HIGH' as ContextReliability):'INSUFFICIENT';
  return{status:conflict?'conflict':coverage===1?'complete':coverage>0?'partial':'missing',coverage,reliability,fields:resolved};
}
function value(section:ContextSection,field:string){return section.fields[field]?.status==='AVAILABLE'?section.fields[field].value:null;}
export function resolveCollegeTeamContext(records:CollegeContextRecord[],args:{teamId:string;teamName:string;season:number;eventId:string;asOf:number;currentGames:number}){
  const common={teamId:args.teamId,season:args.season,eventId:args.eventId,asOf:args.asOf};
  const roster=section(records,common,REQUIRED.roster),qb=section(records,common,REQUIRED.qb),returningProduction=section(records,common,REQUIRED.returningProduction),
    transfers=section(records,common,REQUIRED.transfers),coaching=section(records,common,REQUIRED.coaching),talentDepth=section(records,common,REQUIRED.talentDepth),
    injuries=section(records,common,REQUIRED.injuries),weather=section(records,common,REQUIRED.weather);
  const sections={roster,qb,returningProduction,transfers,coaching,talentDepth,injuries,weather},w=CONTEXT_COMPLETENESS_POLICY.weights;
  const currentSample=Math.min(1,Math.max(0,args.currentGames)/3),completeness=roster.coverage*w.roster+qb.coverage*w.qb+returningProduction.coverage*w.returningProduction
    +transfers.coverage*w.transfers+coaching.coverage*w.coaching+talentDepth.coverage*w.talentDepth+injuries.coverage*w.injuries+weather.coverage*w.weather+currentSample*w.currentSample;
  const present=Object.values(sections).filter(s=>s.coverage>0),reliability:ContextReliability=present.length
    ?present.reduce((min,s)=>RELIABILITY_SCORE[s.reliability]<RELIABILITY_SCORE[min]?s.reliability:min,'HIGH' as ContextReliability):'INSUFFICIENT';
  const fcsTier=resolveContextField(records,{...common,field:'fcs.tier'});
  const playerRows=records.filter(r=>r.domain==='injuries'&&r.playerId&&applicable(r,args.teamId,args.season,args.eventId,args.asOf)),players=[...new Set(playerRows.map(r=>r.playerId!))].map(playerId=>{
    const latest=(field:string)=>playerRows.filter(r=>r.playerId===playerId&&r.field===field).sort((a,b)=>Date.parse(b.source.retrievedAt)-Date.parse(a.source.retrievedAt))[0];
    return{playerId,name:latest('injury.playerName')?.value??null,position:latest('injury.position')?.value??null,status:latest('injury.status')?.value??'UNKNOWN',lastVerifiedAt:latest('injury.status')?.source.retrievedAt??null};});
  return{version:COLLEGE_CONTEXT_EVIDENCE_VERSION,teamId:args.teamId,teamName:args.teamName,asOf:new Date(args.asOf).toISOString(),sections,
    completeness:Number((completeness*100).toFixed(1)),reliability,currentSampleCoverage:Number((currentSample*100).toFixed(1)),fcsTier,
    qb:{starter:value(qb,'qb.starterName'),status:value(qb,'qb.status')??'UNKNOWN',returningStarter:resolveContextField(records,{...common,field:'qb.returningStarter'}).value,
      transfer:resolveContextField(records,{...common,field:'qb.transfer'}).value,careerStarts:resolveContextField(records,{...common,field:'qb.careerStarts'}).value,
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
    contextAdjustedMargin:null,contextAdjustmentReason:'Unavailable — football-context point coefficients are not validated.'};
}
export function contextBlendWeights(week:number|null,currentGames:number,completeness:number){
  const priorEquivalent=week===null||week<=1?6:week<=3?5:week<=6?3:2,currentEquivalent=Math.max(0,currentGames),denominator=priorEquivalent+currentEquivalent;
  const currentSeasonWeight=denominator?currentEquivalent/denominator:0,rosterContextWeight=Math.min(.5,Math.max(0,completeness)/100*.5);
  return{version:'college-context-blend-v1-unfitted',calibrated:false,priorSeasonWeight:1-currentSeasonWeight,currentSeasonWeight,rosterContextWeight,
    note:'Diagnostic structure only; weights do not alter projected points.'};
}
