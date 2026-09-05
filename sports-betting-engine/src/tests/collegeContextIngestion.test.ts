import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {CollegeContextIngestion,ContextTeamSeed} from '../services/collegeContextIngestion';
import {appendCollegeContextRecords,NewCollegeContextRecord,resolveCollegeTeamContext,resolveContextField} from '../services/collegeContextEvidence';

const now=Date.parse('2026-09-05T14:00:00Z'),kickoff='2026-09-05T23:30:00Z';
function seed(teamId:string,teamName:string,eventId='1001',division:'FBS'|'FCS'='FBS'):ContextTeamSeed{return{teamId,teamName,eventId,commenceTime:kickoff,division,
  aliases:[teamName.replace(/ (Cornhuskers|Bobcats|Tigers|Eagles)$/,'')],venue:{id:'1',name:'Test Stadium',indoor:false}};}
const teams=[seed('158','Nebraska Cornhuskers'),seed('195','Ohio Bobcats')];
function summary(eventTeams=teams){return{header:{competitions:[{competitors:eventTeams.map(team=>({team:{id:team.teamId}}))}]},gameInfo:{venue:{indoor:false},weather:{temperature:78,feelsLikeTemperature:79,windSpeed:8,gust:12,precipitation:20,precipitationAmount:0,humidity:52}},
  lastFiveGames:eventTeams.map(team=>({team:{id:team.teamId},events:[{id:`old-${team.teamId}`,gameDate:'2026-08-29T18:00:00Z',opponent:{displayName:'Earlier Opponent'},gameResult:'W',score:'31-20',homeTeamScore:'31',awayTeamScore:'20'}]})),
  boxscore:{teams:eventTeams.map(team=>({team:{id:team.teamId},statistics:[{name:'totalPointsPerGame',displayValue:'31.0'},{name:'yardsPerGame',displayValue:'420.0'},
    {name:'totalPointsPerGameAllowed',displayValue:'20.0'},{name:'yardsPerGameAllowed',displayValue:'310.0'}]}))},
  leaders:eventTeams.map(team=>({team:{id:team.teamId},leaders:[{name:'passingYards',leaders:[{displayValue:'21/30, 280 YDS',athlete:{id:`qb-${team.teamId}`,displayName:`QB ${team.teamId}`,position:{abbreviation:'QB'},status:{type:'active'}}}]}]})),
  injuries:eventTeams.map(team=>({team:{id:team.teamId},injuries:[]})),pickcenter:[]};}
function roster(team:ContextTeamSeed){return{season:{year:2026},team:{id:team.teamId},athletes:[{items:[{id:`qb-${team.teamId}`,displayName:`QB ${team.teamId}`,position:{abbreviation:'QB'},status:{name:'Active'}}]}],
  coach:[{id:`coach-${team.teamId}`,firstName:'Coach',lastName:team.teamId}]};}
function contextGet(eventTeams=teams,calls:string[]=[]){return async(url:string)=>{calls.push(url);if(url.includes('/summary?event='))return summary(eventTeams);const id=url.match(/\/teams\/(\d+)\/roster/)?.[1],team=eventTeams.find(item=>item.teamId===id);if(team)return roster(team);throw Error('unexpected fixture URL');};}

test('configured ESPN sources are invoked, timestamped, stored and reused while internal FBS classification is normalized',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'college-ingestion-ok-')),calls:string[]=[];try{
    const ingestion=new CollegeContextIngestion(root,contextGet(teams,calls),()=>now,undefined,async()=>{}),first=await ingestion.refresh(teams);
    assert.equal(calls.filter(url=>url.includes('/summary?')).length,1);assert.equal(calls.filter(url=>url.includes('/roster')).length,2);
    assert.equal(first.storage.loadStatus,'SUCCESS');assert.equal(first.storage.storeStatus,'SUCCESS');assert.ok(first.added>0);
    const resolved=resolveCollegeTeamContext(first.records,{teamId:'158',teamName:'Nebraska Cornhuskers',season:2026,eventId:'1001',asOf:now,currentGames:1});
    assert.equal(resolved.currentSeason.gamesPlayed,1);assert.equal(resolved.currentSeason.primaryQb,'QB 158');assert.equal(resolved.qb.status,'EXPECTED');
    assert.equal(resolved.coaching.headCoach,'Coach 158');assert.equal(resolved.weather.windMph,8);assert.equal(resolved.talent.classification,'FBS');assert.ok(resolved.completeness>30);
    const registry=first.sourceRegistry.sources,gameSource=registry.find((row:any)=>row.id==='espn-game-summary:CURRENT_SEASON'),cfbd=registry.find((row:any)=>row.id==='cfbd:TRANSFERS');
    assert.ok(gameSource.lastAttempt);assert.ok(gameSource.lastSuccess);assert.match(gameSource.lastResult,/SUCCESS/);assert.equal(gameSource.credentialsRequired,false);
    assert.equal(cfbd.configured,false);assert.equal(cfbd.credentialsPresent,false);assert.equal(cfbd.lastResult,'NO_PROVIDER_CONFIGURED');
    const callCount=calls.length,second=await ingestion.refresh(teams);assert.equal(calls.length,callCount,JSON.stringify(calls));assert.equal(second.storage.storeStatus,'SUCCESS');
    assert.equal(second.sourceRegistry.sources.find((row:any)=>row.id==='espn-game-summary:INJURIES').lastResult,'SUCCESS');
    assert.equal(second.sourceRegistry.sources.find((row:any)=>row.id==='espn-game-summary:WEATHER').lastResult,'PARTIAL_SUCCESS');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('rate limit and auth failures are precise and one event/team failure does not erase successful categories',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'college-ingestion-isolation-')),all=[...teams,seed('196','Test Tigers','1002'),seed('197','Test Eagles','1002')],calls:string[]=[];try{
    const get=async(url:string)=>{calls.push(url);if(url.includes('summary?event=1002'))throw Error('NFL data source returned HTTP 429');
      if(url.includes('summary?event=1001'))return summary(teams);if(url.includes('/teams/196/roster'))throw Error('NFL data source returned HTTP 401');
      const id=url.match(/\/teams\/(\d+)\/roster/)?.[1],team=all.find(item=>item.teamId===id);if(team)return roster(team);throw Error('unexpected');};
    const result=await new CollegeContextIngestion(root,get,()=>now,undefined,async()=>{}).refresh(all);
    assert.equal(resolveContextField(result.records,{teamId:'158',season:2026,eventId:'1001',field:'current.gamesPlayed',asOf:now}).value,1);
    const limited=resolveContextField(result.records,{teamId:'196',season:2026,eventId:'1002',field:'current.gamesPlayed',asOf:now});
    assert.equal(limited.diagnosticReason,'SOURCE_RATE_LIMITED');assert.notEqual(limited.diagnosticReason,'NO_SOURCE_ATTEMPTED');
    const auth=resolveContextField(result.records,{teamId:'196',season:2026,eventId:'1002',field:'roster.currentSeasonAvailable',asOf:now});assert.equal(auth.diagnosticReason,'SOURCE_AUTH_FAILED');
    assert.equal(calls.filter(url=>url.includes('summary?event=1002')).length,2);assert.equal(calls.filter(url=>url.includes('/teams/196/roster')).length,1);
    assert.equal(result.sourceRegistry.sources.find((row:any)=>row.id==='espn-game-summary:CURRENT_SEASON').lastResult,'PARTIAL_SUCCESS');
    assert.equal(result.storage.storeStatus,'SUCCESS');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('a requested malformed payload becomes PARSER_FAILED, never NO_SOURCE_ATTEMPTED',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'college-ingestion-parser-'));try{
    const get=async(url:string)=>url.includes('/summary?')?null:roster(teams.find(team=>url.includes(`/teams/${team.teamId}/`))!);
    const result=await new CollegeContextIngestion(root,get,()=>now,undefined,async()=>{}).refresh(teams),field=resolveContextField(result.records,{teamId:'158',season:2026,eventId:'1001',field:'qb.starterName',asOf:now});
    assert.equal(field.diagnosticReason,'PARSER_FAILED');assert.equal(result.sourceRegistry.sources.find((row:any)=>row.id==='espn-game-summary:QB').lastResult,'PARSER_FAILED');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('an exhausted upstream HTTP failure is reported precisely after the limited retry',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'college-ingestion-http-'));let attempts=0;try{
    const get=async(url:string)=>{if(url.includes('/summary?')){attempts++;throw Error('NFL data source returned HTTP 503');}
      return roster(teams.find(team=>url.includes(`/teams/${team.teamId}/`))!);};
    const result=await new CollegeContextIngestion(root,get,()=>now,undefined,async()=>{}).refresh(teams);
    const field=resolveContextField(result.records,{teamId:'158',season:2026,eventId:'1001',field:'current.gamesPlayed',asOf:now});
    assert.equal(attempts,2);assert.equal(field.diagnosticReason,'SOURCE_HTTP_ERROR');assert.notEqual(field.diagnosticReason,'NO_SOURCE_ATTEMPTED');
    assert.equal(result.sourceRegistry.sources.find((row:any)=>row.id==='espn-game-summary:CURRENT_SEASON').lastResult,'SOURCE_HTTP_ERROR');
    assert.equal(resolveContextField(result.records,{teamId:'158',season:2026,eventId:'1001',field:'roster.currentSeasonAvailable',asOf:now}).value,true);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('store and load failures preserve retrieved context in memory with explicit pipeline status',async()=>{
  const failedStore=fs.mkdtempSync(path.join(os.tmpdir(),'college-ingestion-store-'));try{
    const ingestion=new CollegeContextIngestion(failedStore,contextGet(),()=>now,undefined,async()=>{},()=>{throw Error('simulated disk failure');}),result=await ingestion.refresh(teams);
    assert.equal(result.storage.storeStatus,'STORE_FAILED');assert.equal(resolveContextField(result.records,{teamId:'158',season:2026,eventId:'1001',field:'current.gamesPlayed',asOf:now}).value,1);
    assert.ok(result.warnings.some((warning:string)=>warning.includes('STORE_FAILED')));
  }finally{fs.rmSync(failedStore,{recursive:true,force:true});}
  const failedLoad=fs.mkdtempSync(path.join(os.tmpdir(),'college-ingestion-load-'));try{
    const dir=path.join(failedLoad,'college_context','evidence-v1');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'index.json'),'corrupt fixture');let calls=0;
    const result=await new CollegeContextIngestion(failedLoad,async(url:string)=>{calls++;return contextGet()(url);},()=>now,undefined,async()=>{}).refresh(teams);
    assert.equal(result.storage.loadStatus,'LOAD_FAILED');assert.equal(result.storage.storeStatus,'LOAD_FAILED');assert.ok(calls>0);
    assert.equal(resolveContextField(result.records,{teamId:'158',season:2026,eventId:'1001',field:'current.gamesPlayed',asOf:now}).value,1);
  }finally{fs.rmSync(failedLoad,{recursive:true,force:true});}
});

test('append-only context storage accepts the September 5-sized record batch that previously aborted at 5000',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'college-ingestion-5001-')),at='2026-09-05T14:00:00Z',hash='a'.repeat(64);try{
    const records=Array.from({length:5001},(_,i):NewCollegeContextRecord=>({teamId:'158',teamName:'Nebraska Cornhuskers',season:2026,eventId:'123',playerId:null,domain:'current_season',
      field:`current.bulkDiagnostic${i}`,value:i,effectiveFrom:at,effectiveTo:null,source:{name:'ESPN',url:'https://example.test/context',tier:2,reliability:'MEDIUM',publishedAt:at,retrievedAt:at},verification:'REPORTED',rawPayloadHash:hash}));
    const saved=appendCollegeContextRecords(root,records);assert.equal(saved.added,5001);assert.equal(saved.total,5001);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
