// Synthetic local-browser fixture; cannot target the production snapshot disk.
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { NflPaperLedger, PAPER_RULES } from '../services/nflPaper';
async function main() {
  const dir=path.resolve(process.env.NFL_BROWSER_FIXTURE_DIR ?? '');
  if(path.dirname(dir)!==path.resolve(os.tmpdir())||!/^football-research-qa-[a-f0-9-]+$/i.test(path.basename(dir)))
    throw new Error('Fixture requires a specifically named isolated temp directory.');
  const file=path.join(dir,'nfl_paper_picks.json');if(fs.existsSync(file))throw new Error('Refusing to overwrite an existing paper file.');
  const date='2025-12-14T18:00:00Z';let clock=Date.parse(date)-60_000;
  const event={id:'qa-synthetic-only',sportKey:'americanfootball_nfl',homeTeam:'QA Home',awayTeam:'QA Away',commenceTime:date};
  const data={header:{league:{slug:'nfl'},season:{year:2025,type:2},competitions:[{id:'123',date,status:{type:{completed:true,state:'post',name:'STATUS_FINAL'}},
    competitors:[{homeAway:'home',team:{displayName:event.homeTeam},score:'20'}, {homeAway:'away',team:{displayName:event.awayTeam},score:'10'}]}]}};
  const ledger=new NflPaperLedger(file,{matchEvent:async()=> '123',player:async()=>{throw Error('No player needed');},summary:async()=>data},()=>clock);
  await ledger.save(event,{market:'totals',participant:'',side:'Over',line:28.5,price:-110,book:'QA synthetic book',bookKey:'qa',updatedAt:new Date(clock).toISOString(),stale:false},PAPER_RULES);
  clock=Date.parse(date)+5*3600_000;await ledger.grade();
  console.log(JSON.stringify({isolatedFixture:true,records:ledger.read().length,result:ledger.read()[0].result,directory:dir}));
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1;});
