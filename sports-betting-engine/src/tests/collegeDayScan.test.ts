import test from 'node:test';
import assert from 'node:assert/strict';
import { CollegeDayScan,collegeDate,validateCollegeDate } from '../services/collegeDayScan';
import { NCAAF } from '../config/productionFocus';
const now=Date.parse('2026-09-02T23:00:00Z');
const game=(id='1',date='2026-09-03T23:00:00Z')=>({id,sportKey:NCAAF,homeTeam:`Home ${id}`,awayTeam:`Away ${id}`,commenceTime:date});
function espn(g=game()):any{return {id:g.id,name:`${g.awayTeam} @ ${g.homeTeam}`,date:g.commenceTime,season:{year:2026,type:2},competitions:[{id:g.id,neutralSite:true,competitors:[
  {homeAway:'home',team:{id:'100'+g.id,displayName:g.homeTeam}},{homeAway:'away',team:{id:'200'+g.id,displayName:g.awayTeam}},
]}]};}
function odds(g=game(),time=now):any{return {id:g.id,sport_key:NCAAF,home_team:g.homeTeam,away_team:g.awayTeam,commence_time:g.commenceTime,bookmakers:
  ['fanduel','draftkings','bovada','betonlineag'].map((book,i)=>({key:book,title:book,last_update:new Date(time).toISOString(),markets:[
    {key:'spreads',last_update:new Date(time).toISOString(),outcomes:[{name:g.homeTeam,point:-3.5,price:i?-110:120},{name:g.awayTeam,point:3.5,price:-110}]},
    {key:'totals',last_update:new Date(time).toISOString(),outcomes:[{name:'Over',point:45.5,price:i?-110:120},{name:'Under',point:45.5,price:-110}]},
  ]}))};}
function setup(games=[game()],opts:any={}){
  let clock=now,calls=0;const archives:any[]=[];
  const scanner=new CollegeDayScan({now:()=>clock,upcoming:async()=>games,scoreboard:async()=>({events:games.map(g=>espn(g))}),
    odds:async()=>{calls++;return {events:games.map(g=>odds(g,clock)),quota:{remainingRequests:19992,usedRequests:8,requestsMade:1},creditsUsed:2};},
    archive:r=>archives.push(r),...opts});
  return {scanner,archives,calls:()=>calls,setTime:(n:number)=>clock=n};
}
test('college date uses Central midnight including DST and rejects rolling-window/past/invalid input',()=>{
  assert.equal(collegeDate(Date.parse('2026-09-04T04:59:00Z')),'2026-09-03');
  assert.equal(collegeDate(Date.parse('2026-09-04T05:00:00Z')),'2026-09-04');
  assert.equal(collegeDate(Date.parse('2026-11-02T05:59:00Z')),'2026-11-01');
  assert.equal(collegeDate(Date.parse('2026-11-02T06:00:00Z')),'2026-11-02');
  for(const date of ['2026-09-01','2026-09-31','2026-09-16','../bad','2026-09-03T12:00:00Z'])assert.throws(()=>validateCollegeDate(date,now));
  validateCollegeDate('2026-09-15',now);
});
test('college full-day scan checks all 68 games with one bulk call; one-game selection never enters its API',async()=>{
  const s=setup(Array.from({length:68},(_,i)=>game(String(i+1),'2026-09-05T23:30:00Z')));
  const r=await s.scanner.scan('2026-09-05');
  assert.equal(s.calls(),1);assert.equal(r.providerGames,68);assert.equal(r.gamesWithFreshOdds,68);
  assert.equal(r.shortlist.length,136);assert.equal(r.rows.length,68);assert.equal(r.counts.price_research_found,68);
  assert.deepEqual(r.recommendations,[]);assert.equal(r.recommendationStatus,'blocked_model_validation');
  assert.equal(s.archives.length,1);assert.equal(s.archives[0].sources.odds.length,68);assert.equal(r.evidenceSaved,true);
});
test('college empty calendar day spends zero and next date is explicit, not silently scanned',async()=>{
  const s=setup();const r=await s.scanner.scan('2026-09-02');
  assert.equal(s.calls(),0);assert.equal(r.providerGames,0);assert.equal(r.nextDate,'2026-09-03');assert.equal(r.creditsUsed,0);
});
test('college calendar scope includes near-kickoff and UTC-next-day games, excludes started and other dates',async()=>{
  const s=setup([game('1','2026-09-03T23:00:00Z'),game('2','2026-09-04T04:59:00Z'),game('3','2026-09-04T05:00:00Z'),game('4','2026-09-03T22:00:00Z')]);
  s.setTime(Date.parse('2026-09-03T22:40:00Z'));const r=await s.scanner.scan('2026-09-03');
  assert.equal(r.providerGames,3);assert.equal(r.gamesWithFreshOdds,2);assert.equal(r.counts.started_or_complete,1);
});
test('college schedule/odds/archival failures remain explicit and cannot create a misleading successful empty slate',async()=>{
  const failed=async()=>{throw Error('offline');};
  for(const opts of [{upcoming:failed},{scoreboard:failed}]){
    const s=setup(undefined,opts),r=await s.scanner.scan('2026-09-03');
    assert.equal(s.calls(),0);assert.equal(r.coverage,'incomplete');assert.ok(r.warnings.length);assert.deepEqual(r.shortlist,[]);
  }
  const a=setup(undefined,{odds:failed}),r=await a.scanner.scan('2026-09-03');
  assert.equal(r.oddsStatus,'unavailable');assert.equal(r.counts.odds_unavailable,1);assert.equal(r.creditsUsed,null);
  const b=setup(undefined,{archive:()=>{throw Error('disk');}}),br=await b.scanner.scan('2026-09-03');
  assert.equal(br.evidenceSaved,false);assert.ok(br.warnings.some(w=>w.includes('evidence')));
});
test('college missing provider games and ambiguous identities are disclosed without fuzzy matching or paid fan-out',async()=>{
  const s=setup([game(),game()],{scoreboard:async()=>({events:[espn(),espn(game('2'))]})});
  const r=await s.scanner.scan('2026-09-03');assert.equal(r.providerGames,1);assert.equal(r.counts.ambiguous_provider_game,1);
  assert.equal(r.unmatchedScheduledGames,1);assert.equal(s.calls(),0);
  const mismatch=setup(undefined,{scoreboard:async()=>({events:[espn(game('2'))]})});
  const mr=await mismatch.scanner.scan('2026-09-03');assert.equal(mr.counts.identity_unverified,1);assert.equal(mismatch.calls(),0);
});
test('college exact-line research rejects stale/future quotes, missing prices, wrong games and insufficient book depth',async()=>{
  const scenarios=[
    {raw:[],status:'no_posted_odds'},
    {raw:[{...odds(),home_team:'Wrong'}],status:'odds_identity_mismatch'},
    {raw:[odds(game(),now-16*60_000)],status:'stale_odds'},
    {raw:[odds(game(),now+30_000)],status:'stale_odds'},
    {raw:[{...odds(),bookmakers:odds().bookmakers.slice(0,3)}],status:'insufficient_comparison'},
    {raw:[{...odds(),bookmakers:odds().bookmakers.slice(1)}],status:'no_configured_book'},
  ];
  for(const scenario of scenarios){
    const s=setup(undefined,{odds:async()=>({events:scenario.raw,quota:{remainingRequests:19992},creditsUsed:2})});
    const r=await s.scanner.scan('2026-09-03');assert.equal(r.rows[0].status,scenario.status);assert.deepEqual(r.shortlist,[]);
  }
});
test('college bulk cache serves different selected dates and expires; cached rows cannot survive kickoff',async()=>{
  const s=setup([game(),game('2','2026-09-04T23:00:00Z')]);
  await s.scanner.scan('2026-09-03');const cached=await s.scanner.scan('2026-09-04');
  assert.equal(cached.cached,true);assert.equal(cached.creditsUsed,0);assert.equal(s.calls(),1);
  s.setTime(now+5*60_000);await s.scanner.scan('2026-09-03');assert.equal(s.calls(),2);
  s.setTime(Date.parse(game().commenceTime));const started=await s.scanner.scan('2026-09-03');assert.deepEqual(started.shortlist,[]);assert.equal(s.calls(),2);
});
test('college overlapping day scans are blocked and cannot multiply paid requests',async()=>{
  let release:()=>void;const pending=new Promise<void>(r=>release=r);
  const s=setup(undefined,{upcoming:async()=>{await pending;return [game()];}});
  const first=s.scanner.scan('2026-09-03');await assert.rejects(()=>s.scanner.scan('2026-09-04'),/already running/);
  release();await first;assert.equal(s.calls(),1);
});
