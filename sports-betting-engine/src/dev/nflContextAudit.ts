import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {NflMarketBoard} from '../services/nflMarketBoard';
import {NflContextIngestion} from '../services/nflContextIngestion';
import {collegeDate} from '../services/collegeDayScan';
import {nflReadinessChecklist} from '../services/nflReadiness';

async function main(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-context-audit-'));try{const events=await new NflMarketBoard().events(),date=process.argv[2]??events.map(event=>collegeDate(Date.parse(event.commenceTime))).sort()[0];
    if(!date)throw Error('No NFL games in the next 14 days');const slate=events.filter(event=>collegeDate(Date.parse(event.commenceTime))===date),result=await new NflContextIngestion(root).refresh(slate);
    console.log(JSON.stringify({date,sportsbookOddsCalls:0,events:slate.length,summary:result.summary,storage:result.storage,sources:result.sourceRegistry.sources,
      games:result.games.map(game=>({game:`${game.event.awayTeam} @ ${game.event.homeTeam}`,kickoff:game.event.commenceTime,identity:game.identity,weather:game.weather,
        availability:game.availability,teams:game.teams.map(team=>({team:team.teamName,id:team.teamId,roster:team.roster,qb:team.qb,injuries:team.injuries,
          officialInjuryReport:team.officialInjuryReport,teamResearch:team.teamResearch,currentSeason:team.currentSeason,completeness:team.completeness,reliability:team.reliability}))})),
      readiness:nflReadinessChecklist()},null,2));
  }finally{fs.rmSync(root,{recursive:true,force:true});}}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
