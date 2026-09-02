import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCollegeScores,mergeCollegeResults,parseCollegeResults,CollegeResult } from '../services/collegeScoreModel';
function history():CollegeResult[]{return Array.from({length:160},(_,i)=>{
  const h=String(i%8),a=String((i+1+i%3)%8),date=new Date(Date.UTC(2024,8,1+i%90)).toISOString();
  return {id:String(1000+i),date,season:2024,homeId:h,awayId:a===h?'9':a,homeName:h,awayName:a,homeScore:28+Number(h),awayScore:20+Number(a),neutral:i%7===0};
});}
test('college score model excludes target-day, future and other seasons from training, without mutating history',()=>{
  const games=history(),asOf=Date.parse('2025-09-01T12:00:00Z'),config={ridge:3,halfLifeDays:365};
  const before=JSON.stringify(games),base=fitCollegeScores(games,asOf,config);
  const leaked=[{...games[0],id:'99999',season:2025,date:'2025-09-02T12:00:00Z',homeScore:150},
    {...games[0],id:'99998',season:2025,date:'2025-09-01T02:00:00Z',homeScore:149},
    {...games[0],id:'99997',season:2023,date:'2023-11-01T02:00:00Z',homeScore:148}];
  const withFuture=fitCollegeScores([...games,...leaked],asOf,config);
  assert.equal(base.historyHash,withFuture.historyHash);assert.deepEqual(base.predict('0','1',false),withFuture.predict('0','1',false));
  assert.equal(JSON.stringify(games),before);
});
test('college score model learns venue separately, returns coherent spread/total and blocks unknown teams',()=>{
  const model=fitCollegeScores(history(),Date.parse('2025-09-01T12:00:00Z'),{ridge:3,halfLifeDays:365});
  const p=model.predict('0','1',false),n=model.predict('0','1',true);
  assert.ok(Number.isFinite(p.total));assert.equal(p.homeMargin,p.homeScore-p.awayScore);assert.equal(p.total,p.homeScore+p.awayScore);
  assert.equal(p.fairHomeSpread,-p.homeMargin);assert.ok(Math.abs((p.homeMargin-n.homeMargin)-p.learnedHomeAdvantage)<1e-6);
  assert.equal(model.predict('missing','1',false),null);assert.equal(model.predict('1','1',false),null);
  assert.equal(p.homeCurrentGames,0);assert.ok(p.homeGames>=6);
});
test('college history merge accepts exact overlaps but rejects conflicting scores or orientation',()=>{
  const g=history()[0];assert.equal(mergeCollegeResults([[g],[g]]).length,1);
  assert.throws(()=>mergeCollegeResults([[g],[{...g,homeScore:99}]]),/Conflicting/);
  assert.throws(()=>mergeCollegeResults([[g],[{...g,homeId:'wrong'}]]),/Conflicting/);
});
test('college result parser refuses truncation, missing/invalid scores and unknown neutral venues',()=>{
  const e:any={id:'1',date:'2024-09-01T18:00:00Z',season:{year:2024,type:2},competitions:[{id:'1',neutralSite:false,status:{type:{completed:true,state:'post',name:'STATUS_FINAL'}},
    competitors:[{homeAway:'home',team:{id:'10',displayName:'Home'},score:'28'},{homeAway:'away',team:{id:'20',displayName:'Away'},score:'21'}]}]};
  assert.equal(parseCollegeResults({events:[e]},2024).games.length,1);
  for(const mutate of [(x:any)=>delete x.competitions[0].neutralSite,(x:any)=>x.competitions[0].competitors[0].score='',
    (x:any)=>x.competitions[0].competitors[0].score='-1',(x:any)=>x.competitions[0].status.type.completed=false]){
    const copy=structuredClone(e);mutate(copy);assert.equal(parseCollegeResults({events:[copy]},2024).games.length,0);
  }
  assert.throws(()=>parseCollegeResults({events:Array(1000).fill(e)},2024),/truncated/);
});
