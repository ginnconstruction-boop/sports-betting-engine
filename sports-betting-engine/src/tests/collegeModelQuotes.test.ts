import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessCollegeQuote,selectCollegeQuotes} from '../services/collegeModelQuotes';
const now=Date.parse('2026-09-02T18:00:00Z');
const event:any={sportKey:'americanfootball_ncaaf',id:'game',homeTeam:'Home',awayTeam:'Away',commenceTime:'2026-09-03T18:00:00Z'};
const p:any={asOf:new Date(now).toISOString(),homeMargin:10,total:50,homeGames:12,awayGames:12};
const q:any={market:'spreads',participant:'',side:'Home',line:-3,price:-110,bookKey:'fanduel',book:'FanDuel',stale:false,updatedAt:new Date(now-1000).toISOString()};
const residuals={marginResiduals:Array.from({length:1000},(_,i)=>i%20-10),totalResiduals:Array.from({length:1000},(_,i)=>i%20-10)};
test('college residual probabilities account for exact integer pushes and EV',()=>{
  const a=assessCollegeQuote(event,q,p,residuals,now);assert.equal(a.eligible,true);assert.equal(a.pushProbability,.05);
  assert.ok(Math.abs(a.probability+a.pushProbability+a.lossProbability-1)<1e-10);
  assert.equal(a.pointGap,7);assert.ok(Math.abs(a.estimatedEV-(a.probability*100/110-a.lossProbability))<1e-10);
  assert.equal(assessCollegeQuote(event,{...q,line:-3.5},p,residuals,now).pushProbability,0);
});
test('college paper selection requires approved market, fixed thresholds and one selection per market',()=>{
  const rows=[q,{...q,bookKey:'betmgm',price:-105},{...q,side:'Away',line:3},{...q,market:'totals',side:'Over',line:40}];
  const result=selectCollegeQuotes(event,rows,p,residuals,now,{spreads:true,totals:false});
  assert.equal(result.selected.length,1);assert.equal(result.selected[0].quote.bookKey,'betmgm');
  assert.equal(assessCollegeQuote(event,{...q,line:-8},p,residuals,now).eligible,false);
  assert.equal(assessCollegeQuote(event,{...q,price:-250},p,residuals,now).eligible,false);
});
test('college quote model fails closed on future, stale, wrong sport/side/book and insufficient evidence',()=>{
  for(const bad of [{...q,updatedAt:new Date(now+1000).toISOString()},{...q,stale:true},{...q,side:'Unknown'},
    {...q,bookKey:'pinnacle'},{...q,market:'h2h'},{...q,line:null}])assert.equal(assessCollegeQuote(event,bad,p,residuals,now).eligible,false);
  assert.equal(assessCollegeQuote({...event,sportKey:'americanfootball_nfl'},q,p,residuals,now).eligible,false);
  assert.equal(assessCollegeQuote(event,q,{...p,asOf:new Date(now-3600_000).toISOString()},residuals,now).eligible,false);
  assert.equal(assessCollegeQuote(event,q,p,{...residuals,marginResiduals:[1,2]},now).eligible,false);
});
