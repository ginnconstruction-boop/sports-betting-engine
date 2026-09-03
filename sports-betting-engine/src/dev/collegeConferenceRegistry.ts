// Free, season-scoped descriptive metadata. Not a historical roster/availability feed.
import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
async function main(){
  const target=path.resolve(__dirname,'../data/college-conferences-v1.json');
  if(fs.existsSync(target))throw Error('Registry already exists; preserve it and create a reviewed version instead.');
  const seasons:Record<string,any>={},sources:any[]=[];
  for(const season of [2023,2024,2025,2026]){
    seasons[season]={};
    for(const [group,division]of [[80,'FBS'],[81,'FCS']]as const){
      const source=`https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${season}/types/2/groups/${group}/children?limit=100`;
      const r=await fetch(source,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Conference source HTTP '+r.status);
      const data:any=await r.json();if(data.pageCount!==1||data.count!==data.items?.length)throw Error('Incomplete conference registry');
      for(const row of data.items){const id=String(row.$ref).match(/\/groups\/(\d+)\?/);if(!id)throw Error('Invalid conference reference');
        if(seasons[season][id[1]])throw Error('Ambiguous division');seasons[season][id[1]]=division;}
      sources.push({source,fetchedAt:new Date().toISOString(),data});
    }
  }
  const payload={version:'college-conferences-v1',seasons,sources,note:'Season-scoped ESPN metadata fetched now; historical groups are descriptive, not point-in-time roster evidence.'};
  fs.writeFileSync(target,JSON.stringify({payload,sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex')},null,2),{flag:'wx'});
  console.log(JSON.stringify({file:target,seasons:Object.keys(seasons),sources:sources.length}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
