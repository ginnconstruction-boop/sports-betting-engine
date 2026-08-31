import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exactMarketBaseline } from '../services/footballMarketBaseline';
import { availabilityReasons, NflEvidenceArchive } from '../services/nflEvidence';
import { footballPaperMetrics } from '../services/footballValidation';
import { isPausedCommand } from '../config/productionFocus';
const now = Date.parse('2026-09-10T23:00Z');
const event = { id: 'e', sportKey: 'americanfootball_nfl', homeTeam: 'Home', awayTeam: 'Away', commenceTime: '2026-09-11T00:00Z' };
const q: any = { market: 'player_receptions', participant: 'Player', side: 'Over', line: 4.5, price: -110,
  bookKey: 'target', book: 'Target', updatedAt: new Date(now).toISOString(), stale: false };
const refs = ['a','b','c'].flatMap(bookKey => [{ ...q, bookKey }, { ...q, bookKey, side: 'Under' }]);
test('legacy specialty commands and aliases cannot bypass production restrictions',()=>{
  for(const command of ['firsttd','ftd','sgp','sgp-nfl','parlay','alt','altparlays','altparlays-nfl','teasers','teaser'])
    assert.equal(isPausedCommand(command),true);
  for(const command of ['nfl','ncaaf','record','results'])assert.equal(isPausedCommand(command),false);
});
test('no-vig reference uses exact lines and three other books, independent of target price', () => {
  const a = exactMarketBaseline(event, q, [...refs,q,{...q,side:'Under',price:900}], now);
  assert.equal(a.conditionalNoPushProbability, .5);
  assert.equal(a.referenceBooks.length, 3);
  const b = exactMarketBaseline(event, {...q,price:150}, refs, now);
  assert.equal(b.conditionalNoPushProbability, a.conditionalNoPushProbability);
  assert.notEqual(b.conditionalPriceAdvantage, a.conditionalPriceAdvantage);
  assert.equal(exactMarketBaseline(event, q, refs.map((r,i)=>i===0?{...r,line:5.5}:r), now).status, 'unavailable');
  assert.equal(exactMarketBaseline(event, q, [...refs,refs[0]], now).status, 'unavailable');
});
test('market baseline rejects stale/future/asynchronous/wrong-period pairs and matches opposite spread signs', () => {
  for (const changed of [{updatedAt:'2026-09-10T23:01Z'}, {updatedAt:'2026-09-10T22:40Z'},
    {market:'player_receptions_q1'}, {updatedAt:'2026-09-10T22:59Z'}])
    assert.equal(exactMarketBaseline(event,q,refs.map((r,i)=>i===0?{...r,...changed}:r),now).status,'unavailable');
  const spread={...q,participant:'',market:'spreads',side:'Home',line:-3};
  const pairs=['a','b','c'].flatMap(bookKey=>[{...spread,bookKey},{...spread,bookKey,side:'Away',line:3}]);
  assert.equal(exactMarketBaseline(event,spread,pairs,now).conditionalNoPushProbability,.5);
  assert.equal(exactMarketBaseline(event,{...q,market:'player_anytime_td'},refs,now).status,'unavailable');
});
test('availability requires exact game/player/team and a fresh pregame official status, not just roster active', () => {
  const input:any={player:{id:'p',teamId:'t'}};
  const a:any={eventId:'e',playerId:'p',teamId:'t',status:'active',source:'https://fixture.invalid/game',
    sourceKind:'official_game_status',publishedAt:new Date(now).toISOString(),fetchedAt:new Date(now).toISOString()};
  assert.equal(availabilityReasons(a,input,event,now).length,0);
  for(const patch of [{eventId:'wrong'},{teamId:'wrong'},{status:'inactive'},{sourceKind:'roster'},
    {publishedAt:'2026-09-09T23:00Z'},{publishedAt:'2026-09-10T23:01Z'},{fetchedAt:'2026-09-10T23:01Z'}])
    assert.ok(availabilityReasons({...a,...patch},input,event,now).length);
  assert.ok(availabilityReasons(undefined,input,event,now).length);
});
test('evidence archive is immutable, idempotent and refuses corrupted content-addressed files', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'football-evidence-test-'));
  try {
    const store=new NflEvidenceArchive(dir), first=store.record({id:'player',asOf:new Date(now).toISOString()});
    assert.deepEqual(store.record({id:'player',asOf:new Date(now).toISOString()}),first);
    assert.equal(fs.readdirSync(dir).length,1);
    fs.writeFileSync(path.join(dir,first.file),'corrupted fixture');
    assert.throws(()=>store.record({id:'player',asOf:new Date(now).toISOString()}),/preserved/);
    assert.equal(fs.readFileSync(path.join(dir,first.file),'utf8'),'corrupted fixture');
  } finally {
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
    assert.match(path.basename(dir),/^football-evidence-test-/);fs.rmSync(dir,{recursive:true});
  }
});
test('paper metrics separate versions, count unresolved and do not treat correlated props as independent games', () => {
  const p:any={id:'p',season:2026,version:'v',origin:'model',event,quote:q,result:'WIN',modelProbability:.6,modelPushProbability:0};
  const [report]=footballPaperMetrics([p,{...p,id:'loss',result:'LOSS'},{...p,id:'pending',result:'PENDING'}],now+7200_000);
  assert.equal(report.tracked,3);assert.equal(report.settled,2);assert.equal(report.unresolved,1);
  assert.equal(report.distinctSettledGames,1);assert.equal(report.approximateGameClusterRoiInterval,null);
  assert.ok(Math.abs(report.multiclassBrier-.52)<1e-12);
  assert.equal(report.closeWindowMissed,3);assert.equal(report.closeWindowCaptured,0);
  assert.equal(footballPaperMetrics([p,{...p,version:'other'}]).length,2);
});
