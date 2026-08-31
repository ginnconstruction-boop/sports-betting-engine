// Isolated retrospective research utilities. Never imported by production routes.
export const PRESEASON_PRICE_POLICY = Object.freeze({
  version:'preseason-consensus-price-experiment-v1', date:'2026-08-28', cutoff:'2026-08-28T21:00:00Z',
  sport:'americanfootball_nfl_preseason', targetBooks:['fanduel','betmgm'],
  referenceBooks:['draftkings','williamhill_us','betrivers','bovada','betonlineag'],
  markets:['h2h','spreads','totals'], minReferences:3, minConditionalReturn:0.05,
  maxQuoteAgeMinutes:15, maxSnapshotAgeMinutes:10, maxKickoffDifferenceMinutes:15,
});
export type AuditGame={id:string;name:string;date:string;home:string;away:string;homeId:string;awayId:string;seasonType:number};
export type AuditQuote={market:string;side:string;line:number|null;price:number;book:string;updatedAt:string;conditionalProbability:number};
const implied=(price:number)=>price>0?100/(price+100):Math.abs(price)/(Math.abs(price)+100);
export const auditPayout=(price:number)=>price>0?price/100:100/Math.abs(price);
const median=(xs:number[])=>{const s=[...xs].sort((a,b)=>a-b);return (s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2;};
export function eventMatches(event:any,game:AuditGame){
  return event?.sport_key===PRESEASON_PRICE_POLICY.sport && event.home_team===game.home && event.away_team===game.away
    && Number.isFinite(Date.parse(event.commence_time)) && Date.parse(event.commence_time)>Date.parse(PRESEASON_PRICE_POLICY.cutoff)
    && Math.abs(Date.parse(event.commence_time)-Date.parse(game.date))<=PRESEASON_PRICE_POLICY.maxKickoffDifferenceMinutes*60_000;
}
export function freshPairs(event:any,bookKey:string,market:string):AuditQuote[]{
  const books=(event?.bookmakers??[]).filter((b:any)=>b.key===bookKey);
  if(books.length!==1)return [];
  const markets=(books[0].markets??[]).filter((m:any)=>m.key===market);
  if(markets.length!==1)return [];
  const m=markets[0],timestamp=m.last_update??books[0].last_update,age=Date.parse(PRESEASON_PRICE_POLICY.cutoff)-Date.parse(timestamp??'');
  if(!Number.isFinite(age)||age<0||age>PRESEASON_PRICE_POLICY.maxQuoteAgeMinutes*60_000)return [];
  const rows=m.outcomes??[];
  if(rows.length!==2||new Set(rows.map((q:any)=>q.name)).size!==2)return [];
  const sides=market==='totals'?['Over','Under']:[event.home_team,event.away_team];
  if(!rows.every((q:any)=>sides.includes(q.name)&&Number.isFinite(q.price)&&Math.abs(q.price)>=100))return [];
  if(market!=='h2h'&&rows.some((q:any)=>!Number.isFinite(q.point)||!Number.isInteger(q.point*2)))return [];
  if(market==='spreads'&&rows[0].point!==-rows[1].point)return [];
  if(market==='totals'&&(rows[0].point!==rows[1].point||rows[0].point<0))return [];
  const sum=rows.reduce((a:number,q:any)=>a+implied(q.price),0);
  return rows.map((q:any)=>({market,side:q.name,line:market==='h2h'?null:q.point,price:q.price,book:bookKey,
    updatedAt:timestamp,conditionalProbability:implied(q.price)/sum}));
}
export function assessPriceGame(game:AuditGame,events:any[]){
  const matches=events.filter(e=>eventMatches(e,game));
  const modelStatus='UNSUPPORTED_PRESEASON';
  if(matches.length!==1)return {game,modelStatus,status:'UNMATCHED_ODDS_EVENT',candidates:[],selection:null,benchmark:null};
  const event=matches[0],candidates:any[]=[];
  for(const market of PRESEASON_PRICE_POLICY.markets)for(const book of PRESEASON_PRICE_POLICY.targetBooks){
    for(const quote of freshPairs(event,book,market)){
      const references=PRESEASON_PRICE_POLICY.referenceBooks.flatMap(key=>freshPairs(event,key,market)
        .filter(q=>q.side===quote.side&&q.line===quote.line));
      const enough=references.length>=PRESEASON_PRICE_POLICY.minReferences;
      const probability=enough?median(references.map(q=>q.conditionalProbability)):null;
      const conditionalReturn=enough?probability*auditPayout(quote.price)-(1-probability):null;
      candidates.push({quote,references,probability,conditionalReturn,eligible:enough&&conditionalReturn>=PRESEASON_PRICE_POLICY.minConditionalReturn,
        reason:!enough?'Fewer than three fresh exact-line reference books':conditionalReturn<PRESEASON_PRICE_POLICY.minConditionalReturn?'Below fixed 5% conditional-return threshold':'Eligible exploratory price'});
    }
  }
  const eligible=candidates.filter(c=>c.eligible).sort((a,b)=>b.conditionalReturn-a.conditionalReturn
    ||a.quote.market.localeCompare(b.quote.market)||a.quote.side.localeCompare(b.quote.side)||a.quote.book.localeCompare(b.quote.book));
  let benchmark:AuditQuote=null;
  for(const book of PRESEASON_PRICE_POLICY.targetBooks){
    const pair=freshPairs(event,book,'h2h');
    if(pair.length){const ordered=pair.sort((a,b)=>b.conditionalProbability-a.conditionalProbability);
      if(ordered[0].conditionalProbability!==ordered[1].conditionalProbability)benchmark=ordered[0];break;}
  }
  return {game,oddsEventId:event.id,modelStatus,status:eligible.length?'EXPERIMENTAL_SELECTION':candidates.length?'NO_QUALIFYING_PRICE':'NO_FRESH_TARGET_QUOTES',candidates,selection:eligible[0]??null,benchmark};
}
export function verifyPreseasonFinal(game:AuditGame,data:any,scoreboard:any){
  const c=data?.header?.competitions?.[0],sb=scoreboard?.competitions?.[0];
  const score=(cs:any[],orientation:string)=>{
    const matches=(cs??[]).filter(t=>t.homeAway===orientation);if(matches.length!==1)return null;
    const team=matches[0],expected=orientation==='home'?game.home:game.away,expectedId=orientation==='home'?game.homeId:game.awayId;
    const n=Number(team.score);return team.team?.displayName===expected&&String(team.team?.id)===expectedId&&team.score!=null&&String(team.score).trim()!==''&&Number.isInteger(n)&&n>=0?n:null;
  };
  if(data?.header?.league?.slug!=='nfl'||Number(data.header?.season?.year)!==2026||Number(data.header?.season?.type)!==1
    ||String(c?.id)!==game.id||String(scoreboard?.id)!==game.id||Number(scoreboard?.season?.type)!==1
    ||Number(scoreboard?.season?.year)!==2026||Math.abs(Date.parse(c?.date)-Date.parse(game.date))>15*60_000
    ||!Number.isFinite(Date.parse(c?.date))||c?.status?.type?.completed!==true||c.status.type.state!=='post'
    ||!['STATUS_FINAL','STATUS_FINAL_OVERTIME'].includes(c.status.type.name)||sb?.status?.type?.completed!==true)
    return {verified:false,reason:'Game identity/season/final status not verified',home:null,away:null};
  const home=score(c.competitors,'home'),away=score(c.competitors,'away');
  if(home===null||away===null||home!==score(sb?.competitors,'home')||away!==score(sb?.competitors,'away'))
    return {verified:false,reason:'Missing scores or disagreement between ESPN summary and scoreboard',home:null,away:null};
  return {verified:true,reason:'Matching ESPN final summary and scoreboard (same provider, not independent sources)',home,away};
}
export function gradeAuditQuote(game:AuditGame,quote:AuditQuote,final:ReturnType<typeof verifyPreseasonFinal>){
  if(!final.verified)return {result:'REVIEW',profit:null};
  let difference:number;
  if(quote.market==='totals')difference=(final.home+final.away-quote.line)*(quote.side==='Over'?1:-1);
  else difference=(quote.side===game.home?final.home-final.away:final.away-final.home)+(quote.market==='spreads'?quote.line:0);
  const result=difference===0?'PUSH':difference>0?'WIN':'LOSS';
  return {result,profit:result==='WIN'?auditPayout(quote.price):result==='LOSS'?-1:0};
}
export function auditRecord(rows:Array<{result:string;profit:number}>){
  const wins=rows.filter(r=>r.result==='WIN').length,losses=rows.filter(r=>r.result==='LOSS').length,pushes=rows.filter(r=>r.result==='PUSH').length;
  const settled=wins+losses+pushes,profit=rows.filter(r=>r.profit!=null).reduce((s,r)=>s+r.profit,0);
  return {wins,losses,pushes,review:rows.length-settled,profitUnits:profit,winRate:wins+losses?wins/(wins+losses):null,settledRoi:settled?profit/settled:null};
}
