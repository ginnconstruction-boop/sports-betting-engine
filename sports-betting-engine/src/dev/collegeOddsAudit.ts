import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
import {fitCollegeScores,mergeCollegeResults} from '../services/collegeScoreModel';
import {selectCollegeQuotes} from '../services/collegeModelQuotes';
import {matchCollegeEvent} from '../services/collegeResearch';
import {flattenNflQuotes} from '../services/nflMarketBoard';
import {collegeDate} from '../services/collegeDayScan';
import {paperProfit} from '../services/nflPaper';
import {recordApiResponse} from '../services/creditTracker';
const root=path.resolve(__dirname,'../../snapshots/college-model-v1');
const read=(n:string)=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8'));
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function save(n:string,data:any){const f=path.join(root,n);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(data),{flag:'wx'});}
async function freeze(){
  const protocol=read('registered-protocol.json').protocol,lock=read('configuration-lock.json'),validation=read('validation-summary.json');
  const codeHash=hash(fs.readFileSync(path.resolve(__dirname,'../services/collegeModelQuotes.ts'),'utf8').replace(/\r\n/g,'\n'));
  if(!fs.existsSync(path.join(root,'odds-selection-lock.json')))save('odds-selection-lock.json',{lockedAt:new Date().toISOString(),codeHash,config:lock.config,protocolHash:lock.protocolHash});
  if(read('odds-selection-lock.json').codeHash!==codeHash)throw Error('Selection code changed after historical odds lock.');
  const development=read('development-data.json'),holdout=read('holdout-data.json'),all=mergeCollegeResults([development.games,holdout.games]);
  const sources=fs.readdirSync(path.join(root,'sources')).filter(f=>f.startsWith('2025-'));
  const schedule=[...new Map(sources.flatMap(f=>read('sources/'+f).data.events).map((e:any)=>[String(e.id),e])).values()];
  let spent=0;
  for(const date of protocol.oddsAudit.dates){
    const snapshot=date+'T12:00:00Z',asOf=Date.parse(snapshot),name='odds/'+date+'.json',frozen='frozen/'+date+'.json';
    if(fs.existsSync(path.join(root,frozen))){console.log('Already frozen '+date);continue;}
    if(!fs.existsSync(path.join(root,name))){
      if(fs.existsSync(path.join(root,'attempts/'+date+'.json')))throw Error('Previous uncertain attempt; no automatic paid retry for '+date);
      if(spent+20>protocol.oddsAudit.maxCredits)throw Error('Historical audit credit cap reached');
      if(!process.env.ODDS_API_KEY)throw Error('Odds key unavailable');
      save('attempts/'+date+'.json',{date,attemptedAt:new Date().toISOString(),expectedCredits:20});spent+=20;
      const url=new URL('https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds');
      url.search=new URLSearchParams({apiKey:process.env.ODDS_API_KEY,date:snapshot,regions:'us',markets:'spreads,totals',oddsFormat:'american',dateFormat:'iso'}).toString();
      let response:Response;try{response=await fetch(url,{signal:AbortSignal.timeout(30000)});}catch{throw Error('Historical odds request failed; no retry.');}
      const remaining=Number(response.headers.get('x-requests-remaining')),last=Number(response.headers.get('x-requests-last'));
      if(response.headers.has('x-requests-remaining')&&Number.isFinite(remaining))recordApiResponse(remaining);
      if(!response.ok)throw Error('Historical odds HTTP '+response.status+'; no retry.');
      const data:any=await response.json();
      save(name,{requested:snapshot,receivedAt:new Date().toISOString(),creditsUsed:last,remainingCredits:remaining,data});
      console.log(JSON.stringify({date,creditsUsed:last,remainingCredits:remaining}));
      if(last>20)throw Error('Provider charged more than expected; stop audit');
    }
    const archive=read(name),snapshotTime=Date.parse(archive.data.timestamp);
    if(!Number.isFinite(snapshotTime)||snapshotTime>asOf||asOf-snapshotTime>10*60_000||!Array.isArray(archive.data.data))throw Error('Invalid historical snapshot timestamp/shape');
    const model=fitCollegeScores(all,asOf,lock.config),rows:any[]=[],seen=new Set<string>();
    for(const raw of archive.data.data){
      if(!Number.isFinite(Date.parse(raw.commence_time))||collegeDate(Date.parse(raw.commence_time))!==date)continue;
      const event={id:raw.id,sportKey:raw.sport_key,homeTeam:raw.home_team,awayTeam:raw.away_team,commenceTime:raw.commence_time};
      try{
        if(seen.has(raw.id))throw Error('Duplicate historical provider event');seen.add(raw.id);
        if(Date.parse(event.commenceTime)<=asOf)throw Error('Kickoff already passed');
        const identity=matchCollegeEvent(event,{events:schedule},'archived-month-scoreboard',snapshot);
        const projection=model.predict(identity.homeTeamId,identity.awayTeamId,identity.neutralSite);
        if(!projection)throw Error('Insufficient historical team data or missing venue');
        const quotes=flattenNflQuotes(raw,['spreads','totals'],asOf);
        const assessment=selectCollegeQuotes(event,quotes,projection,lock,asOf,validation.paperApproved);
        rows.push({event,identity,projection,...assessment});
      }catch(e){rows.push({event,skipped:(e as Error).message});}
    }
    // Contains only original forecasts/quotes and selections. Grading is a separate
    // invocation; every date must be frozen before any selection results are read.
    save(frozen,{date,asOf:snapshot,oddsHash:hash(JSON.stringify(archive)),selectionCodeHash:codeHash,rows});
    console.log(JSON.stringify({date,phase:'FROZEN_UNGRADED',games:rows.length,projected:rows.filter(r=>r.projection).length,selections:rows.reduce((n,r)=>n+(r.selected?.length??0),0)}));
  }
}
function grade(){
  const protocol=read('registered-protocol.json').protocol;
  const frozen=protocol.oddsAudit.dates.map((date:string)=>read('frozen/'+date+'.json'));
  if(fs.existsSync(path.join(root,'odds-audit-report.json')))throw Error('Historical odds audit already graded; preserve results');
  const games=read('holdout-data.json').games,rows:any[]=[],skipped:any[]=[];
  for(const day of frozen)for(const row of day.rows){
    if(row.skipped){skipped.push({date:day.date,...row});continue;}
    for(const candidate of row.selected){
      const g=games.find((g:any)=>g.id===row.identity.espnEventId),q=candidate.quote;
      if(!g||g.homeId!==row.identity.homeTeamId||g.awayId!==row.identity.awayTeamId||g.neutral!==row.identity.neutralSite){rows.push({date:day.date,event:row.event,quote:q,result:'REVIEW'});continue;}
      const actual=q.market==='totals'?(q.side==='Over'?1:-1)*(g.homeScore+g.awayScore-q.line)
        :(q.side===row.event.homeTeam?g.homeScore-g.awayScore:g.awayScore-g.homeScore)+q.line;
      const result=actual===0?'PUSH':actual>0?'WIN':'LOSS';
      rows.push({date:day.date,event:row.event,quote:q,assessment:candidate.assessment,result,actual,profitUnits:paperProfit(result,q.price)});
    }
  }
  const settled=rows.filter(r=>['WIN','LOSS','PUSH'].includes(r.result)),profit=settled.reduce((n,r)=>n+r.profitUnits,0);
  const summary={dates:protocol.oddsAudit.dates,providerGames:frozen.reduce((n:any,d:any)=>n+d.rows.length,0),projectedGames:frozen.reduce((n:any,d:any)=>n+d.rows.filter((r:any)=>r.projection).length,0),
    selections:rows.length,settled:settled.length,wins:rows.filter(r=>r.result==='WIN').length,losses:rows.filter(r=>r.result==='LOSS').length,
    pushes:rows.filter(r=>r.result==='PUSH').length,review:rows.filter(r=>r.result==='REVIEW').length,profitUnits:profit,roi:settled.length?profit/settled.length:null,
    moneyBettingApproved:false,note:'Reconstructed historical paper experiment on six fixed dates, not archived as-seen live forecasts and not evidence of proven profitability. Totals excluded because the independent score holdout failed its gate.'};
  save('odds-audit-report.json',{gradedAt:new Date().toISOString(),summary,rows,skipped});console.log(JSON.stringify(summary,null,2));
}
(process.argv[2]==='freeze'?freeze():process.argv[2]==='grade'?Promise.resolve().then(grade):Promise.reject(Error('Use freeze or grade'))).catch(e=>{console.error((e as Error).message);process.exitCode=1;});
