import { NflPaperLedger, NflPaperPick } from './nflPaper';
import { nflNumber, nflSeason } from './nflResearch';
import { CollegeResearch, ESPN_COLLEGE } from './collegeResearch';
import {GameResultEvidence, SavedFullGameSelection, settleFullGame} from './footballSettlement';

export const COLLEGE_PAPER_RULES='college-full-game-includes-ot_v1';

interface EvidenceMeta {sourceProvider?:string;sourceRetrievalTimestamp?:string;gradingTimestamp?:string;}
const timestampOrNull=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(Date.parse(value)).toISOString():null;

/** Extract only provider facts. Settlement remains a separate pure operation. */
export function collegeResultEvidence(pick:NflPaperPick,data:any,meta:EvidenceMeta={}):GameResultEvidence {
  const game=data?.header?.competitions?.length===1?data.header.competitions[0]:null;
  const home=game?.competitors?.filter((c:any)=>c.homeAway==='home')??[];
  const away=game?.competitors?.filter((c:any)=>c.homeAway==='away')??[];
  const status=game?.status?.type;
  return {
    sourceProvider:meta.sourceProvider??ESPN_COLLEGE,
    providerEventId:game?.id==null?null:String(game.id),
    canonicalEventId:game?.id==null?null:String(game.id),
    homeCanonicalId:home.length===1&&home[0].team?.id!=null?String(home[0].team.id):null,
    awayCanonicalId:away.length===1&&away[0].team?.id!=null?String(away[0].team.id):null,
    homeFinalScore:home.length===1?nflNumber(home[0].score):null,
    awayFinalScore:away.length===1?nflNumber(away[0].score):null,
    explicitStatus:typeof status?.name==='string'?status.name:null,
    statusCompleted:typeof status?.completed==='boolean'?status.completed:null,
    statusState:typeof status?.state==='string'?status.state:null,
    eventCompletionTimestamp:timestampOrNull(status?.completedAt??game?.completionTime),
    sourceRetrievalTimestamp:meta.sourceRetrievalTimestamp??'NOT_RECORDED',
    gradingTimestamp:meta.gradingTimestamp??'NOT_RECORDED',
  };
}

export function savedCollegeSelection(pick:NflPaperPick):SavedFullGameSelection|null {
  const identity=pick.verifiedEvent,q=pick.quote;
  if(!identity||!['spreads','totals'].includes(q.market)||!Number.isFinite(q.line))return null;
  const selectedTeamCanonicalId=q.market==='spreads'
    ? q.side===pick.event.homeTeam?identity.homeTeamId:q.side===pick.event.awayTeam?identity.awayTeamId:undefined
    : undefined;
  return {canonicalEventId:pick.espnEventId,homeCanonicalId:identity.homeTeamId,awayCanonicalId:identity.awayTeamId,
    market:q.market as 'spreads'|'totals',selectedSide:q.side,selectedTeamCanonicalId,line:q.line as number,americanPrice:q.price};
}

/** Deterministic replayable settlement from an immutable pick plus archived evidence. */
export function settleCollegePaper(pick:NflPaperPick,evidence:GameResultEvidence){
  const selection=savedCollegeSelection(pick);
  return selection?settleFullGame(selection,evidence):{result:'UNABLE_TO_GRADE' as const,
    note:'Original college selection identity, market, side, or line is missing.'};
}

export function gradeCollegePaper(pick:NflPaperPick,data:any,meta:EvidenceMeta={}) {
  const evidence=collegeResultEvidence(pick,data,meta);
  const game=data?.header?.competitions?.length===1?data.header.competitions[0]:null;
  const invalidIdentity=pick.event.sportKey!=='americanfootball_ncaaf'||pick.rules!==COLLEGE_PAPER_RULES
    ||!['spreads','totals'].includes(pick.quote.market)||!pick.verifiedEvent
    ||data?.header?.league?.slug!=='college-football'||!game
    ||Number(data?.header?.season?.type)!==2||Number(data?.header?.season?.year)!==pick.season
    ||pick.season!==nflSeason(pick.event.commenceTime)||!Number.isFinite(Date.parse(game?.date??''))
    ||Math.abs(Date.parse(game.date)-Date.parse(pick.event.commenceTime))>15*60_000;
  if(invalidIdentity)return {result:'UNABLE_TO_GRADE' as const,
    note:'College game, season, rules, or kickoff identity cannot be verified against the saved selection.',resultEvidence:evidence};
  const settled=settleCollegePaper(pick,evidence);
  return {...settled,resultEvidence:evidence,note:settled.result==='WIN'||settled.result==='LOSS'||settled.result==='PUSH'
    ? `College ${pick.origin==='model'?'experimental model':'manual'} paper result. ${settled.note} Exact saved line, price, event ID and team IDs were used. Sportsbook-specific rules require separate verification.`
    : settled.note};
}

export function createCollegePaperLedger(file:string,research=new CollegeResearch(),now=()=>Date.now()) {
  return new NflPaperLedger(file,{matchEvent:event=>research.matchEvent(event),summary:id=>research.summary(id),
    player:async()=>{throw new Error('College player props are out of scope.');}},now,{
      sportKey:'americanfootball_ncaaf',label:'College football',version:'college-manual-paper-v1',rules:COLLEGE_PAPER_RULES,
      sourceBase:ESPN_COLLEGE,evidenceKind:'college_settlement_source_v1',archiveDirectory:'college_settlement_evidence',
      supports:market=>market==='spreads',grade:gradeCollegePaper,verifyEvent:event=>research.identity(event),
    });
}
