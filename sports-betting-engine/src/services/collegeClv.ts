import {createHash} from 'crypto';
import type {NflPaperPick} from './nflPaper';
import type {MarketQuote} from './nflMarketBoard';
import {median} from './collegeSafety';
export interface CollegeLineObservation {id:string;pickId:string;observedAt:string;bookKey:string;side:string;market:'spreads';
  line:number;price:number;updatedAt:string;nearClose:boolean;method:'observed_pregame_not_verified_final_close';evidenceHash?:string;}
export function collegeLineObservations(pick:NflPaperPick,quotes:MarketQuote[],now:number):CollegeLineObservation[]{
  const kickoff=Date.parse(pick.event.commenceTime);
  if(pick.event.sportKey!=='americanfootball_ncaaf'||pick.quote.market!=='spreads'||!Number.isFinite(kickoff)||now>=kickoff)return[];
  return quotes.filter(q=>q.market==='spreads'&&q.side===pick.quote.side&&q.bookKey===pick.quote.bookKey&&!q.stale&&!q.participant
    &&Number.isFinite(q.line)&&Number.isFinite(q.price)&&Math.abs(q.price)>=100&&Math.abs(q.line)<=85
    &&Date.parse(q.updatedAt)<=now&&Date.parse(q.updatedAt)>=Date.parse(pick.quote.updatedAt)&&now-Date.parse(q.updatedAt)<=15*60_000)
    .map(q=>({id:createHash('sha256').update(JSON.stringify([pick.id,q.bookKey,q.side,q.line,q.price,q.updatedAt])).digest('hex'),pickId:pick.id,
      observedAt:new Date(now).toISOString(),bookKey:q.bookKey,side:q.side,market:'spreads' as const,line:q.line,price:q.price,updatedAt:q.updatedAt,
      nearClose:kickoff-now<=5*60_000&&kickoff-Date.parse(q.updatedAt)<=5*60_000,method:'observed_pregame_not_verified_final_close' as const}));
}
const implied=(price:number)=>price>0?100/(price+100):Math.abs(price)/(Math.abs(price)+100);
export function collegePickClv(pick:NflPaperPick,now=Date.now()){
  const empty={betLine:pick.quote.line,closingLine:null,lineClv:null,priceClv:null,priceClvProbabilityPoints:null,method:'unavailable',observations:0};
  if(pick.quote.market!=='spreads'||Date.parse(pick.event.commenceTime)>now)return empty;
  const observations=(pick.collegeLineObservations??[]).filter(o=>o.nearClose&&o.pickId===pick.id&&o.bookKey===pick.quote.bookKey
    &&o.side===pick.quote.side&&Date.parse(o.observedAt)<Date.parse(pick.event.commenceTime)&&Date.parse(o.updatedAt)<=Date.parse(o.observedAt)
    &&Date.parse(pick.event.commenceTime)-Date.parse(o.observedAt)<=5*60_000);
  if(!observations.length)return empty;
  const sorted=[...observations].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||Date.parse(b.observedAt)-Date.parse(a.observedAt));
  const latest=sorted[0],sameTime=sorted.filter(o=>o.updatedAt===latest.updatedAt);
  // Multiple alternative lines at the same last timestamp do not identify a main close.
  const closingLine=new Set(sameTime.map(o=>o.line)).size===1?latest.line:null;
  const exact=sameTime.filter(o=>o.line===pick.quote.line),price=exact.length===1?exact[0].price:null;
  return {betLine:pick.quote.line,closingLine,lineClv:closingLine===null?null:pick.quote.line-closingLine,
    priceClv:price===null?null:(pick.quote.price>0?1+pick.quote.price/100:1+100/Math.abs(pick.quote.price))-(price>0?1+price/100:1+100/Math.abs(price)),
    priceClvProbabilityPoints:price===null?null:100*(implied(price)-implied(pick.quote.price)),method:'last_five_minute_observation_proxy_not_verified_close',
    observations:observations.length,updatedAt:latest.updatedAt,observedAt:latest.observedAt};
}
export function collegeClvReport(picks:NflPaperPick[],now=Date.now()){
  const rows=picks.filter(p=>p.event.sportKey==='americanfootball_ncaaf'&&p.quote.market==='spreads').map(p=>({pickId:p.id,...collegePickClv(p,now)}));
  const lines=rows.flatMap(r=>r.lineClv===null?[]:[r.lineClv]),prices=rows.flatMap(r=>r.priceClvProbabilityPoints===null?[]:[r.priceClvProbabilityPoints]);
  return {rows,tracked:rows.length,lineSamples:lines.length,priceSamples:prices.length,verifiedFinalCloses:0,
    averageSpreadClv:lines.length?lines.reduce((a,b)=>a+b,0)/lines.length:null,medianSpreadClv:median(lines),
    positiveClvRate:lines.length?lines.filter(v=>v>0).length/lines.length:null,averagePriceClv:prices.length?prices.reduce((a,b)=>a+b,0)/prices.length:null,
    note:'CLV proxies are separate from W/L: same-book final-five-minute observations, not verified final closing lines. Price CLV is implied-probability percentage points at the exact original spread. No captured close means unavailable, never zero. No automatic closing-time odds purchase.'};
}
