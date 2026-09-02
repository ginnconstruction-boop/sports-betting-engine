import { NflPaperLedger, NflPaperPick } from './nflPaper';
import { nflNumber, nflSeason } from './nflResearch';
import { CollegeResearch, ESPN_COLLEGE } from './collegeResearch';

export const COLLEGE_PAPER_RULES='college-full-game-includes-ot_v1';
export function gradeCollegePaper(pick:NflPaperPick,data:any) {
  const review=(note:string)=>({result:'REVIEW' as const,note});
  const game=data?.header?.competitions?.[0],identity=pick.verifiedEvent,q=pick.quote;
  if(pick.event.sportKey!=='americanfootball_ncaaf'||pick.rules!==COLLEGE_PAPER_RULES||!['spreads','totals'].includes(q.market)
    ||!identity||data?.header?.league?.slug!=='college-football'||data.header.competitions?.length!==1
    ||String(game?.id)!==pick.espnEventId||identity.espnEventId!==pick.espnEventId
    ||Number(data.header.season?.type)!==2||Number(data.header.season?.year)!==pick.season
    ||pick.season!==nflSeason(pick.event.commenceTime)||!Number.isFinite(Date.parse(game?.date??''))
    ||Math.abs(Date.parse(game.date)-Date.parse(pick.event.commenceTime))>15*60_000)
    return review('College game/season/rules identity does not match the saved selection.');
  const home=game.competitors?.filter((c:any)=>c.homeAway==='home')??[],away=game.competitors?.filter((c:any)=>c.homeAway==='away')??[];
  if(game.competitors?.length!==2||home.length!==1||away.length!==1||String(home[0].team?.id)!==identity.homeTeamId
    ||String(away[0].team?.id)!==identity.awayTeamId||identity.homeTeamId===identity.awayTeamId)
    return review('College home/away team IDs do not match.');
  if(game.status?.type?.completed!==true||game.status?.type?.state!=='post')return {result:'PENDING' as const,note:'Awaiting completed college game.'};
  if(!['STATUS_FINAL','STATUS_FINAL_OVERTIME'].includes(game.status.type.name))return review('Unusual college final status; verify manually.');
  const hs=nflNumber(home[0].score),as=nflNumber(away[0].score);
  if(!Number.isInteger(hs)||!Number.isInteger(as)||hs<0||as<0||(hs===0&&as===0)||!Number.isFinite(q.line))return review('College final scores or exact line are missing/invalid.');
  let actual:number,result:'WIN'|'LOSS'|'PUSH';
  if(q.market==='totals') {
    if(!['Over','Under'].includes(q.side))return review('Invalid college total side.');
    actual=hs+as;result=actual===q.line?'PUSH':(q.side==='Over'?actual>q.line:actual<q.line)?'WIN':'LOSS';
  }else{
    if(![pick.event.homeTeam,pick.event.awayTeam].includes(q.side))return review('Unknown selected college team.');
    actual=(q.side===pick.event.homeTeam?hs-as:as-hs)+q.line;result=actual===0?'PUSH':actual>0?'WIN':'LOSS';
  }
  return {result,actual,note:`College ${pick.origin==='model'?'experimental model':'manual'} paper result, full game including overtime. Exact saved line and home/away IDs; neutral venue is not home-field advantage. Sportsbook rules/promotions require separate verification.`};
}
export function createCollegePaperLedger(file:string,research=new CollegeResearch(),now=()=>Date.now()) {
  return new NflPaperLedger(file,{matchEvent:event=>research.matchEvent(event),summary:id=>research.summary(id),
    player:async()=>{throw new Error('College player props are out of scope.');}},now,{
      sportKey:'americanfootball_ncaaf',label:'College football',version:'college-manual-paper-v1',rules:COLLEGE_PAPER_RULES,
      sourceBase:ESPN_COLLEGE,evidenceKind:'college_settlement_source_v1',archiveDirectory:'college_settlement_evidence',
      supports:market=>['spreads','totals'].includes(market),grade:gradeCollegePaper,verifyEvent:event=>research.identity(event),
    });
}
