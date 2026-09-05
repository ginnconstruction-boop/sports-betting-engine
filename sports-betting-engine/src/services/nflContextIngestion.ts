import * as fs from 'fs';
import * as path from 'path';
import {randomUUID} from 'crypto';
import type {UpcomingEvent} from '../api/oddsApiClient';
import {NflEvidenceArchive} from './nflEvidence';
import {ESPN_NFL,fetchNflJson,nflName,nflSeason,NflResearch} from './nflResearch';
import {NflContextResult,NflContextSourceRegistry,safeNflContextFailure} from './nflContextSources';
import {OfficialNflInjuryReport,OfficialNflInjuryReports} from './nflOfficialReports';
import {NflTeamResearchContext,NflverseTeamResearch} from './nflFreeResearchData';

type Fetcher=(url:string)=>Promise<any>;
interface Outcome {result:NflContextResult;reason?:string;}
export interface NflTeamContext {teamId:string;teamName:string;side:'home'|'away';roster:{status:NflContextResult;players:number|null};
  qb:{status:NflContextResult;name:string|null;designation:'EXPECTED'|'UNKNOWN'};injuries:{status:NflContextResult;listed:number|null;updatedAt:string|null;note:string};
  officialInjuryReport:{status:NflContextResult;listed:number|null;source:string|null;note:string};
  teamResearch:NflTeamResearchContext|null;
  currentSeason:{status:NflContextResult;record:string|null};classification:'NFL';completeness:number;reliability:'MEDIUM'|'LOW'|'INSUFFICIENT';}
export interface NflGameContext {event:UpcomingEvent;espnEventId:string|null;identity:NflContextResult;weather:{status:NflContextResult;indoor:boolean|null;temperatureF:number|null;
  windMph:number|null;gustMph:number|null;precipitationProbability:number|null};availability:{status:NflContextResult;note:string};teams:NflTeamContext[];warnings:string[];}
const TTL={teams:6*3600_000,summary:15*60_000,roster:6*3600_000,depth:3600_000,injuries:15*60_000};
function providerFailure(error:unknown):NflContextResult{const message=safeNflContextFailure(error);if(/HTTP\s+(401|403)\b|unauthori[sz]ed|forbidden/i.test(message))return'SOURCE_AUTH_FAILED';
  if(/HTTP\s+429\b|rate.?limit|too many requests/i.test(message))return'SOURCE_RATE_LIMITED';return'SOURCE_HTTP_ERROR';}
function aggregate(rows:Outcome[]):Outcome{if(!rows.length)return{result:'NO_SOURCE_ATTEMPTED'};const success=rows.filter(row=>['SUCCESS','PARTIAL_SUCCESS'].includes(row.result));
  if(success.length===rows.length)return{result:rows.some(row=>row.result==='PARTIAL_SUCCESS')?'PARTIAL_SUCCESS':'SUCCESS'};
  if(success.length)return{result:'PARTIAL_SUCCESS',reason:`${success.length}/${rows.length} targets succeeded; ${rows.length-success.length} failed.`};
  const order:NflContextResult[]=['SOURCE_AUTH_FAILED','SOURCE_RATE_LIMITED','SOURCE_HTTP_ERROR','PARSER_FAILED','TEAM_MATCH_FAILED','VALIDATION_FAILED','SOURCE_RETURNED_EMPTY','SOURCE_FIELD_UNAVAILABLE'];
  const result=order.find(value=>rows.some(row=>row.result===value))??rows[0].result;return{result,reason:rows.find(row=>row.result===result)?.reason};}
async function mapLimit<T>(values:T[],limit:number,work:(value:T)=>Promise<void>){let next=0;await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{while(next<values.length){const i=next++;await work(values[i]);}}));}
function finite(value:any):number|null{return typeof value==='number'&&Number.isFinite(value)?value:null;}
function qbFromDepth(payload:any){for(const chart of payload?.depthchart??[])for(const [key,block]of Object.entries(chart?.positions??{}) as [string,any][]){const label=String(block?.position?.abbreviation??block?.name??key).toUpperCase();
    if(label!=='QB')continue;const rows=block?.athletes??block?.items??[],first=rows[0]?.athlete??rows[0];if(first?.id&&first?.displayName)return{id:String(first.id),name:String(first.displayName)};}return null;}
function rosterPlayers(payload:any){return(Array.isArray(payload?.athletes)?payload.athletes:[]).flatMap((group:any)=>Array.isArray(group?.items)?group.items:[]);}
function teamDirectory(payload:any){return(payload?.sports?.[0]?.leagues?.[0]?.teams??[]).map((row:any)=>row?.team).filter((team:any)=>team?.id&&team?.displayName);}
function directoryId(teams:any[],name:string){const matches=teams.filter(team=>nflName(team.displayName)===nflName(name));return matches.length===1?String(matches[0].id):'';}
function officialLabel(teams:any[],teamId:string,teamName:string){return String(teams.find(team=>String(team.id)===teamId)?.name??teamName.split(/\s+/).at(-1)??'');}
function injuryGroups(payload:any){return Array.isArray(payload?.injuries)?payload.injuries:[];}
function exactTeams(summary:any,event:UpcomingEvent){const game=summary?.header?.competitions?.[0],rows=game?.competitors??[],home=rows.filter((row:any)=>row.homeAway==='home'),away=rows.filter((row:any)=>row.homeAway==='away');
  if(summary?.header?.league?.slug!=='nfl'||home.length!==1||away.length!==1||nflName(home[0].team?.displayName)!==nflName(event.homeTeam)||nflName(away[0].team?.displayName)!==nflName(event.awayTeam))return null;return{home:home[0],away:away[0]};}

export class NflContextIngestion {
  private cache=new Map<string,{at:number;value:any}>();
  constructor(private root:string,private research=new NflResearch(),private get:Fetcher=fetchNflJson,private now=()=>Date.now(),private wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),
    private officialReports=new OfficialNflInjuryReports(undefined,now),private teamResearch=new NflverseTeamResearch(undefined,now)){ }
  private async request(url:string,ttl:number){const hit=this.cache.get(url);if(hit&&this.now()-hit.at<ttl)return{payload:hit.value,result:'SUCCESS' as NflContextResult,cached:true};let last:unknown;
    for(let attempt=0;attempt<2;attempt++)try{const payload=await this.get(url);this.cache.set(url,{at:this.now(),value:payload});return{payload,result:'SUCCESS' as NflContextResult,cached:false};}
    catch(error){last=error;const result=providerFailure(error);if(attempt||['SOURCE_AUTH_FAILED','SOURCE_RATE_LIMITED'].includes(result))return{payload:null,result,reason:safeNflContextFailure(error),cached:false};await this.wait(250);}
    return{payload:null,result:providerFailure(last),reason:safeNflContextFailure(last),cached:false};}
  async refresh(events:UpcomingEvent[]){const registry=new NflContextSourceRegistry(this.root,this.now),archive=new NflEvidenceArchive(path.join(this.root,'nfl_context','evidence-v1')),
      games:NflGameContext[]=[],outcomes=new Map<string,Outcome[]>(),warnings:string[]=[];
    const note=(id:string,result:NflContextResult,reason?:string)=>outcomes.set(id,[...(outcomes.get(id)??[]),{result,reason}]);
    let directory:any[]=[],injuryFeed:any=null;
    if(events.length){const teams=await this.request(`${ESPN_NFL}/teams`,TTL.teams);if(teams.result==='SUCCESS'){directory=teamDirectory(teams.payload);note('espn-teams:GAME_IDENTITY',directory.length?'SUCCESS':'SOURCE_RETURNED_EMPTY');}
      else note('espn-teams:GAME_IDENTITY',teams.result,teams.reason);
      const injuries=await this.request(`${ESPN_NFL}/injuries`,TTL.injuries);if(injuries.result==='SUCCESS'){
        if(Number(injuries.payload?.season?.year)===nflSeason(events[0].commenceTime)){injuryFeed=injuries.payload;note('espn-injuries:INJURIES',injuryGroups(injuryFeed).length?'PARTIAL_SUCCESS':'SOURCE_RETURNED_EMPTY','Provider injury/news entries are not official game-day inactive status.');
          archive.record({kind:'nfl_context_injuries_v1',fetchedAt:new Date(this.now()).toISOString(),data:injuryFeed});}
        else note('espn-injuries:INJURIES','VALIDATION_FAILED','Injury feed season did not match the selected NFL season.');}
      else note('espn-injuries:INJURIES',injuries.result,injuries.reason);
    }
    await mapLimit([...new Map(events.map(event=>[event.id,event])).values()],4,async event=>{
      const game:NflGameContext={event:{...event},espnEventId:null,identity:'NO_SOURCE_ATTEMPTED',weather:{status:'NO_SOURCE_ATTEMPTED',indoor:null,temperatureF:null,windMph:null,gustMph:null,precipitationProbability:null},
        availability:{status:'NO_PROVIDER_CONFIGURED',note:'No complete automated official game-specific inactive adapter is configured.'},teams:[],warnings:[]};
      let summary:any=null;
      try{const id=await this.research.matchEvent(event);game.espnEventId=id;game.identity='SUCCESS';note('espn-scoreboard:GAME_IDENTITY','SUCCESS');
        try{summary=await this.research.summary(id);archive.record({kind:'nfl_context_summary_v1',event,espnEventId:id,fetchedAt:new Date(this.now()).toISOString(),data:summary});}
        catch(error){const result=providerFailure(error);note('espn-summary:CURRENT_SEASON',result,safeNflContextFailure(error));note('espn-summary:WEATHER',result,safeNflContextFailure(error));game.warnings.push(`Game summary ${result}.`);}}
      catch(error){game.identity=error instanceof Error&&/identity|verified|unique/i.test(error.message)?'TEAM_MATCH_FAILED':providerFailure(error);note('espn-scoreboard:GAME_IDENTITY',game.identity,safeNflContextFailure(error));game.warnings.push(`Game identity ${game.identity}.`);}
      const matched=summary?exactTeams(summary,event):null;
      let official:OfficialNflInjuryReport|null=null;const week=Number(summary?.header?.week),season=nflSeason(event.commenceTime);
      if(summary&&Number.isInteger(week)&&week>=1&&week<=18){official=await this.officialReports.report(season,week);note('nfl-injury-report:INJURIES',official.status,official.note);
        archive.record({kind:'nfl_official_injury_report_observation_v1',eventId:event.id,season,week,source:official.source,fetchedAt:official.fetchedAt,status:official.status,
          teams:official.teams,rows:official.rows.filter(row=>[event.homeTeam,event.awayTeam].some(team=>nflName(team).endsWith(nflName(row.team))))});}
      else if(summary)note('nfl-injury-report:INJURIES','VALIDATION_FAILED','NFL week number unavailable or invalid.');
      if(summary&&!matched){note('espn-summary:CURRENT_SEASON','TEAM_MATCH_FAILED');note('espn-summary:WEATHER','TEAM_MATCH_FAILED');game.warnings.push('Summary teams did not match the provider game.');}
      if(matched){const weather=summary?.gameInfo?.weather??{},venue=summary?.gameInfo?.venue??{};game.weather={status:Object.keys(weather).length||typeof venue.indoor==='boolean'?'PARTIAL_SUCCESS':'SOURCE_RETURNED_EMPTY',
          indoor:typeof venue.indoor==='boolean'?venue.indoor:null,temperatureF:finite(weather.temperature),windMph:finite(weather.windSpeed),gustMph:finite(weather.gust),precipitationProbability:finite(weather.precipitation)};
        note('espn-summary:WEATHER',game.weather.status,game.weather.windMph===null?'Sustained wind unavailable; no calm condition assumed.':undefined);
        note('espn-summary:CURRENT_SEASON','PARTIAL_SUCCESS','Team record is available; full opponent-adjusted team model inputs are not.');}
      for(const side of ['away','home'] as const){const competitor=matched?.[side],teamName=side==='home'?event.homeTeam:event.awayTeam,
        teamId=String(competitor?.team?.id??(!summary?directoryId(directory,teamName):''));
        const team:NflTeamContext={teamId,teamName,side,roster:{status:teamId?'NO_SOURCE_ATTEMPTED':'TEAM_MATCH_FAILED',players:null},qb:{status:teamId?'NO_SOURCE_ATTEMPTED':'TEAM_MATCH_FAILED',name:null,designation:'UNKNOWN'},
          injuries:{status:teamId?'NO_SOURCE_ATTEMPTED':'TEAM_MATCH_FAILED',listed:null,updatedAt:null,note:'Provider injury/news context is not verified game-day availability.'},
          officialInjuryReport:{status:teamId?'NO_SOURCE_ATTEMPTED':'TEAM_MATCH_FAILED',listed:null,source:official?.source??null,note:'Official weekly injury report is not the game-day inactive list.'},
          teamResearch:null,
          currentSeason:{status:matched?'PARTIAL_SUCCESS':'TEAM_MATCH_FAILED',record:competitor?.records?.find?.((row:any)=>row.type==='total')?.summary??null},classification:'NFL',completeness:0,reliability:'INSUFFICIENT'};
        if(!teamId){note('espn-roster:ROSTER','TEAM_MATCH_FAILED');note('espn-depthchart:QB_ROLE','TEAM_MATCH_FAILED');game.teams.push(team);continue;}
        const season=nflSeason(event.commenceTime),rosterUrl=`${ESPN_NFL}/teams/${teamId}/roster`,roster=await this.request(rosterUrl,TTL.roster);
        if(roster.result==='SUCCESS'){try{if(Number(roster.payload?.season?.year)!==season||String(roster.payload?.team?.id)!==teamId)throw Error('Roster team/season mismatch');const players=rosterPlayers(roster.payload);team.roster={status:players.length?'SUCCESS':'SOURCE_RETURNED_EMPTY',players:players.length};
            archive.record({kind:'nfl_context_roster_v1',eventId:event.id,teamId,fetchedAt:new Date(this.now()).toISOString(),data:roster.payload});}
          catch(error){team.roster.status='TEAM_MATCH_FAILED';game.warnings.push(`${teamName}: ${safeNflContextFailure(error)}.`);}}
        else{team.roster.status=roster.result;game.warnings.push(`${teamName}: roster ${roster.result}.`);}
        note('espn-roster:ROSTER',team.roster.status);
        if(injuryFeed){const groups=injuryGroups(injuryFeed).filter((group:any)=>String(group?.id??group?.team?.id)==teamId),rows=groups.flatMap((group:any)=>group?.injuries??[]),
          dates=rows.map((row:any)=>Date.parse(row?.date??'')).filter(Number.isFinite).sort((a:number,b:number)=>b-a);
          team.injuries={status:groups.length?'PARTIAL_SUCCESS':'SOURCE_RETURNED_EMPTY',listed:groups.length?rows.length:null,updatedAt:dates.length?new Date(dates[0]).toISOString():null,
            note:groups.length?`${rows.length} ESPN injury/news entries; verify dated practice report and inactive status.`:'No team group returned; health is not assumed.'};}
        else team.injuries={...team.injuries,status:'SOURCE_FIELD_UNAVAILABLE',note:'The separate injury/news feed was unavailable; health is not assumed.'};
        if(official){const label=officialLabel(directory,teamId,teamName),listed=official.rows.filter(row=>nflName(row.team)===nflName(label));team.officialInjuryReport={status:official.status==='PARTIAL_SUCCESS'&&official.teams.some(name=>nflName(name)===nflName(label))?'PARTIAL_SUCCESS':official.status,
            listed:official.teams.some(name=>nflName(name)===nflName(label))?listed.length:null,source:official.source,note:official.teams.some(name=>nflName(name)===nflName(label))?`${listed.length} official weekly practice/game-status rows; absence is not proof of active status.`:official.note};}
        const teamRow=directory.find(row=>String(row.id)===teamId),opponentName=side==='home'?event.awayTeam:event.homeTeam,opponentId=directoryId(directory,opponentName),opponentRow=directory.find(row=>String(row.id)===opponentId);
        if(Number.isInteger(week)&&teamRow?.abbreviation&&opponentRow?.abbreviation){team.teamResearch=await this.teamResearch.context(String(teamRow.abbreviation),String(opponentRow.abbreviation),season,week);
          note('nflverse-team-stats:OPPONENT_QUALITY',team.teamResearch.status,team.teamResearch.note);archive.record({kind:'nflverse_team_research_observation_v1',eventId:event.id,teamId,...team.teamResearch});}
        else note('nflverse-team-stats:OPPONENT_QUALITY','VALIDATION_FAILED','Exact team abbreviation or NFL week is unavailable.');
        const depthUrl=`${ESPN_NFL}/teams/${teamId}/depthcharts`,depth=await this.request(depthUrl,TTL.depth);
        if(depth.result==='SUCCESS'){try{if(Number(depth.payload?.season?.year)!==season||String(depth.payload?.team?.id)!==teamId)throw Error('Depth-chart team/season mismatch');const qb=qbFromDepth(depth.payload);
            team.qb=qb?{status:'PARTIAL_SUCCESS',name:qb.name,designation:'EXPECTED'}:{status:'SOURCE_RETURNED_EMPTY',name:null,designation:'UNKNOWN'};archive.record({kind:'nfl_context_depth_v1',eventId:event.id,teamId,fetchedAt:new Date(this.now()).toISOString(),data:depth.payload});}
          catch(error){team.qb.status='TEAM_MATCH_FAILED';game.warnings.push(`${teamName}: ${safeNflContextFailure(error)}.`);}}
        else team.qb.status=depth.result;note('espn-depthchart:QB_ROLE',team.qb.status);
        const checks=[game.identity==='SUCCESS',team.roster.status==='SUCCESS',team.qb.name!==null,team.currentSeason.record!==null,game.weather.status==='PARTIAL_SUCCESS',team.injuries.listed!==null,
          team.officialInjuryReport.listed!==null,Boolean(team.teamResearch?.current||team.teamResearch?.prior),game.availability.status==='SUCCESS'];
        team.completeness=Number((checks.filter(Boolean).length/checks.length*100).toFixed(1));team.reliability=game.identity==='SUCCESS'&&team.roster.status==='SUCCESS'?'MEDIUM':game.identity==='SUCCESS'?'LOW':'INSUFFICIENT';game.teams.push(team);
      }
      games.push(game);
    });
    for(const [id,rows]of outcomes){const result=aggregate(rows);registry.mark(id,result.result,result.reason);}
    const snapshot={version:'nfl-context-preflight-v1',scannedAt:new Date(this.now()).toISOString(),games:games.sort((a,b)=>Date.parse(a.event.commenceTime)-Date.parse(b.event.commenceTime)),warnings};
    let storeStatus:'SUCCESS'|'STORE_FAILED'='SUCCESS',storeFailure:string|null=null;try{const dir=path.join(this.root,'nfl_context'),target=path.join(dir,'latest.json');fs.mkdirSync(dir,{recursive:true});
      const tmp=path.join(dir,randomUUID()+'.tmp');fs.writeFileSync(tmp,JSON.stringify({schema:1,...snapshot},null,2),{flag:'wx'});fs.renameSync(tmp,target);archive.record({kind:'nfl_context_preflight_v1',...snapshot});}
    catch(error){storeStatus='STORE_FAILED';storeFailure=safeNflContextFailure(error);warnings.push(`NFL context STORE_FAILED: ${storeFailure}. Retrieved diagnostics remain in this response.`);}
    const registryStore=registry.save();if(registryStore.status!=='SUCCESS')warnings.push(`NFL source registry ${registryStore.status}: ${registryStore.error}.`);
    return{...snapshot,sourceRegistry:registry.snapshot(),storage:{storeStatus,storeFailure,registryStore},summary:{games:games.length,teams:games.reduce((n,g)=>n+g.teams.length,0),
      averageCompleteness:Number((games.flatMap(g=>g.teams).reduce((n,t)=>n+t.completeness,0)/Math.max(1,games.flatMap(g=>g.teams).length)).toFixed(1)),
      expectedQbs:games.flatMap(g=>g.teams).filter(t=>t.qb.name).length,rostersLoaded:games.flatMap(g=>g.teams).filter(t=>t.roster.status==='SUCCESS').length,
      officialInjuryTeams:games.flatMap(g=>g.teams).filter(t=>t.officialInjuryReport.listed!==null).length,
      teamResearchLoaded:games.flatMap(g=>g.teams).filter(t=>t.teamResearch?.prior||t.teamResearch?.current).length,officialAvailability:0}};
  }
}
