import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
import * as dotenv from 'dotenv';
import {PROP_PILOT as policy,pilotStatDiagnostic,pilotQuoteAssessment,pilotSelection} from './regularPropPilot';
import {NFL_FORECAST_VERSION} from '../services/nflForecast';
import {parseNflLogs,nflName,ESPN_NFL,NflPlayer} from '../services/nflResearch';
import {flattenNflQuotes} from '../services/nflMarketBoard';
import {gradeNflPaper,paperProfit,PAPER_RULES,NflPaperPick} from '../services/nflPaper';
dotenv.config();
const root=path.resolve(__dirname,'../../snapshots/backtests/2025-12-07-core-props');
const policyPath=path.resolve(__dirname,'../../research/REGULAR_SEASON_PROP_PILOT_POLICY.md');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const codeFiles=['runRegularPropPilot.ts','regularPropPilot.ts','../services/nflForecast.ts','../services/nflResearch.ts','../services/nflPaper.ts'];
const hashes=()=>Object.fromEntries(codeFiles.map(f=>[f,hash(fs.readFileSync(path.resolve(__dirname,f),'utf8'))]));
function save(name:string,data:any){fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2),{flag:'wx'});}
const read=(name:string)=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const exists=(name:string)=>fs.existsSync(path.join(root,name));
async function publicData(url:string) {
  const name=`source-${hash(url).slice(0,24)}.json`;
  if(exists(name)){const item=read(name);if(item.error)throw Error(item.error);return item.data;}
  const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
  if(!response.ok){save(name,{source:url,error:`Public source HTTP ${response.status}`});throw Error(`Public source HTTP ${response.status}`);}
  const data=await response.json();save(name,{source:url,fetchedAt:new Date().toISOString(),data});return data;
}
async function archive(endpoint:string,params:Record<string,string>,name:string,maxCost:number) {
  if(exists(name))return read(name);
  if(!process.env.ODDS_API_KEY)throw Error('Missing odds API key');
  // An attempt marker prevents silently repeating a possibly charged failed request.
  const marker=`${name}.attempt`;if(exists(marker))throw Error('Previous archive attempt needs inspection; no paid retry');
  save(marker,{endpoint,params,maxCost,at:new Date().toISOString()});
  const url=new URL(endpoint);for(const[k,v]of Object.entries(params))url.searchParams.set(k,v);url.searchParams.set('apiKey',process.env.ODDS_API_KEY);
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`Historical odds HTTP ${response.status}; no automatic retry`);
  const data=await response.json();const item={source:endpoint,params,cost:Number(response.headers.get('x-requests-last')),
    remaining:Number(response.headers.get('x-requests-remaining')),fetchedAt:new Date().toISOString(),data};
  save(name,item);if(!Number.isFinite(item.cost)||item.cost>maxCost)throw Error('Archive cost exceeded fixed per-call ceiling');return item;
}
function verifySnapshot(item:any){const age=Date.parse(policy.cutoff)-Date.parse(item.data?.timestamp??'');
  if(!Number.isFinite(age)||age<0||age>10*60_000)throw Error('Archive snapshot future or stale');}
async function batches<T,R>(items:T[],fn:(item:T)=>Promise<R>):Promise<R[]>{
  const out:R[]=[];for(let i=0;i<items.length;i+=6)out.push(...await Promise.all(items.slice(i,i+6).map(fn)));return out;
}
async function seasonRoster(team:any):Promise<NflPlayer[]>{
  const source=`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/teams/${team.id}/athletes?limit=200`;
  const list=await publicData(source);
  if(list.pageCount!==1||list.count!==list.items?.length)throw Error('Incomplete season roster');
  return batches(list.items,async(item:any)=>{
    const ref=String(item.$ref??'');const match=ref.match(/^https?:\/\/sports\.core\.api\.espn\.com\/v2\/sports\/football\/leagues\/nfl\/seasons\/2025\/athletes\/(\d+)\?/);
    if(!match)throw Error('Unverified season athlete reference');
    const url=`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/athletes/${match[1]}?lang=en&region=us`;
    const a=await publicData(url);if(String(a.id)!==match[1]||!a.displayName)throw Error('Athlete identity mismatch');
    return {id:String(a.id),name:a.displayName,teamId:String(team.id),team:team.displayName,position:a.position?.abbreviation??'Unknown',
      rosterStatus:'HISTORICAL_AVAILABILITY_UNVERIFIED',injuries:[],fetchedAt:new Date().toISOString(),source};
  });
}
async function prepare(){
  if(exists('locked-selections.json'))throw Error('Selections already locked; use grade');
  const spec=fs.readFileSync(policyPath,'utf8'),codeHashes=hashes();
  if(!exists('policy.json'))save('policy.json',{policy,text:spec,hash:hash(spec),codeHashes,createdAt:new Date().toISOString()});
  const frozen=read('policy.json');if(frozen.hash!==hash(spec)||JSON.stringify(frozen.codeHashes)!==JSON.stringify(codeHashes))throw Error('Frozen policy/code changed');
  const base=`https://api.the-odds-api.com/v4/historical/sports/${policy.sport}`;
  const schedule=await archive(`${base}/events`,{date:policy.cutoff},'archive-events.json',1);verifySnapshot(schedule);
  const games=schedule.data.data.filter((e:any)=>e.sport_key===policy.sport&&String(e.commence_time).startsWith(policy.date)
    &&Date.parse(e.commence_time)>=Date.parse(policy.cutoff)+30*60_000)
    .sort((a:any,b:any)=>Date.parse(a.commence_time)-Date.parse(b.commence_time)||a.id.localeCompare(b.id)).slice(0,2);
  if(games.length!==2||new Set(games.map((g:any)=>g.id)).size!==2)throw Error('Two unique predetermined games unavailable');
  const teamsData=await publicData(`${ESPN_NFL}/teams`),teams=teamsData.sports?.[0]?.leagues?.[0]?.teams?.map((t:any)=>t.team)??[];
  const decisions:any[]=[];let credits=schedule.cost,remaining=schedule.remaining;
  for(const rawGame of games){
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(rawGame.id))throw Error('Invalid archive event ID');
    const odds=await archive(`${base}/events/${rawGame.id}/odds`,{date:policy.cutoff,regions:'us',oddsFormat:'american',markets:policy.markets.join(',')},`archive-${rawGame.id}.json`,40);
    credits+=odds.cost;remaining=odds.remaining;if(credits>policy.maxCredits)throw Error('Pilot credit ceiling exceeded');verifySnapshot(odds);
    const raw=odds.data.data;
    if(raw.id!==rawGame.id||raw.sport_key!==policy.sport||raw.home_team!==rawGame.home_team||raw.away_team!==rawGame.away_team||raw.commence_time!==rawGame.commence_time)throw Error('Archive game identity mismatch');
    const event={id:raw.id,sportKey:raw.sport_key,homeTeam:raw.home_team,awayTeam:raw.away_team,commenceTime:raw.commence_time};
    const quotes=flattenNflQuotes(raw,policy.markets,Date.parse(policy.cutoff)).filter(q=>policy.books.includes(q.bookKey));
    const names=[...new Set(quotes.map(q=>nflName(q.participant)))].sort();if(names.length>60)throw Error('Player safety cap exceeded');
    console.log(JSON.stringify({stage:'HISTORY_INPUTS',game:`${event.awayTeam} @ ${event.homeTeam}`,players:names.length,quotes:quotes.length,cost:odds.cost}));
    const roster:NflPlayer[]=[];
    for(const name of [event.homeTeam,event.awayTeam]){
      const matches=teams.filter((t:any)=>nflName(t.displayName)===nflName(name));if(matches.length!==1)throw Error('Team identity ambiguous');
      roster.push(...await seasonRoster(matches[0]));
    }
    const pairs:any[]=[];
    for(const name of names){
      const matches=roster.filter(p=>nflName(p.name)===name),player=matches.length===1?matches[0]:null;
      const markets=policy.markets.filter(m=>quotes.some(q=>nflName(q.participant)===name&&q.market===m));
      let logs:any[]=[],error:string=null;
      if(player){try{logs=await batches([2023,2024,2025],async season=>{
        const source=`https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${player.id}/gamelog?season=${season}`;
        const payload=await publicData(source);
        if(String(payload.filters?.find((f:any)=>f.name==='season')?.value)!==String(season))throw Error('Log season unverified');
        return {season,source,payload};});}catch(e){error=(e as Error).message;}}
      for(const market of markets){
        const playerQuotes=quotes.filter(q=>nflName(q.participant)===name&&q.market===market);
        if(!player||error){pairs.push({name,market,player,quotes:playerQuotes,status:'SOURCE_UNAVAILABLE',reason:error??'Season roster identity missing/ambiguous',selection:null});continue;}
        const cutoff=Date.parse(policy.cutoff),observations=logs.flatMap(l=>parseNflLogs(l.payload,l.season,market,cutoff));
        const diagnostic=pilotStatDiagnostic(observations,player.teamId,market,cutoff);
        const assessments=playerQuotes.map(q=>pilotQuoteAssessment(diagnostic,q,player.name,market,cutoff));
        const selection=pilotSelection(assessments);
        pairs.push({name:player.name,market,player,sources:logs.map(l=>l.source),diagnostic,assessments,
          status:selection?'CONDITIONAL_RESEARCH_ONLY':'NO_CONDITIONAL_SELECTION',selection});
      }
    }
    decisions.push({event,archiveTimestamp:odds.data.timestamp,quotedPlayers:names.length,quoteCount:quotes.length,
      missingMarkets:policy.markets.filter(m=>!quotes.some(q=>q.market===m)),pairs});
  }
  const locked={policyHash:frozen.hash,codeHashes,modelVersion:NFL_FORECAST_VERSION,lockedAt:new Date().toISOString(),cutoff:policy.cutoff,
    fullPolicyStatus:'UNVERIFIED_ARCHIVED_AVAILABILITY',credits,remaining,decisions};
  save('locked-selections.json',locked);
  console.log(JSON.stringify({stage:'LOCKED_BEFORE_GRADING',credits,remaining,games:decisions.map(d=>({game:d.event,pairs:d.pairs.length,
    selected:d.pairs.filter((p:any)=>p.selection).map((p:any)=>({name:p.name,market:p.market,quote:p.selection.quote,estimatedEV:p.selection.estimatedEV})),
    sourceUnavailable:d.pairs.filter((p:any)=>p.status==='SOURCE_UNAVAILABLE').map((p:any)=>({name:p.name,market:p.market,reason:p.reason}))}))},null,2));
}
async function grade(){
  const text=fs.readFileSync(path.join(root,'locked-selections.json'),'utf8'),locked=JSON.parse(text);
  if(locked.policyHash!==hash(fs.readFileSync(policyPath,'utf8'))||JSON.stringify(locked.codeHashes)!==JSON.stringify(hashes()))throw Error('Frozen policy/logic changed');
  if(exists('graded-report.json'))throw Error('Report already graded; do not overwrite');
  const scoreboard=await publicData(`${ESPN_NFL}/scoreboard?dates=20251207&limit=100`);const rows:any[]=[];
  for(const d of locked.decisions){
    const matches=(scoreboard.events??[]).filter((e:any)=>e.season?.year===2025&&e.season?.type===2
      &&Math.abs(Date.parse(e.date)-Date.parse(d.event.commenceTime))<=2*3600_000
      &&nflName(e.competitions?.[0]?.competitors?.find((c:any)=>c.homeAway==='home')?.team?.displayName)===nflName(d.event.homeTeam)
      &&nflName(e.competitions?.[0]?.competitors?.find((c:any)=>c.homeAway==='away')?.team?.displayName)===nflName(d.event.awayTeam));
    let summary:any=null,source:string=null,error:string=null;
    if(matches.length===1&&/^\d+$/.test(matches[0].id)){
      source=`${ESPN_NFL}/summary?event=${matches[0].id}`;try{summary=await publicData(source);}catch(e){error=(e as Error).message;}
    }else error='Unique final ESPN game not found';
    for(const p of d.pairs.filter((p:any)=>p.selection)){
      const pick:NflPaperPick={id:hash(`${d.event.id}:${p.player.id}:${p.market}`),event:d.event,espnEventId:matches[0]?.id??'',player:p.player,
        quote:p.selection.quote,season:2025,version:locked.modelVersion,rules:PAPER_RULES,savedAt:locked.lockedAt,result:'PENDING',note:'Conditional historical research only; never a production pick'};
      const result=error?{result:'REVIEW' as const,note:error}:gradeNflPaper(pick,summary);
      rows.push({game:`${d.event.awayTeam} @ ${d.event.homeTeam}`,eventId:d.event.id,espnEventId:pick.espnEventId,name:p.name,market:p.market,
        quote:p.selection.quote,projection:p.diagnostic.point.projection,estimatedEV:p.selection.estimatedEV,source,...result,profitUnits:paperProfit(result.result,pick.quote.price)});
    }
  }
  function record(items:any[]){const count=(r:string)=>items.filter(i=>i.result===r).length,wins=count('WIN'),losses=count('LOSS'),pushes=count('PUSH'),profitUnits=items.reduce((s,i)=>s+i.profitUnits,0);
    return {selected:items.length,wins,losses,pushes,review:count('REVIEW'),pending:count('PENDING'),profitUnits,
      winRate:wins+losses?wins/(wins+losses):null,roi:wins+losses+pushes?profitUnits/(wins+losses+pushes):null};}
  const report={generatedAt:new Date().toISOString(),lockedSelectionsHash:hash(text),fullPolicyStatus:locked.fullPolicyStatus,games:locked.decisions.length,
    credits:locked.credits,remaining:locked.remaining,conditionalResearch:record(rows),byMarket:Object.fromEntries(policy.markets.map(m=>[m,record(rows.filter(r=>r.market===m))])),
    coverage:locked.decisions.map((d:any)=>({event:d.event,quoteCount:d.quoteCount,quotedPlayers:d.quotedPlayers,pairs:d.pairs.length,
      sourceUnavailable:d.pairs.filter((p:any)=>p.status==='SOURCE_UNAVAILABLE').length,selected:d.pairs.filter((p:any)=>p.selection).length,missingMarkets:d.missingMarkets})),rows};
  save('graded-report.json',report);console.log(JSON.stringify(report,null,2));
}
const mode=process.argv[2];
(mode==='prepare'?prepare():mode==='grade'?grade():Promise.reject(Error('Use prepare or grade'))).catch(e=>{console.error((e as Error).message);process.exitCode=1;});
