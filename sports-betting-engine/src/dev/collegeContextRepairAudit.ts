import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {CollegeDayScan} from '../services/collegeDayScan';
import {CollegePredictions} from '../services/collegePredictions';
import {createCollegePaperLedger} from '../services/collegePaper';

async function main(){
  const date=process.argv[2]??new Date().toISOString().slice(0,10),root=fs.mkdtempSync(path.join(os.tmpdir(),'college-repair-audit-'));
  try{
    const paper=createCollegePaperLedger(path.join(root,'college_paper_picks.json'));
    const predictions=new CollegePredictions(paper,root);
    const result:any=await new CollegeDayScan(undefined,predictions).scan(date,false);
    const named=['Ohio','Nebraska','Coastal Carolina','West Virginia','Oregon State','Houston','Arkansas State','Memphis','Clemson','LSU','UNLV','Hawai','Bryant','Army'];
    const concise=(item:any)=>({game:`${item.event.awayTeam} @ ${item.event.homeTeam}`,kickoff:item.event.commenceTime,
      classification:item.safety.classification,reason:item.reason,modelHomeMargin:item.projection.homeMargin,marketHomeLine:item.safety.marketConsensus.homeLine,
      disagreementPoints:item.safety.marketDisagreementPoints,disagreementStatus:item.safety.marketDisagreementStatus,
      homeDivision:item.safety.mismatch.homeDivision,awayDivision:item.safety.mismatch.awayDivision,hugeFcsUnderdog:item.safety.mismatch.hugeFcsUnderdog,
      contextCompleteness:item.safety.currentContext.completenessAverage,contextReliability:item.safety.currentContext.reliability,
      awayQb:item.safety.currentContext.away.qb,homeQb:item.safety.currentContext.home.qb,contextChecks:item.safety.checks});
    const representative=result.projections.filter((item:any)=>named.some(name=>item.event.homeTeam.includes(name)||item.event.awayTeam.includes(name))).map(concise);
    const extreme=result.projections.filter((item:any)=>item.safety.marketDisagreementStatus==='EXTREME DISAGREEMENT').map(concise);
    console.log(JSON.stringify({date,scannedAt:result.scannedAt,trackPaper:false,providerGames:result.providerGames,independentScheduledGames:result.independentScheduledGames,
      projections:result.projections.length,recommendations:result.recommendations.length,monitors:result.monitors.length,recommendationStatus:result.recommendationStatus,
      oddsStatus:result.oddsStatus,creditsUsed:result.creditsUsed,remainingCredits:result.remainingCredits,contextStorage:result.contextStorage,
      contextSources:result.contextSourceRegistry?.sources,representative,extreme,warnings:result.warnings},null,2));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
