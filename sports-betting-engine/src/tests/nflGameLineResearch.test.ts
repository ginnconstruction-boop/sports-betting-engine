import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNflGameLineSeason, parseNflverseGameResults } from '../services/nflGameLineResearch';

const header='game_id,season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,location,result,spread_line,total_line';
test('NFL schedule research preserves signed market margin and verified final identity',()=>{
  const games=parseNflverseGameResults(`${header}\n2025_01_DAL_PHI,2025,REG,1,2025-09-04,20:20,DAL,20,PHI,24,Home,4,8.5,47.5\n`);
  assert.equal(games.length,1);assert.equal(games[0].homeId,'PHI');assert.equal(games[0].awayId,'DAL');
  assert.equal(games[0].spreadLine,8.5);assert.equal(games[0].neutral,false);assert.equal(games[0].homeScore-games[0].awayScore,4);
});

test('NFL schedule research excludes nonregular/unplayed rows and rejects corrupt finals',()=>{
  assert.equal(parseNflverseGameResults(`${header}\npre,2025,PRE,1,2025-08-01,20:00,A,10,B,14,Home,4,-1,40\nfuture,2026,REG,1,2026-09-01,20:00,A,,B,,Home,,,\n`).length,0);
  assert.throws(()=>parseNflverseGameResults(`${header}\nbad,2025,REG,1,2025-09-01,20:00,A,10,B,14,Home,999,-1,40\n`),/Invalid/);
  assert.throws(()=>parseNflverseGameResults('wrong,schema\n'),/schema/);
});

test('NFL game-line research reports model, baseline and market bias for spreads and totals',()=>{
  const games=[] as ReturnType<typeof parseNflverseGameResults>;
  for(let season=2024;season<=2025;season++)for(let week=1;week<=18;week++)for(let game=0;game<8;game++){
    const home=`T${game}`,away=`T${(game+week)%8}`;if(home===away)continue;
    games.push({id:`${season}-${week}-${game}`,date:`${season}-${String(Math.min(week,12)).padStart(2,'0')}-${String(game+1).padStart(2,'0')}T12:00:00.000Z`,season,
      homeId:home,awayId:away,homeName:home,awayName:away,homeScore:20+game,awayScore:17+(week%5),neutral:false,spreadLine:3,totalLine:41});
  }
  games.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||a.id.localeCompare(b.id));
  const report=evaluateNflGameLineSeason(games,2025,{ridge:3,halfLifeDays:180});
  assert.ok(report.games>0);assert.equal(report.modelMargin.count,report.games);assert.equal(report.modelTotal.count,report.games);
  for(const metric of [report.modelMargin,report.naiveMargin,report.marketMargin,report.modelTotal,report.naiveTotal,report.marketTotal]){
    assert.equal(typeof metric.bias,'number');assert.equal(typeof metric.mae,'number');assert.equal(typeof metric.rmse,'number');
  }
});
