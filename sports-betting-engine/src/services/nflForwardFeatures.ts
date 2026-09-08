import {createHash} from 'crypto';

export const NFL_FORWARD_FEATURE_VERSION='nfl-forward-feature-v1' as const;
export const NFL_FORWARD_NORMALIZATION_VERSION='nfl-forward-normalization-v1' as const;

export type NflFeatureStageState='PASS'|'PARTIAL'|'FAIL'|'UNKNOWN';
export type NflFeatureCategory='TEAM_VOLUME'|'PASS_RUN_TENDENCY'|'OFFENSIVE_EFFICIENCY'|'DEFENSIVE_EFFICIENCY'|'QB'|'INJURIES'|'DEPTH_CHART'|'SNAPS'|'ROUTES'|'TARGETS'|'CARRIES'|'RED_ZONE'|'WEATHER'|'REST'|'COACHING'|'MARKET'|'VENUE'|'PLAYER_ROLE'|'TEAMMATE_AVAILABILITY'|'CURRENT_SEASON_SAMPLE'|'GAME_IDENTITY';
export const NFL_FEATURE_SCORECARD_CATEGORIES:NflFeatureCategory[]=['TEAM_VOLUME','PASS_RUN_TENDENCY','OFFENSIVE_EFFICIENCY','DEFENSIVE_EFFICIENCY','QB','INJURIES','DEPTH_CHART','SNAPS','ROUTES','TARGETS','CARRIES','RED_ZONE','WEATHER','REST','COACHING','MARKET'];
export type NflCaptureWindow='>24H'|'6-24H'|'1-6H'|'<1H'|'LAST_VERIFIED_PREGAME';
export type NflFeatureQuality='VERIFIED'|'PARTIAL'|'UNAVAILABLE'|'INVALID';
export type NflFeatureFreshness='FRESH'|'STALE'|'UNKNOWN';
export type NflPointInTimeClass='PREGAME_KNOWN'|'PREGAME_SOURCE_TIME_UNKNOWN';
export type NflForwardRoleState='QB1'|'QB2'|'STARTER_UNRESOLVED'|'RB1'|'RB2'|'RB3'|'COMMITTEE'|'PASSING_DOWN'|'GOAL_LINE'|'WR1'|'WR2'|'WR3'|'SLOT'|'OUTSIDE'|'ROTATIONAL'|'TE1'|'TE2'|'BLOCKING_HEAVY'|'UNKNOWN';

export interface NflFeatureIntegrity {
  SOURCE_RETRIEVAL:NflFeatureStageState;
  NORMALIZATION:NflFeatureStageState;
  ENTITY_MATCHING:NflFeatureStageState;
  CONTEXT_ATTACHMENT:NflFeatureStageState;
  FIELD_VALIDITY:NflFeatureStageState;
  FRESHNESS:NflFeatureStageState;
}

export interface NflForwardFeatureRecord {
  recordId:string;
  gameId:string;
  teamId:string|null;
  playerId:string|null;
  category:NflFeatureCategory;
  field:string;
  captureTimestamp:string;
  forecastTimestamp:string;
  kickoffTimestamp:string;
  minutesToKickoff:number;
  captureWindow:Exclude<NflCaptureWindow,'LAST_VERIFIED_PREGAME'>;
  source:string;
  sourceTimestamp:string|null;
  retrievalTimestamp:string;
  normalizationVersion:typeof NFL_FORWARD_NORMALIZATION_VERSION;
  featureVersion:typeof NFL_FORWARD_FEATURE_VERSION;
  rawEvidenceReference:string;
  normalizedValue:unknown;
  numerator:number|null;
  denominator:number|null;
  qualityState:NflFeatureQuality;
  freshnessState:NflFeatureFreshness;
  pointInTimeClassification:NflPointInTimeClass;
  integrity:NflFeatureIntegrity;
  correctionOf:string|null;
  notes:string[];
}

export type NflQbChangeEventType='QB_STARTER_CHANGED'|'QB_STATUS_UPGRADED'|'QB_STATUS_DOWNGRADED'|'QB_INACTIVE_VERIFIED'|'QB_STARTER_UNRESOLVED';
export type NflRoleChangeEventType='ROLE_UPGRADE'|'ROLE_DOWNGRADE'|'STARTER_CHANGE'|'COMMITTEE_CHANGE'|'DEPTH_ORDER_CHANGE'|'UNKNOWN_TO_CONFIRMED';
export interface NflFeatureChangeEvent {eventId:string;gameId:string;teamId:string|null;playerId:string|null;capturedAt:string;type:NflQbChangeEventType|NflRoleChangeEventType;previousRecordId:string|null;currentRecordId:string;previousValue:unknown;currentValue:unknown;}
export interface NflFeatureCoverageRow {category:NflFeatureCategory;status:NflFeatureStageState;recordsExpected:number;recordsObtained:number;coveragePercentage:number|null;integrity:NflFeatureIntegrity;notes:string[];}
export interface NflCriticalFeatureHealth {status:'HEALTHY'|'PARTIAL'|'DEGRADED';required:{startingQb:NflFeatureStageState;gameIdentity:NflFeatureStageState;kickoff:NflFeatureStageState;marketIdentity:NflFeatureStageState;injuryInactiveEvidence:NflFeatureStageState;currentSeasonTeamSample:NflFeatureStageState};counts:{pass:number;partial:number;fail:number;unknown:number};authorizationBasis:'DETERMINISTIC_CATEGORY_REQUIREMENTS_AND_COUNTS_ONLY';}

export interface NflForwardTargetRecord {targetId:string;gameId:string;teamId:string|null;playerId:string|null;recordedAt:string;kickoffTimestamp:string;source:string;sourceTimestamp:string;rawEvidenceReference:string;field:'final_margin'|'final_total'|'qb_attempts'|'qb_rushing_attempts'|'rb_carries'|'rb_targets'|'wr_targets'|'te_targets'|'routes'|'snaps';value:number;classification:'POSTGAME_TARGET_ONLY';correctionOf:string|null;}

const stable=(value:unknown):string=>{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;return`{${Object.keys(value as Record<string,unknown>).sort().map(key=>`${JSON.stringify(key)}:${stable((value as Record<string,unknown>)[key])}`).join(',')}}`;};
const sha=(value:unknown)=>createHash('sha256').update(stable(value)).digest('hex');
const validHash=(value:string)=>/^[a-f0-9]{64}$/.test(value);
const time=(value:string,label:string)=>{const result=Date.parse(value);if(!Number.isFinite(result))throw Error(`Invalid ${label} timestamp.`);return result;};
const marketPattern=/(^|[._ -])(spread|total|moneyline|sportsbook|consensus|implied.?probability|prop.?line|over.?price|under.?price|line.?movement)([._ -]|$)/i;
const marketKeys=(value:unknown,path='value'):string[]=>{if(!value||typeof value!=='object')return[];return Object.entries(value as Record<string,unknown>).flatMap(([key,row])=>marketPattern.test(key)?[`${path}.${key}`]:marketKeys(row,`${path}.${key}`));};
const allStages=(state:NflFeatureStageState):NflFeatureIntegrity=>({SOURCE_RETRIEVAL:state,NORMALIZATION:state,ENTITY_MATCHING:state,CONTEXT_ATTACHMENT:state,FIELD_VALIDITY:state,FRESHNESS:state});

export function nflCaptureWindow(minutesToKickoff:number):Exclude<NflCaptureWindow,'LAST_VERIFIED_PREGAME'>{if(!Number.isFinite(minutesToKickoff)||minutesToKickoff<=0)throw Error('Capture window requires a positive pregame interval.');if(minutesToKickoff>1440)return'>24H';if(minutesToKickoff>360)return'6-24H';if(minutesToKickoff>60)return'1-6H';return'<1H';}

export function createNflForwardFeature(input:Omit<NflForwardFeatureRecord,'recordId'|'minutesToKickoff'|'captureWindow'|'normalizationVersion'|'featureVersion'|'pointInTimeClassification'>):NflForwardFeatureRecord{
  const capture=time(input.captureTimestamp,'capture'),forecast=time(input.forecastTimestamp,'forecast'),kickoff=time(input.kickoffTimestamp,'kickoff'),retrieval=time(input.retrievalTimestamp,'retrieval'),sourceTime=input.sourceTimestamp===null?null:time(input.sourceTimestamp,'source');
  if(capture!==forecast||retrieval>forecast||sourceTime!==null&&sourceTime>forecast||forecast>=kickoff)throw Error('FUTURE_LEAKAGE_VIOLATION');
  if(!input.gameId||!validHash(input.rawEvidenceReference)||input.correctionOf!==null&&!validHash(input.correctionOf))throw Error('Invalid feature identity or raw evidence reference.');
  if(input.category!=='MARKET'&&(marketPattern.test(input.field)||marketPattern.test(input.source)||marketKeys(input.normalizedValue).length))throw Error('MARKET_CONTAMINATION_VIOLATION');
  if(input.numerator!==null&&(!Number.isFinite(input.numerator)||input.numerator<0)||input.denominator!==null&&(!Number.isFinite(input.denominator)||input.denominator<=0)||input.numerator!==null&&input.denominator!==null&&input.numerator>input.denominator)throw Error('Invalid raw numerator/denominator.');
  if(input.qualityState==='UNAVAILABLE'&&input.normalizedValue!==null)throw Error('Unavailable features cannot contain an invented value.');
  const minutesToKickoff=(kickoff-capture)/60_000,withoutId={...input,minutesToKickoff,captureWindow:nflCaptureWindow(minutesToKickoff),normalizationVersion:NFL_FORWARD_NORMALIZATION_VERSION,featureVersion:NFL_FORWARD_FEATURE_VERSION,pointInTimeClassification:sourceTime===null?'PREGAME_SOURCE_TIME_UNKNOWN' as const:'PREGAME_KNOWN' as const};
  return{recordId:sha(withoutId),...withoutId};
}

export function validateNflForwardFeature(row:NflForwardFeatureRecord){const body={...row} as any;delete body.recordId;if(!validHash(row.recordId)||sha(body)!==row.recordId)throw Error('Feature content hash mismatch.');const forecast=time(row.forecastTimestamp,'feature forecast'),capture=time(row.captureTimestamp,'feature capture'),kickoff=time(row.kickoffTimestamp,'feature kickoff'),retrieval=time(row.retrievalTimestamp,'feature retrieval'),sourceTime=row.sourceTimestamp===null?null:time(row.sourceTimestamp,'feature source');if(capture!==forecast||retrieval>forecast||sourceTime!==null&&sourceTime>forecast||forecast>=kickoff)throw Error('FUTURE_LEAKAGE_VIOLATION');if(row.minutesToKickoff!==(kickoff-capture)/60_000||row.captureWindow!==nflCaptureWindow(row.minutesToKickoff))throw Error('Feature timing mismatch.');if(row.category!=='MARKET'&&(marketPattern.test(row.field)||marketPattern.test(row.source)||marketKeys(row.normalizedValue).length))throw Error('MARKET_CONTAMINATION_VIOLATION');return row;}

export function unavailableNflFeature(input:{gameId:string;teamId?:string|null;playerId?:string|null;category:NflFeatureCategory;field:string;captureTimestamp:string;kickoffTimestamp:string;reason:string}):NflForwardFeatureRecord{
  const evidence={category:input.category,field:input.field,reason:input.reason};
  return createNflForwardFeature({gameId:input.gameId,teamId:input.teamId??null,playerId:input.playerId??null,category:input.category,field:input.field,captureTimestamp:input.captureTimestamp,forecastTimestamp:input.captureTimestamp,kickoffTimestamp:input.kickoffTimestamp,source:'SYSTEM_AVAILABILITY_AUDIT',sourceTimestamp:null,retrievalTimestamp:input.captureTimestamp,rawEvidenceReference:sha(evidence),normalizedValue:null,numerator:null,denominator:null,qualityState:'UNAVAILABLE',freshnessState:'UNKNOWN',integrity:{SOURCE_RETRIEVAL:'FAIL',NORMALIZATION:'UNKNOWN',ENTITY_MATCHING:input.playerId||input.teamId?'PASS':'UNKNOWN',CONTEXT_ATTACHMENT:'FAIL',FIELD_VALIDITY:'UNKNOWN',FRESHNESS:'UNKNOWN'},correctionOf:null,notes:[input.reason]});
}

export function rawShare(numerator:number,denominator:number,label:'TARGET_SHARE'|'CARRY_SHARE'|'SNAP_SHARE'){if(!Number.isInteger(numerator)||numerator<0||!Number.isInteger(denominator)||denominator<=0||numerator>denominator)throw Error(`Invalid ${label} numerator/denominator.`);return{numerator,denominator,share:Number((numerator/denominator).toFixed(6)),label};}

export function nflPositionImportanceGroup(position:string):'QB'|'OL'|'WR'|'TE'|'RB'|'DL'|'EDGE'|'LB'|'CB'|'S'|'OTHER'{const value=position.toUpperCase();if(value==='QB')return'QB';if(['OT','T','LT','RT','OG','G','LG','RG','C','OL'].includes(value))return'OL';if(value==='WR')return'WR';if(value==='TE')return'TE';if(['RB','HB','FB'].includes(value))return'RB';if(['DT','NT','DE','DL'].includes(value))return value==='DE'?'EDGE':'DL';if(['EDGE','OLB'].includes(value))return'EDGE';if(['LB','ILB','MLB'].includes(value))return'LB';if(['CB','DB'].includes(value))return'CB';if(['S','FS','SS'].includes(value))return'S';return'OTHER';}
export function normalizeNflForwardRole(position:string,value:string):NflForwardRoleState{const aliases:Record<string,NflForwardRoleState>={STARTER_UNVERIFIED:'QB1',COMMITTEE_PACKAGE_ROLE:'UNKNOWN',PASSING_DOWN_BACK:'PASSING_DOWN',SHORT_YARDAGE_GOAL_LINE:'GOAL_LINE'},normalized=aliases[value]??value,group=nflPositionImportanceGroup(position),allowed:Record<string,NflForwardRoleState[]>={QB:['QB1','QB2','STARTER_UNRESOLVED','UNKNOWN'],RB:['RB1','RB2','RB3','COMMITTEE','PASSING_DOWN','GOAL_LINE','ROTATIONAL','UNKNOWN'],WR:['WR1','WR2','WR3','SLOT','OUTSIDE','ROTATIONAL','UNKNOWN'],TE:['TE1','TE2','ROTATIONAL','BLOCKING_HEAVY','UNKNOWN']};return(allowed[group]??['UNKNOWN']).includes(normalized as NflForwardRoleState)?normalized as NflForwardRoleState:'UNKNOWN';}

export function validateWeatherForecast(input:{forecastTimestamp:string|null;retrievalTimestamp:string;forecastAt:string;kickoffTimestamp:string;temperatureF:number|null;windMph:number|null;gustMph:number|null;precipitationProbability:number|null;precipitationType:string|null;humidity:number|null;indoor:boolean|null}){
  const retrieval=time(input.retrievalTimestamp,'weather retrieval'),forecast=time(input.forecastAt,'forecast'),kickoff=time(input.kickoffTimestamp,'kickoff'),source=input.forecastTimestamp===null?null:time(input.forecastTimestamp,'weather source');
  if(retrieval>forecast||source!==null&&source>forecast||forecast>=kickoff)throw Error('WEATHER_FUTURE_LEAKAGE_VIOLATION');
  const numeric=[input.temperatureF,input.windMph,input.gustMph,input.precipitationProbability,input.humidity];if(numeric.some(value=>value!==null&&!Number.isFinite(value)))throw Error('Invalid weather field.');
  if(input.precipitationProbability!==null&&(input.precipitationProbability<0||input.precipitationProbability>100))throw Error('Invalid precipitation probability.');
  return{...input,quality:input.indoor===true?'VERIFIED_INDOOR':source===null?'SOURCE_TIMESTAMP_UNKNOWN':'PREGAME_FORECAST'} as const;
}

export function nflRestFeatures(input:{kickoffTimestamp:string;priorKickoffs:Array<{kickoff:string;final:boolean;overtime:boolean;away:boolean;international:boolean}>}){
  const kickoff=time(input.kickoffTimestamp,'kickoff'),prior=input.priorKickoffs.filter(row=>row.final&&time(row.kickoff,'prior kickoff')<kickoff).sort((a,b)=>Date.parse(b.kickoff)-Date.parse(a.kickoff)),last=prior[0]??null,daysRest=last?Number(((kickoff-Date.parse(last.kickoff))/86_400_000).toFixed(3)):null;
  return{daysRest,shortWeek:daysRest!==null&&daysRest<7,byeWeek:daysRest!==null&&daysRest>=13,mondayToSunday:daysRest!==null&&daysRest>=5.5&&daysRest<=6.5&&new Date(last!.kickoff).getUTCDay()===1,thursday:new Date(input.kickoffTimestamp).getUTCDay()===4,internationalTravel:last?.international===true,consecutiveRoadGames:Boolean(last?.away),previousGameOvertime:last?.overtime===true};
}

const roleRank=(value:unknown)=>{const roles=['UNKNOWN','ROTATIONAL','QB2','RB3','WR3','TE2','RB2','WR2','COMMITTEE','SLOT','OUTSIDE','PASSING_DOWN','GOAL_LINE','QB1','RB1','WR1','TE1'];const index=roles.indexOf(String(value));return index<0?0:index;};
export function detectNflFeatureChanges(previous:NflForwardFeatureRecord[],current:NflForwardFeatureRecord[],capturedAt:string):NflFeatureChangeEvent[]{
  const prior=new Map(previous.map(row=>[[row.gameId,row.teamId??'',row.playerId??'',row.category,row.field].join('|'),row])),events:NflFeatureChangeEvent[]=[];
  for(const row of current){const key=[row.gameId,row.teamId??'',row.playerId??'',row.category,row.field].join('|'),old=prior.get(key);if(!old||stable(old.normalizedValue)===stable(row.normalizedValue))continue;let type:NflFeatureChangeEvent['type']|null=null;
    if(row.category==='QB'){const oldValue=old.normalizedValue as any,newValue=row.normalizedValue as any,before=String(oldValue?.gameDayInactiveStatus??oldValue?.status??oldValue),after=String(newValue?.gameDayInactiveStatus??newValue?.status??newValue),beforeStarter=oldValue?.projectedStarter??oldValue,afterStarter=newValue?.projectedStarter??newValue;type=after==='UNRESOLVED'||afterStarter==='UNRESOLVED'?'QB_STARTER_UNRESOLVED':after==='INACTIVE_VERIFIED'?'QB_INACTIVE_VERIFIED':row.field.includes('starter')&&beforeStarter!==afterStarter?'QB_STARTER_CHANGED':/OUT|DOUBTFUL|QUESTIONABLE/.test(after)&&!/OUT|DOUBTFUL|QUESTIONABLE/.test(before)?'QB_STATUS_DOWNGRADED':'QB_STATUS_UPGRADED';}
    if(row.category==='PLAYER_ROLE'||row.category==='DEPTH_CHART'){const before=roleRank(old.normalizedValue),after=roleRank(row.normalizedValue);type=row.field.includes('depth')?'DEPTH_ORDER_CHANGE':String(row.normalizedValue).includes('COMMITTEE')||String(old.normalizedValue).includes('COMMITTEE')?'COMMITTEE_CHANGE':String(old.normalizedValue)==='UNKNOWN'?'UNKNOWN_TO_CONFIRMED':row.field.includes('starter')?'STARTER_CHANGE':after>=before?'ROLE_UPGRADE':'ROLE_DOWNGRADE';}
    if(type){const body={gameId:row.gameId,teamId:row.teamId,playerId:row.playerId,capturedAt,type,previousRecordId:old.recordId,currentRecordId:row.recordId,previousValue:old.normalizedValue,currentValue:row.normalizedValue};events.push({eventId:sha(body),...body});}
  }
  return events.sort((a,b)=>a.eventId.localeCompare(b.eventId));
}

export function buildNflFeatureScorecard(records:NflForwardFeatureRecord[],expected:Partial<Record<NflFeatureCategory,number>>,marketRecords=0):NflFeatureCoverageRow[]{return NFL_FEATURE_SCORECARD_CATEGORIES.map(category=>{const recordsExpected=Math.max(0,expected[category]??0),available=category==='MARKET'?marketRecords:records.filter(row=>row.category===category&&row.qualityState!=='UNAVAILABLE'&&row.qualityState!=='INVALID').length,recordsObtained=Math.min(recordsExpected||available,available),coveragePercentage=recordsExpected?Number((recordsObtained/recordsExpected*100).toFixed(1)):null,status:NflFeatureStageState=recordsExpected===0?'UNKNOWN':recordsObtained===0?'FAIL':recordsObtained<recordsExpected?'PARTIAL':'PASS',rows=records.filter(row=>row.category===category),integrity=rows.length?Object.fromEntries(Object.keys(allStages('UNKNOWN')).map(stage=>{const values=rows.map(row=>row.integrity[stage as keyof NflFeatureIntegrity]);return[stage,values.includes('FAIL')?'FAIL':values.includes('PARTIAL')?'PARTIAL':values.every(value=>value==='PASS')?'PASS':'UNKNOWN'];})) as unknown as NflFeatureIntegrity:allStages('UNKNOWN');return{category,status,recordsExpected,recordsObtained,coveragePercentage,integrity,notes:status==='FAIL'?[`${category} expected but no usable pregame record was attached.`]:status==='UNKNOWN'?[`${category} was not expected for this run or source support is unavailable.`]:[]};});}

export function buildNflCriticalFeatureHealth(input:{startingQb:NflFeatureStageState;gameIdentity:NflFeatureStageState;kickoff:NflFeatureStageState;marketIdentity:NflFeatureStageState;injuryInactiveEvidence:NflFeatureStageState;currentSeasonTeamSample:NflFeatureStageState}):NflCriticalFeatureHealth{const values=Object.values(input),counts={pass:values.filter(v=>v==='PASS').length,partial:values.filter(v=>v==='PARTIAL').length,fail:values.filter(v=>v==='FAIL').length,unknown:values.filter(v=>v==='UNKNOWN').length},status=counts.fail?'DEGRADED':counts.partial||counts.unknown?'PARTIAL':'HEALTHY';return{status,required:input,counts,authorizationBasis:'DETERMINISTIC_CATEGORY_REQUIREMENTS_AND_COUNTS_ONLY'};}

export class NflRequestDeduplicator {
  private cache=new Map<string,{storedAt:number;ttlMs:number;value:unknown}>();private pending=new Map<string,Promise<unknown>>();
  constructor(private now=()=>Date.now()){}
  async get<T>(key:string,ttlMs:number,loader:()=>Promise<T>):Promise<{value:T;cacheHit:boolean}>{const hit=this.cache.get(key);if(hit&&this.now()-hit.storedAt<=Math.min(hit.ttlMs,ttlMs))return{value:structuredClone(hit.value) as T,cacheHit:true};const active=this.pending.get(key);if(active)return{value:structuredClone(await active) as T,cacheHit:true};const pending=loader().then(value=>(this.cache.set(key,{storedAt:this.now(),ttlMs,value:structuredClone(value)}),value)).finally(()=>this.pending.delete(key));this.pending.set(key,pending);return{value:structuredClone(await pending),cacheHit:false};}
  clearExpired(){for(const [key,row] of this.cache)if(this.now()-row.storedAt>row.ttlMs)this.cache.delete(key);}
}

export const NFL_PHASE4_PROVIDER_COST_AUDIT=Object.freeze([
  {provider:'ESPN public web feeds',featureGained:'schedule, roster, depth, best-effort pregame summary and historical player usage',requestPattern:'one scoreboard; roster/depth once per team; summary once per game',estimatedCallsPerManualCollection:'1 + 2/team + 1/game',estimatedPaidCredits:0,cacheability:'schedule short; roster/depth bounded; historical usage long',freeAlternative:'none with an equivalent combined free surface',existingSourceAlternative:'already used by NFL forward collection'},
  {provider:'NFL.com official inactives',featureGained:'official game-day inactive evidence',requestPattern:'one shared page per manual collection',estimatedCallsPerManualCollection:'1',estimatedPaidCredits:0,cacheability:'short, only through source freshness window',freeAlternative:'none more authoritative',existingSourceAlternative:'already used by NFL forward collection'},
  {provider:'NFL.com official weekly injury report',featureGained:'practice participation and official game-status evidence',requestPattern:'one shared report per distinct eligible week',estimatedCallsPerManualCollection:'0-1 for a single-week slate',estimatedPaidCredits:0,cacheability:'short and publication-aware',freeAlternative:'none more authoritative',existingSourceAlternative:'existing official NFL report parser and cache'},
  {provider:'nflverse archived data',featureGained:'postgame snaps, schedules and eventual research targets',requestPattern:'cached season files; never required for every manual collection',estimatedCallsPerManualCollection:'0 when cached',estimatedPaidCredits:0,cacheability:'season artifacts are highly cacheable',freeAlternative:'ESPN postgame summaries for narrower fields',existingSourceAlternative:'already archived for Phase 3 research'},
  {provider:'The Odds API',featureGained:'separate game and supported prop quote archive',requestPattern:'one bounded event-market request per matched game',estimatedCallsPerManualCollection:'0-20',estimatedPaidCredits:'0-200 existing credits, only on explicit non-dry manual run',cacheability:'short; never beyond kickoff',freeAlternative:'none accepted for timestamped multi-book quotes',existingSourceAlternative:'existing market archive; no Phase 4 expansion'},
  {provider:'Dedicated route/depth/injury vendor',featureGained:'routes and richer point-in-time roles/injuries',requestPattern:'not enabled',estimatedCallsPerManualCollection:'0',estimatedPaidCredits:0,cacheability:'not applicable',freeAlternative:'no reliable point-in-time route source confirmed',existingSourceAlternative:'ROUTE_DATA_UNAVAILABLE and explicit partial coverage'},
]);

export function validateNflTargetRecord(input:Omit<NflForwardTargetRecord,'targetId'>):NflForwardTargetRecord{const recorded=time(input.recordedAt,'target record'),kickoff=time(input.kickoffTimestamp,'target kickoff'),source=time(input.sourceTimestamp,'target source');if(recorded<=kickoff||source<kickoff||source>recorded||!Number.isFinite(input.value)||!validHash(input.rawEvidenceReference))throw Error('Invalid or pregame-contaminating settlement target.');const body={...input};return{targetId:sha(body),...body};}

export function buildNflForwardRows(snapshots:Array<{snapshotId:string;forecastAt:string;game:{canonicalGameId:string;scheduledKickoff:string;home:{canonicalTeamId:string};away:{canonicalTeamId:string}};players:Array<{canonicalPlayerId:string;teamId:string;position:string}>;featureRecords?:NflForwardFeatureRecord[];gameMarkets?:unknown[];propMarkets?:unknown[]}>){
  const gameRows=[] as any[],playerRows=[] as any[];
  for(const snapshot of [...snapshots].sort((a,b)=>a.forecastAt.localeCompare(b.forecastAt)||a.snapshotId.localeCompare(b.snapshotId))){const features=[...(snapshot.featureRecords??[])].sort((a,b)=>a.recordId.localeCompare(b.recordId));if(features.some(row=>Date.parse(row.retrievalTimestamp)>Date.parse(snapshot.forecastAt)||row.forecastTimestamp!==snapshot.forecastAt))throw Error('FORWARD_ROW_LEAKAGE_VIOLATION');const teamFeatures=(teamId:string)=>features.filter(row=>row.teamId===teamId&&row.playerId===null).map(row=>({recordId:row.recordId,category:row.category,field:row.field,value:row.normalizedValue,numerator:row.numerator,denominator:row.denominator}));gameRows.push({snapshotId:snapshot.snapshotId,gameId:snapshot.game.canonicalGameId,forecastTimestamp:snapshot.forecastAt,kickoffTimestamp:snapshot.game.scheduledKickoff,homeTeamId:snapshot.game.home.canonicalTeamId,awayTeamId:snapshot.game.away.canonicalTeamId,homeFeatures:teamFeatures(snapshot.game.home.canonicalTeamId),awayFeatures:teamFeatures(snapshot.game.away.canonicalTeamId),gameFeatures:features.filter(row=>row.teamId===null&&row.playerId===null).map(row=>({recordId:row.recordId,category:row.category,field:row.field,value:row.normalizedValue})),marketReferences:{gameQuoteCount:snapshot.gameMarkets?.length??0,propQuoteCount:snapshot.propMarkets?.length??0},targets:[]});for(const player of snapshot.players)playerRows.push({snapshotId:snapshot.snapshotId,gameId:snapshot.game.canonicalGameId,forecastTimestamp:snapshot.forecastAt,kickoffTimestamp:snapshot.game.scheduledKickoff,playerId:player.canonicalPlayerId,teamId:player.teamId,position:player.position,features:features.filter(row=>row.playerId===player.canonicalPlayerId).map(row=>({recordId:row.recordId,category:row.category,field:row.field,value:row.normalizedValue,numerator:row.numerator,denominator:row.denominator})),targets:[]});}
  return{schemaVersion:'nfl-forward-row-builder-v1',gameRows,playerGameRows:playerRows,datasetHash:sha({gameRows,playerRows})};
}

export const NFL_NEXT_MODEL_DATA_GATES=Object.freeze({gameModels:{minimumSettledGameForecasts:200,startingQbCoverageMinimum:.90,criticalTeamFeatureCoverageMinimum:.85,marketIdentityMinimum:.95,maximumLeakageViolations:0},playerOpportunity:{minimumSettledPlayerGameRows:200,positionsRequired:['QB','RB','WR','TE'],routesRequirement:'TRUSTWORTHY_ROUTES_OR_PREDECLARED_ROUTE_UNAVAILABLE_STRATEGY',availabilityCoverageMinimum:.90,identityCoverageMinimum:.98,maximumLeakageViolations:0},sampleLabels:[{maximum:49,label:'EARLY COLLECTION'},{minimum:50,maximum:199,label:'PRELIMINARY'},{minimum:200,label:'RESEARCH-EVALUABLE'}]});
export function nflForwardSampleLabel(n:number):'EARLY COLLECTION'|'PRELIMINARY'|'RESEARCH-EVALUABLE'{if(!Number.isInteger(n)||n<0)throw Error('Invalid forward sample size.');return n<50?'EARLY COLLECTION':n<200?'PRELIMINARY':'RESEARCH-EVALUABLE';}
