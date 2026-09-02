import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createCollegePaperLedger,COLLEGE_PAPER_RULES,gradeCollegePaper } from '../services/collegePaper';
import { CollegeResearch,matchCollegeEvent,ESPN_COLLEGE,collegeTeamMatches,COLLEGE_TEAM_ALIASES } from '../services/collegeResearch';
import { CollegeMarketBoard } from '../services/collegeMarketBoard';
import { NflPaperLedger,nflPaperReport } from '../services/nflPaper';

const date='2026-09-03T22:00:00Z',before=Date.parse(date)-60_000;
const event={id:'college-odds',sportKey:'americanfootball_ncaaf',homeTeam:'Rutgers Scarlet Knights',awayTeam:'UMass Minutemen',commenceTime:date};
test('reviewed college aliases are bound to exact team IDs, never global State/name substitutions',()=>{
  for(const [id,names]of Object.entries(COLLEGE_TEAM_ALIASES))for(const name of names){
    assert.equal(collegeTeamMatches(name,{id,displayName:'different canonical name'}),true);
    assert.equal(collegeTeamMatches(name,{id:'999999',displayName:'different canonical name'}),false);
  }
  assert.equal(collegeTeamMatches('Michigan State Spartans',{id:'130',displayName:'Michigan Wolverines'}),false);
});
const quote={market:'spreads',participant:'',side:event.homeTeam,line:-13,price:-110,book:'Test',bookKey:'test',updatedAt:new Date(before).toISOString(),stale:false};
function competitors(){return [{homeAway:'home',team:{id:'164',displayName:event.homeTeam},score:'34'},
  {homeAway:'away',team:{id:'113',displayName:'Massachusetts Minutemen'},score:'21'}];}
function schedule(){return {events:[{id:'1234',date,season:{year:2026,type:2},competitions:[{id:'1234',neutralSite:true,competitors:competitors()}]}]};}
function summary(){return {header:{league:{slug:'college-football'},season:{year:2026,type:2},competitions:[{id:'1234',date,competitors:competitors(),
  status:{type:{completed:true,state:'post',name:'STATUS_FINAL_OVERTIME'}}}]}};}
function identity(){return matchCollegeEvent(event,schedule(),ESPN_COLLEGE+'/scoreboard',new Date(before).toISOString());}
function pick():any{return {id:'paper',event,espnEventId:'1234',verifiedEvent:identity(),quote,season:2026,rules:COLLEGE_PAPER_RULES,version:'college-manual-paper-v1',origin:'manual',savedAt:new Date(before).toISOString(),result:'PENDING',note:''};}
test('college exact-ID alias matching retains neutral venues without assuming home-field advantage',()=>{
  const i=identity();assert.equal(i.homeTeamId,'164');assert.equal(i.awayTeamId,'113');assert.equal(i.neutralSite,true);
  assert.throws(()=>matchCollegeEvent({...event,awayTeam:'Miami'},schedule(),'fixture',date),/Unique/);
});
test('college identity rejects duplicate games, reversed roles, wrong seasons, kickoff drift and ID mismatch',()=>{
  for(const change of [(d:any)=>d.events.push(d.events[0]),(d:any)=>d.events[0].season.type=1,
    (d:any)=>d.events[0].season.year=2025,(d:any)=>d.events[0].date='2026-09-04T22:00Z',
    (d:any)=>d.events[0].competitions[0].id='different',
    (d:any)=>d.events[0].competitions[0].competitors[0].homeAway='away']){
    const data=schedule();change(data);assert.throws(()=>matchCollegeEvent(event,data,'fixture',date));
  }
});
test('college grading handles favorite/underdog sign, totals, pushes and final scores including OT',()=>{
  const p=pick();assert.equal(gradeCollegePaper(p,summary()).result,'PUSH');
  assert.equal(gradeCollegePaper({...p,quote:{...quote,line:-12.5}},summary()).result,'WIN');
  assert.equal(gradeCollegePaper({...p,quote:{...quote,side:event.awayTeam,line:12.5}},summary()).result,'LOSS');
  assert.equal(gradeCollegePaper({...p,quote:{...quote,side:event.awayTeam,line:13.5}},summary()).result,'WIN');
  for(const [side,line,result]of [['Over',55,'PUSH'],['Over',54.5,'WIN'],['Under',54.5,'LOSS'],['Under',55.5,'WIN']]as const)
    assert.equal(gradeCollegePaper({...p,quote:{...quote,market:'totals',side,line}},summary()).result,result);
});
test('college grading rejects NFL data, missing scores, malformed/unsupported markets and wrong exact team IDs',()=>{
  for(const change of [(d:any)=>d.header.league.slug='nfl',(d:any)=>d.header.competitions[0].competitors[0].score=null,
    (d:any)=>d.header.competitions[0].competitors[0].score='-1',(d:any)=>d.header.competitions[0].competitors[0].score='3.5',
    (d:any)=>d.header.competitions[0].competitors[0].team.id='999']){
    const d=summary();change(d);assert.equal(gradeCollegePaper(pick(),d).result,'REVIEW');
  }
  assert.equal(gradeCollegePaper({...pick(),quote:{...quote,market:'player_pass_yds'}},summary()).result,'REVIEW');
  assert.equal(gradeCollegePaper({...pick(),rules:'NFL-rules'},summary()).result,'REVIEW');
  assert.equal(gradeCollegePaper({...pick(),verifiedEvent:undefined},summary()).result,'REVIEW');
  const pending=summary();pending.header.competitions[0].status.type.completed=false;
  assert.equal(gradeCollegePaper(pick(),pending).result,'PENDING');
});
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'college-paper-test-'));}
function clean(dir:string){assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^college-paper-test-/);fs.rmSync(dir,{recursive:true});}
function setup(dir:string){let clock=before,data=summary();const research=new CollegeResearch(async url=>url.includes('scoreboard')?schedule():data,()=>clock);
  return {ledger:createCollegePaperLedger(path.join(dir,'college.json'),research,()=>clock),research,setTime:(n:number)=>{clock=n;},setData:(d:any)=>{data=d;}};}
test('college save → deduplicate → grade → replay → export remains separate from NFL',async()=>{
  const dir=temp();try{
    const s=setup(dir),saved=await s.ledger.save(event,{...quote,line:-12.5},COLLEGE_PAPER_RULES);
    assert.equal((await s.ledger.save(event,{...quote,line:-12.5,price:120},COLLEGE_PAPER_RULES)).duplicate,true);
    assert.equal(s.ledger.read()[0].quote.price,-110);assert.equal(saved.pick.verifiedEvent.neutralSite,true);
    s.setTime(Date.parse(date)+5*3600_000);await s.ledger.grade();
    const p=s.ledger.read()[0];assert.equal(p.result,'WIN');assert.equal(s.ledger.replay(p.id).audits[0].status,'matched');
    assert.equal(s.ledger.exportRecord().sportKey,event.sportKey);assert.equal(Object.keys(s.ledger.exportRecord().evidence).length,1);
    assert.equal(nflPaperReport([p]).buckets[0].wins,1);assert.deepEqual(p.quote,saved.pick.quote);
    assert.ok(fs.existsSync(path.join(dir,'college_settlement_evidence')));assert.equal(fs.existsSync(path.join(dir,'nfl_settlement_evidence')),false);
    const nfl=new NflPaperLedger(path.join(dir,'nfl.json'),{matchEvent:async()=>'',player:async()=>{throw Error();},summary:async()=>({})});
    assert.equal(nfl.read().length,0);
    const wronglyWired=new NflPaperLedger(path.join(dir,'college.json'),{matchEvent:async()=>'',player:async()=>{throw Error();},summary:async()=>({})});
    assert.throws(()=>wronglyWired.read(),/different sport/);
  }finally{clean(dir);}
});
test('college final corrections preserve the original selection and outage cannot erase settled results',async()=>{
  const dir=temp();try{
    const s=setup(dir);const saved=await s.ledger.save(event,{...quote,line:-12.5},COLLEGE_PAPER_RULES);
    s.setTime(Date.parse(date)+5*3600_000);await s.ledger.grade();
    const corrected=summary();corrected.header.competitions[0].competitors[0].score='30';s.setData(corrected);s.setTime(Date.parse(date)+6*3600_000);
    await s.ledger.grade(true);assert.equal(s.ledger.read()[0].result,'LOSS');assert.equal(s.ledger.read()[0].gradingAudit.length,2);
    assert.deepEqual(s.ledger.replay(saved.pick.id).audits.map(a=>a.status),['matched','matched']);
    s.research.summary=async()=>{throw Error('outage');};await s.ledger.grade(true);
    assert.equal(s.ledger.read()[0].result,'LOSS');assert.deepEqual(s.ledger.read()[0].quote,saved.pick.quote);
  }finally{clean(dir);}
});
test('college rules, sport, malformed price, expired quote and NFL-model issuance cannot bypass guards',async()=>{
  const dir=temp();try{
    const s=setup(dir);
    await assert.rejects(()=>s.ledger.save(event,quote,'wrong'));
    await assert.rejects(()=>s.ledger.save({...event,sportKey:'americanfootball_nfl'},quote,COLLEGE_PAPER_RULES));
    await assert.rejects(()=>s.ledger.save(event,{...quote,price:0},COLLEGE_PAPER_RULES));
    await assert.rejects(()=>s.ledger.save(event,{...quote,updatedAt:'2020-01-01'},COLLEGE_PAPER_RULES));
    await assert.rejects(()=>s.ledger.saveModel(event,quote,{}as any,{}as any,COLLEGE_PAPER_RULES),/cannot issue college/);
    s.research.identity=async()=>{s.setTime(Date.parse(date));return identity();};
    await assert.rejects(()=>s.ledger.save(event,quote,COLLEGE_PAPER_RULES),/kickoff/);assert.equal(s.ledger.read().length,0);
  }finally{clean(dir);}
});
test('college server-held quote IDs cannot be forged or reused after expiry/kickoff',async()=>{
  let clock=before;const board=new CollegeMarketBoard({now:()=>clock,upcoming:async()=>[event],odds:async()=>({quota:{}as any,event:{id:event.id,sport_key:event.sportKey,home_team:event.homeTeam,away_team:event.awayTeam,commence_time:date,
    bookmakers:[{key:'test',title:'Test',last_update:new Date(before).toISOString(),markets:[{key:'spreads',outcomes:[{name:event.homeTeam,point:-13,price:-110}]}]}]}as any})});
  const data=await board.quotes(event.id),id=data.quotes[0].quoteId;assert.ok(id);assert.equal(board.selection(event.id,id).quote.price,-110);
  assert.throws(()=>board.selection(event.id,'forged'));clock+=5*60_000;assert.throws(()=>board.selection(event.id,id),/expired/);
});
