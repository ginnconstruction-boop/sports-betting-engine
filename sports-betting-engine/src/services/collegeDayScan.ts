import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getUpcomingEvents,getCollegeSlateOdds,UpcomingEvent } from '../api/oddsApiClient';
import { RawEvent,QuotaUsage } from '../types/odds';
import { NCAAF } from '../config/productionFocus';
import { getUserBookKeys } from '../config/bookmakers';
import { flattenNflQuotes,MarketBoardError } from './nflMarketBoard';
import { exactMarketBaseline } from './footballMarketBaseline';
import { ESPN_COLLEGE,matchCollegeEvent } from './collegeResearch';
import { fetchNflJson } from './nflResearch';
import type { CollegePredictions } from './collegePredictions';

export const COLLEGE_SCAN_VERSION='college-day-model-paper-v1';
export const COLLEGE_TIMEZONE='America/Chicago';
export function collegeDate(ms:number) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:COLLEGE_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
}
export function validateCollegeDate(date:string,now:number) {
  const parsed=Date.parse(`${date}T12:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==date
    ||date<collegeDate(now)||date>collegeDate(now+13*86400_000))
    throw new MarketBoardError('Choose today or one of the next 13 days (Central time). Past games require a separate historical test.');
}
type Dependencies={
  upcoming:()=>Promise<UpcomingEvent[]>;
  odds:()=>Promise<{events:RawEvent[];quota:QuotaUsage;creditsUsed:number|null}>;
  scoreboard:(date:string)=>Promise<any>;
  archive:(record:any)=>void;
  now:()=>number;
};
const defaultDeps:Dependencies={
  upcoming:()=>getUpcomingEvents(NCAAF),odds:getCollegeSlateOdds,now:Date.now,
  scoreboard:date=>{
    // Include next UTC date, then filter precisely to the Central calendar day.
    const next=new Date(Date.parse(`${date}T12:00:00Z`)+86400_000).toISOString().slice(0,10);
    return fetchNflJson(`${ESPN_COLLEGE}/scoreboard?dates=${date.replace(/-/g,'')}-${next.replace(/-/g,'')}&groups=80&limit=500`);
  },
  archive:record=>{
    const root=path.join(process.env.SNAPSHOT_DIR??'./snapshots','college_day_scans');fs.mkdirSync(root,{recursive:true});
    fs.writeFileSync(path.join(root,`${record.date}_${record.id}.json`),JSON.stringify(record,null,2),{flag:'wx'});
  },
};
/** Full calendar-day discovery, independent experimental paper model and separately
 * labeled exact-line price research. Never turn a market reference into a forecast.
 * One global bulk cache covers ALL dates; source failures are not empty slates. */
export class CollegeDayScan {
  private busy=false;
  private cache:{at:number;data:Awaited<ReturnType<Dependencies['odds']>>}|null=null;
  constructor(private deps:Dependencies=defaultDeps,private model?:Pick<CollegePredictions,'scan'>){}
  async scan(date:string,trackPaper=false) {
    validateCollegeDate(date,this.deps.now());
    if(this.busy)throw new MarketBoardError('A college full-day scan is already running. Please wait.',409);
    this.busy=true;
    try{return await this.run(date,trackPaper);}finally{this.busy=false;}
  }
  private async run(date:string,trackPaper:boolean) {
    const warnings:string[]=[];
    const [providerResult,scheduleResult]=await Promise.allSettled([this.deps.upcoming(),this.deps.scoreboard(date)]);
    const providerOk=providerResult.status==='fulfilled'&&Array.isArray(providerResult.value);
    const scheduleOk=scheduleResult.status==='fulfilled'&&Array.isArray(scheduleResult.value?.events);
    if(!providerOk)warnings.push('Odds-provider schedule unavailable; coverage could not be confirmed.');
    if(!scheduleOk)warnings.push('Independent college schedule unavailable; missing-provider games could not be checked.');
    const provider=providerOk?providerResult.value.filter(e=>e.sportKey===NCAAF&&Number.isFinite(Date.parse(e.commenceTime))):[];
    const nextDate=provider.map(e=>collegeDate(Date.parse(e.commenceTime))).filter(d=>d>date).sort()[0]??null;
    const onDate=provider.filter(e=>collegeDate(Date.parse(e.commenceTime))===date);
    const ids=onDate.map(e=>e.id),duplicates=new Set(ids.filter((id,i)=>ids.indexOf(id)!==i));
    const games=onDate.filter((e,i)=>ids.indexOf(e.id)===i).sort((a,b)=>Date.parse(a.commenceTime)-Date.parse(b.commenceTime)||a.id.localeCompare(b.id));
    const schedule=scheduleOk?scheduleResult.value.events.filter((e:any)=>Number.isFinite(Date.parse(e.date))&&collegeDate(Date.parse(e.date))===date):[];
    const mapped=new Set<string>();
    const rows=games.map(event=>{
      let identity:any=null,reason='';
      try{identity=matchCollegeEvent(event,{events:schedule},`${ESPN_COLLEGE}/scoreboard`,new Date(this.deps.now()).toISOString());mapped.add(identity.espnEventId);}
      catch(e){reason=e instanceof MarketBoardError?e.message:'Exact college game/team identity not verified against the independent schedule.';}
      const started=Date.parse(event.commenceTime)<=this.deps.now();
      return {event,identity,status:duplicates.has(event.id)?'ambiguous_provider_game':started?'started_or_complete':identity?'awaiting_odds':'identity_unverified',
        reason:duplicates.has(event.id)?'Duplicate provider event ID.':started?'Kickoff has passed; no new pregame selection.':reason,
        quoteCount:0,freshQuotes:0,marketsChecked:0,comparableQuotes:0,researchCandidates:0};
    });
    const canonicalCounts=new Map<string,number>();for(const r of rows)if(r.identity)canonicalCounts.set(r.identity.espnEventId,(canonicalCounts.get(r.identity.espnEventId)??0)+1);
    for(const r of rows)if(r.identity&&canonicalCounts.get(r.identity.espnEventId)>1){r.status='ambiguous_provider_game';r.reason='Multiple provider IDs map to one canonical game. Manual review required.';}
    const unlisted=schedule.filter((e:any)=>!mapped.has(String(e.id))).map((e:any)=>({espnEventId:String(e.id),name:String(e.name??'College game'),
      commenceTime:e.date,reason:'Not matched to an odds-provider game for this date; no price or pick assumed.'}));
    const eligible=rows.filter(r=>r.status==='awaiting_odds');
    let oddsStatus='not_requested',cached=false,creditsUsed:number|null=0,remainingCredits:number|null=null,oddsFetchedAt:string|null=null;
    let raw:RawEvent[]=[];
    if(eligible.length){
      try{
        cached=!!this.cache&&this.deps.now()-this.cache.at<5*60_000;
        if(!cached)this.cache={at:this.deps.now(),data:await this.deps.odds()};
        raw=this.cache.data.events;creditsUsed=cached?0:this.cache.data.creditsUsed;
        remainingCredits=this.cache.data.quota.remainingRequests;oddsFetchedAt=new Date(this.cache.at).toISOString();oddsStatus='available';
      }catch{oddsStatus='unavailable';creditsUsed=null;warnings.push('Bulk odds request failed or was budget-blocked. No automatic retry; any charged credits are unknown.');}
    }
    const shortlist:any[]=[];
    for(const row of eligible){
      if(Date.parse(row.event.commenceTime)<=this.deps.now()){row.status='started_or_complete';row.reason='Kickoff passed while loading the slate.';continue;}
      if(oddsStatus!=='available'){row.status='odds_unavailable';row.reason='Odds feed failed or credit budget blocked it.';continue;}
      const matches=raw.filter(e=>e.id===row.event.id),e=matches[0];
      if(matches.length!==1||e.sport_key!==NCAAF||e.home_team!==row.event.homeTeam||e.away_team!==row.event.awayTeam
        ||Date.parse(e.commence_time)!==Date.parse(row.event.commenceTime)){
        row.status=matches.length?'odds_identity_mismatch':'no_posted_odds';row.reason=matches.length?'Odds game identity/kickoff changed. Refresh and verify.':'No event prices returned in the bulk feed.';continue;
      }
      const quotes=flattenNflQuotes(e,['spreads','totals'],this.deps.now()).filter(q=>!q.participant&&Number.isFinite(q.line)
        &&(q.market==='totals'?['Over','Under'].includes(q.side):[e.home_team,e.away_team].includes(q.side)));
      const fresh=quotes.filter(q=>!q.stale&&Date.parse(q.updatedAt)<=this.deps.now());
      row.quoteCount=quotes.length;row.freshQuotes=fresh.length;row.marketsChecked=new Set(fresh.map(q=>q.market)).size;
      if(!fresh.length){row.status=quotes.length?'stale_odds':'no_posted_odds';row.reason=quotes.length?'No fresh, timestamped quotes.':'No supported spreads or totals posted.';continue;}
      const own=fresh.filter(q=>getUserBookKeys().includes(q.bookKey));
      if(!own.length){row.status='no_configured_book';row.reason='No fresh quotes at your configured sportsbooks.';continue;}
      const comparisons=own.map(q=>({quote:q,baseline:exactMarketBaseline(row.event,q,quotes,this.deps.now())}));
      row.comparableQuotes=comparisons.filter(c=>c.baseline.conditionalPriceAdvantage!==null).length;
      for(const market of ['spreads','totals']){
        const candidates=comparisons.filter(c=>c.quote.market===market&&c.baseline.conditionalPriceAdvantage!==null&&c.baseline.conditionalPriceAdvantage>=.02)
          .sort((a,b)=>b.baseline.conditionalPriceAdvantage-a.baseline.conditionalPriceAdvantage
            ||a.quote.bookKey.localeCompare(b.quote.bookKey)||a.quote.side.localeCompare(b.quote.side)||a.quote.line-b.quote.line);
        if(candidates.length){shortlist.push({event:row.event,...candidates[0],label:'PRICE RESEARCH ONLY — not a betting recommendation'});row.researchCandidates++;}
      }
      row.status=row.researchCandidates?'price_research_found':row.comparableQuotes?'no_price_candidate':'insufficient_comparison';
      row.reason=row.researchCandidates?'Exact-line price comparison met the research threshold. This is separate from the college prediction model.'
        :row.comparableQuotes?'No exact-line price comparison cleared the 2-percentage-point research threshold.'
        :'Need three other fresh two-sided books at the exact same line. No pooled-line substitute.';
    }
    const counts:Record<string,number>={};for(const row of rows)counts[row.status]=(counts[row.status]??0)+1;
    let modelResult:any={recommendations:[],projections:[],recommendationStatus:'blocked_model_validation'};
    if(this.model){try{modelResult=await this.model.scan(rows,raw,trackPaper);warnings.push(...modelResult.warnings);}
      catch{warnings.push('College prediction service failed its integrity or availability checks. No model recommendation was assumed.');}}
    const report={id:randomUUID(),version:COLLEGE_SCAN_VERSION,date,timezone:COLLEGE_TIMEZONE,scannedAt:new Date(this.deps.now()).toISOString(),
      coverage:providerOk&&scheduleOk?'checked_against_two_feeds':'incomplete',providerScheduleAvailable:providerOk,independentScheduleAvailable:scheduleOk,
      providerGames:games.length,independentScheduledGames:scheduleOk?schedule.length:null,unmatchedScheduledGames:unlisted.length,
      gamesWithFreshOdds:rows.filter(r=>r.freshQuotes>0).length,counts,nextDate,oddsStatus,oddsFetchedAt,cached,creditsUsed,remainingCredits,
      ...modelResult,
      recommendationNote:this.model?'Qualified PAPER BET/LEAN and unqualified PAPER MONITOR records are separate. Missing context or extreme disagreement can mean NO RELIABLE EDGE. Totals remain research-only because their holdout test failed. No real-money or stake recommendation.'
        :'No validated college prediction model is enabled. Price research is not a win forecast, recommendation, proven edge, or instruction to bet.',
      shortlist:shortlist.sort((a,b)=>b.baseline.conditionalPriceAdvantage-a.baseline.conditionalPriceAdvantage||a.event.id.localeCompare(b.event.id)),rows,unlisted,warnings,
      evidenceSaved:false,
      note:'All provider-listed games for the selected Central calendar day were checked, with independent schedule gaps disclosed. Started games are excluded from new pregame selections. Paper selections are saved only when paper tracking is explicitly enabled for this scan. No bets, automatic grading or background odds requests. College FCS-only/other provider omissions may not be covered by either feed.'};
    try{
      this.deps.archive({...report,evidenceSaved:true,sources:{schedule:scheduleOk?scheduleResult.value:null,provider:providerOk?providerResult.value:null,
        odds:raw.filter(e=>games.some(g=>g.id===e.id))}});report.evidenceSaved=true;
    }catch{warnings.push('Scan evidence could not be saved. Do not treat this as a replayable historical record.');}
    return report;
  }
}
