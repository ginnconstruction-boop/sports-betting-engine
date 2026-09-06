import test from 'node:test';
import assert from 'node:assert/strict';
import { nflForwardGate, nflObservedClv } from '../services/nflForwardGate';
import type { NflPaperPick } from '../services/nflPaper';

function pick(overrides: Partial<NflPaperPick> = {}): NflPaperPick {
  return { id:'p1',origin:'model',event:{id:'g1',sportKey:'americanfootball_nfl',homeTeam:'A',awayTeam:'B',commenceTime:'2026-09-10T00:00:00Z'},espnEventId:'1',
    quote:{quoteId:'q',market:'player_pass_yds',participant:'Player',side:'Over',line:250.5,price:-110,book:'Book',bookKey:'book',updatedAt:'2026-09-09T23:00:00Z',stale:false},
    season:2026,version:'model',rules:'regulation-periods_full-game-includes-ot_v1',savedAt:'2026-09-09T23:00:00Z',result:'WIN',note:'test',actual:280,
    modelProbability:.58,modelPushProbability:0,forecast:{point:{projection:270,baseline:250}} as any,...overrides };
}

test('prop CLV signs line movement from the selected side and labels unverified observations',()=>{
  const over=pick({closeWindow:{line:248.5,price:-120,bookKey:'book',updatedAt:'2026-09-09T23:59:00Z',observedAt:'2026-09-09T23:59:10Z',method:'observed_last_5_minutes_not_verified_final_close'}});
  assert.deepEqual(nflObservedClv(over),{lineClv:2,priceClvProbability:null,verified:false,method:'observed_last_5_minutes_not_verified_final_close',openingLine:250.5,closingLine:248.5,openingPrice:-110,closingPrice:-120});
  const under=pick({quote:{...pick().quote,side:'Under'},closeWindow:{line:252.5,price:-110,bookKey:'book',updatedAt:'2026-09-09T23:59:00Z',observedAt:'2026-09-09T23:59:10Z',method:'verified_same_book_final_close'}});
  assert.equal(nflObservedClv(under)!.lineClv,2);assert.equal(nflObservedClv(under)!.verified,true);
});

test('forward gate is per market and cannot pass on software checks or a tiny sample',()=>{
  const report=nflForwardGate([pick()]);
  const passing=report.markets.find(row=>row.market==='player_pass_yds')!;
  assert.equal(report.moneyBettingApproved,false);assert.equal(report.kellyEnabled,false);
  assert.equal(passing.status,'COLLECTING_FORWARD_EVIDENCE');assert.equal(passing.settled,1);assert.equal(passing.distinctGames,1);
  assert.equal(passing.verifiedCloses,0);assert.ok(passing.checks.some(check=>check.id==='verified_closes'&&!check.pass));
  assert.equal(report.markets.find(row=>row.market==='player_rush_yds')!.settled,0);
});

test('same-line close reports price CLV as an implied-probability difference',()=>{
  const row=pick({closeWindow:{line:250.5,price:-120,bookKey:'book',updatedAt:'2026-09-09T23:59:00Z',observedAt:'2026-09-09T23:59:10Z',method:'verified_same_book_final_close'}});
  assert.ok(nflObservedClv(row)!.priceClvProbability!>0);
});
