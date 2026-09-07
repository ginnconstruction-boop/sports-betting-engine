import * as fs from 'fs';
import * as path from 'path';
import {createHash,randomUUID} from 'crypto';
import {
  COLLEGE_FORWARD_LOCKED_AT,CollegeForwardResearchArchive,ForwardCaptureTrigger,
  ForwardResearchSnapshot,NewForwardResearchSnapshot,
} from './collegeForwardResearch';
export type {ForwardCaptureTrigger} from './collegeForwardResearch';
import {stableStringify} from './collegeEdgeResearch';

export const COLLEGE_FORWARD_OPERATIONS_VERSION='college-forward-operations-v1';
export const FORWARD_TIMEZONE='America/Chicago';
export type ForwardScheduleStatus='SCHEDULED'|'POSTPONED'|'CANCELED'|'IN_PROGRESS'|'FINAL'|'UNKNOWN';
export type ForwardRunHealth='HEALTHY'|'DEGRADED'|'STALE'|'FAILED'|'NOT_CONFIGURED';
export type ForwardRunStatus='SUCCESS'|'DEGRADED'|'FAILED'|'DRY_RUN';
export type ForwardObservationStatus='CAPTURED'|'DEDUPLICATED'|'WOULD_CAPTURE'|'SKIPPED_STARTED'|'SKIPPED_POSTPONED'|'SKIPPED_CANCELED'|'DEFERRED'|'FAILED';

export interface ForwardDiscoveredGame {
  canonicalEventId:string;
  originalScheduledKickoff:string;
  latestVerifiedKickoff:string|null;
  status:ForwardScheduleStatus;
  homeSubdivision:'FBS'|'FCS'|'UNKNOWN';
  awaySubdivision:'FBS'|'FCS'|'UNKNOWN';
  missingCriticalEvidence:number;
  scheduleSource:{provider:string;retrievedAt:string;rawPayloadHash:string};
  payload:unknown;
}
export interface ForwardRequestPlan {provider:string;category:string;scope:string;cache:'HIT'|'MISS'|'UNKNOWN';maximumRequests:number;priority:number;}
export interface ForwardRunMetrics {apiRequests:number;cacheHits:number;cfbdRequests:number;marketRequests:number;}
export interface ForwardPreparedRun {state:unknown;metrics:ForwardRunMetrics;deferred:string[];failures:Array<{provider:string;type:string;retryable:boolean;nextEligibleAttempt:string|null;message:string}>;}
export interface ForwardCollectorAdapter {
  discover(at:string):Promise<{games:ForwardDiscoveredGame[];requests:number;cacheHits:number;failures:string[]}>;
  plan(games:ForwardDiscoveredGame[],at:string):ForwardRequestPlan[];
  prepare(games:ForwardDiscoveredGame[],at:string):Promise<ForwardPreparedRun>;
  capture(game:ForwardDiscoveredGame,prepared:ForwardPreparedRun,trigger:ForwardCaptureTrigger,captureEventId:string):Promise<NewForwardResearchSnapshot>;
}
export interface ForwardRunObservation {eventId:string;originalScheduledKickoff:string;latestVerifiedKickoff:string|null;scheduleStatus:ForwardScheduleStatus;status:ForwardObservationStatus;snapshotId:string|null;minutesToKickoff:number|null;message:string;homeSubdivision?:'FBS'|'FCS'|'UNKNOWN';awaySubdivision?:'FBS'|'FCS'|'UNKNOWN';}
export interface ForwardOperationalRun {
  schemaVersion:typeof COLLEGE_FORWARD_OPERATIONS_VERSION;
  runId:string;
  captureEventId:string;
  trigger:ForwardCaptureTrigger;
  scheduledFor:string|null;
  startedAt:string;
  completedAt:string;
  dryRun:boolean;
  status:ForwardRunStatus;
  observations:ForwardRunObservation[];
  requestPlan:ForwardRequestPlan[];
  metrics:ForwardRunMetrics;
  deferred:string[];
  providerFailures:Array<{provider:string;type:string;retryable:boolean;nextEligibleAttempt:string|null;message:string}>;
  discoveryFailures:string[];
  idempotentRetry:boolean;
}

interface OperationsIndex {schema:1;version:typeof COLLEGE_FORWARD_OPERATIONS_VERSION;runs:Array<{id:string;captureEventId:string;completedAt:string;trigger:ForwardCaptureTrigger}>;}
const sha=(value:unknown)=>createHash('sha256').update(stableStringify(value)).digest('hex');
const validStamp=(value:string,label:string)=>{const n=Date.parse(value);if(!Number.isFinite(n))throw Error(`Invalid ${label} timestamp.`);return n;};
const operationsRoot=(root:string)=>path.join(root,'college_forward_research','v1','operations');
const indexPath=(root:string)=>path.join(operationsRoot(root),'index.json');
const runPath=(root:string,id:string)=>path.join(operationsRoot(root),'runs',`${id}.json`);
const emptyIndex=():OperationsIndex=>({schema:1,version:COLLEGE_FORWARD_OPERATIONS_VERSION,runs:[]});
function loadIndex(root:string):OperationsIndex {const file=indexPath(root);if(!fs.existsSync(file))return emptyIndex();const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value?.schema!==1||value?.version!==COLLEGE_FORWARD_OPERATIONS_VERSION||!Array.isArray(value.runs))throw Error('Invalid forward operations index.');return value;}
function saveIndex(root:string,index:OperationsIndex){const file=indexPath(root);fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=path.join(path.dirname(file),`${randomUUID()}.tmp`);fs.writeFileSync(tmp,JSON.stringify(index,null,2),{flag:'wx'});fs.renameSync(tmp,file);}
function readRun(root:string,id:string){const value=JSON.parse(fs.readFileSync(runPath(root,id),'utf8')) as ForwardOperationalRun;if(value.runId!==id){throw Error('Forward operations run identity mismatch.');}const body={...value,runId:undefined};delete body.runId;if(sha(body)!==id)throw Error('Forward operations run hash mismatch.');return value;}

export class ForwardOperationsStore {
  constructor(private root:string){}
  runs(){return loadIndex(this.root).runs.map(row=>readRun(this.root,row.id));}
  byCaptureEvent(captureEventId:string){return this.runs().find(row=>row.captureEventId===captureEventId&&!row.dryRun)??null;}
  append(input:Omit<ForwardOperationalRun,'runId'>){if(input.schemaVersion!==COLLEGE_FORWARD_OPERATIONS_VERSION||input.dryRun)throw Error('Only completed non-dry operational runs may be persisted.');validStamp(input.startedAt,'run start');validStamp(input.completedAt,'run completion');const body=structuredClone(input),id=sha(body),value:ForwardOperationalRun={runId:id,...body},file=runPath(this.root,id),index=loadIndex(this.root),prior=index.runs.find(row=>row.captureEventId===input.captureEventId);
    if(prior&&prior.id!==id)throw Error('Operational capture event already has a different immutable run record.');fs.mkdirSync(path.dirname(file),{recursive:true});if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(value,null,2),{flag:'wx'});else if(fs.readFileSync(file,'utf8')!==JSON.stringify(value,null,2))throw Error('Immutable operational run collision.');
    if(!prior){index.runs.push({id,captureEventId:input.captureEventId,completedAt:input.completedAt,trigger:input.trigger});index.runs.sort((a,b)=>a.completedAt.localeCompare(b.completedAt)||a.id.localeCompare(b.id));saveIndex(this.root,index);}return{runId:id,created:!prior};}
}

function localParts(ms:number){const fields=new Intl.DateTimeFormat('en-CA',{timeZone:FORWARD_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));const get=(type:string)=>fields.find(row=>row.type===type)?.value??'';return{date:`${get('year')}-${get('month')}-${get('day')}`,hour:Number(get('hour')),minute:Number(get('minute'))};}
export function centralScheduledInstant(date:string,hour:7|14){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid Central calendar date.');const center=Date.parse(`${date}T${String(hour).padStart(2,'0')}:00:00Z`);for(let value=center-12*3600_000;value<=center+12*3600_000;value+=60_000){const parts=localParts(value);if(parts.date===date&&parts.hour===hour&&parts.minute===0)return new Date(value).toISOString();}throw Error('Central schedule instant could not be resolved.');}
export function scheduledCaptureEventId(trigger:ForwardCaptureTrigger,now:number,idempotencyKey?:string){if(trigger==='MANUAL'){if(!idempotencyKey||idempotencyKey.length>160)throw Error('Manual collection requires a bounded idempotency key.');return`manual-${sha(idempotencyKey).slice(0,32)}`;}const date=localParts(now).date;return`${date}-${trigger==='SCHEDULED_0700_CT'?'0700':'1400'}-ct`;}
export function scheduledFor(trigger:ForwardCaptureTrigger,now:number){if(trigger==='MANUAL')return null;return centralScheduledInstant(localParts(now).date,trigger==='SCHEDULED_0700_CT'?7:14);}
export function nextCentralRun(now:number){const today=localParts(now).date;for(let offset=0;offset<4;offset++){const date=new Date(Date.parse(`${today}T12:00:00Z`)+offset*86400_000).toISOString().slice(0,10);for(const entry of [{hour:7 as const,trigger:'SCHEDULED_0700_CT' as const},{hour:14 as const,trigger:'SCHEDULED_1400_CT' as const}]){const at=centralScheduledInstant(date,entry.hour);if(Date.parse(at)>now)return{trigger:entry.trigger,at};}}throw Error('Next Central run could not be resolved.');}

const conceptualPolicies={T24H:[1080,1800],T6H:[240,480],T1H:[30,90],LATEST_PREKICK:[0,30]} as const;
export function actualCaptureSemantics(capturedAt:string,kickoff:string,trigger:ForwardCaptureTrigger,captureEventId:string,scheduled:string|null,game:ForwardDiscoveredGame){const minutes=(validStamp(kickoff,'kickoff')-validStamp(capturedAt,'capture'))/60_000;if(minutes<=0)throw Error('Operational capture is not before kickoff.');const conceptualWindows=Object.fromEntries(Object.entries(conceptualPolicies).map(([name,[minimum,maximum]])=>[name,minutes>=minimum&&minutes<=maximum?'CAPTURED':'NOT_SCHEDULED_FOR_CAPTURE'])) as any;
  return{trigger,captureEventId,captureTimestamp:capturedAt,scheduledFor:scheduled,originalScheduledKickoff:game.originalScheduledKickoff,latestVerifiedKickoff:kickoff,minutesToKickoff:minutes,hoursToKickoff:minutes/60,scheduleStatus:'SCHEDULED' as const,scheduleSource:game.scheduleSource,conceptualWindows};}

export class CollegeForwardOperationalCollector {
  private archive:CollegeForwardResearchArchive;private operations:ForwardOperationsStore;
  constructor(private root:string,private adapter:ForwardCollectorAdapter,private now=()=>Date.now()){this.archive=new CollegeForwardResearchArchive(root);this.operations=new ForwardOperationsStore(root);}
  async run(args:{trigger:ForwardCaptureTrigger;dryRun:boolean;idempotencyKey?:string}){
    const started=this.now(),startedAt=new Date(started).toISOString();if(started<Date.parse(COLLEGE_FORWARD_LOCKED_AT))throw Error('Collector cannot run before the protected forward cutoff.');const captureEventId=scheduledCaptureEventId(args.trigger,started,args.idempotencyKey),scheduled=scheduledFor(args.trigger,started),prior=this.operations.byCaptureEvent(captureEventId);if(prior)return{...prior,idempotentRetry:true};
    const discovery=await this.adapter.discover(startedAt),historical=this.archive.load().snapshots,previousRuns=this.operations.runs(),previousObservations=previousRuns.flatMap(run=>run.observations),games=discovery.games.map(game=>{const history=previousObservations.filter(row=>row.eventId===game.canonicalEventId),original=history.map(row=>row.originalScheduledKickoff).sort()[0]??game.originalScheduledKickoff;return{...game,originalScheduledKickoff:original};});
    const duplicateKeys=new Set(historical.filter(row=>row.operational?.captureEventId===captureEventId).map(row=>row.identity.canonicalEventId)),capturedEvents=new Set(historical.map(row=>row.identity.canonicalEventId));
    const ordered=[...games].sort((a,b)=>{const ak=a.latestVerifiedKickoff?Date.parse(a.latestVerifiedKickoff):Infinity,bk=b.latestVerifiedKickoff?Date.parse(b.latestVerifiedKickoff):Infinity;return ak-bk||b.missingCriticalEvidence-a.missingCriticalEvidence||Number(capturedEvents.has(a.canonicalEventId))-Number(capturedEvents.has(b.canonicalEventId))||a.canonicalEventId.localeCompare(b.canonicalEventId);});
    const observations:ForwardRunObservation[]=[],eligible:ForwardDiscoveredGame[]=[];
    for(const game of ordered){const kickoff=game.latestVerifiedKickoff?Date.parse(game.latestVerifiedKickoff):NaN;if(game.status==='CANCELED'){observations.push(this.observation(game,'SKIPPED_CANCELED',null,'Canceled game; earlier snapshots preserved.'));continue;}if(game.status==='POSTPONED'||!Number.isFinite(kickoff)){observations.push(this.observation(game,'SKIPPED_POSTPONED',null,'Postponed without a trustworthy new kickoff.'));continue;}if(game.status==='IN_PROGRESS'||game.status==='FINAL'||kickoff<=started){observations.push(this.observation(game,'SKIPPED_STARTED',null,'Kickoff passed or game entered a started/final state.'));continue;}if(game.status!=='SCHEDULED'){observations.push(this.observation(game,'DEFERRED',null,'Schedule state is not trustworthy enough for pregame capture.'));continue;}if(duplicateKeys.has(game.canonicalEventId)){observations.push(this.observation(game,'DEDUPLICATED',historical.find(row=>row.identity.canonicalEventId===game.canonicalEventId&&row.operational?.captureEventId===captureEventId)?.snapshotId??null,'Retry deduplicated by capture event.'));continue;}eligible.push(game);}
    const requestPlan=this.adapter.plan(eligible,startedAt);if(args.dryRun){for(const game of eligible)observations.push(this.observation(game,'WOULD_CAPTURE',null,'Dry run; no archive mutation.',(Date.parse(game.latestVerifiedKickoff!)-started)/60_000));return this.result({captureEventId,trigger:args.trigger,scheduledFor:scheduled,startedAt,completedAt:new Date(this.now()).toISOString(),dryRun:true,status:'DRY_RUN',observations,requestPlan,metrics:{apiRequests:discovery.requests,cacheHits:discovery.cacheHits,cfbdRequests:0,marketRequests:0},deferred:[],providerFailures:[],discoveryFailures:discovery.failures,idempotentRetry:false});}
    let prepared:ForwardPreparedRun;try{prepared=await this.adapter.prepare(eligible,startedAt);}catch(error){prepared={state:null,metrics:{apiRequests:0,cacheHits:0,cfbdRequests:0,marketRequests:0},deferred:eligible.map(game=>game.canonicalEventId),failures:[{provider:'collector',type:'PREPARE_FAILED',retryable:true,nextEligibleAttempt:new Date(started+15*60_000).toISOString(),message:String(error instanceof Error?error.message:error)}]};}
    for(const game of eligible){if(prepared.deferred.includes(game.canonicalEventId)){observations.push(this.observation(game,'DEFERRED',null,'Provider budget deferred this game.'));continue;}try{const snapshot=await this.adapter.capture(game,prepared,args.trigger,captureEventId),capturedAt=snapshot.capturedAt,kickoff=game.latestVerifiedKickoff!;snapshot.window='ACTUAL_PREKICK';snapshot.identity.kickoff=kickoff;snapshot.operational=actualCaptureSemantics(capturedAt,kickoff,args.trigger,captureEventId,scheduled,game);const saved=this.archive.capture(snapshot);observations.push(this.observation(game,saved.created?'CAPTURED':'DEDUPLICATED',saved.snapshotId,saved.created?'Immutable pregame snapshot captured.':'Identical snapshot already exists.',snapshot.operational.minutesToKickoff));}catch(error){observations.push(this.observation(game,'FAILED',null,String(error instanceof Error?error.message:error)));}}
    const failures=observations.filter(row=>['FAILED','DEFERRED'].includes(row.status)).length,status:ForwardRunStatus=failures||prepared.failures.length||discovery.failures.length?'DEGRADED':'SUCCESS',completedAt=new Date(this.now()).toISOString(),run=this.result({captureEventId,trigger:args.trigger,scheduledFor:scheduled,startedAt,completedAt,dryRun:false,status,observations,requestPlan,metrics:{apiRequests:discovery.requests+prepared.metrics.apiRequests,cacheHits:discovery.cacheHits+prepared.metrics.cacheHits,cfbdRequests:prepared.metrics.cfbdRequests,marketRequests:prepared.metrics.marketRequests},deferred:prepared.deferred,providerFailures:prepared.failures,discoveryFailures:discovery.failures,idempotentRetry:false}),{runId:_transient,...persistable}=run;void _transient;const persisted=this.operations.append(persistable);return{...run,runId:persisted.runId};
  }
  private observation(game:ForwardDiscoveredGame,status:ForwardObservationStatus,snapshotId:string|null,message:string,minutesToKickoff:number|null=null):ForwardRunObservation{return{eventId:game.canonicalEventId,originalScheduledKickoff:game.originalScheduledKickoff,latestVerifiedKickoff:game.latestVerifiedKickoff,scheduleStatus:game.status,status,snapshotId,minutesToKickoff,message,homeSubdivision:game.homeSubdivision,awaySubdivision:game.awaySubdivision};}
  private result(input:Omit<ForwardOperationalRun,'schemaVersion'|'runId'>):ForwardOperationalRun{return{schemaVersion:COLLEGE_FORWARD_OPERATIONS_VERSION,runId:sha(input),...input};}
}

export function buildForwardOperationalStatus(root:string,now:number,configured:{scheduler:boolean;durableStorage:boolean}){const operations=new ForwardOperationsStore(root).runs(),archive=new CollegeForwardResearchArchive(root).load(),latest=(trigger:ForwardCaptureTrigger)=>operations.filter(run=>run.trigger===trigger).sort((a,b)=>b.completedAt.localeCompare(a.completedAt))[0]??null,next=nextCentralRun(now),scheduledRuns=operations.filter(run=>run.trigger!=='MANUAL'),providerFailures=operations.reduce((sum,run)=>sum+run.providerFailures.length+run.discoveryFailures.length,0),missed=scheduledRuns.reduce((sum,run)=>sum+run.observations.filter(row=>['FAILED','DEFERRED'].includes(row.status)).length,0),deferred=operations.reduce((sum,run)=>sum+run.deferred.length,0),distribution=archive.snapshots.filter(row=>row.operational).map(row=>row.operational!.hoursToKickoff).sort((a,b)=>a-b),lastScheduled=scheduledRuns.sort((a,b)=>b.completedAt.localeCompare(a.completedAt))[0]??null;
  let health:ForwardRunHealth='HEALTHY';if(!configured.scheduler||!configured.durableStorage)health='NOT_CONFIGURED';else if(lastScheduled?.status==='FAILED')health='FAILED';else if(!lastScheduled||now-Date.parse(lastScheduled.completedAt)>30*3600_000)health='STALE';else if(missed||deferred||providerFailures||lastScheduled.status==='DEGRADED')health='DEGRADED';
  return{schemaVersion:'college-forward-operational-status-v1',generatedAt:new Date(now).toISOString(),health,last0700Run:latest('SCHEDULED_0700_CT'),last1400Run:latest('SCHEDULED_1400_CT'),lastManualRun:latest('MANUAL'),nextExpectedRun:next,runStatus:lastScheduled?.status??'NOT_CONFIGURED',upcomingEligibleGames:lastScheduled?.observations.filter(row=>['CAPTURED','DEDUPLICATED'].includes(row.status)).length??0,morningSnapshots:archive.snapshots.filter(row=>row.operational?.trigger==='SCHEDULED_0700_CT').length,afternoonSnapshots:archive.snapshots.filter(row=>row.operational?.trigger==='SCHEDULED_1400_CT').length,manualSnapshots:archive.snapshots.filter(row=>row.operational?.trigger==='MANUAL').length,missedScheduledCaptures:missed,deferredWork:deferred,providerFailures,apiRequestCounts:operations.reduce((sum,row)=>sum+row.metrics.apiRequests,0),cacheHits:operations.reduce((sum,row)=>sum+row.metrics.cacheHits,0),cfbdRequestCount:operations.reduce((sum,row)=>sum+row.metrics.cfbdRequests,0),marketRequestCount:operations.reduce((sum,row)=>sum+row.metrics.marketRequests,0),totalForwardSnapshots:archive.snapshots.length,hoursToKickoff:{n:distribution.length,min:distribution[0]??null,median:distribution.length?distribution[Math.floor((distribution.length-1)/2)]:null,max:distribution.at(-1)??null,values:distribution}};}
