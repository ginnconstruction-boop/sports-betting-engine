import {fetchNflJson,nflSeason} from './nflResearch';
import {createHash} from 'crypto';
import {canonicalCollegeName,resolveCollegeTeam} from './collegeEntities';
import {ESPN_COLLEGE} from './collegeResearch';
import {appendCollegeContextRecords,archiveCollegeContextPayload,CollegeContextRecord,ContextDomain,ContextIngestionReason,ContextReliability,hashCollegeContextPayload,
  loadCollegeContextRecords,materializeCollegeContextRecords,NewCollegeContextRecord,validateContextRecord,VerificationStatus} from './collegeContextEvidence';
import {CollegeContextCategory,CollegeContextSourceRegistry,safeContextFailure} from './collegeContextSources';

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
      if(!finite(raw))fieldMissing(rows,team,'weather',field,'SOURCE_FIELD_UNAVAILABLE',url,rawPayloadHash,at,end);
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
    status(rows,team,'qb',expected?'SUCCESS':'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at,end);
    status(rows,team,'current_season',games.length?'PARTIAL_SUCCESS':'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at,end);
    const groups=injuryGroups(summary).filter((g:any)=>String(g?.team?.id??g?.teamId)===team.teamId),listed=groups.flatMap((g:any)=>g.injuries??g.items??[]);
    if(groups.length)recordIf(rows,team,'injuries','injuries.teamStatus',{providerListed:listed.length,scope:'ESPN game-summary listings only'},url,rawPayloadHash,at,'REPORTED',end);
    for(const item of listed){const athlete=item.athlete??item,player=athlete.displayName??athlete.fullName,status=String(item.status??item.type?.name??'UNKNOWN').toUpperCase();
      if(!player)continue;const normalized=['OUT','DOUBTFUL','QUESTIONABLE','PROBABLE','AVAILABLE'].includes(status)?status:'UNKNOWN';
      const playerId=String(athlete.id??player),statusRow=base(team,'injuries','injury.status',normalized,url,rawPayloadHash,at,'REPORTED',end);statusRow.playerId=playerId;rows.push(statusRow);
      const nameRow=base(team,'injuries','injury.playerName',player,url,rawPayloadHash,at,'REPORTED',end);nameRow.playerId=playerId;rows.push(nameRow);
      const position=athlete.position?.abbreviation??item.position;if(position){const positionRow=base(team,'injuries','injury.position',position,url,rawPayloadHash,at,'REPORTED',end);positionRow.playerId=playerId;rows.push(positionRow);}
    }
    status(rows,team,'injuries',groups.length?'SUCCESS':'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at,end);
    status(rows,team,'weather',Object.keys(weather).length?'PARTIAL_SUCCESS':'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at,end);
    const pick=(Array.isArray(summary.pickcenter)?summary.pickcenter:[]).find((item:any)=>item?.pointSpread?.home),opening=parseLine(pick?.pointSpread?.home?.open?.line),current=parseLine(pick?.pointSpread?.home?.close?.line);
    if(finite(opening)&&finite(current)){recordIf(rows,team,'market','market.provider',pick?.provider?.name??'UNKNOWN',url,rawPayloadHash,at,'REPORTED',end);
      recordIf(rows,team,'market','market.openingHomeSpread',opening,url,rawPayloadHash,at,'REPORTED',end);recordIf(rows,team,'market','market.currentHomeSpread',current,url,rawPayloadHash,at,'REPORTED',end);
      recordIf(rows,team,'market','market.movementPoints',Number((current-opening).toFixed(2)),url,rawPayloadHash,at,'REPORTED',end);recordIf(rows,team,'market','market.movementDirection',current===opening?'NONE':current>opening?'TOWARD_AWAY':'TOWARD_HOME',url,rawPayloadHash,at,'REPORTED',end);}
    status(rows,team,'market',finite(opening)&&finite(current)?'AVAILABLE':'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at,end);
  }
  return rows;
}
export function contextRecordsFromEspnRoster(roster:any,team:ContextTeamSeed,url:string,retrieved:number,rawPayloadHash:string){
  const at=new Date(retrieved).toISOString(),rows:NewCollegeContextRecord[]=[];
  if(!roster||typeof roster!=='object'||Array.isArray(roster)){status(rows,team,'roster','PARSER_FAILED',url,rawPayloadHash,at);status(rows,team,'coaching','PARSER_FAILED',url,rawPayloadHash,at);return rows;}
  const groups=Array.isArray(roster?.athletes)?roster.athletes:[],players=groups.flatMap((g:any)=>g.items??[]);
  const matched=Number(roster?.season?.year)===nflSeason(team.commenceTime)&&String(roster?.team?.id)===team.teamId;
  recordIf(rows,team,'roster','roster.providerChecked',matched?'MATCHED':'MISMATCHED',url,rawPayloadHash,at);
  if(!matched){status(rows,team,'roster','TEAM_MATCH_FAILED',url,rawPayloadHash,at);return rows;}
  recordIf(rows,team,'roster','roster.currentSeasonAvailable',true,url,rawPayloadHash,at);recordIf(rows,team,'roster','roster.playerCount',players.length,url,rawPayloadHash,at);
  const qbs=players.filter((p:any)=>String(p?.position?.abbreviation).toUpperCase()==='QB').map((p:any)=>({id:String(p.id),name:p.displayName??p.fullName,status:p.status?.name??'UNKNOWN'}));
  if(qbs.length)recordIf(rows,team,'roster','roster.qbCandidates',qbs,url,rawPayloadHash,at);
  status(rows,team,'roster',players.length?'SUCCESS':'SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at);
  const coaches=Array.isArray(roster?.coach)?roster.coach:[],head=coaches[0],headCoach=[head?.firstName,head?.lastName].filter(Boolean).join(' ').trim();
  if(headCoach){recordIf(rows,team,'coaching','coaching.headCoach',headCoach,url,rawPayloadHash,at);status(rows,team,'coaching','PARTIAL_SUCCESS',url,rawPayloadHash,at);
    for(const field of ['coaching.newHeadCoach','coaching.offensiveCoordinator','coaching.newOc','coaching.defensiveCoordinator','coaching.newDc','coaching.playCallerContinuity'])
      fieldMissing(rows,team,'coaching',field,'SOURCE_FIELD_UNAVAILABLE',url,rawPayloadHash,at);}
  else status(rows,team,'coaching','SOURCE_RETURNED_EMPTY',url,rawPayloadHash,at);
  return rows;
}
export function contextRecordsFromInternalClassification(team:ContextTeamSeed,retrieved:number){
  const at=new Date(retrieved).toISOString(),url=`${ESPN_COLLEGE}/scoreboard`,hash=failureHash({teamId:team.teamId,season:nflSeason(team.commenceTime),division:team.division,at}),rows:NewCollegeContextRecord[]=[];
  if(team.division==='UNKNOWN'){status(rows,team,'talent','VALIDATION_FAILED',url,hash,at);return rows;}
  recordIf(rows,team,'talent','talent.classification',team.division,url,hash,at,'CORROBORATED');status(rows,team,'talent','PARTIAL_SUCCESS',url,hash,at);
  for(const field of ['talent.rosterComposite','talent.depthTier'])fieldMissing(rows,team,'talent',field,'NO_PROVIDER_CONFIGURED',url,hash,at);
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
function recentRecord(records:CollegeContextRecord[],teamId:string,field:string,now:number,ttl:number,eventId?:string|null){return records.filter(r=>r.teamId===teamId&&r.field===field
  &&(eventId===undefined||r.eventId===eventId)&&now-Date.parse(r.source.retrievedAt)<ttl).sort((a,b)=>Date.parse(b.source.retrievedAt)-Date.parse(a.source.retrievedAt))[0];}
function recently(records:CollegeContextRecord[],teamId:string,field:string,now:number,ttl:number,eventId?:string|null,value?:unknown){const row=recentRecord(records,teamId,field,now,ttl,eventId);return!!row&&(arguments.length<7||row.value===value);}
function failureHash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function providerFailure(error:unknown):ContextIngestionReason{
  const message=safeContextFailure(error);if(/HTTP\s+(401|403)\b|unauthori[sz]ed|forbidden/i.test(message))return'SOURCE_AUTH_FAILED';
  if(/HTTP\s+429\b|rate.?limit|too many requests/i.test(message))return'SOURCE_RATE_LIMITED';
  return'SOURCE_HTTP_ERROR';
}
async function mapLimit<T>(values:T[],limit:number,work:(value:T)=>Promise<void>){
  let next=0;await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{while(next<values.length){const index=next++;await work(values[index]);}}));
}
type SourceOutcome={result:ContextIngestionReason;reason?:string};
function aggregateOutcomes(rows:SourceOutcome[]):SourceOutcome{
  if(!rows.length)return{result:'NO_SOURCE_ATTEMPTED'};const successful=rows.filter(row=>['SUCCESS','PARTIAL_SUCCESS'].includes(row.result));
  if(successful.length===rows.length)return{result:rows.some(row=>row.result==='PARTIAL_SUCCESS')?'PARTIAL_SUCCESS':'SUCCESS',reason:rows.find(row=>row.reason)?.reason};
  if(successful.length)return{result:'PARTIAL_SUCCESS',reason:`${successful.length}/${rows.length} source targets succeeded; ${rows.length-successful.length} failed.`};
  const order:ContextIngestionReason[]=['SOURCE_AUTH_FAILED','SOURCE_RATE_LIMITED','SOURCE_HTTP_ERROR','PARSER_FAILED','TEAM_MATCH_FAILED','VALIDATION_FAILED','SOURCE_RETURNED_EMPTY'];
  const result=order.find(value=>rows.some(row=>row.result===value))??rows[0].result;return{result,reason:rows.find(row=>row.result===result)?.reason};
}
export class CollegeContextIngestion {
  constructor(private root:string,private get=fetchNflJson,private now=()=>Date.now(),private apiKey=process.env.CFBD_API_KEY,
    private wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),private append=appendCollegeContextRecords){}
  private async request(url:string){
    let last:unknown;for(let attempt=0;attempt<2;attempt++)try{return{payload:await this.get(url),result:'SUCCESS' as ContextIngestionReason};}
    catch(error){last=error;const result=providerFailure(error);if(attempt||result==='SOURCE_AUTH_FAILED')return{payload:null,result,reason:safeContextFailure(error)};await this.wait(250);}
    return{payload:null,result:providerFailure(last),reason:safeContextFailure(last)};
  }
  async refresh(teams:ContextTeamSeed[]){
    const unique=[...new Map(teams.map(t=>[`${t.eventId}:${t.teamId}`,t])).values()],warnings:string[]=[],incoming:NewCollegeContextRecord[]=[],registry=new CollegeContextSourceRegistry(this.root,Boolean(this.apiKey),this.now);
    let records:CollegeContextRecord[]=[];let loadStatus:'SUCCESS'|'LOAD_FAILED'='SUCCESS',loadFailure:string|null=null;
    try{records=loadCollegeContextRecords(this.root);}catch(error){loadStatus='LOAD_FAILED';loadFailure=safeContextFailure(error);warnings.push(`College context evidence LOAD_FAILED: ${loadFailure}. Sources will still run; corrupt evidence will not be overwritten.`);}
    if(registry.loadFailure)warnings.push(`College context source registry LOAD_FAILED: ${registry.loadFailure}. Source collection will continue; the corrupt registry will not be overwritten.`);
    const outcomes=new Map<string,SourceOutcome[]>(),note=(prefix:string,category:CollegeContextCategory,result:ContextIngestionReason,reason?:string)=>{
      const id=`${prefix}:${category}`;outcomes.set(id,[...(outcomes.get(id)??[]),{result,reason}]);};
    const cachedResult=(value:unknown):ContextIngestionReason=>value==='AVAILABLE'?'SUCCESS':typeof value==='string'?value as ContextIngestionReason:'SOURCE_RETURNED_EMPTY';
    const byEvent=new Map<string,ContextTeamSeed[]>();for(const team of unique)byEvent.set(team.eventId,[...(byEvent.get(team.eventId)??[]),team]);
    await mapLimit([...byEvent.entries()],8,async([eventId,eventTeams])=>{
      if(eventTeams.every(t=>recently(records,t.teamId,'weather.providerChecked',this.now(),15*60_000,eventId,true)
        &&recently(records,t.teamId,'current.ingestionStatus',this.now(),15*60_000,eventId)&&recently(records,t.teamId,'market.ingestionStatus',this.now(),15*60_000,eventId))){
        for(const [category,domain]of [['QB','qb'],['CURRENT_SEASON','current_season'],['INJURIES','injuries'],['WEATHER','weather']] as [CollegeContextCategory,ContextDomain][]){
          const states=eventTeams.map(team=>cachedResult(recentRecord(records,team.teamId,STATUS_FIELD[domain],this.now(),15*60_000,eventId)?.value)),outcome=aggregateOutcomes(states.map(result=>({result})));
          note('espn-game-summary',category,outcome.result,'Fresh cached source evidence reused.');}return;}
      const url=`${ESPN_COLLEGE}/summary?event=${eventId}`,at=new Date(this.now()).toISOString(),fetched=await this.request(url);
      if(fetched.result==='SUCCESS'){let hash=hashCollegeContextPayload(fetched.payload);try{archiveCollegeContextPayload(this.root,fetched.payload);}catch(error){warnings.push(`Raw ESPN context archive STORE_FAILED for event ${eventId}: ${safeContextFailure(error)}.`);}
        try{const parsed=contextRecordsFromEspnSummary(fetched.payload,eventTeams,url,this.now(),hash);incoming.push(...parsed);
          for(const [category,domain]of [['QB','qb'],['CURRENT_SEASON','current_season'],['INJURIES','injuries'],['WEATHER','weather']] as [CollegeContextCategory,ContextDomain][]){
            const states=parsed.filter(row=>row.domain===domain&&row.field===STATUS_FIELD[domain]).map(row=>String(row.value) as ContextIngestionReason);
            note('espn-game-summary',category,states.every(value=>value==='SUCCESS')?'SUCCESS':states.some(value=>['SUCCESS','PARTIAL_SUCCESS'].includes(value))?'PARTIAL_SUCCESS':states[0]??'SOURCE_RETURNED_EMPTY');}
        }catch(error){const reason=safeContextFailure(error);for(const team of eventTeams)for(const domain of ['qb','current_season','injuries','weather','market'] as ContextDomain[])status(incoming,team,domain,'PARSER_FAILED',url,hash,at);
          for(const category of ['QB','CURRENT_SEASON','INJURIES','WEATHER'] as CollegeContextCategory[])note('espn-game-summary',category,'PARSER_FAILED',reason);warnings.push(`ESPN context PARSER_FAILED for event ${eventId}: ${reason}.`);}}
      else{const hash=failureHash({url,at,status:fetched.result});for(const team of eventTeams)for(const domain of ['qb','current_season','injuries','weather','market'] as ContextDomain[])status(incoming,team,domain,fetched.result,url,hash,at);
        for(const category of ['QB','CURRENT_SEASON','INJURIES','WEATHER'] as CollegeContextCategory[])note('espn-game-summary',category,fetched.result,fetched.reason);warnings.push(`ESPN context ${fetched.result} for event ${eventId}: ${fetched.reason}.`);}
    });
    await mapLimit([...new Map(unique.map(t=>[t.teamId,t])).values()],8,async team=>{
      if(recently(records,team.teamId,'roster.providerChecked',this.now(),7*DAY,null,'MATCHED')){
        note('espn-roster','ROSTER',cachedResult(recentRecord(records,team.teamId,'roster.ingestionStatus',this.now(),7*DAY,null)?.value),'Fresh cached source evidence reused.');
        note('espn-roster','COACHING',cachedResult(recentRecord(records,team.teamId,'coaching.ingestionStatus',this.now(),7*DAY,null)?.value),'Fresh cached head-coach evidence reused.');return;}
      const url=`${ESPN_COLLEGE}/teams/${team.teamId}/roster`,at=new Date(this.now()).toISOString(),fetched=await this.request(url);
      if(fetched.result==='SUCCESS'){const hash=hashCollegeContextPayload(fetched.payload);try{archiveCollegeContextPayload(this.root,fetched.payload);}catch(error){warnings.push(`${team.teamName}: raw roster archive STORE_FAILED: ${safeContextFailure(error)}.`);}
        try{const parsed=contextRecordsFromEspnRoster(fetched.payload,team,url,this.now(),hash);incoming.push(...parsed);const rosterState=parsed.find(row=>row.field==='roster.ingestionStatus')?.value as ContextIngestionReason??'SOURCE_RETURNED_EMPTY';
          const coachingState=parsed.find(row=>row.field==='coaching.ingestionStatus')?.value as ContextIngestionReason??'SOURCE_RETURNED_EMPTY';note('espn-roster','ROSTER',rosterState);note('espn-roster','COACHING',coachingState);}
        catch(error){const reason=safeContextFailure(error);status(incoming,team,'roster','PARSER_FAILED',url,hash,at);status(incoming,team,'coaching','PARSER_FAILED',url,hash,at);note('espn-roster','ROSTER','PARSER_FAILED',reason);note('espn-roster','COACHING','PARSER_FAILED',reason);}}
      else{const hash=failureHash({url,at,status:fetched.result});status(incoming,team,'roster',fetched.result,url,hash,at);status(incoming,team,'coaching',fetched.result,url,hash,at);
        note('espn-roster','ROSTER',fetched.result,fetched.reason);note('espn-roster','COACHING',fetched.result,fetched.reason);warnings.push(`${team.teamName}: ESPN roster ${fetched.result}: ${fetched.reason}.`);}
    });
    for(const team of unique){const parsed=contextRecordsFromInternalClassification(team,this.now());incoming.push(...parsed);note('verified-schedule','CLASSIFICATION',team.division==='UNKNOWN'?'VALIDATION_FAILED':'SUCCESS');}
    if(this.apiKey){const cfbd=await this.cfbd(unique,records);incoming.push(...cfbd.rows);for(const [category,result]of Object.entries(cfbd.outcomes) as [CollegeContextCategory,SourceOutcome][])note('cfbd',category,result.result,result.reason);warnings.push(...cfbd.warnings);}
    else{const at=new Date(this.now()).toISOString();for(const team of unique)for(const domain of ['returning_production','transfers','talent','coaching'] as ContextDomain[]){
      if(recently(records,team.teamId,STATUS_FIELD[domain],this.now(),DAY))continue;
        const url=`${CFBD}/`;status(incoming,team,domain,'NO_PROVIDER_CONFIGURED',url,failureHash({url,at,domain,status:'NO_PROVIDER_CONFIGURED'}),at);}
      warnings.push('CollegeFootballData key is not configured; returning production, transfers, talent and coaching remain unavailable unless verified imports exist.');}
    for(const [id,rows]of outcomes){const split=id.indexOf(':'),prefix=id.slice(0,split),category=id.slice(split+1) as CollegeContextCategory,result=aggregateOutcomes(rows);registry.markCategory(prefix,category,result.result,result.reason);}
    const valid:NewCollegeContextRecord[]=[];let rejected=0;for(const row of incoming)try{validateContextRecord(row);valid.push(row);}catch(error){rejected++;warnings.push(`Context record VALIDATION_FAILED for team ${row.teamId}, field ${row.field}: ${safeContextFailure(error)}.`);}
    let storeStatus:'SUCCESS'|'PARTIAL_SUCCESS'|'STORE_FAILED'|'LOAD_FAILED'=loadStatus==='LOAD_FAILED'?'LOAD_FAILED':'SUCCESS',added=0,total=records.length,persisted=records;
    if(valid.length&&loadStatus==='SUCCESS')try{const saved=this.append(this.root,valid);added=saved.added;total=saved.total;persisted=loadCollegeContextRecords(this.root);if(rejected)storeStatus='PARTIAL_SUCCESS';}
    catch(error){storeStatus='STORE_FAILED';warnings.push(`College context evidence STORE_FAILED after successful retrieval: ${safeContextFailure(error)}. Retrieved records remain available to this scan but were not claimed as durable.`);}
    const inMemory=materializeCollegeContextRecords(valid),combined=[...new Map([...persisted,...inMemory].map(row=>[row.id,row])).values()];
    const registryStore=registry.save();if(registryStore.status!=='SUCCESS')warnings.push(`College context source registry ${registryStore.status}: ${registryStore.error}.`);
    return{added,total:Math.max(total,combined.length),warnings,records:combined,sourceRegistry:registry.snapshot(),storage:{loadStatus,loadFailure,storeStatus,rejected,registryStore}};
  }
  private async cfbd(teams:ContextTeamSeed[],records:CollegeContextRecord[]){
    if(teams.every(t=>recently(records,t.teamId,'talent.providerChecked',this.now(),DAY)))return{rows:[] as NewCollegeContextRecord[],warnings:[] as string[],outcomes:{
      TRANSFERS:{result:'SUCCESS',reason:'Fresh cached evidence reused.'},RETURNING_PRODUCTION:{result:'SUCCESS',reason:'Fresh cached evidence reused.'},
      TALENT_DEPTH:{result:'PARTIAL_SUCCESS',reason:'Fresh cached evidence reused.'},COACHING:{result:'PARTIAL_SUCCESS',reason:'Fresh cached evidence reused.'}} as Record<string,SourceOutcome>};
    const season=nflSeason(teams[0].commenceTime),urls={returning:`${CFBD}/player/returning?year=${season}`,portal:`${CFBD}/player/portal?year=${season}`,talent:`${CFBD}/talent?year=${season}`,
      coaches:`${CFBD}/coaches?minYear=${season-1}&maxYear=${season}`,fcsRatings:`${CFBD}/ratings/srs/expanded?year=${season-1}&classification=fcs`,records:`${CFBD}/records?year=${season-1}`};
    const fetchOne=async(url:string)=>{let last:unknown;for(let attempt=0;attempt<2;attempt++)try{const response=await fetch(url,{headers:{Authorization:`Bearer ${this.apiKey}`},signal:AbortSignal.timeout(12_000)});
        if(!response.ok)throw Error(`CFBD HTTP ${response.status}`);return{payload:await response.json(),result:'SUCCESS' as ContextIngestionReason};}
      catch(error){last=error;const result=providerFailure(error);if(attempt||result==='SOURCE_AUTH_FAILED')return{payload:null,result,reason:safeContextFailure(error)};await this.wait(500);}return{payload:null,result:providerFailure(last),reason:safeContextFailure(last)};};
    const names=Object.keys(urls) as (keyof typeof urls)[],results=await Promise.all(names.map(async name=>[name,await fetchOne(urls[name])] as const)),byName=Object.fromEntries(results) as Record<keyof typeof urls,{payload:any;result:ContextIngestionReason;reason?:string}>;
    const payloads={returning:byName.returning.payload??[],portal:byName.portal.payload??[],talent:byName.talent.payload??[],coaches:byName.coaches.payload??[],fcsRatings:byName.fcsRatings.payload??[],records:byName.records.payload??[]};
    const hashes=Object.fromEntries(Object.entries(payloads).map(([key,value])=>{const hash=hashCollegeContextPayload(value);try{archiveCollegeContextPayload(this.root,value);}catch{}return[key,hash];}));
    let rows=contextRecordsFromCfbd(payloads,teams,urls,this.now(),hashes),warnings:string[]=[];
    const domains:{key:keyof typeof urls;domain:ContextDomain;category:CollegeContextCategory}[]=[{key:'returning',domain:'returning_production',category:'RETURNING_PRODUCTION'},
      {key:'portal',domain:'transfers',category:'TRANSFERS'},{key:'talent',domain:'talent',category:'TALENT_DEPTH'},{key:'coaches',domain:'coaching',category:'COACHING'}];
    const outcomes={} as Record<string,SourceOutcome>;
    for(const item of domains){const fetched=byName[item.key];if(fetched.result!=='SUCCESS'){rows=rows.filter(row=>!(row.domain===item.domain&&row.field===STATUS_FIELD[item.domain]));const at=new Date(this.now()).toISOString();
        for(const team of teams)status(rows,team,item.domain,fetched.result,urls[item.key],failureHash({url:urls[item.key],at,status:fetched.result}),at);outcomes[item.category]={result:fetched.result,reason:fetched.reason};warnings.push(`CollegeFootballData ${item.category} ${fetched.result}: ${fetched.reason}.`);}
      else{const has=rows.some(row=>row.domain===item.domain&&!row.field.endsWith('ingestionStatus')&&!row.field.endsWith('providerChecked')&&!row.field.endsWith('.diagnostic'));
        outcomes[item.category]={result:has?(item.category==='TRANSFERS'?'SUCCESS':'PARTIAL_SUCCESS'):'SOURCE_RETURNED_EMPTY'};}}
    return{rows,warnings,outcomes};
  }
}
