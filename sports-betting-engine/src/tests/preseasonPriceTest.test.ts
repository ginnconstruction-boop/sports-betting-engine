import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPriceGame,freshPairs,gradeAuditQuote,verifyPreseasonFinal,auditRecord,AuditGame} from '../dev/preseasonPriceTest';
const game:AuditGame={id:'test',name:'Away at Home',date:'2026-08-28T22:00:00Z',home:'Home',away:'Away',homeId:'1',awayId:'2',seasonType:1};
function event(){return {id:'odds',sport_key:'americanfootball_nfl_preseason',home_team:'Home',away_team:'Away',commence_time:game.date,
  bookmakers:['fanduel','draftkings','williamhill_us','betrivers'].map(key=>({key,markets:[{key:'h2h',last_update:'2026-08-28T20:55:00Z',
    outcomes:[{name:'Home',price:key==='fanduel'?120:-110},{name:'Away',price:key==='fanduel'?-140:-110}]}]}))};}
test('preseason price experiment requires three other books and selects one frozen exact-price candidate',()=>{
  const e=event(),a=assessPriceGame(game,[e]);assert.equal(a.selection.quote.side,'Home');assert.equal(a.selection.references.length,3);
  assert.ok(Math.abs(a.selection.conditionalReturn-0.1)<1e-12);assert.equal(a.benchmark.side,'Away');assert.equal(a.modelStatus,'UNSUPPORTED_PRESEASON');
  e.bookmakers.pop();assert.equal(assessPriceGame(game,[e]).selection,null);
});
test('preseason price test rejects future/stale prices, duplicate books, malformed pairs and wrong events',()=>{
  for(const stamp of ['2026-08-28T21:01:00Z','2026-08-28T20:00:00Z','bad']){
    const e=event();e.bookmakers[0].markets[0].last_update=stamp;assert.equal(freshPairs(e,'fanduel','h2h').length,0);
  }
  const e=event();e.bookmakers.push(e.bookmakers[0]);assert.equal(freshPairs(e,'fanduel','h2h').length,0);
  assert.equal(assessPriceGame(game,[event(),event()]).selection,null);
  assert.equal(assessPriceGame(game,[{...event(),sport_key:'americanfootball_nfl'}]).selection,null);
  assert.equal(assessPriceGame(game,[{...event(),commence_time:'2026-08-28T23:00Z'}]).selection,null);
});
test('reference probabilities never mix different total or signed spread lines',()=>{
  const e:any=event();for(const b of e.bookmakers)b.markets=[{key:'totals',last_update:'2026-08-28T20:55:00Z',outcomes:[{name:'Over',point:b.key==='fanduel'?35.5:36.5,price:b.key==='fanduel'?150:-110},{name:'Under',point:b.key==='fanduel'?35.5:36.5,price:-110}]}];
  assert.equal(assessPriceGame(game,[e]).selection,null);
  for(const b of e.bookmakers)for(const q of b.markets[0].outcomes)q.point=35.5;
  assert.equal(assessPriceGame(game,[e]).selection.quote.market,'totals');
});
function finals(){const competition={id:'test',date:game.date,status:{type:{completed:true,state:'post',name:'STATUS_FINAL'}},competitors:[
  {homeAway:'home',team:{id:'1',displayName:'Home'},score:'24'},{homeAway:'away',team:{id:'2',displayName:'Away'},score:'21'}]};
  return {data:{header:{league:{slug:'nfl'},season:{year:2026,type:1},competitions:[competition]}},scoreboard:{id:'test',season:{year:2026,type:1},competitions:[structuredClone(competition)]}};}
test('preseason result verification requires exact IDs, final status and agreeing scores',()=>{
  const {data,scoreboard}=finals();assert.equal(verifyPreseasonFinal(game,data,scoreboard).verified,true);
  scoreboard.competitions[0].competitors[0].score='23';assert.equal(verifyPreseasonFinal(game,data,scoreboard).verified,false);
  assert.equal(verifyPreseasonFinal(game,null,scoreboard).verified,false);
});
test('separate audit grading uses actual odds, signed lines, pushes and review exclusions',()=>{
  const {data,scoreboard}=finals(),final=verifyPreseasonFinal(game,data,scoreboard),q=freshPairs(event(),'fanduel','h2h')[0];
  assert.deepEqual(gradeAuditQuote(game,q,final),{result:'WIN',profit:1.2});
  assert.deepEqual(gradeAuditQuote(game,{...q,side:'Away',price:-140},final),{result:'LOSS',profit:-1});
  assert.equal(gradeAuditQuote(game,{...q,market:'spreads',line:-3},final).result,'PUSH');
  assert.equal(gradeAuditQuote(game,{...q,market:'totals',side:'Under',line:44.5},final).result,'LOSS');
  assert.equal(gradeAuditQuote(game,q,{...final,verified:false}).result,'REVIEW');
  const r=auditRecord([{result:'WIN',profit:1.2},{result:'LOSS',profit:-1},{result:'PUSH',profit:0},{result:'REVIEW',profit:null}]);
  assert.equal(r.winRate,0.5);assert.ok(Math.abs(r.profitUnits-0.2)<1e-12);assert.ok(Math.abs(r.settledRoi-0.2/3)<1e-12);assert.equal(r.review,1);
});
