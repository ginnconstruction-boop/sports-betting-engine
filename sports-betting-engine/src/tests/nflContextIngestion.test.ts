import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {NflContextIngestion} from '../services/nflContextIngestion';

const now=Date.parse('2026-09-10T18:00:00Z'),event:any={id:'odds-1',sportKey:'americanfootball_nfl',homeTeam:'Philadelphia Eagles',awayTeam:'Dallas Cowboys',commenceTime:'2026-09-11T00:20:00Z'};
const summary={header:{league:{slug:'nfl'},competitions:[{id:'401',competitors:[
  {homeAway:'home',team:{id:'21',displayName:event.homeTeam},records:[{type:'total',summary:'0-0'}]},
  {homeAway:'away',team:{id:'6',displayName:event.awayTeam},records:[{type:'total',summary:'0-0'}]}]}]},
  gameInfo:{venue:{indoor:false},weather:{temperature:76,windSpeed:8,gust:14,precipitation:10}}};
const roster=(id:string)=>({season:{year:2026},team:{id},athletes:[{items:[{id:'p'+id,displayName:'Player '+id,injuries:[]}]}]});
const depth=(id:string,name:string)=>({season:{year:2026},team:{id},depthchart:[{name:'Offense',positions:{qb:{position:{abbreviation:'QB'},athletes:[{id:'qb'+id,displayName:name}]}}}]});
const teams={sports:[{leagues:[{teams:[{team:{id:'6',displayName:event.awayTeam}},{team:{id:'21',displayName:event.homeTeam}}]}]}]};
const injuries={season:{year:2026},injuries:[{id:'6',displayName:event.awayTeam,injuries:[{id:'i6',date:'2026-09-09T15:00:00Z',status:'Questionable'}]},
  {id:'21',displayName:event.homeTeam,injuries:[]}]};
function research(calls:string[]=[]):any{return{matchEvent:async()=>{calls.push('match');return'401';},summary:async()=>{calls.push('summary');return summary;}};}
function getter(calls:string[]=[]){return async(url:string)=>{calls.push(url);if(url.endsWith('/teams'))return teams;if(url.endsWith('/injuries'))return injuries;
  const id=url.match(/\/teams\/(\d+)\//)?.[1];if(!id)throw Error('unexpected');return url.endsWith('/roster')?roster(id):depth(id,id==='21'?'Jalen Hurts':'Dak Prescott');};}

test('NFL preflight invokes real source adapters, stores exact IDs and reports expected QBs without claiming active status',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-context-ok-')),calls:string[]=[];try{const service=new NflContextIngestion(root,research(calls),getter(calls),()=>now,async()=>{}),result=await service.refresh([event]);
    assert.equal(result.summary.games,1);assert.equal(result.summary.teams,2);assert.equal(result.summary.rostersLoaded,2);assert.equal(result.summary.expectedQbs,2);assert.equal(result.summary.officialAvailability,0);
    assert.deepEqual(result.games[0].teams.map((team:any)=>team.teamId),['6','21']);assert.deepEqual(result.games[0].teams.map((team:any)=>team.qb.name),['Dak Prescott','Jalen Hurts']);
    assert.equal(result.games[0].availability.status,'NO_PROVIDER_CONFIGURED');assert.equal(result.games[0].weather.windMph,8);assert.equal(result.games[0].teams[0].injuries.listed,1);assert.equal(result.storage.storeStatus,'SUCCESS');
    const source=(id:string)=>result.sourceRegistry.sources.find((row:any)=>row.id===id);assert.equal(source('espn-roster:ROSTER').lastResult,'SUCCESS');assert.ok(source('espn-roster:ROSTER').lastAttempt);
    assert.equal(source('official-inactives:GAME_AVAILABILITY').lastResult,'NO_PROVIDER_CONFIGURED');assert.ok(fs.existsSync(path.join(root,'nfl_context','latest.json')));
    const firstCalls=calls.length;await service.refresh([event]);assert.equal(calls.filter(call=>call.includes('/roster')).length,2);assert.equal(calls.filter(call=>call.includes('/depthcharts')).length,2);assert.ok(calls.length>firstCalls);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('one NFL team source failure is precise and does not erase the other team or weather',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-context-isolate-'));try{const calls:string[]=[],get=async(url:string)=>{calls.push(url);if(url.includes('/teams/6/roster'))throw Error('NFL data source returned HTTP 429');
      if(url.endsWith('/teams'))return teams;if(url.endsWith('/injuries'))return injuries;const id=url.match(/\/teams\/(\d+)\//)?.[1]??'';return url.endsWith('/roster')?roster(id):depth(id,'Expected QB');};
    const result=await new NflContextIngestion(root,research(),get,()=>now,async()=>{}).refresh([event]),away=result.games[0].teams[0],home=result.games[0].teams[1];
    assert.equal(away.roster.status,'SOURCE_RATE_LIMITED');assert.equal(home.roster.status,'SUCCESS');assert.equal(home.qb.name,'Expected QB');assert.equal(result.games[0].weather.status,'PARTIAL_SUCCESS');
    assert.equal(calls.filter(url=>url.includes('/teams/6/roster')).length,1);assert.equal(result.storage.storeStatus,'SUCCESS');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('NFL team directory keeps roster and depth diagnostics available when game summary is offline',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-context-fallback-'));try{const r:any={matchEvent:async()=> '401',summary:async()=>{throw Error('NFL data source returned HTTP 503');}},
    result=await new NflContextIngestion(root,r,getter(),()=>now,async()=>{}).refresh([event]);
    assert.equal(result.games[0].identity,'SUCCESS');assert.deepEqual(result.games[0].teams.map((team:any)=>team.teamId),['6','21']);
    assert.deepEqual(result.games[0].teams.map((team:any)=>team.roster.status),['SUCCESS','SUCCESS']);assert.equal(result.games[0].weather.status,'NO_SOURCE_ATTEMPTED');
    assert.equal(result.sourceRegistry.sources.find((row:any)=>row.id==='espn-summary:WEATHER').lastResult,'SOURCE_HTTP_ERROR');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('NFL identity mismatch fails closed while preserving an auditable report',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-context-match-'));try{const bad={...summary,header:{...summary.header,competitions:[{...summary.header.competitions[0],competitors:[
      {homeAway:'home',team:{id:'21',displayName:'Wrong Team'}},{homeAway:'away',team:{id:'6',displayName:event.awayTeam}}]}]}};
    const r:any={matchEvent:async()=> '401',summary:async()=>bad},result=await new NflContextIngestion(root,r,getter(),()=>now,async()=>{}).refresh([event]);
    assert.equal(result.games[0].teams[0].roster.status,'TEAM_MATCH_FAILED');assert.equal(result.sourceRegistry.sources.find((row:any)=>row.id==='espn-summary:CURRENT_SEASON').lastResult,'TEAM_MATCH_FAILED');
    assert.equal(result.storage.storeStatus,'SUCCESS');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
