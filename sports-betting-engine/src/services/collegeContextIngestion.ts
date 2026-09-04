import {fetchNflJson,nflSeason} from './nflResearch';
import {createHash} from 'crypto';
import {canonicalCollegeName,resolveCollegeTeam} from './collegeEntities';
import {ESPN_COLLEGE} from './collegeResearch';
import {appendCollegeContextRecords,archiveCollegeContextPayload,CollegeContextRecord,ContextDomain,ContextIngestionReason,ContextReliability,loadCollegeContextRecords,NewCollegeContextRecord,VerificationStatus} from './collegeContextEvidence';

export interface ContextTeamSeed {teamId:string;teamName:string;aliases?:string[];eventId:string;commenceTime:string;division:'FBS'|'FCS'|'UNKNOWN';venue?:{id:string|null;name:string|null;indoor:boolean|null};}
const CFBD='https://api.collegefootballdata.com';
const HOUR=3600_000,DAY=24*HOUR;
export function contextSourceReliability(tier:1|2|3|4,verification:VerificationStatus):ContextReliability{
  if(verification==='CONFLICTED'||verification==='UNVERIFIED'||tier===4)return'LOW';
  if(tier===1&&['VERIFIED','CORROBORATED'].includes(verification))return'HIGH';
  return'MEDIUM';
}
function source(name:string,url:string,tier:1|2|3|4,verification:VerificationStatus,retrievedAt:string,publishedAt=retrievedAt){
  return{name,url,tier,reliability:contextSourceReliability(tier,verification)as Exclude<ContextReliability,'INSUFFICIENT'>,publishedAt,retrievedAt};
}
function base(team:ContextTeamSeed,domain:ContextDomain,field:string,value:unknown,url:string,rawPayloadHash:string,retrievedAt:string,
  verification:VerificationStatus='REPORTED',effectiveTo:string|null=null):NewCollegeContextRecord{
  return{teamId:team.teamId,teamName:team.teamName,season:nflSeason(team.commenceTime),eventId:['weather','injuries','qb','current_season','market'].includes(domain)?team.eventId:null,
    playerId:null,domain,field,value,effectiveFrom:retrievedAt,effectiveTo,source:source(url.includes('collegefootballdata')?'CollegeFootballData':'ESPN',url,
      url.includes('collegefootballdata')?3:2,verification,retrievedAt),verification,rawPayloadHash};
}
function finite(value:any){return typeof value==='number'&&Number.isFinite(value);}
function bool(value:any){return typeof value==='boolean';}
function recordIf(rows:NewCollegeContextRecord[],team:ContextTeamSeed,domain:ContextDomain,field:string,value:any,url:string,hash:string,at:string,
  verification:VerificationStatus='REPORTED',effectiveTo:string|null=null){if(value!==undefined&&value!==null&&(typeof value!=='number'||Number.isFinite(value)))rows.push(base(team,domain,field,value,url,hash,at,verification,effectiveTo));}
const STATUS_FIELD:Record<ContextDomain,string>={qb:'qb.ingestionStatus',roster:'roster.ingestionStatus',returning_production:'returning.ingestionStatus',transfers:'transfers.ingestionStatus',
  coaching:'coaching.ingestionStatus',talent:'talent.ingestionStatus',fcs:'fcs.ingestionStatus',injuries:'injuries.ingestionStatus',weather:'weather.ingestionStatus',
  current_season:'current.ingestionStatus',market:'market.ingestionStatus'};
function status(rows:NewCollegeContextRecord[],team:ContextTeamSeed,domain:ContextDomain,value:'AVAILABLE'|ContextIngestionReason,url:string,hash:string,at:string,effectiveTo:string|null=null){
  recordIf(rows,team,domain,STATUS_FIELD[domain],value,url,hash,at,'REPORTED',effectiveTo);
}
function fieldMissing(rows:NewCollegeContextRecord[],team:ContextTeamSeed,domain:ContextDomain,field:string,reason:ContextIngestionReason,url:string,hash:string,at:string,effectiveTo:string|null=null){
  recordIf(rows,team,domain,`${field}.diagnostic`,reason,url,hash,at,'REPORTED',effectiveTo);
}
function qbDepth(summary:any,teamId:string){
  const team=(summary?.depthchart??summary?.depthcharts??[]).find?.((x:any)=>String(x?.team?.id??x?.teamId)===teamId);
  const groups=team?.positions??team?.depthchart??team?.items??[];
  const qb=groups.find?.((x:any)=>String(x?.position?.abbreviation??x?.position??x?.name).toUpperCase()==='QB');
  const athletes=qb?.athletes??qb?.items??[];if(!Array.isArray(athletes)||!athletes.length)return null;
  const first=athletes[0]?.athlete??athletes[0];return first?.displayName||first?.fullName?{id:String(first.id??''),name:first.displayName??first.fullName}:null;
}
function injuryGroups(summary:any){return Array.isArray(summary?.injuries)?summary.injuries:[];}
function parseLine(value:any){const n=Number(String(value??'').replace(/^[ou]/i,''));return Number.isFinite(n)?n:undefined;}
function passingLeader(summary:any,teamId:string){
  const team=(Array.isArray(summary?.leaders)?summary.leaders:[]).find((x:any)=>String(x?.team?.id)===teamId);
  const group=(team?.leaders??[]).find((x:any)=>x?.name==='passingYards'),leader=group?.leaders?.[0],athlete=leader?.athlete;
  if(!athlete?.displayName||String(athlete?.position?.abbreviation??'').toUpperCase()!=='QB')return null;
  const attempts=Number(String(leader.displayValue??leader.summary??'').match(/\d+\/(\d+)/)?.[1]);
  return{id:String(athlete.id??''),name:String(athlete.displayName),attempts:Number.isFinite(attempts)?attempts:null,active:String(athlete.status?.type??'').toLowerCase()==='active'};
}
function teamStats(summary:any,teamId:string){
  const team=(summary?.boxscore?.teams??[]).find((x:any)=>String(x?.team?.id)===teamId),map=new Map<string,number>();
  for(const item of team?.statistics??[]){const n=Number(item.displayValue);if(Number.isFinite(n))map.set(String(item.name),n);}return map;
}
function currentGames(summary:any,teamId:string,season:number,retrieved:number,eventId:string){
  const group=(Array.isArray(summary?.lastFiveGames)?summary.lastFiveGames:[]).find((x:any)=>String(x?.team?.id)===teamId),start=Date.parse(`${season}-07-01T00:00:00Z`);
  return (group?.events??[]).filter((game:any)=>String(game.id)!==eventId&&Number.isFinite(Date.parse(game.gameDate))&&Date.parse(game.gameDate)>=start&&Date.parse(game.gameDate)<retrieved)
    .sort((a:any,b:any)=>Date.parse(a.gameDate)-Date.parse(b.gameDate));
}
function summaryTeamIds(summary:any){return (summary?.header?.competitions?.[0]?.competitors??[]).map((c:any)=>String(c?.team?.id??'')).filter(Boolean);}
export function contextRecordsFromEspnSummary(summary:any,teams:ContextTeamSeed[],url:string,retrieved:number,rawPayloadHash:string){
  const at=new Date(retrieved).toISOString(),rows:NewCollegeContextRecord[]=[],gameInfo=summary?.gameInfo??{},venue=gameInfo.venue??{},weather=gameInfo.weather??{};
  for(const team of teams){
    const end=new Date(Date.parse(team.commenceTime)+6*HOUR).toISOString();
    if(!summary||typeof summary!=='object'||Array.isArray(summary)){for(const domain of ['qb','current_season','injuries','weather','market'] as ContextDomain[])status(rows,team,domain,'PARSER_FAILED',url,rawPayloadHash,at,end);continue;}
    const identities=summaryTeamIds(summary);if(identities.length&&(!identities.includes(team.teamId)||new Set(identities).size!==identities.length)){
      for(const domain of ['qb','current_season','injuries','weather','market'] as ContextDomain[])status(rows,team,domain,'TEAM_MATCH_FAILED',url,rawPayloadHash,at,end);continue;
    }
    recordIf(rows,team,'weather','weather.providerChecked',true,url,rawPayloadHash,at,'REPORTED',end);
    const indoor=bool(venue.indoor)?venue.indoor:team.venue?.indoor;
    if(bool(indoor))recordIf(rows,team,'weather','weather.indoor',indoor,url,rawPayloadHash,at,'REPORTED',end);
    recordIf(rows,team,'weather','weather.temperatureF',finite(weather.temperature)?weather.temperature:undefined,url,rawPayloadHash,at,'REPORTED',end);
    recordIf(rows,team,'weather','weather.feelsLikeF',finite(weather.feelsLikeTemperature)?weather.feelsLikeTemperature:undefined,url,rawPayloadHash,at,'REPORTED',end);
    recordIf(rows,team,'weather','weather.windMph',finite(weather.windSpeed)?weather.windSpeed:undefined,url,rawPayloadHash,at,'REPORTED',end);
    recordIf(rows,team,'weather','weather.gustMph',finite(weather.gust)?weather.gust:undefined,url,rawPayloadHash,at,'REPORTED',end);
    recordIf(rows,team,'weather','weather.precipitationProbability',finite(weather.precipitation)?weather.precipitation:undefined,url,rawPayloadHash,at,'REPORTED',end);
    recordIf(rows,team,'weather','weather.precipitationMm',finite(weather.precipitationAmount)?weather.precipitationAmount:undefined,url,rawPayloadHash,at,'REPORTED',end);
    recordIf(rows,team,'weather','weather.humidityPct',finite(weather.humidity)?weather.humidity:undefined,url,rawPayloadHash,at,'REPORTED',end);
    for(const [field,raw] of [['weather.feelsLikeF',weather.feelsLikeTemperature],['weather.windMph',weather.windSpeed],['weather.precipitationMm',weather.precipitationAmount],['weather.humidityPct',weather.humidity]] as const)
      if(!finite(raw))fieldMissing(rows,team,'weather',field,'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at,end);
    const temp=weather.temperature,gust=weather.gust,flags:string[]=[];
    if(finite(gust)&&gust>=20)flags.push('GUST_20_PLUS');else if(finite(gust)&&gust>=15)flags.push('GUST_15_PLUS');
    if(finite(temp)&&temp>=95)flags.push('EXTREME_HEAT');if(finite(temp)&&temp<=32)flags.push('EXTREME_COLD');
    if(flags.length)recordIf(rows,team,'weather','weather.flags',flags,url,rawPayloadHash,at,'REPORTED',end);
    const games=currentGames(summary,team.teamId,nflSeason(team.commenceTime),retrieved,team.eventId),last=games.at(-1),stats=teamStats(summary,team.teamId),leader=passingLeader(summary,team.teamId),depth=qbDepth(summary,team.teamId);
    recordIf(rows,team,'current_season','current.gamesPlayed',games.length,url,rawPayloadHash,at,'REPORTED',end);
    if(last){recordIf(rows,team,'current_season','current.lastOpponent',last.opponent?.displayName,url,rawPayloadHash,at,'REPORTED',end);
      recordIf(rows,team,'current_season','current.lastScore',{teamResult:last.gameResult,score:last.score,homeScore:Number(last.homeTeamScore),awayScore:Number(last.awayTeamScore),gameId:String(last.id),playedAt:last.gameDate},url,rawPayloadHash,at,'REPORTED',end);}
    const statFields:Record<string,string>={totalPointsPerGame:'current.pointsPerGame',yardsPerGame:'current.yardsPerGame',totalPointsPerGameAllowed:'current.pointsAllowedPerGame',yardsPerGameAllowed:'current.yardsAllowedPerGame'};
    for(const [sourceName,field] of Object.entries(statFields))recordIf(rows,team,'current_season',field,stats.get(sourceName),url,rawPayloadHash,at,'REPORTED',end);
    if(leader&&games.length){recordIf(rows,team,'current_season','current.primaryQb',leader.name,url,rawPayloadHash,at,'REPORTED',end);recordIf(rows,team,'current_season','current.qbAttempts',leader.attempts,url,rawPayloadHash,at,'REPORTED',end);}
    for(const field of ['current.lastOpponent','current.lastScore','current.pointsPerGame','current.yardsPerGame','current.pointsAllowedPerGame','current.yardsAllowedPerGame','current.primaryQb','current.qbAttempts'])
      if(!rows.some(row=>row.teamId===team.teamId&&row.field===field))fieldMissing(rows,team,'current_season',field,'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at,end);
    const expected=depth??(leader&&games.length&&leader.active?leader:null);
    if(expected){recordIf(rows,team,'qb','qb.starterName',expected.name,url,rawPayloadHash,at,'REPORTED',end);recordIf(rows,team,'qb','qb.status','EXPECTED',url,rawPayloadHash,at,'REPORTED',end);
      recordIf(rows,team,'qb','qb.depthChartStatus',depth?'ESPN_DEPTH_CHART':'CURRENT_SEASON_PRIMARY_PASSER',url,rawPayloadHash,at,'REPORTED',end);}
    status(rows,team,'qb',expected?'AVAILABLE':'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at,end);
    status(rows,team,'current_season',games.length?'AVAILABLE':'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at,end);
    const groups=injuryGroups(summary).filter((g:any)=>String(g?.team?.id??g?.teamId)===team.teamId),listed=groups.flatMap((g:any)=>g.injuries??g.items??[]);
    if(groups.length)recordIf(rows,team,'injuries','injuries.teamStatus',{providerListed:listed.length,scope:'ESPN game-summary listings only'},url,rawPayloadHash,at,'REPORTED',end);
    for(const item of listed){const athlete=item.athlete??item,player=athlete.displayName??athlete.fullName,status=String(item.status??item.type?.name??'UNKNOWN').toUpperCase();
      if(!player)continue;const normalized=['OUT','DOUBTFUL','QUESTIONABLE','PROBABLE','AVAILABLE'].includes(status)?status:'UNKNOWN';
      const playerId=String(athlete.id??player),statusRow=base(team,'injuries','injury.status',normalized,url,rawPayloadHash,at,'REPORTED',end);statusRow.playerId=playerId;rows.push(statusRow);
      const nameRow=base(team,'injuries','injury.playerName',player,url,rawPayloadHash,at,'REPORTED',end);nameRow.playerId=playerId;rows.push(nameRow);
      const position=athlete.position?.abbreviation??item.position;if(position){const positionRow=base(team,'injuries','injury.position',position,url,rawPayloadHash,at,'REPORTED',end);positionRow.playerId=playerId;rows.push(positionRow);}
    }
    status(rows,team,'injuries',groups.length?'AVAILABLE':'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at,end);
    status(rows,team,'weather',Object.keys(weather).length?'AVAILABLE':'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at,end);
    const pick=(Array.isArray(summary.pickcenter)?summary.pickcenter:[]).find((item:any)=>item?.pointSpread?.home),opening=parseLine(pick?.pointSpread?.home?.open?.line),current=parseLine(pick?.pointSpread?.home?.close?.line);
    if(finite(opening)&&finite(current)){recordIf(rows,team,'market','market.provider',pick?.provider?.name??'UNKNOWN',url,rawPayloadHash,at,'REPORTED',end);
      recordIf(rows,team,'market','market.openingHomeSpread',opening,url,rawPayloadHash,at,'REPORTED',end);recordIf(rows,team,'market','market.currentHomeSpread',current,url,rawPayloadHash,at,'REPORTED',end);
      recordIf(rows,team,'market','market.movementPoints',Number((current-opening).toFixed(2)),url,rawPayloadHash,at,'REPORTED',end);recordIf(rows,team,'market','market.movementDirection',current===opening?'NONE':current>opening?'TOWARD_AWAY':'TOWARD_HOME',url,rawPayloadHash,at,'REPORTED',end);}
    status(rows,team,'market',finite(opening)&&finite(current)?'AVAILABLE':'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at,end);
  }
  return rows;
}
export function contextRecordsFromEspnRoster(roster:any,team:ContextTeamSeed,url:string,retrieved:number,rawPayloadHash:string){
  const at=new Date(retrieved).toISOString(),rows:NewCollegeContextRecord[]=[],groups=Array.isArray(roster?.athletes)?roster.athletes:[],players=groups.flatMap((g:any)=>g.items??[]);
  const matched=Number(roster?.season?.year)===nflSeason(team.commenceTime)&&String(roster?.team?.id)===team.teamId;
  recordIf(rows,team,'roster','roster.providerChecked',matched?'MATCHED':'MISMATCHED',url,rawPayloadHash,at);
  if(!matched){status(rows,team,'roster','TEAM_MATCH_FAILED',url,rawPayloadHash,at);return rows;}
  recordIf(rows,team,'roster','roster.currentSeasonAvailable',true,url,rawPayloadHash,at);recordIf(rows,team,'roster','roster.playerCount',players.length,url,rawPayloadHash,at);
  const qbs=players.filter((p:any)=>String(p?.position?.abbreviation).toUpperCase()==='QB').map((p:any)=>({id:String(p.id),name:p.displayName??p.fullName,status:p.status?.name??'UNKNOWN'}));
  if(qbs.length)recordIf(rows,team,'roster','roster.qbCandidates',qbs,url,rawPayloadHash,at);
  status(rows,team,'roster',players.length?'AVAILABLE':'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at);
  return rows;
}
function teamForProvider(name:any,teams:ContextTeamSeed[]){
  const text=String(name??'');if(!text)return undefined;
  const key=canonicalCollegeName(text),exact=teams.filter(t=>[t.teamName,...(t.aliases??[])].some(alias=>canonicalCollegeName(alias)===key));if(exact.length===1)return exact[0];
  const matches=teams.filter(t=>resolveCollegeTeam(text,[{id:t.teamId,displayName:t.teamName,shortDisplayName:t.aliases?.[0],location:t.aliases?.[1]}]).resolved);return matches.length===1?matches[0]:undefined;
}
function pct(value:any){return finite(value)&&value>=0&&value<=1?value:undefined;}
function positionCounts(rows:any[]){const counts:Record<string,number>={};for(const row of rows){const key=String(row.position??'UNKNOWN');counts[key]=(counts[key]??0)+1;}return counts;}
export function contextRecordsFromCfbd(payloads:{returning:any;portal:any;talent:any;coaches:any;fcsRatings:any;records:any},teams:ContextTeamSeed[],urls:Record<string,string>,retrieved:number,hashes:Record<string,string>){
  const at=new Date(retrieved).toISOString(),rows:NewCollegeContextRecord[]=[];
  for(const team of teams)recordIf(rows,team,'talent','talent.providerChecked',true,urls.talent,hashes.talent,at);
  for(const item of Array.isArray(payloads.returning)?payloads.returning:[]){const team=teamForProvider(item.team,teams);if(!team)continue;
    // CFBD's aggregate field is offensive player PPA, not total offense plus
    // defense. Preserve that distinction and leave overall/defense missing.
    recordIf(rows,team,'returning_production','returning.offensePct',pct(item.percentPPA),urls.returning,hashes.returning,at);
    recordIf(rows,team,'returning_production','returning.defensePct',pct(item.percentDefensePPA),urls.returning,hashes.returning,at);
    recordIf(rows,team,'returning_production','returning.passingPct',pct(item.percentPassingPPA??item.passingUsage),urls.returning,hashes.returning,at);
    recordIf(rows,team,'returning_production','returning.receivingPct',pct(item.percentReceivingPPA??item.receivingUsage),urls.returning,hashes.returning,at);
    recordIf(rows,team,'returning_production','returning.rushingPct',pct(item.percentRushingPPA??item.rushingUsage),urls.returning,hashes.returning,at);
  }
  const portal=(Array.isArray(payloads.portal)?payloads.portal:[]).filter((item:any)=>String(item.eligibility??'').toLowerCase()!=='withdrawn');
  for(const team of teams){const add=portal.filter((p:any)=>teamForProvider(p.destination,teams)?.teamId===team.teamId),depart=portal.filter((p:any)=>teamForProvider(p.origin,teams)?.teamId===team.teamId);
    if(add.length||depart.length){recordIf(rows,team,'transfers','transfers.additions',add.length,urls.portal,hashes.portal,at);recordIf(rows,team,'transfers','transfers.departures',depart.length,urls.portal,hashes.portal,at);
      const ratings=(list:any[])=>list.map(x=>x.rating).filter(finite);recordIf(rows,team,'transfers','transfers.quality',{additionRatings:ratings(add),departureRatings:ratings(depart),note:'Quality stored separately; no point value.'},urls.portal,hashes.portal,at);
      recordIf(rows,team,'transfers','transfers.positionCounts',{additions:positionCounts(add),departures:positionCounts(depart)},urls.portal,hashes.portal,at);
      const qbAdditions=add.filter((item:any)=>String(item.position??'').toUpperCase()==='QB').map((item:any)=>({name:String(item.name??[item.firstName,item.lastName].filter(Boolean).join(' ')).trim(),previousSchool:String(item.origin??'').trim()})).filter((item:any)=>item.name);
      if(qbAdditions.length)recordIf(rows,team,'transfers','transfers.qbAdditions',qbAdditions,urls.portal,hashes.portal,at);}
  }
  for(const item of Array.isArray(payloads.talent)?payloads.talent:[]){const team=teamForProvider(item.school??item.team,teams);if(!team)continue;
    recordIf(rows,team,'talent','talent.rosterComposite',finite(item.talent)?item.talent:undefined,urls.talent,hashes.talent,at);recordIf(rows,team,'talent','talent.classification',team.division,urls.talent,hashes.talent,at);
  }
  for(const coach of Array.isArray(payloads.coaches)?payloads.coaches:[]){const seasons=Array.isArray(coach.seasons)?coach.seasons:[],current=seasons.find((s:any)=>Number(s.year)===nflSeason(teams[0].commenceTime)),team=teamForProvider(current?.school??current?.team,teams);if(!team)continue;
    const name=[coach.firstName,coach.lastName].filter(Boolean).join(' ').trim();recordIf(rows,team,'coaching','coaching.headCoach',name||undefined,urls.coaches,hashes.coaches,at);
    recordIf(rows,team,'coaching','coaching.newHeadCoach',!seasons.some((s:any)=>Number(s.year)===nflSeason(team.commenceTime)-1&&canonicalCollegeName(s.school??s.team)===canonicalCollegeName(current.school??current.team)),urls.coaches,hashes.coaches,at);
    const years=seasons.filter((s:any)=>canonicalCollegeName(s.school??s.team)===canonicalCollegeName(current.school??current.team)&&Number(s.year)<=nflSeason(team.commenceTime)).map((s:any)=>Number(s.year));
    if(years.length)recordIf(rows,team,'coaching','coaching.headCoachYear',nflSeason(team.commenceTime)-Math.min(...years)+1,urls.coaches,hashes.coaches,at);
  }
  for(const item of Array.isArray(payloads.fcsRatings)?payloads.fcsRatings:[]){const team=teamForProvider(item.team,teams);if(!team||team.division!=='FCS')continue;
    recordIf(rows,team,'fcs','fcs.previousSrsRating',finite(item.rating)?item.rating:undefined,urls.fcsRatings,hashes.fcsRatings,at);recordIf(rows,team,'fcs','fcs.previousSrsRank',finite(item.ranking)?item.ranking:undefined,urls.fcsRatings,hashes.fcsRatings,at);
    const tier=finite(item.ranking)&&item.ranking<=5?'ELITE_FCS':finite(item.ranking)&&item.ranking<=25?'STRONG_FCS':'UNKNOWN_FCS';recordIf(rows,team,'fcs','fcs.tier',tier,urls.fcsRatings,hashes.fcsRatings,at);
  }
  for(const item of Array.isArray(payloads.records)?payloads.records:[]){const team=teamForProvider(item.team,teams);if(!team||team.division!=='FCS')continue;
    const total=(item.total??item.records??[]),record=Array.isArray(total)?total.find((r:any)=>r.type==='total'):total;recordIf(rows,team,'fcs','fcs.previousRecord',record??item,urls.records,hashes.records,at);
  }
  const sourceByDomain:{domain:ContextDomain;url:string;hash:string}[]=[
    {domain:'returning_production',url:urls.returning,hash:hashes.returning},{domain:'transfers',url:urls.portal,hash:hashes.portal},
    {domain:'talent',url:urls.talent,hash:hashes.talent},{domain:'coaching',url:urls.coaches,hash:hashes.coaches},
    {domain:'fcs',url:urls.fcsRatings,hash:hashes.fcsRatings},
  ];
  for(const team of teams)for(const item of sourceByDomain){if(item.domain==='fcs'&&team.division!=='FCS')continue;
    const available=rows.some(row=>row.teamId===team.teamId&&row.domain===item.domain&&!row.field.endsWith('providerChecked')&&!row.field.endsWith('ingestionStatus'));
    status(rows,team,item.domain,available?'AVAILABLE':'SOURCE_RETURNED_EMPTY',item.url,item.hash,at);
  }
  return rows;
}
function recently(records:CollegeContextRecord[],teamId:string,field:string,now:number,ttl:number){return records.some(r=>r.teamId===teamId&&r.field===field&&now-Date.parse(r.source.retrievedAt)<ttl);}
function failureHash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export class CollegeContextIngestion {
  constructor(private root:string,private get=fetchNflJson,private now=()=>Date.now(),private apiKey=process.env.CFBD_API_KEY){}
  async refresh(teams:ContextTeamSeed[]){
    const unique=[...new Map(teams.map(t=>[`${t.eventId}:${t.teamId}`,t])).values()],warnings:string[]=[],records=loadCollegeContextRecords(this.root),incoming:NewCollegeContextRecord[]=[];
    const byEvent=new Map<string,ContextTeamSeed[]>();for(const team of unique)byEvent.set(team.eventId,[...(byEvent.get(team.eventId)??[]),team]);
    await Promise.all([...byEvent.entries()].map(async([eventId,eventTeams])=>{
      if(eventTeams.every(t=>recently(records,t.teamId,'weather.providerChecked',this.now(),15*60_000)
        &&recently(records,t.teamId,'current.ingestionStatus',this.now(),15*60_000)&&recently(records,t.teamId,'market.ingestionStatus',this.now(),15*60_000)))return;
      const url=`${ESPN_COLLEGE}/summary?event=${eventId}`;try{const payload=await this.get(url),hash=archiveCollegeContextPayload(this.root,payload);
        incoming.push(...contextRecordsFromEspnSummary(payload,eventTeams,url,this.now(),hash));}catch{const at=new Date(this.now()).toISOString(),hash=failureHash({url,at,status:'DATA_PROVIDER_UNAVAILABLE'});
        for(const team of eventTeams)for(const domain of ['qb','current_season','injuries','weather','market'] as ContextDomain[])status(incoming,team,domain,'DATA_PROVIDER_UNAVAILABLE',url,hash,at);
        warnings.push(`ESPN context unavailable for event ${eventId}; missing fields retained.`);}
    }));
    await Promise.all([...new Map(unique.map(t=>[t.teamId,t])).values()].map(async team=>{
      if(recently(records,team.teamId,'roster.providerChecked',this.now(),DAY))return;
      const url=`${ESPN_COLLEGE}/teams/${team.teamId}/roster`;try{const payload=await this.get(url),hash=archiveCollegeContextPayload(this.root,payload);
        incoming.push(...contextRecordsFromEspnRoster(payload,team,url,this.now(),hash));}catch{const at=new Date(this.now()).toISOString(),hash=failureHash({url,at,status:'DATA_PROVIDER_UNAVAILABLE'});
        status(incoming,team,'roster','DATA_PROVIDER_UNAVAILABLE',url,hash,at);warnings.push(`${team.teamName}: current roster unavailable; no roster assumption made.`);}
    }));
    if(this.apiKey){try{incoming.push(...await this.cfbd(unique,records));}catch{const at=new Date(this.now()).toISOString();for(const team of unique)for(const domain of ['returning_production','transfers','talent','coaching'] as ContextDomain[]){
        const url=`${CFBD}/`;status(incoming,team,domain,'DATA_PROVIDER_UNAVAILABLE',url,failureHash({url,at,domain,status:'DATA_PROVIDER_UNAVAILABLE'}),at);}
      warnings.push('CollegeFootballData context refresh failed; cached evidence retained and missing fields remain unknown.');}}
    else{const at=new Date(this.now()).toISOString();for(const team of unique)for(const domain of ['returning_production','transfers','talent','coaching'] as ContextDomain[]){
        if(recently(records,team.teamId,STATUS_FIELD[domain],this.now(),DAY))continue;
        const url=`${CFBD}/`;status(incoming,team,domain,'DATA_PROVIDER_UNAVAILABLE',url,failureHash({url,at,domain,status:'DATA_PROVIDER_UNAVAILABLE'}),at);}
      warnings.push('CollegeFootballData key is not configured; returning production, transfers, talent and coaching remain unavailable unless verified imports exist.');}
    const saved=incoming.length?appendCollegeContextRecords(this.root,incoming):{added:0,total:records.length};return{...saved,warnings,records:loadCollegeContextRecords(this.root)};
  }
  private async cfbd(teams:ContextTeamSeed[],records:CollegeContextRecord[]){
    if(teams.every(t=>recently(records,t.teamId,'talent.providerChecked',this.now(),DAY)))return[];
    const season=nflSeason(teams[0].commenceTime),urls={returning:`${CFBD}/player/returning?year=${season}`,portal:`${CFBD}/player/portal?year=${season}`,talent:`${CFBD}/talent?year=${season}`,
      coaches:`${CFBD}/coaches?minYear=${season-1}&maxYear=${season}`,fcsRatings:`${CFBD}/ratings/srs/expanded?year=${season-1}&classification=fcs`,records:`${CFBD}/records?year=${season-1}`};
    const fetchOne=async(url:string)=>{const response=await fetch(url,{headers:{Authorization:`Bearer ${this.apiKey}`},signal:AbortSignal.timeout(20_000)});if(!response.ok)throw Error(`CFBD ${response.status}`);return response.json();};
    const [returning,portal,talent,coaches,fcsRatings,teamRecords]=await Promise.all([fetchOne(urls.returning),fetchOne(urls.portal),fetchOne(urls.talent),fetchOne(urls.coaches),fetchOne(urls.fcsRatings),fetchOne(urls.records)]),
      payloads={returning,portal,talent,coaches,fcsRatings,records:teamRecords};
    const hashes=Object.fromEntries(Object.entries(payloads).map(([key,value])=>[key,archiveCollegeContextPayload(this.root,value)]));
    return contextRecordsFromCfbd(payloads,teams,urls,this.now(),hashes);
  }
}
