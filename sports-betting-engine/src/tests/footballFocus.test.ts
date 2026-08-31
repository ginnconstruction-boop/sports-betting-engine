import test from 'node:test';
import assert from 'node:assert/strict';
import { NFL, NCAAF, productionMarkets, isPausedCommand } from '../config/productionFocus';
import { getEnabledSports } from '../config/sports';
import { PROP_CONFIG } from '../config/propConfig';
import { NFL_MARKET_GROUPS, isNflMarketGroup } from '../config/nflMarkets';
import { NflMarketBoard, flattenNflQuotes } from '../services/nflMarketBoard';
import { normalizeEvent } from '../services/normalizeOdds';
import { RawEvent } from '../types/odds';

const now = Date.parse('2026-08-30T12:00:00Z');
const upcoming = { id:'game1', sportKey:NFL, commenceTime:'2026-09-09T20:00:00Z', homeTeam:'Home', awayTeam:'Away' };
function fixture(overrides: Partial<RawEvent> = {}): RawEvent {
  return { id:'game1', sport_key:NFL, sport_title:'NFL', commence_time:upcoming.commenceTime,
    home_team:'Home', away_team:'Away', bookmakers:[{key:'fanduel',title:'FanDuel',last_update:new Date(now).toISOString(),markets:[
      {key:'player_pass_yds',last_update:new Date(now).toISOString(),outcomes:[
        {name:'Over',description:'QB One',point:250.5,price:-110},
        {name:'Over',description:'QB One',point:275.5,price:150},
        {name:'Under',description:'QB One',point:250.5,price:-115},
      ]},
      {key:'totals_q1',last_update:new Date(now-20*60_000).toISOString(),outcomes:[{name:'Over',point:7.5,price:-110}]},
      {key:'player_1st_td',last_update:new Date(now).toISOString(),outcomes:[{name:'Yes',description:'WR One',price:1200}]},
    ]}], ...overrides };
}
const quota = { remainingRequests:19980, usedRequests:20, requestsMade:1 };

test('production enables only football; NCAA spreads and totals, props NFL only', () => {
  assert.deepEqual(getEnabledSports(true).map(s=>s.key),[NFL,NCAAF]);
  assert.deepEqual(PROP_CONFIG.ENABLED_SPORTS,[NFL]);
  assert.deepEqual(productionMarkets(NCAAF,['h2h','spreads','totals','player_pass_yds']),['spreads','totals']);
  assert.throws(()=>productionMarkets('basketball_nba',['h2h']),/paused/);
  assert.equal(isPausedCommand('mlbprops'),true);
  assert.equal(isPausedCommand('nflprops'),false);
  assert.equal(isPausedCommand('record'),false);
});
test('all 4 quarters, halves and correct first-TD key are selectable', () => {
  for (const period of ['q1','q2','q3','q4','h1','h2']) {
    assert.ok(NFL_MARKET_GROUPS[period].markets.includes(`totals_${period}`));
    assert.ok(NFL_MARKET_GROUPS[period].markets.includes(`spreads_${period}`));
  }
  assert.ok(NFL_MARKET_GROUPS.touchdowns.markets.includes('player_1st_td'));
  assert.equal(isNflMarketGroup('__proto__'),false);
  assert.equal(isNflMarketGroup('constructor'),false);
});
test('cached NCAA responses cannot reintroduce moneylines', () => {
  const event=fixture({sport_key:NCAAF});
  event.bookmakers[0].markets=[
    {key:'h2h',last_update:'',outcomes:[{name:'Home',price:-110}]},
    {key:'spreads',last_update:'',outcomes:[{name:'Home',point:-3,price:-110}]},
    {key:'totals',last_update:'',outcomes:[{name:'Over',point:50,price:-110}]},
  ];
  assert.deepEqual(normalizeEvent(event,new Date(now).toISOString()).map(r=>r.marketKey),['spreads','totals']);
});
test('quotes retain player identity, exact lines, sides and stale period timestamps', () => {
  const rows=flattenNflQuotes(fixture(),['player_pass_yds','totals_q1','player_1st_td'],now);
  assert.equal(rows.length,5);
  assert.equal(rows.find(r=>r.market==='player_1st_td').participant,'WR One');
  assert.equal(rows.find(r=>r.market==='player_1st_td').side,'Yes');
  assert.equal(rows.find(r=>r.market==='totals_q1').stale,true);
  assert.equal(rows.filter(r=>r.participant==='QB One'&&r.side==='Over').length,2);
  assert.deepEqual(flattenNflQuotes(fixture(),['not_a_market'],now),[]);
});
test('board discovers only upcoming 14-day NFL games, caches quotes and rejects invalid requests', async () => {
  let calls=0;
  const board=new NflMarketBoard({now:()=>now,upcoming:async()=>[
    upcoming,{...upcoming,id:'past',commenceTime:'2026-08-29T12:00:00Z'},
    {...upcoming,id:'far',commenceTime:'2026-10-01T12:00:00Z'}, {...upcoming,id:'college',sportKey:NCAAF},
  ],odds:async()=>{calls++;return {event:fixture(),quota};}});
  assert.deepEqual((await board.events()).map(e=>e.id),['game1']);
  const first=await board.quotes('game1','passing');
  assert.equal(first.cached,false); assert.equal(first.quotes.length,3);
  assert.equal((await board.quotes('game1','passing')).cached,true); assert.equal(calls,1);
  for(const [id,group] of [['past','passing'],['far','passing'],['game1','__proto__'],['../escape','passing']]) {
    await assert.rejects(()=>board.quotes(id,group));
  }
  assert.equal(calls,1);
});
test('no posted markets is explicit; budget blocks and wrong events fail closed', async () => {
  const deps={now:()=>now,upcoming:async()=>[upcoming]};
  const empty=new NflMarketBoard({...deps,odds:async()=>({event:fixture({bookmakers:[]}),quota})});
  assert.equal((await empty.quotes('game1','q1')).status,'not_posted');
  const blocked=new NflMarketBoard({...deps,odds:async()=>({event:null,quota})});
  await assert.rejects(()=>blocked.quotes('game1','q1'),/blocked/);
  const wrong=new NflMarketBoard({...deps,odds:async()=>({event:fixture({id:'other'}),quota})});
  await assert.rejects(()=>wrong.quotes('game1','q1'),/mismatched/);
});
test('concurrent identical requests are coalesced and other categories do not fan out', async () => {
  let calls=0; let release:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const board=new NflMarketBoard({now:()=>now,upcoming:async()=>[upcoming],odds:async()=>{calls++;await gate;return {event:fixture(),quota};}});
  await board.events();
  const a=board.quotes('game1','passing'); const b=board.quotes('game1','passing');
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(()=>board.quotes('game1','q1'),/Another market request/);
  release(); await Promise.all([a,b]); assert.equal(calls,1);
});
test('started games cannot be served from quote cache', async () => {
  let clock=now;
  const board=new NflMarketBoard({now:()=>clock,upcoming:async()=>[upcoming],odds:async()=>({event:fixture(),quota})});
  await board.quotes('game1','passing'); clock=Date.parse(upcoming.commenceTime)+1000;
  await assert.rejects(()=>board.quotes('game1','passing'),/upcoming/);
});
