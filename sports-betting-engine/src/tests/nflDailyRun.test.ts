import test from 'node:test';
import assert from 'node:assert/strict';
import {NflDailyRun} from '../services/nflDailyRun';
const now=Date.parse('2026-09-10T18:00:00Z'),event={id:'1',sportKey:'americanfootball_nfl',homeTeam:'Home',awayTeam:'Away',commenceTime:'2026-09-11T00:20:00Z'};
async function finish(run:NflDailyRun,id:string){for(let i=0;i<100;i++){await new Promise(resolve=>setImmediate(resolve));const job=run.get(id);if(job.stage==='finished')return job;}throw Error('job timeout');}
test('one-click NFL preflight scans only today, buys no odds and grades bounded eligible records',async()=>{let preflight:any[]=[];const grades:string[][]=[],picks:any[]=[{espnEventId:'401',result:'PENDING',event:{...event,commenceTime:'2026-09-10T10:00:00Z'}}];
  const run=new NflDailyRun({now:()=>now,events:async()=>[event,{...event,id:'tomorrow',commenceTime:'2026-09-12T00:20:00Z'}],preflight:async events=>{preflight=events;return{warnings:[],summary:{games:events.length}};},
    read:()=>picks,gradeEvents:async ids=>{grades.push(ids);return{checked:ids.length,sourceFailures:0};}}),done=await finish(run,run.start().id);
  assert.deepEqual(preflight,[event]);assert.deepEqual(grades,[['401']]);assert.equal(done.status,'complete');assert.equal(done.grading.picksChecked,1);
});
test('NFL daily double-click coalesces and source failure still reaches grading',async()=>{let release:()=>void,graded=0;const gate=new Promise<void>(resolve=>{release=resolve;});
  const run=new NflDailyRun({now:()=>now,events:async()=>[event],preflight:async()=>{await gate;throw Error('offline');},read:()=>[],gradeEvents:async()=>{graded++;return{checked:0,sourceFailures:0};}});
  const a=run.start(),b=run.start();assert.equal(a.id,b.id);release();const done=await finish(run,a.id);assert.equal(done.status,'partial');assert.equal(graded,0);assert.match(done.warnings.join(' '),/could not finish/);
});
