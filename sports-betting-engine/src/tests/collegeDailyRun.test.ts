import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {CollegeDailyRun} from '../services/collegeDailyRun';
import {createCollegePaperLedger,COLLEGE_PAPER_RULES} from '../services/collegePaper';
const now=Date.parse('2026-09-04T05:05:00Z');
const pick=(i:number,extra:any={}):any=>({id:'pick'+i,espnEventId:String(i),result:'PENDING',
  event:{id:'game'+i,sportKey:'americanfootball_ncaaf',homeTeam:'Home',awayTeam:'Away',commenceTime:'2026-09-03T23:00:00Z'},...extra});
async function finish(run:CollegeDailyRun,id:string){for(let i=0;i<100;i++){await new Promise(r=>setImmediate(r));const job=run.get(id);if(job.stage==='finished')return job;}throw Error('Daily job did not finish');}
test('one-click uses server Central date, saves paper spreads and grades every eligible game once beyond ten',async()=>{
  const picks=Array.from({length:25},(_,i)=>pick(i+1));picks.push(pick(1),pick(26,{result:'WIN'}),pick(27,{event:{...pick(27).event,commenceTime:'2026-09-05T00:00:00Z'}}));
  const calls:string[][]=[],scans:any[]=[];
  const run=new CollegeDailyRun({now:()=>now,read:()=>picks,scan:async(...args)=>{scans.push(args);return{recommendations:[],warnings:[]};},
    gradeEvents:async(ids)=>{calls.push(ids);return{checked:ids.length,sourceFailures:0};}});
  const first=run.start();assert.equal(first.date,'2026-09-04');const done=await finish(run,first.id);
  assert.deepEqual(scans,[['2026-09-04',true]]);assert.deepEqual(calls.map(c=>c.length),[10,10,5]);
  assert.equal(new Set(calls.flat()).size,25);assert.equal(done.grading.gamesChecked,25);assert.equal(done.status,'complete');
  // Mock leaves every game pending; the job still terminates instead of retrying.
  assert.equal(done.grading.pending,27);
});
test('one-click shares an active job across double clicks; status reads are non-mutating',async()=>{
  let release:()=>void,calls=0;const wait=new Promise<void>(r=>{release=r;});
  const run=new CollegeDailyRun({now:()=>now,read:()=>[],scan:async()=>{calls++;await wait;return{warnings:[]};},gradeEvents:async()=>({checked:0,sourceFailures:0})});
  const a=run.start(),b=run.start();assert.equal(a.id,b.id);assert.equal(calls,1);
  a.warnings.push('client tamper');assert.deepEqual(run.get(a.id).warnings,[]);
  release();await finish(run,a.id);assert.notEqual(run.start().id,a.id);
  assert.throws(()=>run.get('unknown'),/server restarted/);
});
test('empty slate still grades earlier picks; scan failure never suppresses grading or automatically retries odds',async()=>{
  for(const fails of [false,true]){
    let scans=0,grades=0;const run=new CollegeDailyRun({now:()=>now,read:()=>[pick(1)],scan:async()=>{scans++;if(fails)throw Error('offline');return{providerGames:0,warnings:[]};},
      gradeEvents:async()=>{grades++;return{checked:1,sourceFailures:0};}});
    const done=await finish(run,run.start().id);assert.equal(scans,1);assert.equal(grades,1);assert.equal(done.status,fails?'partial':'complete');
  }
});
test('source failures and storage errors preserve partial progress without endless grading loops',async()=>{
  let calls=0;const run=new CollegeDailyRun({now:()=>now,read:()=>Array.from({length:21},(_,i)=>pick(i+1)),scan:async()=>({warnings:[]}),
    gradeEvents:async()=>{calls++;if(calls===2)throw Error('storage');return{checked:10,sourceFailures:2};}});
  const done=await finish(run,run.start().id);assert.equal(done.status,'partial');assert.equal(calls,2);assert.equal(done.grading.gamesChecked,10);
  assert.equal(done.grading.sourceFailures,2);assert.ok(done.warnings.some(w=>w.includes('Grading could not finish')));
});
test('one-click leaves started but unfinished/future picks pending and never touches NFL or settled picks',async()=>{
  const picks=[pick(1,{result:'WIN'}),pick(2,{result:'LOSS'}),pick(3,{result:'PUSH'}),
    pick(4,{event:{...pick(4).event,sportKey:'americanfootball_nfl'}}),
    pick(5,{event:{...pick(5).event,commenceTime:new Date(now-3600_000).toISOString()}}),
    pick(6,{event:{...pick(6).event,commenceTime:new Date(now+3600_000).toISOString()}})];
  let calls=0;const before=JSON.stringify(picks),run=new CollegeDailyRun({now:()=>now,read:()=>picks,scan:async()=>({warnings:[]}),gradeEvents:async()=>{calls++;return{checked:0,sourceFailures:0};}});
  const done=await finish(run,run.start().id);assert.equal(calls,0);assert.equal(done.grading.gamesPlanned,0);assert.equal(JSON.stringify(picks),before);
});
test('bounded ledger grading processes requested IDs only and retains original lines/results',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'college-daily-grade-')),file=path.join(root,'college_paper_picks.json');
  const rows=[1,2,3].map(i=>({...pick(i),season:2026,version:'college-manual-paper-v1',rules:COLLEGE_PAPER_RULES,savedAt:'2026-09-03T20:00:00Z',
    quote:{market:'spreads',side:'Home',line:-3,price:-110,bookKey:'fanduel'},verifiedEvent:{espnEventId:String(i),homeTeamId:'100',awayTeamId:'200',neutralSite:false}}));
  fs.writeFileSync(file,JSON.stringify({schema:1,picks:rows}));const calls:string[]=[];
  const research:any={summary:async(id:string)=>{calls.push(id);return{header:{league:{slug:'college-football'},season:{year:2026,type:2},
    competitions:[{id,date:rows[0].event.commenceTime,status:{type:{completed:true,state:'post',name:'STATUS_FINAL'}},
      competitors:[{homeAway:'home',team:{id:'100'},score:'24'},{homeAway:'away',team:{id:'200'},score:'21'}]}]}};}};
  const ledger=createCollegePaperLedger(file,research,()=>now);
  try{
    await ledger.gradeEvents(['2']);assert.deepEqual(calls,['2']);assert.deepEqual(ledger.read().map(r=>r.result),['PENDING','PUSH','PENDING']);
    await ledger.gradeEvents(['2','3']);assert.deepEqual(calls,['2','3']);assert.equal(ledger.read()[1].quote.line,-3);
    assert.equal(ledger.replay('pick2').audits[0].status,'matched');
    await assert.rejects(()=>ledger.gradeEvents(Array(11).fill('1')),/Invalid/);
    await assert.rejects(()=>ledger.gradeEvents(['../bad']),/Invalid/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
