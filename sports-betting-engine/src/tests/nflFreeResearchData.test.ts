import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'zlib';
import {NflverseTeamResearch,parseNflverseTeamStats} from '../services/nflFreeResearchData';

const header='season,week,team,season_type,game_id,opponent_team,attempts,carries,passing_yards,rushing_yards,passing_epa,rushing_epa,def_sacks,def_qb_hits';
const csv=[header,'2025,1,DAL,REG,2025_01_DAL_PHI,PHI,30,25,210,100,3,-1,2,5','2025,1,PHI,REG,2025_01_DAL_PHI,DAL,40,20,280,80,4,2,1,4','2025,2,DAL,REG,2025_02_DAL_NYG,NYG,20,30,160,150,2,3,3,6','2025,2,NYG,REG,2025_02_DAL_NYG,DAL,35,22,175,88,-3,-2,2,3'].join('\n');

test('nflverse team research derives offense and opponent-allowed diagnostics without model weights',()=>{const rows=parseNflverseTeamStats(csv,2025);assert.equal(rows.length,4);
  assert.throws(()=>parseNflverseTeamStats(csv.replace('def_qb_hits','pressure'),2025),/schema/);
  assert.throws(()=>parseNflverseTeamStats(csv+'\n'+csv.split('\n')[1],2025),/Duplicate/);
});

test('nflverse adapter keeps unavailable current season separate from prior-season context and caches both',async()=>{let calls=0;const service=new NflverseTeamResearch(async url=>{calls++;if(url.includes('2026'))throw Error('nflverse source returned HTTP 404');return gzipSync(csv);},()=>Date.parse('2026-09-05T12:00:00Z'));
  const [dal,phi]=await Promise.all([service.context('DAL','PHI',2026,1),service.context('PHI','DAL',2026,1)]);assert.equal(calls,2);assert.equal(dal.status,'PARTIAL_SUCCESS');assert.equal(dal.current,null);
  assert.equal(dal.prior?.games,2);assert.equal(dal.prior?.passYardsPerAttempt,7.4);assert.equal(dal.prior?.passEpaAllowedPerAttempt,0.0133);assert.equal(dal.modelAdjustmentEnabled,false);
  assert.equal(phi.prior?.games,1);await service.context('DAL','PHI',2026,1);assert.equal(calls,2);
});
