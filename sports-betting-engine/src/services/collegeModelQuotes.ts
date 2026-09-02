import { UpcomingEvent } from '../api/oddsApiClient';
import { MarketQuote } from './nflMarketBoard';
import { CollegeProjection } from './collegeScoreModel';
export const COLLEGE_SELECTION_VERSION='college-paper-selection-v1';
export interface CollegeAssessment {eligible:boolean;probability:number;pushProbability:number;lossProbability:number;estimatedEV:number;
  probabilityAdvantage:number;pointGap:number;sample:number;reasons:string[];}
export interface CollegeResiduals {marginResiduals:number[];totalResiduals:number[];}
/** Frozen residual distribution from development games only. Never feed held-out
 * scores or market prices into the score projection. Rounded simulated scores
 * distinguish integer pushes from wins and losses. Probabilities are experimental. */
export function assessCollegeQuote(event:UpcomingEvent,quote:MarketQuote,p:CollegeProjection,residuals:CollegeResiduals,now:number):CollegeAssessment {
  const empty=(reason:string):CollegeAssessment=>({eligible:false,probability:0,pushProbability:0,lossProbability:0,estimatedEV:0,probabilityAdvantage:0,pointGap:0,sample:0,reasons:[reason]});
  const stamp=Date.parse(quote.updatedAt??''),asOf=Date.parse(p.asOf),kickoff=Date.parse(event.commenceTime);
  if(event.sportKey!=='americanfootball_ncaaf'||!['spreads','totals'].includes(quote.market)||quote.participant
    ||!Number.isFinite(quote.line)||!Number.isFinite(quote.price)||Math.abs(quote.price)<100
    ||![now,kickoff,stamp,asOf].every(Number.isFinite)||kickoff<=now||stamp>now||now-stamp>15*60_000
    ||asOf>now||now-asOf>5*60_000||quote.stale)return empty('Invalid, expired, started or unsupported quote/projection.');
  if(!['fanduel','betmgm'].includes(quote.bookKey))return empty('Quote is not at a configured accessible sportsbook.');
  const spread=quote.market==='spreads',home=quote.side===event.homeTeam;
  if(spread?!home&&quote.side!==event.awayTeam:!['Over','Under'].includes(quote.side))return empty('Unknown selection side.');
  const errors=spread?residuals.marginResiduals:residuals.totalResiduals;
  if(errors.length<500||errors.some(e=>!Number.isFinite(e))||![p.homeMargin,p.total].every(Number.isFinite))return empty('Insufficient valid development residuals.');
  const direction=spread?(home?1:-1):(quote.side==='Over'?1:-1);
  const pointGap=spread?direction*p.homeMargin+quote.line:direction*(p.total-quote.line);
  let wins=0,pushes=0;
  for(const error of errors){
    const actual=Math.round((spread?p.homeMargin:p.total)+error);
    const compared=spread?direction*actual+quote.line:direction*(actual-quote.line);
    if(compared>0)wins++;else if(compared===0)pushes++;
  }
  const probability=wins/errors.length,pushProbability=pushes/errors.length,lossProbability=1-probability-pushProbability;
  const payout=quote.price>0?quote.price/100:100/Math.abs(quote.price),breakEven=1/(1+payout);
  const probabilityAdvantage=pushProbability<1?probability/(1-pushProbability)-breakEven:0;
  const estimatedEV=probability*payout-lossProbability,reasons:string[]=[];
  if(quote.price< -200||quote.price>180)reasons.push('Price outside fixed -200 to +180 paper range.');
  if(p.homeGames<6||p.awayGames<6)reasons.push('Fewer than six previous games for a team.');
  if(pointGap<3)reasons.push('Model-to-line gap below three points.');
  if(probabilityAdvantage<.03)reasons.push('Experimental probability gap below three percentage points.');
  if(estimatedEV<.04)reasons.push('Experimental expected return below 0.04 per unit risked.');
  return {eligible:!reasons.length,probability,pushProbability,lossProbability,estimatedEV,probabilityAdvantage,pointGap,sample:errors.length,reasons};
}
export function selectCollegeQuotes(event:UpcomingEvent,quotes:MarketQuote[],p:CollegeProjection,residuals:CollegeResiduals,now:number,
  approved:{spreads:boolean;totals:boolean}){
  const assessed=quotes.map(quote=>({quote,assessment:assessCollegeQuote(event,quote,p,residuals,now)}));
  const selected=[] as typeof assessed;
  for(const market of ['spreads','totals'] as const){
    if(!approved[market])continue;
    const eligible=assessed.filter(a=>a.quote.market===market&&a.assessment.eligible)
      .sort((a,b)=>b.assessment.estimatedEV-a.assessment.estimatedEV||a.quote.bookKey.localeCompare(b.quote.bookKey)
        ||a.quote.side.localeCompare(b.quote.side)||a.quote.line-b.quote.line);
    if(eligible.length)selected.push(eligible[0]);
  }
  return {selected,assessed};
}
