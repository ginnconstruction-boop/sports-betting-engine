import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NflResearch, nflNumber, nflSeason, parseNflLogs, summarizeNflLogs, parseNflDepth } from '../services/nflResearch';
import { gradeNflPaper, NflPaperLedger, NflPaperPick, nflPaperReport, PAPER_RULES } from '../services/nflPaper';
import { scoreAllProps, scoreAllPropsWithIntelligence } from '../services/propScorer';
import { buildPropPredictions } from '../services/propIntelligence';
import { NflMarketBoard } from '../services/nflMarketBoard';

const kickoff = '2025-12-14T18:00:00Z';
const event = { id: 'odds-event', sportKey: 'americanfootball_nfl', homeTeam: 'Kansas City Chiefs', awayTeam: 'Los Angeles Chargers', commenceTime: kickoff };
const quote = { market: 'player_pass_yds', participant: 'Patrick Mahomes', side: 'Over', line: 188.5, price: -110, book: 'Test Book', bookKey: 'test', updatedAt: '2025-12-14T17:59:00Z', stale: false };
const player = { id: '3139477', name: 'Patrick Mahomes', teamId: '12', team: event.homeTeam, position: 'QB', rosterStatus: 'Active', injuries: [], fetchedAt: quote.updatedAt, source: 'ESPN' };
function pick(overrides: Partial<NflPaperPick> = {}): NflPaperPick {
  return { id: 'p1', event, espnEventId: '401772798', quote, player, season: 2025, version: 'test-v1', rules: PAPER_RULES, savedAt: quote.updatedAt, result: 'PENDING', note: '', ...overrides };
}
// Compact ESPN-shaped fixture using the verified December 14, 2025 game.
function summary() {
  return { header: { league: { slug: 'nfl' }, season: { year: 2025, type: 2 }, competitions: [{
    id: '401772798', date: kickoff, status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
    competitors: [
      { homeAway: 'home', team: { id: '12', displayName: event.homeTeam }, score: '13', linescores: [7, 6, 0, 0].map(n => ({ displayValue: String(n) })) },
      { homeAway: 'away', team: { id: '24', displayName: event.awayTeam }, score: '16', linescores: [3, 7, 6, 0].map(n => ({ displayValue: String(n) })) },
    ] }] }, boxscore: { players: [{ team: { id: '12' }, statistics: [
      { name: 'passing', keys: ['passingYards'], athletes: [{ athlete: { id: player.id, displayName: player.name }, stats: ['189'] }] },
      { name: 'rushing', keys: ['rushingYards'], athletes: [{ athlete: { id: player.id, displayName: player.name }, stats: ['15'] }] },
      { name: 'receiving', keys: ['receivingYards', 'receptions'], athletes: [{ athlete: { id: player.id, displayName: player.name }, stats: ['0', '0'] }] },
    ] }] } };
}
function logs() {
  return { filters: [{ name: 'season', value: '2025' }], names: ['points', 'passingYards'],
    events: {
      one: { gameDate: '2025-12-14T18:00:00Z', gameResult: 'L', team: { id: '12' } },
      two: { gameDate: '2025-12-07T18:00:00Z', gameResult: 'W', team: { id: '12' } },
      future: { gameDate: '2025-12-21T18:00:00Z', gameResult: 'W' },
      missing: { gameDate: '2025-12-01T18:00:00Z', gameResult: 'L' },
    }, seasonTypes: [{ categories: [{ type: 'event', splitType: '2', events: [
      { eventId: 'one', stats: ['99', '189'] }, { eventId: 'two', stats: ['99', '0'] },
      { eventId: 'future', stats: ['99', '900'] }, { eventId: 'missing', stats: ['99', '--'] },
      { eventId: 'one', stats: ['99', '189'] },
    ] }, { type: 'event', splitType: '1', events: [{ eventId: 'missing', stats: ['99', '999'] }] }] }] };
}

test('NFL numeric parsing preserves zero and negative yards but rejects blanks and missing values', () => {
  for (const v of [null, undefined, '', ' ', '--', 'DNP', '2/3']) assert.equal(nflNumber(v), null);
  assert.equal(nflNumber('0'), 0); assert.equal(nflNumber('-3'), -3); assert.equal(nflNumber('1,000'), 1000);
  assert.equal(nflSeason('2026-01-04'), 2025); assert.equal(nflSeason('2026-09-01'), 2026);
});
test('NFL logs use named football stat, correct season and split; exclude future, missing and duplicates', () => {
  const rows = parseNflLogs(logs(), 2025, 'player_pass_yds', Date.parse('2025-12-20'));
  assert.deepEqual(rows.map(r => r.value), [189, 0]);
  assert.equal(parseNflLogs(logs(), 2026, 'player_pass_yds', Date.now()).length, 0);
  assert.equal(parseNflLogs(logs(), 2025, 'player_points', Date.now()).length, 0);
  const s = summarizeNflLogs(rows, 189); assert.equal(s.mean, 94.5); assert.equal(s.pushes, 1); assert.equal(s.under, 1); assert.equal(s.historicalOverRateExcludingPushes, 0);
  assert.equal(summarizeNflLogs([], 1).mean, null);
});
test('NFL cannot enter generic basketball-shaped scoring or predictions', async () => {
  assert.deepEqual(scoreAllProps([{} as any], 24, event.sportKey), []);
  assert.deepEqual(await scoreAllPropsWithIntelligence([{} as any], 24, new Map(), event.sportKey), []);
  assert.equal((await buildPropPredictions([{} as any], new Map(), event.sportKey)).predictions.size, 0);
});
test('NFL props grade exact IDs/stat columns including true zero, push and under', () => {
  assert.equal(gradeNflPaper(pick(), summary()).result, 'WIN');
  assert.equal(gradeNflPaper(pick({ quote: { ...quote, line: 189 } }), summary()).result, 'PUSH');
  assert.equal(gradeNflPaper(pick({ quote: { ...quote, side: 'Under' } }), summary()).result, 'LOSS');
  for(const market of ['player_receptions', 'player_reception_yds']) assert.equal(gradeNflPaper(pick({quote:{...quote,market,line:0.5,side:'Under'}}), summary()).result,'WIN');
  assert.equal(gradeNflPaper(pick({quote:{...quote,market:'player_rush_yds',line:15}}),summary()).result,'PUSH');
});
test('missing/ambiguous player stats and wrong game identity require review, never a zero', () => {
  const missing=summary();missing.boxscore.players=[];
  assert.equal(gradeNflPaper(pick(), missing).result,'REVIEW');
  const wrong=summary();wrong.header.competitions[0].id='999';
  assert.equal(gradeNflPaper(pick(), wrong).result,'REVIEW');
  assert.equal(gradeNflPaper(pick({player:{...player,id:'999'}}),summary()).result,'REVIEW');
  const dup=summary();dup.boxscore.players[0].statistics[0].athletes.push(dup.boxscore.players[0].statistics[0].athletes[0]);
  assert.equal(gradeNflPaper(pick(),dup).result,'REVIEW');
  const unfinished=summary();unfinished.header.competitions[0].status.type.completed=false;
  assert.equal(gradeNflPaper(pick(),unfinished).result,'PENDING');
});
test('game, quarter and half grading respects selected team, signed spread, pushes and period', () => {
  const grade=(market:string,side:string,line:number|null)=>gradeNflPaper(pick({quote:{...quote,market,side,line,participant:''}}),summary());
  assert.equal(grade('h2h',event.awayTeam,null).result,'WIN');
  assert.equal(grade('spreads',event.homeTeam,3).result,'PUSH');
  assert.equal(grade('totals','Under',30).result,'WIN');
  assert.equal(grade('totals_q1','Over',9.5).actual,10);
  assert.equal(grade('h2h_q4',event.homeTeam,null).result,'PUSH');
  assert.equal(grade('totals_h1','Over',23).result,'PUSH');
  assert.equal(grade('totals_h2','Under',6.5).result,'WIN');
  assert.equal(grade('h2h_3_way_q1','Draw',null).result,'REVIEW');
});
test('regulation periods exclude OT; missing or inconsistent periods require review', () => {
  const ot=summary(); const away=ot.header.competitions[0].competitors[1];
  away.score='22';away.linescores.push({displayValue:'6'});
  const q=(market:string)=>pick({quote:{...quote,market,line:7,side:'Under'}});
  assert.equal(gradeNflPaper(q('totals_h2'),ot).actual,6);
  assert.equal(gradeNflPaper(q('totals'),ot).actual,35);
  away.linescores.pop();assert.equal(gradeNflPaper(q('totals_h2'),ot).result,'REVIEW');
  away.linescores.pop();assert.equal(gradeNflPaper(q('totals_q1'),ot).result,'REVIEW');
});
test('paper report separates seasons and exact markets, excludes review/pending from ROI', () => {
  const report=nflPaperReport([pick({result:'WIN',quote:{...quote,price:150}}),pick({id:'p2',result:'LOSS'}),pick({id:'p3',result:'PUSH'}),pick({id:'p4',result:'REVIEW'}),pick({id:'p5',season:2026}),pick({id:'p6',quote:{...quote,market:'player_receptions'}})]);
  assert.equal(report.buckets.length,3); const b=report.buckets[0];assert.equal(b.profitUnits,0.5);assert.equal(b.roi,0.5/3);assert.equal(b.winRate,0.5);assert.equal(b.uniqueEvents,1);
});
test('roster lookup rejects first-initial guesses and ambiguous names', async () => {
  const fake=async(url:string)=>url.endsWith('/teams')?{sports:[{leagues:[{teams:[{team:{id:'12',displayName:event.homeTeam}},{team:{id:'24',displayName:event.awayTeam}}]}]}]}:
    {season:{year:2025},team:{id:url.includes('/12/')?'12':'24'},athletes:[{items:[{id:'3139477',displayName:'Patrick Mahomes'}]}]};
  const r=new NflResearch(fake);
  await assert.rejects(()=>r.player(event,'P. Mahomes'),/missing or ambiguous/);
  await assert.rejects(()=>r.player(event,'Patrick Mahomes'),/missing or ambiguous/);
});
test('depth charts require matching season/team/player and report listed order, not starter certainty', () => {
  const data={season:{year:2025},team:{id:'12'},depthchart:[{name:'3WR',positions:{qb:{athletes:[{id:'999',displayName:'Other Player'},{id:player.id,displayName:player.name}]}}}]};
  assert.deepEqual(parseNflDepth(data,player,2025),[{formation:'3WR',position:'qb',listedOrder:2}]);
  assert.deepEqual(parseNflDepth(data,player,2026),[]);
  assert.deepEqual(parseNflDepth(data,{...player,teamId:'24'},2025),[]);
});
test('opportunity baselines exclude missing values and preserve true zero', () => {
  const data=logs();data.names.push('passingAttempts');
  data.seasonTypes[0].categories[0].events[0].stats.push('28');
  data.seasonTypes[0].categories[0].events[1].stats.push('0');
  const rows=parseNflLogs(data,2025,'player_pass_yds',Date.parse('2025-12-20'));
  assert.equal(summarizeNflLogs(rows,189).meanOpportunities,14);
  assert.equal(summarizeNflLogs(rows,189).opportunityGames,2);
});
test('result-source outage stays reviewable and retries safely', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-paper-outage-'));let now=Date.parse('2025-12-14T17:59:30Z'),failed=true;
  const ledger=new NflPaperLedger(path.join(dir,'paper.json'),{matchEvent:async()=> '401772798',player:async()=>player,summary:async()=>{if(failed)throw Error('offline');return summary();}},()=>now);
  try {await ledger.save(event,quote,PAPER_RULES);now=Date.parse('2025-12-14T23:00Z');assert.equal((await ledger.grade()).picks[0].result,'REVIEW');failed=false;assert.equal((await ledger.grade()).picks[0].result,'WIN');}
  finally {fs.rmSync(dir,{recursive:true});}
});
test('corrupt ledger is never silently reset or overwritten', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-paper-corrupt-'));const file=path.join(dir,'paper.json');
  try {fs.writeFileSync(file,'{"schema":0}');const ledger=new NflPaperLedger(file,new NflResearch());assert.throws(()=>ledger.read(),/refusing to overwrite/);assert.equal(fs.readFileSync(file,'utf8'),'{"schema":0}');}
  finally {fs.rmSync(dir,{recursive:true});}
});
test('paper persistence deduplicates across books, refuses stale/post-kickoff, preserves prior records', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-paper-test-'));
  const file=path.join(dir,'paper.json');let now=Date.parse('2025-12-14T17:59:30Z');
  const fake={matchEvent:async()=> '401772798',player:async()=>player,summary:async()=>summary()};
  const ledger=new NflPaperLedger(file,fake,()=>now);
  try {
    assert.equal((await ledger.save(event,quote,PAPER_RULES)).duplicate,false);
    assert.equal((await ledger.save(event,{...quote,bookKey:'other',price:120},PAPER_RULES)).duplicate,true);
    assert.equal(ledger.read().length,1);assert.equal(ledger.read()[0].quote.price,-110);
    await assert.rejects(()=>ledger.save(event,{...quote,updatedAt:'2025-12-14T16:00Z'},PAPER_RULES),/stale/);
    await assert.rejects(()=>ledger.save(event,quote,'unconfirmed'),/acknowledged/);
    now=Date.parse('2025-12-14T23:00Z');await assert.rejects(()=>ledger.save(event,quote,PAPER_RULES),/kickoff/);
    const graded=await ledger.grade();assert.equal(graded.checked,1);assert.equal(graded.picks[0].result,'WIN');
    assert.equal((await ledger.grade()).checked,0);
  } finally {fs.rmSync(dir,{recursive:true});}
});
test('paper observations only compare the same market, player, side, line and book before kickoff', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-paper-observe-'));let now=Date.parse('2025-12-14T17:59:30Z');
  const ledger=new NflPaperLedger(path.join(dir,'paper.json'),{matchEvent:async()=> '401772798',player:async()=>player,summary:async()=>summary()},()=>now);
  try {
    await ledger.save(event,quote,PAPER_RULES);
    ledger.observe(event.id,[{...quote,line:200,price:120,updatedAt:'2025-12-14T17:59:20Z'}]);assert.equal(ledger.read()[0].latestPregame,undefined);
    ledger.observe(event.id,[{...quote,price:120,updatedAt:'2025-12-14T17:59:20Z'}]);assert.equal(ledger.read()[0].latestPregame.price,120);
    now=Date.parse(kickoff);ledger.observe(event.id,[{...quote,price:160,updatedAt:kickoff}]);assert.equal(ledger.read()[0].latestPregame.price,120);
  } finally {fs.rmSync(dir,{recursive:true});}
});
test('paper save cannot cross kickoff while awaiting provider data', async () => {
  let now=Date.parse('2025-12-14T17:59:30Z');
  const ledger=new NflPaperLedger('unused-test-file',{matchEvent:async()=>{now=Date.parse(kickoff);return '401772798';},player:async()=>player,summary:async()=>summary()},()=>now);
  await assert.rejects(()=>ledger.save(event,quote,PAPER_RULES),/kickoff/);
});
test('board selection uses server-owned quote IDs, expires, and never silently purchases odds', async () => {
  let now=Date.parse('2025-12-14T17:00:00Z'),calls=0;
  const board=new NflMarketBoard({now:()=>now,upcoming:async()=>[event],odds:async()=>{calls++;return {event:{id:event.id,sport_key:event.sportKey,home_team:event.homeTeam,away_team:event.awayTeam,commence_time:kickoff,bookmakers:[{key:'test',title:'Test',last_update:new Date(now).toISOString(),markets:[{key:'player_pass_yds',outcomes:[{name:'Over',description:player.name,point:188.5,price:-110}]}]}]} as any,quota:{} as any};}});
  const data=await board.quotes(event.id,'passing');const id=data.quotes[0].quoteId;
  assert.equal(board.selection(event.id,'passing',id).quote.price,-110);
  assert.throws(()=>board.selection(event.id,'passing','forged'),/Select a quote/);
  now+=5*60_000;assert.throws(()=>board.selection(event.id,'passing',id),/expired/);assert.equal(calls,1);
});
