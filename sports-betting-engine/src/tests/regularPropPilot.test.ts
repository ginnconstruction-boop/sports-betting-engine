import test from 'node:test';
import assert from 'node:assert/strict';
import {pilotStatDiagnostic,pilotQuoteAssessment,pilotSelection} from '../dev/regularPropPilot';
import {buildNflForecast,assessNflQuote} from '../services/nflForecast';
import {NflObservation} from '../services/nflResearch';
import {MarketQuote} from '../services/nflMarketBoard';
const cutoff=Date.parse('2025-12-07T16:00:00Z');
const rows:NflObservation[]=Array.from({length:30},(_,i)=>({eventId:String(i),teamId:'1',opponent:'Other',
  date:new Date(cutoff-(31-i)*7*86400_000).toISOString(),value:100+i*3,opportunity:20}));
const quote:MarketQuote={market:'player_pass_yds',participant:'Test Player',side:'Over',line:150.5,price:-110,
  book:'FanDuel',bookKey:'fanduel',updatedAt:new Date(cutoff).toISOString(),stale:false};
test('historical diagnostic matches production stat equations without claiming archived availability',()=>{
  const d=pilotStatDiagnostic(rows,'1',quote.market,cutoff);
  const full=buildNflForecast({observations:rows,asOf:new Date(cutoff).toISOString(),sources:[],
    player:{id:'10',name:'Test Player',teamId:'1',team:'Home',position:'QB',rosterStatus:'Unknown',injuries:[],fetchedAt:'',source:'test'},
    depth:{rows:[],source:'test',sourceTimestamp:null}},
    {id:'game',sportKey:'americanfootball_nfl',homeTeam:'Home',awayTeam:'Away',commenceTime:new Date(cutoff+3600_000).toISOString()},quote.market,cutoff);
  assert.deepEqual(d.point,full.point);assert.deepEqual(d.errors,full.errors);assert.deepEqual(d.evaluation,full.evaluation);
  assert.equal(d.fullPolicyStatus,'UNVERIFIED_ARCHIVED_AVAILABILITY');assert.ok(full.reasons.some(r=>/Roster|Depth/.test(r)));
  const a=pilotQuoteAssessment(d,quote,'Test Player',quote.market,cutoff),b=assessNflQuote(full,quote,['fanduel'],cutoff);
  assert.equal(a.estimatedEV,b.estimatedEV);assert.equal(a.probability,b.probability);assert.equal(b.eligible,false);
});
test('historical selection ignores target/future observations and fails timestamp, identity and book checks',()=>{
  const d=pilotStatDiagnostic(rows,'1',quote.market,cutoff);
  const future={...rows[0],eventId:'future',date:new Date(cutoff).toISOString(),value:99999};
  assert.deepEqual(pilotStatDiagnostic([...rows,future],'1',quote.market,cutoff).point,d.point);
  for(const q of [{...quote,updatedAt:new Date(cutoff+1).toISOString()},{...quote,updatedAt:new Date(cutoff-16*60_000).toISOString()},
    {...quote,participant:'Wrong'},{...quote,bookKey:'wrong'},{...quote,line:null}])
    assert.equal(pilotQuoteAssessment(d,q,'Test Player',quote.market,cutoff).eligible,false);
});
test('pilot picks one highest-EV quote with deterministic ties and keeps empty results empty',()=>{
  const d=pilotStatDiagnostic(rows,'1',quote.market,cutoff);
  const a=pilotQuoteAssessment(d,quote,'Test Player',quote.market,cutoff);
  assert.equal(a.eligible,true);
  const b=pilotQuoteAssessment(d,{...quote,price:110,bookKey:'betmgm'},'Test Player',quote.market,cutoff);
  assert.equal(pilotSelection([a,b])?.quote.bookKey,'betmgm');assert.equal(pilotSelection([]),null);
  assert.equal(pilotQuoteAssessment(pilotStatDiagnostic(rows.slice(0,7),'1',quote.market,cutoff),quote,'Test Player',quote.market,cutoff).eligible,false);
});
