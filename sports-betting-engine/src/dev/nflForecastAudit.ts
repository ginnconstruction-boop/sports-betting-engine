// Read-only provider audit. Does not fetch odds, issue picks or access production ledgers.
// Optional --out stores a reproducible local research artifact (not a betting record).
import * as fs from 'fs';
import * as path from 'path';
import { parseNflLogs, fetchNflJson } from '../services/nflResearch';
import { eligibleNflHistory, evaluateNflWalkForward, NFL_FORECAST_VERSION } from '../services/nflForecast';

async function main() {
  // Frozen illustrative cohort; never choose/remove players based on model errors.
  // These IDs identify historical 2025 players, not claims about their current roles.
  const cohort = [
    {name:'Drake Maye',id:'4431452',teamId:'17',market:'player_pass_yds'},
    {name:'Patrick Mahomes',id:'3139477',teamId:'12',market:'player_pass_yds'},
    {name:'Drake Maye',id:'4431452',teamId:'17',market:'player_rush_yds'},
    {name:'Patrick Mahomes',id:'3139477',teamId:'12',market:'player_rush_yds'},
    {name:'Travis Kelce',id:'15847',teamId:'12',market:'player_reception_yds'},
    {name:'Travis Kelce',id:'15847',teamId:'12',market:'player_receptions'},
    {name:'Jaxon Smith-Njigba',id:'4430878',teamId:'26',market:'player_reception_yds'},
    {name:'Jaxon Smith-Njigba',id:'4430878',teamId:'26',market:'player_receptions'},
  ];
  const dataCache = new Map<string, any>();
  const records = [];
  for (const player of cohort) {
    const sources = [], observations = [];
    try {
      for (const season of [2024, 2025]) {
        const url=`https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${player.id}/gamelog?season=${season}`;
        if(!dataCache.has(url))dataCache.set(url,await fetchNflJson(url));
        const payload=dataCache.get(url);
        if(String(payload.filters?.find((f:any)=>f.name==='season')?.value)!==String(season))throw Error(`Season ${season} not verified`);
        sources.push(url);observations.push(...parseNflLogs(payload,season,player.market,Date.parse('2026-08-01T00:00Z')));
      }
      const {rows,excluded}=eligibleNflHistory(observations,player.teamId,Date.parse('2026-08-01T00:00Z'),player.market);
      const full=evaluateNflWalkForward(rows);
      // 2024 provides warm-up only; report the untouched chronological 2025 targets.
      const tests=full.tests.filter(t=>Date.parse(t.date)>=Date.parse('2025-08-01T00:00Z'));
      const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
      const result={...player,status:tests.length?'evaluated':'insufficient_data',sources,observations:rows,excluded,tests,games:tests.length,
        mae:avg(tests.map(t=>Math.abs(t.error))),baselineMae:avg(tests.map(t=>Math.abs(t.actual-t.baseline)))};
      records.push(result);
      console.log(JSON.stringify({name:player.name,market:player.market,games:result.games,mae:result.mae,baselineMae:result.baselineMae}));
    }catch(e){records.push({...player,status:'source_unavailable',error:(e as Error).message});console.log(`${player.name} ${player.market}: source unavailable`);}
  }
  const report={version:NFL_FORECAST_VERSION,generatedAt:new Date().toISOString(),
    note:'Illustrative fixed cohort, not league-wide or independent pre-registered validation. Frozen model parameters; 2024 warm-up, chronological 2025 stat forecasts. Data may include later corrections. No historical betting odds, archived availability, win rates, ROI or calibrated probability claims.',records};
  const index=process.argv.indexOf('--out');
  if(index>=0){
    const out=path.resolve(process.argv[index+1]);
    if(!out.endsWith('.json')||path.basename(out)!=='nfl_forecast_audit.json')throw Error('Output must be named nfl_forecast_audit.json');
    fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));
    console.log(`Research audit written to ${out}`);
  }
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1;});
