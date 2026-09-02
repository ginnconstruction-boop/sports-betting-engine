import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { parseCollegeResults,mergeCollegeResults,evaluateCollegeSeason } from '../services/collegeScoreModel';
const root=path.resolve(__dirname,'../../snapshots/college-model-v1');
const protocolFile=path.resolve(__dirname,'../../research/COLLEGE_MODEL_PROTOCOL_2026_09_02.json');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const read=(name:string)=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
function save(name:string,data:any){const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(data),{flag:'wx'});}
async function source(season:number,month:number,group:number){
  const m=String(month).padStart(2,'0'),last=new Date(Date.UTC(season,month,0)).getUTCDate();
  const url=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${season}${m}01-${season}${m}${last}&groups=${group}&limit=1000`;
  const name=`sources/${season}-${m}-${group}.json`;if(fs.existsSync(path.join(root,name)))return read(name);
  const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('College history HTTP '+r.status);
  const data:any=await r.json();if(!Array.isArray(data.events)||data.events.length>=1000)throw Error('Invalid/truncated college month source');
  const record={source:url,fetchedAt:new Date().toISOString(),data};save(name,record);
  console.log(JSON.stringify({season,month,group,sourceEvents:data.events.length}));return record;
}
async function collect(seasons:number[]){
  const all=[],coverage=[];
  for(const season of seasons){for(const month of [8,9,10,11,12]){
    const results=await Promise.all([80,81].map(g=>source(season,month,g)));
    for(let i=0;i<results.length;i++){const r=results[i],parsed=parseCollegeResults(r.data,season);all.push(parsed.games);
      coverage.push({season,month,group:i?81:80,total:r.data.events.length,parsed:parsed.games.length,skipped:parsed.skipped,sourceHash:hash(JSON.stringify(r))});}
  }}
  return {games:mergeCollegeResults(all),coverage};
}
async function develop(){
  if(fs.existsSync(path.join(root,'configuration-lock.json')))throw Error('Configuration already locked; do not retune. Use holdout.');
  const protocol=JSON.parse(fs.readFileSync(protocolFile,'utf8'));
  if(!fs.existsSync(path.join(root,'registered-protocol.json')))save('registered-protocol.json',{protocol,hash:hash(fs.readFileSync(protocolFile,'utf8')),registeredAt:new Date().toISOString()});
  const data=await collect([2023,2024]);if(!fs.existsSync(path.join(root,'development-data.json')))save('development-data.json',data);
  const results=[];
  for(const ridge of protocol.development.ridgeCandidates)for(const halfLifeDays of protocol.development.halfLifeDaysCandidates){
    const result=evaluateCollegeSeason(data.games,2024,{ridge,halfLifeDays});
    console.log(JSON.stringify({phase:'DEVELOPMENT',config:result.config,games:result.games,excluded:result.excluded,margin:result.modelMargin,total:result.modelTotal,
      baselineMargin:result.naiveMargin,baselineTotal:result.naiveTotal}));results.push(result);
  }
  results.sort((a,b)=>(a.modelMargin.rmse+a.modelTotal.rmse)-(b.modelMargin.rmse+b.modelTotal.rmse));
  const best=results[0],lock={lockedAt:new Date().toISOString(),protocolHash:read('registered-protocol.json').hash,
    modelCodeHash:hash(fs.readFileSync(path.resolve(__dirname,'../services/collegeScoreModel.ts'),'utf8').replace(/\r\n/g,'\n')),config:best.config,
    scores:results.map(({rows,skipped,...r})=>r),marginResiduals:best.rows.map(r=>r.marginError),totalResiduals:best.rows.map(r=>r.totalError)};
  save('development-best.json',best);save('configuration-lock.json',lock);console.log(JSON.stringify({phase:'CONFIGURATION_LOCKED',config:best.config,games:best.games}));
}
async function holdout(){
  const lock=read('configuration-lock.json');
  if(lock.modelCodeHash!==hash(fs.readFileSync(path.resolve(__dirname,'../services/collegeScoreModel.ts'),'utf8').replace(/\r\n/g,'\n')))throw Error('Frozen model code changed; refuse holdout');
  if(fs.existsSync(path.join(root,'holdout-report.json')))throw Error('Holdout already evaluated; keep its result');
  const development=read('development-data.json'),test=await collect([2025]);save('holdout-data.json',test);
  const all=mergeCollegeResults([development.games,test.games]);
  const r=evaluateCollegeSeason(all,2025,lock.config);save('holdout-report.json',r);
  const summary={generatedAt:new Date().toISOString(),protocolHash:lock.protocolHash,modelCodeHash:lock.modelCodeHash,config:lock.config,
    games:r.games,excluded:r.excluded,margin:r.modelMargin,total:r.modelTotal,baselineMargin:r.naiveMargin,baselineTotal:r.naiveTotal,
    paperApproved:{spreads:r.games>=500&&r.modelMargin.rmse<r.naiveMargin.rmse,totals:r.games>=500&&r.modelTotal.rmse<r.naiveTotal.rmse},moneyBettingApproved:false};
  save('validation-summary.json',summary);console.log(JSON.stringify({phase:'UNTOUCHED_2025_HOLDOUT',...summary},null,2));
}
(process.argv[2]==='develop'?develop():process.argv[2]==='holdout'?holdout():Promise.reject(Error('Use develop or holdout'))).catch(e=>{console.error((e as Error).message);process.exitCode=1;});
