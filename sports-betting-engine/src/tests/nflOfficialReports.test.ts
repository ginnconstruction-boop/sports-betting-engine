import test from 'node:test';
import assert from 'node:assert/strict';
import {nflOfficialInjuryUrl,OfficialNflInjuryReports,parseOfficialNflInjuryReport} from '../services/nflOfficialReports';

const fixture=`<!doctype html><html><head><title>Official NFL Injury Report for Players - Week 1</title></head><body>
<div class="d3-o-section-sub-title"><span>Patriots</span></div><div><table class="d3-o-table d3-o-reports--detailed"><thead><tr><th>Player</th><th>Position</th><th>Injuries</th><th>Practice Status</th><th>Game Status</th></tr></thead>
<tbody><tr><td><a>Test &amp; Player</a></td><td>WR</td><td>Ankle</td><td>Limited Participation in Practice</td><td>Questionable</td></tr></tbody></table></div>
<div class="d3-o-section-sub-title"><span>Seahawks</span></div><table class="d3-o-reports--detailed"><thead><tr><th>Player</th><th>Position</th><th>Injuries</th><th>Practice Status</th><th>Game Status</th></tr></thead><tbody></tbody></table>
</body></html>`;

test('official NFL weekly report parser preserves exact team/player practice and game statuses',()=>{const parsed=parseOfficialNflInjuryReport(fixture);assert.deepEqual(parsed.teams,['Patriots','Seahawks']);
  assert.deepEqual(parsed.rows,[{team:'Patriots',player:'Test & Player',position:'WR',injury:'Ankle',practiceStatus:'Limited Participation in Practice',gameStatus:'Questionable'}]);
  assert.equal(nflOfficialInjuryUrl(2026,1),'https://www.nfl.com/injuries/league/2026/reg1');assert.throws(()=>nflOfficialInjuryUrl(2026,19));});

test('official NFL report rejects page/schema changes and treats a valid unpublished week as empty',()=>{
  assert.throws(()=>parseOfficialNflInjuryReport('<html>not an NFL report</html>'),/identity/);
  assert.throws(()=>parseOfficialNflInjuryReport(fixture.replace('Game Status</th>','Availability</th>')),/schema/);
  const empty='<!doctype html><html><head><title>Official NFL Injury Report for Players - Week 1</title></head><body>'+'.'.repeat(101)+'</body></html>';
  assert.deepEqual(parseOfficialNflInjuryReport(empty),{teams:[],rows:[]});
});

test('official NFL report fetch coalesces, caches and reports source failures precisely',async()=>{let calls=0;const source=new OfficialNflInjuryReports(async()=>{calls++;return fixture;},()=>Date.parse('2026-09-07T12:00:00Z'));
  const [a,b]=await Promise.all([source.report(2026,1),source.report(2026,1)]);assert.equal(calls,1);assert.equal(a.status,'PARTIAL_SUCCESS');assert.deepEqual(a,b);await source.report(2026,1);assert.equal(calls,1);
  const failed=await new OfficialNflInjuryReports(async()=>{throw Error('Official NFL source returned HTTP 429');}).report(2026,1);assert.equal(failed.status,'SOURCE_RATE_LIMITED');assert.equal(failed.rows.length,0);
});
