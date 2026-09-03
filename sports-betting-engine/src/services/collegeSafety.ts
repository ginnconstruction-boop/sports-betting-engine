import {UpcomingEvent} from '../api/oddsApiClient';
import {MarketQuote} from './nflMarketBoard';
import {CollegeProjection} from './collegeScoreModel';
import {CollegeAssessment} from './collegeModelQuotes';
import {CollegeRosterSnapshot,collegeDivision,contextMarginAdjustment,rosterContext,selectRosterSnapshot,ContextCoefficientArtifact} from './collegeContext';
import {CalibrationArtifact,calibratedProbability} from './collegeCalibration';
import {nflSeason} from './nflResearch';
export const COLLEGE_SAFETY_VERSION='college-paper-safety-v2';
export type CollegePaperClass='PAPER BET'|'PAPER LEAN'|'PAPER MONITOR'|'PAPER PASS'|'MODEL WARNING';
export const COLLEGE_TOTALS_LABEL='TOTAL PROJECTION — RESEARCH ONLY. Historical holdout gate failed.';
export const median=(values:number[])=>{const a=[...values].sort((x,y)=>x-y);return a.length?(a[Math.floor(a.length/2)]+a[Math.ceil(a.length/2)-1])/2:null;};
export function marketDisagreement(points:number|null){
  return points===null||!Number.isFinite(points)?'UNAVAILABLE':Math.abs(points)>=10?'EXTREME DISAGREEMENT':Math.abs(points)>=6?'LARGE DISAGREEMENT':Math.abs(points)>=3?'MEANINGFUL DISAGREEMENT':'NORMAL DISAGREEMENT';
}
export function collegeMarketConsensus(event:UpcomingEvent,quotes:MarketQuote[],now:number){
  const books:any[]=[],issues:string[]=[];
  for(const book of new Set(quotes.filter(q=>q.market==='spreads').map(q=>q.bookKey))){
    const rows=quotes.filter(q=>q.bookKey===book&&q.market==='spreads'&&!q.stale&&Number.isFinite(q.line)&&Number.isFinite(q.price)
      &&Math.abs(q.price)>=100&&Date.parse(q.updatedAt)<=now&&now-Date.parse(q.updatedAt)<=15*60_000);
    const h=rows.filter(q=>q.side===event.homeTeam),a=rows.filter(q=>q.side===event.awayTeam);
    if(!h.length&&!a.length)continue;
    if(h.length!==1||a.length!==1||h[0].line!==-a[0].line||Math.abs(h[0].line)>85){issues.push('Conflicting/ambiguous spread pair at '+book);continue;}
    books.push({bookKey:book,homeLine:h[0].line,homePrice:h[0].price,awayPrice:a[0].price,updatedAt:h[0].updatedAt});
  }
  return {homeLine:median(books.map(b=>b.homeLine)),books,issues,method:'median of fresh symmetric full-game home spreads; one pair per book'};
}
export function assessCollegeSafety(args:{event:UpcomingEvent;identity:any;projection:CollegeProjection;quotes:MarketQuote[];
  candidate?:{quote:MarketQuote;assessment:CollegeAssessment};rosters:CollegeRosterSnapshot[];now:number;spreadHoldoutPassed:boolean;calibrator?:CalibrationArtifact;
  contextCoefficients?:ContextCoefficientArtifact}){
  return buildSafety(args);
}
function buildSafety(args:Parameters<typeof assessCollegeSafety>[0]){
  const {event,identity,projection:p,now,candidate}=args,season=nflSeason(event.commenceTime),kickoff=Date.parse(event.commenceTime);
  const home=rosterContext(selectRosterSnapshot(args.rosters,p.homeId,season,now),p.homeId,season,identity?.espnEventId,kickoff,now);
  const away=rosterContext(selectRosterSnapshot(args.rosters,p.awayId,season,now),p.awayId,season,identity?.espnEventId,kickoff,now);
  const divisions:[ReturnType<typeof collegeDivision>,ReturnType<typeof collegeDivision>]=[
    collegeDivision(season,identity?.homeConferenceId),collegeDivision(season,identity?.awayConferenceId)];
  const week=Number.isInteger(identity?.week)&&identity.week>0?identity.week:null;
  const context=contextMarginAdjustment(home,away,divisions,week,[p.homeCurrentGames,p.awayCurrentGames],now,args.contextCoefficients);
  const consensus=collegeMarketConsensus(event,args.quotes,now),gap=consensus.homeLine===null?null:p.homeMargin+consensus.homeLine;
  const disagreement=marketDisagreement(gap),mismatch=divisions.every(d=>d!=='UNKNOWN')&&divisions[0]!==divisions[1];
  const low=home.completeness<1||away.completeness<1||!home.qbVerified||!away.qbVerified||!home.injuryVerified||!away.injuryVerified
    ||home.quality===null||away.quality===null||Math.min(p.homeCurrentGames,p.awayCurrentGames)<3||divisions.includes('UNKNOWN');
  const checks={rosterData:home.completeness===1&&away.completeness===1,qbKnown:home.qbVerified&&away.qbVerified,
    injuriesVerified:home.injuryVerified&&away.injuryVerified,coachingAccountedFor:context.adjusted,
    divisionKnown:!divisions.includes('UNKNOWN'),currentSample:Math.min(p.homeCurrentGames,p.awayCurrentGames)>=3,
    priorInputsFresh:[p.homeLastGame,p.awayLastGame].every(t=>Number.isFinite(Date.parse(t))&&now-Date.parse(t)<400*86400_000&&Date.parse(t)<now),
    distinctTeams:p.homeId!==p.awayId,venueKnown:typeof identity?.neutralSite==='boolean',homeFieldApplied:p.neutral===identity?.neutralSite,
    providerLine:!consensus.issues.length&&consensus.homeLine!==null,canonicalIds:p.homeId===identity?.homeTeamId&&p.awayId===identity?.awayTeamId,
    transferData:[home,away].every(c=>Number.isFinite(c.features.transferAdditions)&&Number.isFinite(c.features.transferLosses))};
  const reasons:string[]=[],probability=candidate?.assessment.probability??null,push=candidate?.assessment.pushProbability??0;
  const conditional=probability===null||push>=1?null:probability/(1-push);
  const calibrated=conditional===null?null:calibratedProbability(args.calibrator,conditional,now);
  let classification:CollegePaperClass='PAPER PASS';
  const integrity=!checks.distinctTeams||!checks.canonicalIds||!checks.venueKnown||!checks.homeFieldApplied||!checks.priorInputsFresh||consensus.issues.length>0;
  if(candidate?.quote.market==='totals')reasons.push(COLLEGE_TOTALS_LABEL);
  else if(integrity){classification='MODEL WARNING';reasons.push('Integrity/provider/venue check failed.');}
  else if(!Number.isFinite(kickoff)||kickoff<=now||now-Date.parse(p.asOf)>5*60_000||Date.parse(p.asOf)>now){reasons.push('Started game or stale/future model inputs.');}
  else if(!args.spreadHoldoutPassed){reasons.push('Spread historical gate failed.');}
  else if(disagreement==='EXTREME DISAGREEMENT'&&low){classification='MODEL WARNING';reasons.push('Extreme market disagreement and incomplete football context; no reliable edge.');}
  else if(!candidate?.assessment.eligible||consensus.homeLine===null){reasons.push('No fresh spread candidate with sufficient information.');}
  else if(low||disagreement==='EXTREME DISAGREEMENT'||mismatch&&!context.adjusted||consensus.books.length<3||!args.calibrator?.approved){
    classification='PAPER MONITOR';reasons.push('Unverified roster/QB, early sample, mismatch or probability calibration: observation only, not a qualified paper bet.');
  }else{classification=disagreement==='LARGE DISAGREEMENT'?'PAPER LEAN':'PAPER BET';reasons.push('Paper-only context and validation gates passed.');}
  if(!context.adjusted)reasons.push(context.reason);
  const isHugeUnderdog=!!candidate&&candidate.quote.line>=28&&mismatch
    &&(candidate.quote.side===event.homeTeam?divisions[0]:divisions[1])==='FCS';
  return {version:COLLEGE_SAFETY_VERSION,classification,qualified:['PAPER BET','PAPER LEAN'].includes(classification),
    trackable:classification==='PAPER MONITOR'||['PAPER BET','PAPER LEAN'].includes(classification),confidence:low||!args.calibrator?.approved?'LOW':'LIMITED',
    reasons,marketConsensus:consensus,marketDisagreementPoints:gap,marketDisagreementStatus:disagreement,
    rawProjectedHomeMargin:p.homeMargin,talentAdjustedHomeMargin:context.adjusted?p.homeMargin+context.rosterPoints+context.mismatchPoints:null,
    rosterContext:{home,away,...context},mismatch:{homeDivision:divisions[0],awayDivision:divisions[1],isMismatch:mismatch,hugeFcsUnderdog:isHugeUnderdog,
      warning:isHugeUnderdog?'Possible regression-to-mean bias: huge FCS underdog; depth/talent validation required.':null},
    week,checks,rawProbability:probability,rawConditionalProbability:conditional,calibratedProbability:calibrated,
    calibrationStatus:'RAW MODEL PROBABILITY — NOT CALIBRATED',calibratedLabel:calibrated===null?'Unavailable':'CALIBRATED ESTIMATE — PAPER USE ONLY; approval failed',
    calibrationVersion:args.calibrator?.version??null,spreadHoldoutPassed:args.spreadHoldoutPassed,
    totalsStatus:COLLEGE_TOTALS_LABEL,moneyBettingApproved:false,kellyEnabled:false,recommendedStake:null};
}
export type CollegeSafety=ReturnType<typeof buildSafety>;
