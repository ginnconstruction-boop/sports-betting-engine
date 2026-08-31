import { eligibleNflHistory, evaluateNflWalkForward, nflPointForecast, nflResidualDistribution, NFL_FORECAST_POLICY } from '../services/nflForecast';
import { NflObservation, nflName, NFL_CORE_STATS } from '../services/nflResearch';
import { MarketQuote } from '../services/nflMarketBoard';

export const PROP_PILOT = Object.freeze({date:'2025-12-07',cutoff:'2025-12-07T16:00:00Z',sport:'americanfootball_nfl',
  markets:['player_pass_yds','player_rush_yds','player_reception_yds','player_receptions'],books:['fanduel','betmgm'],maxCredits:81});

// Separate diagnostic, NOT a production forecast. Missing archived availability
// remains unverified; this module neither fabricates that evidence nor issues picks.
export function pilotStatDiagnostic(observations:NflObservation[],teamId:string,market:string,cutoff:number) {
  if(!NFL_CORE_STATS[market])throw Error('Unsupported pilot market');
  const {rows,excluded}=eligibleNflHistory(observations,teamId,cutoff,market);
  const point=nflPointForecast(rows),evaluation=evaluateNflWalkForward(rows),errors=evaluation.tests.slice(-20).map(t=>t.error);
  const reasons:string[]=[];
  if(!point)reasons.push('Insufficient complete workload training');
  if(errors.length<NFL_FORECAST_POLICY.minErrors)reasons.push('Insufficient rolling errors');
  if(point&&(point.workloadRatio<0.65||point.workloadRatio>1.35))reasons.push('Material workload change');
  if(!rows.length||cutoff-Date.parse(rows[rows.length-1].date)>NFL_FORECAST_POLICY.maxAgeDays*86400_000)reasons.push('Recent same-team history unavailable');
  if(evaluation.games>=NFL_FORECAST_POLICY.minErrors&&evaluation.mae>=evaluation.baselineMae)reasons.push('Model did not beat baseline');
  return {rows,excluded,point,evaluation,errors,reasons,fullPolicyStatus:'UNVERIFIED_ARCHIVED_AVAILABILITY' as const};
}
export function pilotQuoteAssessment(d:ReturnType<typeof pilotStatDiagnostic>,q:MarketQuote,name:string,market:string,cutoff:number) {
  const reasons=[...d.reasons],age=cutoff-Date.parse(q.updatedAt??'');
  if(q.market!==market||nflName(q.participant)!==nflName(name))reasons.push('Quote identity mismatch');
  if(!PROP_PILOT.books.includes(q.bookKey))reasons.push('Book outside fixed scope');
  if(!Number.isFinite(age)||age<0||age>15*60_000)reasons.push('Quote timestamp missing, future or stale');
  if(q.line===null||!Number.isFinite(q.line)||!Number.isFinite(q.price)||Math.abs(q.price)<100||!['Over','Under'].includes(q.side))
    return {quote:q,reasons:[...reasons,'Invalid quote'],eligible:false,estimatedEV:null,probability:null,pushProbability:null};
  if(!d.point||d.errors.length<NFL_FORECAST_POLICY.minErrors)
    return {quote:q,reasons,eligible:false,estimatedEV:null,probability:null,pushProbability:null};
  const dist=nflResidualDistribution(d.point.projection,d.errors,market,q.line);
  const probability=q.side==='Over'?dist.over:dist.under,loss=q.side==='Over'?dist.under:dist.over;
  const estimatedEV=probability*(q.price>0?q.price/100:100/Math.abs(q.price))-loss;
  if(estimatedEV<NFL_FORECAST_POLICY.minEstimatedEV)reasons.push('Estimated EV below 5%');
  if(probability/(1-dist.push)<NFL_FORECAST_POLICY.minConditionalProbability)reasons.push('Conditional probability below 55%');
  return {quote:q,reasons,estimatedEV,probability,pushProbability:dist.push,eligible:reasons.length===0};
}
export function pilotSelection(assessments:ReturnType<typeof pilotQuoteAssessment>[]) {
  return assessments.filter(a=>a.eligible).sort((a,b)=>b.estimatedEV-a.estimatedEV
    || a.quote.bookKey.localeCompare(b.quote.bookKey)||a.quote.side.localeCompare(b.quote.side)||a.quote.line-b.quote.line)[0]??null;
}
