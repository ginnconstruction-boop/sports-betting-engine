import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'zlib';
import {NflverseSnapResearch,parseNflverseSchedule,parseNflverseSnapCounts} from '../services/nflSnapResearch';

const schedule='game_id,gameday\n2025_01_DAL_PHI,2025-09-07\n2025_02_DAL_NYG,2025-09-14\n2026_01_DAL_PHI,2026-09-10';
const header='game_id,pfr_game_id,season,game_type,week,player,pfr_player_id,position,team,opponent,offense_snaps,offense_pct,defense_snaps,defense_pct,st_snaps,st_pct';
const prior=[header,'2025_01_DAL_PHI,x,2025,REG,1,Test Player,TestPl00,WR,DAL,PHI,60,0.8,0,0,0,0','2025_02_DAL_NYG,x,2025,REG,2,Test Player,TestPl00,WR,DAL,NYG,30,0.4,0,0,0,0'].join('\n');
const current=[header,'2026_01_DAL_PHI,x,2026,REG,1,Test Player,TestPl00,WR,DAL,PHI,70,0.9,0,0,0,0'].join('\n');

test('nflverse snap and schedule parsers enforce schema, bounds and duplicate identity',()=>{assert.equal(parseNflverseSnapCounts(prior,2025).length,2);assert.equal(parseNflverseSchedule(schedule).get('2025_01_DAL_PHI'),'2025-09-07T23:59:59.999Z');
  assert.throws(()=>parseNflverseSnapCounts(prior.replace('offense_pct','share'),2025),/schema/);assert.throws(()=>parseNflverseSnapCounts(prior+'\n'+prior.split('\n')[1],2025),/Duplicate/);
});

test('snap research excludes future games, maps one exact PFR identity and never enables an adjustment',async()=>{let calls=0;const service=new NflverseSnapResearch(async url=>{calls++;if(url.includes('games.csv'))return gzipSync(schedule);if(url.includes('2026'))return gzipSync(current);return gzipSync(prior);},()=>Date.parse('2026-09-05T12:00:00Z'));
  const context=await service.context('Test Player',2026,Date.parse('2026-09-05T12:00:00Z'));assert.equal(calls,3);assert.equal(context.current.length,0);assert.equal(context.prior.length,2);assert.equal(context.recent.length,2);
  assert.equal(context.meanRecentOffensePct,.6);assert.equal(context.pfrPlayerId,'TestPl00');assert.equal(context.modelAdjustmentEnabled,false);await service.context('Test Player',2026,Date.parse('2026-09-05T12:00:00Z'));assert.equal(calls,3);
});

test('snap research fails closed on ambiguous exact names',async()=>{const ambiguous=prior+'\n2025_02_DAL_NYG,x,2025,REG,2,Test Player,Other00,WR,NYG,DAL,5,0.1,0,0,0,0',service=new NflverseSnapResearch(async url=>gzipSync(url.includes('games.csv')?schedule:url.includes('2026')?header:ambiguous));
  const context=await service.context('Test Player',2026,Date.parse('2026-09-05T12:00:00Z'));assert.equal(context.status,'TEAM_MATCH_FAILED');assert.equal(context.recent.length,0);assert.equal(context.pfrPlayerId,null);
});
