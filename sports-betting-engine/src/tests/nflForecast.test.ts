import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assessNflQuote, buildNflForecast, eligibleNflHistory, evaluateNflWalkForward, NFL_FORECAST_VERSION,
  nflPointForecast, nflResidualDistribution, NflForecastInput } from '../services/nflForecast';
import { NflPaperLedger, nflPaperReport, PAPER_RULES } from '../services/nflPaper';
import { NflMarketBoard, MarketQuote } from '../services/nflMarketBoard';
import { NflRecommendations } from '../services/nflRecommendations';
import { NflObservation, NflResearch } from '../services/nflResearch';

const now = Date.parse('2026-08-31T01:00:00Z');
const event = { id:'odds-test', sportKey:'americanfootball_nfl', homeTeam:'Seattle Seahawks', awayTeam:'New England Patriots', commenceTime:'2026-09-10T00:15:00Z' };
const quote: MarketQuote = { quoteId:'q1', market:'player_pass_yds', participant:'Test Player', side:'Over', line:200.5,
  price:-110, book:'FanDuel', bookKey:'fanduel', updatedAt:new Date(now).toISOString(), stale:false };
function input(): NflForecastInput {
  return { player:{ id:'123', name:'Test Player', teamId:'17', team:event.awayTeam, position:'QB', rosterStatus:'Active', injuries:[], fetchedAt:new Date(now).toISOString(), source:'fixture' },
    asOf:new Date(now).toISOString(), depth:{ rows:[{position:'qb',formation:'test',listedOrder:1}],source:'fixture',sourceTimestamp:new Date(now).toISOString() }, sources:[],
    observations:Array.from({length:20},(_,i)=>({eventId:`history-${i}`,date:new Date(Date.parse('2025-08-31T18:00Z')+i*7*86400_000).toISOString(),teamId:'17',opponent:'Fixture opponent',opportunity:20+i,value:(20+i)*8})) };
}
function forecast() { return buildNflForecast(input(),event,quote.market,now); }
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(),'nfl-forecast-test-')); }
function clean(dir:string) {
  assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
  assert.match(path.basename(dir),/^nfl-forecast-test-/); fs.rmSync(dir,{recursive:true});
}
function finalSummary(actual=320) {
  return { header:{league:{slug:'nfl'},season:{year:2026,type:2},competitions:[{id:'999',date:event.commenceTime,
    status:{type:{completed:true,state:'post',name:'STATUS_FINAL'}},competitors:[
      {homeAway:'home',team:{id:'26',displayName:event.homeTeam},score:'10'},
      {homeAway:'away',team:{id:'17',displayName:event.awayTeam},score:'20'}]}]},
    boxscore:{players:[{team:{id:'17'},statistics:[{name:'passing',keys:['passingYards'],athletes:[{athlete:{id:'123',displayName:'Test Player'},stats:[String(actual)]}]}]}]} };
}
function setup(dir:string, dataset=input()) {
  let clock=now;
  const board = new NflMarketBoard({now:()=>clock,upcoming:async()=>[event],odds:async()=>({event:{id:event.id,sport_key:event.sportKey,home_team:event.homeTeam,away_team:event.awayTeam,commence_time:event.commenceTime,
    bookmakers:[{key:'fanduel',title:'FanDuel',last_update:quote.updatedAt,markets:[{key:quote.market,outcomes:[{name:'Over',description:quote.participant,point:quote.line,price:quote.price},{name:'Under',description:quote.participant,point:quote.line,price:-110}]}]},
      {key:'analysis',title:'Unavailable book',last_update:quote.updatedAt,markets:[{key:quote.market,outcomes:[{name:'Over',description:quote.participant,point:quote.line,price:150}]}]}]} as any,quota:{} as any})});
  const research={forecastInputs:async()=>dataset,matchEvent:async()=> '999',player:async()=>dataset.player,summary:async()=>finalSummary()};
  const ledger=new NflPaperLedger(path.join(dir,'paper.json'),research,()=>clock);
  const service=new NflRecommendations(board,research,ledger,['fanduel'],()=>clock);
  return {board,research,ledger,service,setNow:(ms:number)=>{clock=ms;}};
}

test('workload forecast is football opportunity × efficiency, with a fixed average baseline', () => {
  const result=nflPointForecast(input().observations);
  assert.equal(result.workload,34);assert.equal(result.efficiency,8);assert.equal(result.projection,272);assert.equal(result.baseline,236);
  assert.deepEqual(nflPointForecast([...input().observations].reverse()),result);
  assert.equal(nflPointForecast(input().observations.slice(0,7)),null);
});
test('forecast excludes future, other-team and invalid observations; conflicting duplicates fail closed', () => {
  const data=input();const extra:NflObservation[]=[{...data.observations[0],eventId:'future',date:event.commenceTime,value:9999},
    {...data.observations[0],eventId:'other',teamId:'99',value:9999},{...data.observations[0],eventId:'missing',opportunity:null}];
  assert.deepEqual(eligibleNflHistory([...data.observations,...extra],'17',now,quote.market).rows,data.observations);
  assert.throws(()=>eligibleNflHistory([...data.observations,{...data.observations[0],value:9999}],'17',now,quote.market),/Conflicting/);
});
test('rolling evaluation does not change earlier predictions when later outcomes change', () => {
  const data=input().observations;const before=evaluateNflWalkForward(data);
  const changed=data.map((r,i)=>i>=18?{...r,value:9999,opportunity:999}:r);
  const after=evaluateNflWalkForward(changed);
  assert.deepEqual(after.tests.filter(t=>Date.parse(t.date)<Date.parse(data[18].date)),before.tests.filter(t=>Date.parse(t.date)<Date.parse(data[18].date)));
  assert.equal(after.tests.find(t=>t.eventId===data[18].eventId).prediction,before.tests.find(t=>t.eventId===data[18].eventId).prediction);
  assert.ok(before.tests.every(t=>Date.parse(t.trainingThrough)<Date.parse(t.date)));
  assert.ok(before.mae<before.baselineMae);assert.equal(before.games,12);
});
test('point projection does not depend on a posted betting line or odds', () => {
  const f=forecast();assessNflQuote(f,{...quote,line:1000,price:300},['fanduel'],now);
  assert.equal(f.point.projection,272);assert.equal(f.reasons.length,0);
  assert.equal(f.currentSeasonGames,0);assert.ok(f.warnings.some(w=>w.includes('prior-season')));
});
test('integer-stat empirical distribution accounts for pushes; probabilities sum to one', () => {
  const d=nflResidualDistribution(10,[-2,-1,0,0,1,2,3,4],'player_receptions',10);
  assert.ok(Math.abs(d.over+d.under+d.push-1)<1e-12);assert.ok(d.push>0);
  const half=nflResidualDistribution(10,[-2,-1,0,0,1,2,3,4],'player_receptions',10.5);
  assert.equal(half.push,0);assert.ok(half.over<1&&half.under>0);
});
test('all four core markets have forecast support; non-core NFL stats remain unsupported', () => {
  for(const market of ['player_pass_yds','player_rush_yds','player_reception_yds','player_receptions']) {
    const data=input();if(market==='player_receptions')data.observations=data.observations.map(r=>({...r,value:r.opportunity}));
    assert.ok(buildNflForecast(data,event,market,now).point);
  }
  assert.throws(()=>buildNflForecast(input(),event,'player_anytime_td',now),/Unsupported/);
});
test('injury, stale depth, unknown role and incomplete history block issuance without deleting diagnostics', () => {
  const injured=input();injured.player.injuries=[{status:'Questionable',date:null}];
  assert.ok(buildNflForecast(injured,event,quote.market,now).reasons.some(r=>r.includes('injury')));
  const role=input();role.depth.rows=[];role.depth.sourceTimestamp=null;
  assert.ok(buildNflForecast(role,event,quote.market,now).reasons.some(r=>r.includes('depth-chart')));
  const short=input();short.observations=short.observations.slice(0,8);
  assert.ok(buildNflForecast(short,event,quote.market,now).reasons.some(r=>r.includes('rolling forecast errors')));
  const stale=input();stale.player.fetchedAt='2026-01-01';assert.ok(buildNflForecast(stale,event,quote.market,now).reasons.some(r=>r.includes('Roster snapshot')));
});
test('a model that does not beat the simple baseline cannot issue experimental picks', () => {
  const data=input();data.observations=data.observations.map(r=>({...r,value:200,opportunity:25}));
  const f=buildNflForecast(data,event,quote.market,now);assert.ok(f.reasons.some(r=>r.includes('did not beat')));
  assert.equal(assessNflQuote(f,{...quote,line:100.5},['fanduel'],now).eligible,false);
});
test('exact quote assessment excludes inaccessible, stale, mismatched and malformed quotes', () => {
  const f=forecast();assert.equal(assessNflQuote(f,quote,['fanduel'],now).eligible,true);
  for(const q of [{...quote,bookKey:'other'},{...quote,updatedAt:null},{...quote,participant:'Other Player'},
    {...quote,line:null},{...quote,price:0},{...quote,side:'Yes'}])assert.equal(assessNflQuote(f,q,['fanduel'],now).eligible,false);
  const under=assessNflQuote(f,{...quote,side:'Under'},['fanduel'],now);assert.equal(under.eligible,false);
});
test('recommendation → automatic durable logging → final grading → separate model W/L report', async () => {
  const dir=temp();try {
    const {board,service,ledger,setNow}=setup(dir);const quotes=await board.quotes(event.id,'passing');
    const result=await service.run(event.id,'passing',quotes.quotes[0].quoteId,PAPER_RULES);
    assert.equal(result.status,'paper_recommendation');assert.equal(result.pick.quote.bookKey,'fanduel');
    assert.equal(ledger.read().length,1);assert.equal(result.pick.origin,'model');assert.equal(result.pick.version,NFL_FORECAST_VERSION);
    assert.equal(result.pick.forecast.observations.length,20);assert.ok(result.pick.forecast.dataHash);
    const repeated=await service.run(event.id,'passing',quotes.quotes[1].quoteId,PAPER_RULES);
    assert.equal(repeated.status,'already_tracked');assert.deepEqual(repeated.pick,result.pick);
    await ledger.save(event,quote,PAPER_RULES);assert.equal(ledger.read().length,2);
    setNow(Date.parse(event.commenceTime)+5*3600_000);const graded=await ledger.grade();
    assert.equal(graded.checked,2);assert.equal(graded.report.buckets.length,2);
    assert.equal(graded.report.buckets.find(b=>b.origin==='model').wins,1);
    assert.equal(graded.report.buckets.find(b=>b.origin==='manual').wins,1);
    assert.equal(graded.picks.find(p=>p.origin==='model').forecast.dataHash,result.pick.forecast.dataHash);
    const reopened=new NflPaperLedger(path.join(dir,'paper.json'),{matchEvent:async()=> '999',player:async()=>input().player,summary:async()=>finalSummary()});
    assert.equal(reopened.read().length,2);assert.equal(reopened.read()[0].result,'WIN');
  } finally {clean(dir);}
});
test('failed gates and unacknowledged rules issue no pick and create no paper records', async () => {
  const dir=temp();try {
    const data=input();data.player.injuries=[{status:'Out',date:null}];const {board,service,ledger}=setup(dir,data);
    const q=(await board.quotes(event.id,'passing')).quotes[0];
    await assert.rejects(()=>service.run(event.id,'passing',q.quoteId,''),/Acknowledge/);
    assert.equal((await service.run(event.id,'passing',q.quoteId,PAPER_RULES)).status,'no_recommendation');assert.equal(ledger.read().length,0);
  } finally {clean(dir);}
});
test('storage failure cannot return an issued recommendation', async () => {
  const dir=temp();try {
    const s=setup(dir);const q=(await s.board.quotes(event.id,'passing')).quotes[0];
    s.ledger.saveModel=async()=>{throw Error('disk failure');};
    await assert.rejects(()=>s.service.run(event.id,'passing',q.quoteId,PAPER_RULES),/disk failure/);assert.equal(s.ledger.read().length,0);
  } finally {clean(dir);}
});
test('concurrent model saves across opposite sides and changed lines retain exactly one original pick', async () => {
  const dir=temp();try {
    const s=setup(dir),f=forecast(),a=assessNflQuote(f,quote,['fanduel'],now);
    const saves=await Promise.all([s.ledger.saveModel(event,quote,f,a,PAPER_RULES),s.ledger.saveModel(event,{...quote,line:199.5},f,a,PAPER_RULES)]);
    assert.equal(s.ledger.read().length,1);assert.equal(saves.filter(x=>x.duplicate).length,1);
    assert.deepEqual(saves[0].pick,saves[1].pick);
  } finally {clean(dir);}
});
test('slow event verification cannot issue after kickoff', async () => {
  const dir=temp();try {
    const s=setup(dir),f=forecast(),a=assessNflQuote(f,quote,['fanduel'],now);
    s.research.matchEvent=async()=>{s.setNow(Date.parse(event.commenceTime));return '999';};
    await assert.rejects(()=>s.ledger.saveModel(event,quote,f,a,PAPER_RULES),/kickoff/);assert.equal(s.ledger.read().length,0);
  } finally {clean(dir);}
});
test('a slow forecast cannot issue from an expired board snapshot', async () => {
  const dir=temp();try {
    const s=setup(dir);const q=(await s.board.quotes(event.id,'passing')).quotes[0];
    s.research.forecastInputs=async()=>{s.setNow(now+6*60_000);return input();};
    await assert.rejects(()=>s.service.run(event.id,'passing',q.quoteId,PAPER_RULES),/expired/);
    assert.equal(s.ledger.read().length,0);
  }finally{clean(dir);}
});
test('forecast endpoint serializes expensive requests and releases its guard after a source error', async () => {
  const dir=temp();try {
    const s=setup(dir);const q=(await s.board.quotes(event.id,'passing')).quotes[0];
    let reject:(e:Error)=>void;s.research.forecastInputs=()=>new Promise((_,no)=>{reject=no;});
    const pending=s.service.run(event.id,'passing',q.quoteId,PAPER_RULES);
    const failed=assert.rejects(pending,/source error/);
    await assert.rejects(()=>s.service.run(event.id,'passing',q.quoteId,PAPER_RULES),/Another NFL forecast/);
    reject(Error('source error'));await failed;
    s.research.forecastInputs=async()=>input();
    assert.equal((await s.service.run(event.id,'passing',q.quoteId,PAPER_RULES)).status,'paper_recommendation');
  }finally{clean(dir);}
});
