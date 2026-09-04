import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {CollegeContextIngestion,ContextTeamSeed} from '../services/collegeContextIngestion';
import {resolveCollegeTeamContext,resolveContextField} from '../services/collegeContextEvidence';
import {collegeDivision} from '../services/collegeContext';
import {ESPN_COLLEGE} from '../services/collegeResearch';

async function main(){
  const compact=process.argv[2]??new Date().toISOString().slice(0,10).replace(/-/g,'');
  if(!/^\d{8}$/.test(compact))throw Error('Usage: collegeCurrentContextAudit.ts YYYYMMDD');
  const season=Number(compact.slice(0,4)),url=`${ESPN_COLLEGE}/scoreboard?dates=${compact}&groups=80&limit=500`,retrieved=Date.now(),response=await fetch(url,{signal:AbortSignal.timeout(20_000)});
  if(!response.ok)throw Error(`ESPN scoreboard ${response.status}`);const data:any=await response.json(),root=fs.mkdtempSync(path.join(os.tmpdir(),'college-context-audit-'));
  try{
    const games=(data.events??[]).map((event:any)=>{const competition=event.competitions?.[0],competitors=competition?.competitors??[],home=competitors.find((c:any)=>c.homeAway==='home'),away=competitors.find((c:any)=>c.homeAway==='away');
      if(!home?.team?.id||!away?.team?.id)return null;const seed=(c:any):ContextTeamSeed=>({teamId:String(c.team.id),teamName:c.team.displayName,
        aliases:[c.team.shortDisplayName,c.team.location,c.team.abbreviation].filter((x:any)=>typeof x==='string'&&x.trim()),eventId:String(event.id),commenceTime:event.date,
        division:collegeDivision(season,String(c.team.conferenceId??c.team.groups?.id??'')),venue:{id:competition.venue?.id?String(competition.venue.id):null,name:competition.venue?.fullName??null,
          indoor:typeof competition.venue?.indoor==='boolean'?competition.venue.indoor:null}});return{eventId:String(event.id),kickoff:event.date,home:seed(home),away:seed(away)};}).filter(Boolean);
    const ingestion=new CollegeContextIngestion(root);const refreshed=await ingestion.refresh(games.flatMap((g:any)=>[g.home,g.away])),forecastAt=Date.now();
    const concise=(team:any)=>({team:team.teamName,completeness:team.completeness,reliability:team.reliability,qb:team.qb,roster:team.sections.roster.status,
      returningProduction:team.sections.returningProduction.status,transfers:team.sections.transfers.status,coaching:team.sections.coaching.status,
      talentDepth:team.sections.talentDepth.status,currentSeason:team.currentSeason,fcsTier:team.fcsTier.value??'UNKNOWN_FCS',injuries:team.sections.injuries.status,weather:team.sections.weather.status,
      weatherValues:team.weather,missingDiagnostics:Object.fromEntries(Object.values(team.sections).flatMap((section:any)=>Object.entries(section.fields)).filter(([,field]:any)=>field.status!=='AVAILABLE')
        .map(([field,value]:any)=>[field,value.diagnosticReason]))});
    const resolvedTeams:any[]=[];
    const summary=games.map((g:any)=>{const resolve=(team:any)=>{const initial=resolveCollegeTeamContext(refreshed.records,{teamId:team.teamId,teamName:team.teamName,season,eventId:g.eventId,asOf:forecastAt,currentGames:0});
        return resolveCollegeTeamContext(refreshed.records,{teamId:team.teamId,teamName:team.teamName,season,eventId:g.eventId,asOf:forecastAt,currentGames:Number(initial.currentSeason.gamesPlayed??0)});},away=resolve(g.away),home=resolve(g.home);
      resolvedTeams.push(away,home);const field=(name:string)=>resolveContextField(refreshed.records,{teamId:g.home.teamId,season,eventId:g.eventId,field:name,asOf:forecastAt}).value;
      return{game:`${g.away.teamName} @ ${g.home.teamName}`,eventId:g.eventId,kickoff:g.kickoff,away:concise(away),home:concise(home),marketMovement:{provider:field('market.provider'),
        openingHomeSpread:field('market.openingHomeSpread'),currentHomeSpread:field('market.currentHomeSpread'),movementPoints:field('market.movementPoints'),direction:field('market.movementDirection')}};});
    const values=resolvedTeams.map(team=>team.completeness).sort((a,b)=>a-b),fieldBlocks:Record<string,number>={};
    for(const team of resolvedTeams)for(const section of Object.values(team.sections) as any[])for(const [field,resolved] of Object.entries(section.fields) as any)if(resolved.status!=='AVAILABLE')fieldBlocks[field]=(fieldBlocks[field]??0)+1;
    console.log(JSON.stringify({date:compact,source:url,retrievedAt:new Date(retrieved).toISOString(),sportsbookOddsCalls:0,records:refreshed.total,warnings:refreshed.warnings,
      completeness:{teams:values.length,average:values.reduce((sum,value)=>sum+value,0)/values.length,median:(values[Math.floor((values.length-1)/2)]+values[Math.ceil((values.length-1)/2)])/2,
        atLeast80:values.filter(value=>value>=80).length,fieldBlocks},games:summary},null,2));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
