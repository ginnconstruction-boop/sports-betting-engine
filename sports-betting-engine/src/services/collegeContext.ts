import * as fs from 'fs';
import * as path from 'path';
import {createHash,randomUUID} from 'crypto';
export type CollegeDivision='FBS'|'FCS'|'UNKNOWN';
export const COLLEGE_CONTEXT_VERSION='college-context-v2';
export const ROSTER_FIELDS=['returningProduction','returningOffensiveStarters','returningDefensiveStarters','qbContinuity','newStartingQb',
  'qbTransfer','transferAdditions','transferLosses','majorTurnover','talentRating','headCoachChange','offensiveCoordinatorChange',
  'defensiveCoordinatorChange','schemeChange','priorSeasonStrength','conferenceStrength','depthRating','fcsQuality','garbageTime','favoriteSubstitution']as const;
export type RosterFeature=typeof ROSTER_FIELDS[number];
export interface CollegeRosterSnapshot {
  teamId:string;season:number;version:string;source:string;publishedAt:string;fetchedAt:string;validUntil:string;
  features:Partial<Record<RosterFeature,number>>;
  sampleQuality:number|null;
  qb?:{eventId:string;starterId:string;verifiedAt:string;source:string;injuryStatusVerified:boolean};
}
export interface ContextCoefficientArtifact {
  version:string;trainedThrough:string;trainingDataHash:string;validation:{approvedForPaper:boolean;games:number;baselineRmse:number;rmse:number};
  roster:Partial<Record<RosterFeature,number>>;
  mismatch:Partial<Record<'talentRating'|'depthRating'|'conferenceStrength'|'fcsQuality'|'garbageTime'|'favoriteSubstitution',number>>;
}
export const BLEND_POLICY={version:'prior-equivalent-games-v1-unfitted',early:6,middle:4,late:2};
export function earlySeasonBlend(week:number|null,currentGames:number,sampleQuality:number|null,policy=BLEND_POLICY){
  if(!Number.isInteger(currentGames)||currentGames<0||sampleQuality!==null&&(!Number.isFinite(sampleQuality)||sampleQuality<0||sampleQuality>1))
    throw Error('Invalid current-season sample quality');
  if([policy.early,policy.middle,policy.late].some(n=>!Number.isFinite(n)||n<=0))throw Error('Invalid blend policy');
  const prior=week===null||week<=3?policy.early:week<=6?policy.middle:policy.late;
  const effective=currentGames*(sampleQuality??0),currentWeight=effective/(effective+prior);
  return {policy:policy.version,calibrated:false,priorEquivalentGames:prior,effectiveCurrentGames:effective,
    preseasonWeight:1-currentWeight,currentSeasonWeight:currentWeight,qualityKnown:sampleQuality!==null};
}
let conferenceRegistry:any;
export function collegeDivision(season:number,conferenceId:string):CollegeDivision {
  try{
    if(!conferenceRegistry){const b=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/college-conferences-v1.json'),'utf8'));
      if(createHash('sha256').update(JSON.stringify(b.payload)).digest('hex')!==b.sha256)throw Error('Registry hash');conferenceRegistry=b.payload;}
    return conferenceRegistry.seasons[String(season)]?.[conferenceId]??'UNKNOWN';
  }catch{return'UNKNOWN';}
}
export function rosterContext(snapshot:CollegeRosterSnapshot|undefined,teamId:string,season:number,eventId:string,kickoff:number,now:number){
  const issues:string[]=[],times=snapshot?[snapshot.publishedAt,snapshot.fetchedAt,snapshot.validUntil].map(Date.parse):[];
  const verified=!!snapshot&&snapshot.teamId===teamId&&snapshot.season===season&&!!snapshot.version&&/^https:\/\//.test(snapshot.source)
    &&times.every(Number.isFinite)&&times[0]<=times[1]&&times[1]<=now&&times[0]<kickoff&&times[2]>=now&&times[2]>=times[1]
    &&now-times[1]<=7*86400_000;
  if(!verified)issues.push('Verified current-season roster snapshot missing, stale or not known at forecast time.');
  const features=verified?snapshot.features??{}:{};
  const missing=ROSTER_FIELDS.filter(k=>!Number.isFinite(features[k]));
  if(missing.length)issues.push('Missing roster features: '+missing.join(', '));
  const bounded=(k:RosterFeature,min:number,max:number)=>features[k]===undefined||Number.isFinite(features[k])&&features[k]>=min&&features[k]<=max;
  const validValues=bounded('returningProduction',0,1)&&bounded('returningOffensiveStarters',0,11)&&bounded('returningDefensiveStarters',0,11)
    &&['qbContinuity','newStartingQb','qbTransfer','majorTurnover','headCoachChange','offensiveCoordinatorChange','defensiveCoordinatorChange','schemeChange']
      .every(k=>bounded(k as RosterFeature,0,1))&&bounded('transferAdditions',0,200)&&bounded('transferLosses',0,200)
    &&Object.values(features).every(v=>Number.isFinite(v));
  if(!validValues)issues.push('Impossible roster feature values.');
  const qb=snapshot?.qb,qbTime=Date.parse(qb?.verifiedAt??'');
  const qbVerified=verified&&!!qb&&qb.eventId===eventId&&!!qb.starterId&&/^https:\/\//.test(qb.source)&&Number.isFinite(qbTime)
    &&qbTime<=now&&qbTime<kickoff&&now-qbTime<=48*3600_000;
  if(!qbVerified)issues.push('Starting QB not verified for this game.');
  if(!qbVerified||!qb.injuryStatusVerified)issues.push('Game-specific injury/QB availability unverified.');
  const quality=verified&&validValues&&typeof snapshot.sampleQuality==='number'&&Number.isFinite(snapshot.sampleQuality)
    &&snapshot.sampleQuality>=0&&snapshot.sampleQuality<=1?snapshot.sampleQuality:null;
  return {teamId,season,status:verified&&validValues?'verified_snapshot':'missing_or_invalid',features:validValues?features:{},
    missing,qbVerified,injuryVerified:qbVerified&&qb.injuryStatusVerified,quality,issues,
    completeness:verified&&validValues?(ROSTER_FIELDS.length-missing.length)/ROSTER_FIELDS.length:0,
    snapshot:verified&&validValues?snapshot:null};
}
export function loadCollegeRosterSnapshots(root:string):CollegeRosterSnapshot[]{
  const f=path.join(root,'college_context','rosters.json');if(!fs.existsSync(f))return[];
  const d=JSON.parse(fs.readFileSync(f,'utf8'));if(d.schema!==1||!Array.isArray(d.snapshots))throw Error('Invalid college context store');
  return d.snapshots;
}
export function loadCollegeContextCoefficients(){
  const f=path.resolve(__dirname,'../data/college-context-coefficients-v1.json');if(!fs.existsSync(f))return undefined;
  const b=JSON.parse(fs.readFileSync(f,'utf8'));
  if(createHash('sha256').update(JSON.stringify(b.payload)).digest('hex')!==b.sha256||b.payload.validation?.approvedForPaper!==true)
    throw Error('College context coefficient integrity/approval mismatch');
  return b.payload as ContextCoefficientArtifact;
}
export function selectRosterSnapshot(all:CollegeRosterSnapshot[],teamId:string,season:number,now:number){
  return all.filter(s=>s.teamId===teamId&&s.season===season&&Date.parse(s.fetchedAt)<=now&&Date.parse(s.publishedAt)<=now)
    .sort((a,b)=>Date.parse(b.fetchedAt)-Date.parse(a.fetchedAt))[0];
}
/** Operator-imported dated evidence; not a scraper or a claim of provider verification.
 * Never edits an earlier version. Source snapshots remain content-addressed. */
export function appendCollegeRosterSnapshots(root:string,incoming:CollegeRosterSnapshot[],now:number){
  if(!Array.isArray(incoming)||incoming.length>500)throw Error('Expected at most 500 dated roster snapshots');
  const existing=loadCollegeRosterSnapshots(root),all=[...existing],directory=path.join(root,'college_context');
  for(const s of incoming){
    if(!s||!/^\d+$/.test(s.teamId)||!Number.isInteger(s.season)||s.season<2023||!s.version||!s.features)
      throw Error('Invalid roster snapshot identity');
    const context=rosterContext(s,s.teamId,s.season,s.qb?.eventId??'',Date.parse(s.validUntil),now);
    if(context.status!=='verified_snapshot')throw Error('Invalid/stale/future roster source; no import');
    const previous=all.find(r=>r.teamId===s.teamId&&r.season===s.season&&r.version===s.version);
    if(previous){if(JSON.stringify(previous)!==JSON.stringify(s))throw Error('Roster version already exists; use a separate new version');continue;}
    all.push(structuredClone(s));
  }
  fs.mkdirSync(directory,{recursive:true});
  for(const s of incoming){const bytes=JSON.stringify(s),id=createHash('sha256').update(bytes).digest('hex'),file=path.join(directory,id+'.json');
    try{fs.writeFileSync(file,bytes,{flag:'wx'});}catch(e:any){if(e.code!=='EEXIST'||fs.readFileSync(file,'utf8')!==bytes)throw e;}}
  const tmp=path.join(directory,randomUUID()+'.tmp');fs.writeFileSync(tmp,JSON.stringify({schema:1,snapshots:all},null,2),{flag:'wx'});
  fs.renameSync(tmp,path.join(directory,'rosters.json'));return{added:all.length-existing.length,total:all.length};
}
/** No default point bonus. A future independently validated, point-unit coefficient
 * artifact can use team-quality differences; absent data never becomes neutral. */
export function contextMarginAdjustment(home:ReturnType<typeof rosterContext>,away:ReturnType<typeof rosterContext>,
  divisions:[CollegeDivision,CollegeDivision],week:number|null,samples:[number,number],now:number,artifact?:ContextCoefficientArtifact){
  const homeBlend=earlySeasonBlend(week,samples[0],home.quality),awayBlend=earlySeasonBlend(week,samples[1],away.quality);
  const available=home.completeness===1&&away.completeness===1&&artifact?.validation.approvedForPaper===true
    &&artifact.validation.games>=500&&artifact.validation.rmse<artifact.validation.baselineRmse
    &&/^[a-f0-9]{64}$/.test(artifact.trainingDataHash)&&Date.parse(artifact.trainedThrough)<now;
  if(!available)return {rosterPoints:null,mismatchPoints:null,adjusted:false,homeBlend,awayBlend,
    reason:'No validated dated roster/depth coefficients and complete inputs. Raw margin retained for research; confidence reduced.'};
  let rosterPoints=0,mismatchPoints=0;
  for(const k of ROSTER_FIELDS){const c=artifact.roster[k]??0;if(!Number.isFinite(c))throw Error('Invalid roster coefficient');
    rosterPoints+=c*(home.features[k]*homeBlend.preseasonWeight-away.features[k]*awayBlend.preseasonWeight);}
  const mismatch=divisions[0]!=='UNKNOWN'&&divisions[1]!=='UNKNOWN'&&divisions[0]!==divisions[1];
  if(mismatch)for(const [k,c]of Object.entries(artifact.mismatch)){
    if(!Number.isFinite(c)||!Number.isFinite(home.features[k])||!Number.isFinite(away.features[k]))throw Error('Invalid mismatch feature');
    mismatchPoints+=c*(home.features[k]-away.features[k]);
  }
  return {rosterPoints,mismatchPoints,adjusted:true,homeBlend,awayBlend,reason:'Validated team-quality interactions; no fixed FBS bonus.'};
}
