// One date, separate research directory, no production imports or ledger writes.
import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
import * as dotenv from 'dotenv';
import {PRESEASON_PRICE_POLICY as policy,AuditGame,assessPriceGame,verifyPreseasonFinal,gradeAuditQuote,auditRecord} from './preseasonPriceTest';
dotenv.config();
const root=path.resolve(__dirname,'../../snapshots/backtests/2026-08-28-preseason');
const scoreboardUrl='https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260828-20260829&limit=100';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function save(name:string,data:any){fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2),{flag:'wx'});}
function read(name:string){return JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));}
async function json(url:string):Promise<any>{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`Public data HTTP ${r.status}`);return r.json();}
function gamesFrom(data:any):AuditGame[]{
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'});
  return (data.events??[]).filter((e:any)=>day.format(new Date(e.date))===policy.date).map((e:any)=>{
    const teams=e.competitions?.[0]?.competitors??[],home=teams.find((t:any)=>t.homeAway==='home'),away=teams.find((t:any)=>t.homeAway==='away');
    if(e.season?.year!==2026||e.season?.type!==1||!home?.team?.id||!away?.team?.id)throw Error('Invalid preseason schedule identity');
    return {id:String(e.id),name:e.name,date:e.date,home:home.team.displayName,away:away.team.displayName,homeId:String(home.team.id),awayId:String(away.team.id),seasonType:1};
  });
}
async function prepare(){
  if(fs.existsSync(path.join(root,'locked-selections.json')))throw Error('Selections already locked; use grade. No odds re-fetch.');
  const games=gamesFrom(await json(scoreboardUrl));
  if(games.length!==10||new Set(games.map(g=>g.id)).size!==10)throw Error('Expected ten unique games; inspect schedule before proceeding.');
  const policyText=fs.readFileSync(path.resolve(__dirname,'../../research/AUGUST_28_2026_TEST_POLICY.md'),'utf8');
  if(!fs.existsSync(path.join(root,'policy.json')))save('policy.json',{policy,policyText,policyHash:hash(policyText),createdAt:new Date().toISOString()});
  else if(read('policy.json').policyHash!==hash(policyText))throw Error('Frozen policy changed');
  let archive:any;
  if(fs.existsSync(path.join(root,'odds-archive.json')))archive=read('odds-archive.json');
  else{
    if(!process.env.ODDS_API_KEY)throw Error('Missing API key');
    const url=new URL(`https://api.the-odds-api.com/v4/historical/sports/${policy.sport}/odds`);
    const params={regions:'us',markets:policy.markets.join(','),oddsFormat:'american',date:policy.cutoff};
    for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);url.searchParams.set('apiKey',process.env.ODDS_API_KEY);
    const r=await fetch(url,{signal:AbortSignal.timeout(20000)});const data:any=await r.json();
    if(!r.ok)throw Error(`Historical odds HTTP ${r.status}; ${String(data.error_code??'unknown')}`);
    archive={source:`https://api.the-odds-api.com/v4/historical/sports/${policy.sport}/odds`,params,fetchedAt:new Date().toISOString(),
      cost:r.headers.get('x-requests-last'),remaining:r.headers.get('x-requests-remaining'),data};save('odds-archive.json',archive);
  }
  const age=Date.parse(policy.cutoff)-Date.parse(archive.data.timestamp??'');
  if(!Number.isFinite(age)||age<0||age>policy.maxSnapshotAgeMinutes*60_000||!Array.isArray(archive.data.data))throw Error('Historical snapshot invalid/stale');
  const decisions=games.map(g=>assessPriceGame(g,archive.data.data));
  const locked={policyHash:hash(policyText),codeHash:hash(fs.readFileSync(path.join(__dirname,'preseasonPriceTest.ts'),'utf8')),policy,
    lockedAt:new Date().toISOString(),source:archive.source,archiveHash:hash(JSON.stringify(archive)),snapshotTimestamp:archive.data.timestamp,decisions};
  save('locked-selections.json',locked);
  console.log(JSON.stringify({phase:'PREPARED_NOT_GRADED',games:games.length,archiveGames:archive.data.data.length,cost:archive.cost,remaining:archive.remaining,
    snapshot:archive.data.timestamp,decisions:decisions.map(d=>({game:d.game.name,status:d.status,candidates:d.candidates.length,
      selected:d.selection?{...d.selection.quote,referenceCount:d.selection.references.length,conditionalReturn:d.selection.conditionalReturn}:null,benchmark:d.benchmark}))},null,2));
}
async function grade(){
  const lockedText=fs.readFileSync(path.join(root,'locked-selections.json'),'utf8'),locked=JSON.parse(lockedText);
  if(locked.codeHash!==hash(fs.readFileSync(path.join(__dirname,'preseasonPriceTest.ts'),'utf8')))throw Error('Test logic changed after selections locked');
  const scoreboard=await json(scoreboardUrl);save('final-scoreboard.json',{source:scoreboardUrl,fetchedAt:new Date().toISOString(),data:scoreboard});
  const rows=[];
  for(const d of locked.decisions){
    const source=`https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${d.game.id}`;
    let data:any=null,error:string=null;
    try{data=await json(source);}catch(e){error=(e as Error).message;}
    save(`final-${d.game.id}.json`,{source,fetchedAt:new Date().toISOString(),data,error});
    const final=verifyPreseasonFinal(d.game,data,scoreboard.events?.find((e:any)=>String(e.id)===d.game.id));
    const boxscoreRows=(data?.boxscore?.players??[]).flatMap((t:any)=>(t.statistics??[]).flatMap((s:any)=>s.athletes??[])).length;
    rows.push({...d,source,final,boxscoreRows,recommendationResult:d.selection?gradeAuditQuote(d.game,d.selection.quote,final):null,
      benchmarkResult:d.benchmark?gradeAuditQuote(d.game,d.benchmark,final):null});
  }
  const report={date:policy.date,generatedAt:new Date().toISOString(),lockedSelectionsHash:hash(lockedText),policyHash:locked.policyHash,
    regularSeasonModel:{supportedGames:0,reason:'All ten games were preseason; production workload model and grading gates remain unchanged.'},
    recommendations:auditRecord(rows.filter(r=>r.recommendationResult).map(r=>r.recommendationResult)),
    favoriteBenchmark:auditRecord(rows.filter(r=>r.benchmarkResult).map(r=>r.benchmarkResult)),rows};
  save('graded-report.json',report);
  console.log(JSON.stringify({phase:'GRADED',recommendations:report.recommendations,favoriteBenchmark:report.favoriteBenchmark,
    rows:rows.map(r=>({game:r.game.name,final:r.final,status:r.status,pick:r.selection?.quote??null,result:r.recommendationResult,
      benchmark:r.benchmark,benchmarkResult:r.benchmarkResult,boxscoreRows:r.boxscoreRows}))},null,2));
}
const mode=process.argv[2];
(mode==='prepare'?prepare():mode==='grade'?grade():Promise.reject(Error('Use prepare or grade'))).catch(e=>{console.error((e as Error).message);process.exitCode=1;});
