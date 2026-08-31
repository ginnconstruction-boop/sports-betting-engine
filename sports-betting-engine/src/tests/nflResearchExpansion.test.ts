import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseWorkloadEvidence, summarizeWorkloadEvidence, nflShareShadowForecast } from '../services/nflWorkloadContext';
import { evaluateNflShareShadow } from '../services/nflShadowEvaluation';
import { NflPaperLedger, PAPER_RULES } from '../services/nflPaper';
import { NflResearch } from '../services/nflResearch';

const date='2025-12-14T18:00:00Z', now=Date.parse('2026-08-31T12:00:00Z');
const player={id:'123',name:'Test Player',teamId:'12',team:'Kansas City Chiefs',position:'QB',rosterStatus:'Active',injuries:[],source:'fixture',fetchedAt:new Date(now).toISOString()};
const row={eventId:'999',date,teamId:'12',opponent:'Los Angeles Chargers',opportunity:28,value:189};
function source() {
  return {header:{league:{slug:'nfl'},season:{year:2025,type:2},competitions:[{id:'999',date,status:{type:{state:'post',completed:true,name:'STATUS_FINAL'}},
    competitors:[{homeAway:'home',team:{id:'12',displayName:player.team},score:'13'},
      {homeAway:'away',team:{id:'24',displayName:row.opponent},score:'16'}]}]},
    boxscore:{players:[{team:{id:'12'},statistics:[{name:'passing',keys:['completions/passingAttempts','passingYards'],totals:['19/33','190'],
      athletes:[{athlete:{id:'123',displayName:player.name},stats:['16/28','189']},{athlete:{id:'456',displayName:'Backup'},stats:['3/5','22']}]}]}]}};
}
const parse=(data=source(),r=row)=>parseWorkloadEvidence(data,r,player,'player_pass_yds',now,new Date(now).toISOString(),'https://fixture.invalid/summary');
test('workload evidence reconciles individual attempts with complete team attempts, not net passing yards',()=>{
  const e=parse();assert.equal(e.teamOpportunity,33);assert.equal(e.opportunity,28);assert.equal(e.share,28/33);
  const summary=summarizeWorkloadEvidence([e],5);assert.equal(summary.verifiedGames,1);assert.equal(summary.requestedGames,5);
  assert.equal(summarizeWorkloadEvidence([],5).pooledOpportunityShare,null);
});
test('historical workload ignores CURRENT injuries even when injected into an old game summary',()=>{
  const d:any=source();d.injuries=[{date:'2099-01-01',status:'Out'}];d.rosters=[{status:'Inactive'}];
  assert.deepEqual(parse(d),parse());
});
test('workload rejects duplicate/missing players, inconsistent totals and stat disagreement',()=>{
  for(const change of [
    (d:any)=>d.boxscore.players[0].statistics[0].athletes.push(d.boxscore.players[0].statistics[0].athletes[0]),
    (d:any)=>d.boxscore.players[0].statistics[0].totals.splice(0,1,'19/99'),
    (d:any)=>d.boxscore.players[0].statistics[0].athletes[0].stats.splice(1,1,'190'),
    (d:any)=>d.boxscore.players[0].statistics[0].athletes[0].athlete.displayName='Wrong Name',
    (d:any)=>d.boxscore.players[0].statistics[0].athletes[1].stats.splice(0,1,'--'),
  ]) {const d=source();change(d);assert.throws(()=>parse(d),/verified/);}
});
test('workload rejects wrong game, team, opponent, season, incomplete/future games',()=>{
  for(const change of [
    (d:any)=>d.header.competitions[0].id='123',
    (d:any)=>d.header.season.type=1,
    (d:any)=>d.header.season.year=2024,
    (d:any)=>d.header.competitions[0].competitors[1].team.displayName='Wrong Opponent',
    (d:any)=>d.header.competitions[0].status.type.completed=false,
  ]) {const d=source();change(d);assert.throws(()=>parse(d),/verified/);}
  assert.throws(()=>parseWorkloadEvidence(source(),row,player,'player_pass_yds',Date.parse(date),new Date(now).toISOString(),'fixture'),/verified/);
});
test('receiving workload is share of targets, never a route or snap share',()=>{
  const d=source();d.boxscore.players[0].statistics=[{name:'receiving',keys:['receivingTargets','receptions'],totals:['10','7'],
    athletes:[{athlete:{id:'123',displayName:player.name},stats:['6','4']},{athlete:{id:'456',displayName:'Backup'},stats:['4','3']}]}];
  const e=parseWorkloadEvidence(d,{...row,opportunity:6,value:4},player,'player_receptions',now,new Date(now).toISOString(),'fixture');
  assert.equal(e.share,.6);assert.match(summarizeWorkloadEvidence([e],1).note,/NOT snap share/);
});
function series() {return Array.from({length:25},(_,i)=>({...row,eventId:String(1000+i),date:new Date(Date.parse('2024-09-01')+i*7*86400_000).toISOString(),opportunity:20+i,value:(20+i)*7,teamOpportunity:40+i}));}
test('shadow comparisons use identical earlier-game training and do not leak target/later outcomes or workload',()=>{
  const rows=series(),start=Date.parse(rows[8].date),end=now;
  const first=evaluateNflShareShadow(rows,start,end);
  const modified=rows.map((r,i)=>i>=20?{...r,value:999,opportunity:200,teamOpportunity:900}:r);
  const second=evaluateNflShareShadow(modified,start,end);
  assert.deepEqual(first.tests.filter(t=>Date.parse(t.date)<Date.parse(rows[20].date)),second.tests.filter(t=>Date.parse(t.date)<Date.parse(rows[20].date)));
  assert.equal(first.tests.find(t=>t.eventId===rows[20].eventId).shadowPrediction,second.tests.find(t=>t.eventId===rows[20].eventId).shadowPrediction);
  assert.ok(first.tests.every(t=>Date.parse(t.trainingThrough)<Date.parse(t.date)&&!t.trainingEventIds.includes(t.eventId)));
  assert.equal(first.promoted,false);assert.throws(()=>evaluateNflShareShadow([...rows,rows[0]],start,end),/duplicate/);
});
test('missing team totals block shadow comparisons instead of cherry-picking complete older games',()=>{
  const rows=series();delete rows[10].teamOpportunity;
  assert.equal(nflShareShadowForecast(rows.slice(0,11)),null);
  const e=evaluateNflShareShadow(rows,Date.parse(rows[10].date),now);
  assert.equal(e.tested,0);assert.equal(e.excluded.length,15);
});
test('live descriptive workload calls are bounded and missing feeds cannot invent context',async()=>{
  let calls=0;const research=new NflResearch(async()=>{calls++;throw Error('outage');},()=>now);
  const w=await research.workloadContext(player,series(),'player_pass_yds',now);
  assert.equal(calls,5);assert.equal(w.requestedGames,5);assert.equal(w.verifiedGames,0);assert.equal(w.unavailable.length,5);
});
function temporary() {return fs.mkdtempSync(path.join(os.tmpdir(),'nfl-expansion-test-'));}
function cleanup(dir:string) {assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^nfl-expansion-test-/);fs.rmSync(dir,{recursive:true});}
async function ledgerFixture(dir:string) {
  let time=Date.parse(date)-60_000,data=source();
  const research={matchEvent:async()=> '999',player:async()=>player,summary:async()=>data};
  const ledger=new NflPaperLedger(path.join(dir,'paper.json'),research,()=>time);
  const event={id:'odds-test',sportKey:'americanfootball_nfl',homeTeam:player.team,awayTeam:row.opponent,commenceTime:date};
  const q={market:'totals',participant:'',side:'Over',line:28.5,price:-110,book:'Test',bookKey:'test',updatedAt:new Date(time).toISOString(),stale:false};
  const saved=await ledger.save(event,q,PAPER_RULES);time=Date.parse(date)+5*3600_000;
  return {ledger,saved,research,setData:(d:any)=>{data=d;}};
}
test('paper settlement → archived source → replay → export reproduces win/loss without requests or mutation',async()=>{
  const dir=temporary();try {
    const {ledger,saved,research}=await ledgerFixture(dir);await ledger.grade();
    const pick=ledger.read()[0];assert.equal(pick.result,'WIN');assert.match(pick.gradingAudit[0].evidenceHash,/^[a-f0-9]{64}$/);
    research.summary=async()=>{throw Error('Replay must not use live network');};
    const before=fs.readFileSync(path.join(dir,'paper.json'),'utf8');
    assert.equal(ledger.replay(saved.pick.id).audits[0].status,'matched');
    const exported=ledger.exportRecord();assert.equal(exported.picks.length,1);assert.equal(Object.keys(exported.evidence).length,1);
    assert.deepEqual(exported.missingEvidence,[]);assert.equal(fs.readFileSync(path.join(dir,'paper.json'),'utf8'),before);
    assert.throws(()=>ledger.replay('missing'),/not found/);
  }finally{cleanup(dir);}
});
test('stat correction retains both source snapshots and each historical grading replays independently',async()=>{
  const dir=temporary();try {
    const {ledger,saved,setData}=await ledgerFixture(dir);await ledger.grade();
    const corrected=source();corrected.header.competitions[0].competitors[0].score='0';setData(corrected);await ledger.grade(true);
    assert.equal(ledger.read()[0].result,'LOSS');assert.equal(ledger.read()[0].gradingAudit.length,2);
    assert.deepEqual(ledger.replay(saved.pick.id).audits.map(a=>a.status),['matched','matched']);
    assert.equal(Object.keys(ledger.exportRecord().evidence).length,2);assert.deepEqual(ledger.read()[0].quote,saved.pick.quote);
  }finally{cleanup(dir);}
});
test('corrupt source evidence is reported and cannot reverse a settled result or be overwritten',async()=>{
  const dir=temporary();try {
    const {ledger,saved}=await ledgerFixture(dir);await ledger.grade();const hash=ledger.read()[0].gradingAudit[0].evidenceHash;
    const file=path.join(dir,'nfl_settlement_evidence',hash+'.json');fs.writeFileSync(file,'corrupt fixture');
    assert.equal(ledger.replay(saved.pick.id).audits[0].status,'evidence_unavailable_or_corrupt');
    assert.deepEqual(ledger.exportRecord().missingEvidence,[hash]);await ledger.grade(true);
    assert.equal(ledger.read()[0].result,'WIN');assert.equal(fs.readFileSync(file,'utf8'),'corrupt fixture');
  }finally{cleanup(dir);}
});
test('UI and endpoints expose plain-language readiness, workload, export and protected read-only replay',()=>{
  const root=path.resolve(__dirname,'../..'),html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'public/nfl-markets.js'),'utf8'),server=fs.readFileSync(path.join(root,'server.ts'),'utf8');
  assert.match(html,/Where we stand/);assert.match(html,/Export NFL paper record/);assert.match(js,/Verify saved grading/);
  assert.match(server,/app.get\('\/api\/nfl\/paper\/export', requireAuth/);assert.match(server,/app.get\('\/api\/nfl\/paper\/:id\/replay', requireAuth/);
  assert.match(js,/Verified recent workload context/);
});
test('frozen shadow results replay exactly without network and do not promote the candidate',()=>{
  const root=path.resolve(__dirname,'../..');
  const protocol=JSON.parse(fs.readFileSync(path.join(root,'research/NFL_SHADOW_PROTOCOL_2026_08_31.json'),'utf8'));
  const report=JSON.parse(fs.readFileSync(path.join(root,'research/nfl-share-shadow-2026-08-31/report.json'),'utf8'));
  assert.equal(report.records.length,protocol.cohort.length);assert.equal(report.oddsCreditsUsed,0);assert.equal(report.promoted,false);
  for(const row of report.records) {
    if(!row.observations)continue;
    const replay=evaluateNflShareShadow(row.observations,Date.parse(protocol.evaluationStart),Date.parse(protocol.evaluationEnd));
    assert.deepEqual(replay.tests,row.tests);assert.deepEqual(replay.excluded,row.excluded);
    for(const key of ['meanMae','workloadMae','shadowMae'])assert.equal(replay[key],row[key]);
  }
});
