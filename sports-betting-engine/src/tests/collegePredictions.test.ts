import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {CollegePredictions,loadCollegeModelBundle} from '../services/collegePredictions';
import {createCollegePaperLedger} from '../services/collegePaper';
import {NflEvidenceArchive} from '../services/nflEvidence';
import {nflPaperReport} from '../services/nflPaper';
const now=Date.parse('2026-09-02T22:00:00Z');
function fixture(){
  let clock=now,calls=0,fail=false;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'college-model-unit-'));
  const history=Array.from({length:160},(_,i)=>({id:String(1000+i),date:new Date(Date.UTC(2025,8,1+Math.floor(i/8))).toISOString(),season:2025,
    homeId:String(i%8),awayId:String((i+1+Math.floor(i/8)%7)%8),homeName:'Home',awayName:'Away',homeScore:35+i%4,awayScore:18+i%8,neutral:false}));
  const bundle:any={sha256:'a'.repeat(64),payload:{historySeason:2025,version:'college-score-ridge-v1',config:{ridge:1,halfLifeDays:365},history,
    validation:{paperApproved:{spreads:true,totals:false},moneyBettingApproved:false},marginResiduals:Array(600).fill(0),totalResiduals:Array(600).fill(0)}};
  const event:any={id:'fixture',sportKey:'americanfootball_ncaaf',homeTeam:'Home',awayTeam:'Away',commenceTime:'2026-09-03T22:00:00Z'};
  const identity:any={espnEventId:'123',homeTeamId:'0',awayTeamId:'1',neutralSite:false,source:'https://example.test/college',fetchedAt:new Date(now).toISOString()};
  const row:any={event,identity,status:'no_price_candidate'},raw:any={id:event.id,sport_key:event.sportKey,home_team:'Home',away_team:'Away',commence_time:event.commenceTime,
    bookmakers:[{key:'fanduel',title:'FanDuel',last_update:new Date(now).toISOString(),markets:[
      {key:'spreads',outcomes:[{name:'Home',point:20,price:-110},{name:'Away',point:-20,price:-110}]},
      {key:'totals',outcomes:[{name:'Over',point:20,price:-110}]}]}]};
  const summary={header:{league:{slug:'college-football'},season:{year:2026,type:2},competitions:[{id:'123',date:event.commenceTime,
    status:{type:{completed:true,state:'post',name:'STATUS_FINAL'}},competitors:[{homeAway:'home',team:{id:'0'},score:'24'},{homeAway:'away',team:{id:'1'},score:'21'}]}]}};
  const research:any={identity:async()=>identity,matchEvent:async()=>identity.espnEventId,summary:async()=>summary};
  const paper=createCollegePaperLedger(path.join(root,'college_paper_picks.json'),research,()=>clock);
  const service=new CollegePredictions(paper,root,async()=>{calls++;if(fail)throw Error('Offline');return{events:[]};},()=>clock,()=>bundle);
  return{root,event,identity,row,raw,service,paper,bundle,setClock:(n:number)=>{clock=n;},fail:()=>{fail=true;},calls:()=>calls};
}
test('bundled college model retains frozen audit hashes and separate spread/total validation',()=>{
  const b=loadCollegeModelBundle();assert.equal(b.payload.validation.paperApproved.spreads,true);assert.equal(b.payload.validation.paperApproved.totals,false);
  assert.equal(b.payload.validation.games,1565);assert.equal(b.payload.oddsAudit.wins,113);assert.equal(b.payload.oddsAudit.losses,93);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'college-corrupt-bundle-')),f=path.join(dir,'bundle.json');
  try{fs.writeFileSync(f,JSON.stringify({...b,sha256:'0'.repeat(64)}));assert.throws(()=>loadCollegeModelBundle(f),/integrity/);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('college preview → paper save → deduplicate → source replay → grade → export retains original forecast',async()=>{
  const f=fixture();try{
    const preview=await f.service.scan([f.row],[f.raw],false);assert.equal(preview.recommendations.length,0);assert.equal(f.paper.read().length,0);
    assert.equal(preview.projections[0].selected.length,1);assert.equal(f.calls(),4);
    const first=await f.service.scan([f.row],[f.raw],true);assert.equal(first.recommendations.length,1);assert.equal(f.calls(),4);
    const pick=first.recommendations[0].pick;assert.equal(pick.origin,'model');assert.equal(pick.quote.market,'spreads');
    assert.equal(f.paper.replay(pick.id).forecastReplay.status,'matched');
    f.raw.bookmakers[0].markets[0].outcomes[0].point=21;
    const second=await f.service.scan([f.row],[f.raw],true);assert.equal(second.recommendations[0].duplicate,true);
    assert.equal(second.recommendations[0].pick.quote.line,20);assert.equal(f.paper.read().length,1);
    f.setClock(Date.parse(f.event.commenceTime)+5*3600_000);const graded=await f.paper.grade();assert.equal(graded.picks[0].result,'WIN');
    const replay=f.paper.replay(pick.id);assert.equal(replay.forecastReplay.status,'matched');assert.equal(replay.audits[0].status,'matched');
    const exp=f.paper.exportRecord();assert.equal(exp.picks.length,1);assert.equal(Object.keys(exp.evidence).length,3);assert.equal(exp.missingEvidence.length,0);
    const report=nflPaperReport(exp.picks);assert.equal(report.buckets[0].origin,'model');assert.equal(report.buckets[0].wins,1);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('college model failures, mismatched quotes, missing venue and kickoff cannot produce recommendations',async()=>{
  for(const mode of ['offline','venue','wrongOdds','kickoff','stale','future','historySeason']){
    const f=fixture();try{
      if(mode==='offline')f.fail();if(mode==='venue')f.row.identity.neutralSite=null;
      if(mode==='wrongOdds')f.raw.home_team='Wrong';if(mode==='kickoff')f.setClock(Date.parse(f.event.commenceTime));
      if(mode==='stale')f.raw.bookmakers[0].last_update=new Date(now-3600_000).toISOString();
      if(mode==='future')f.raw.bookmakers[0].last_update=new Date(now+3600_000).toISOString();
      if(mode==='historySeason')f.bundle.payload.historySeason=2024;
      const result=await f.service.scan([f.row],[f.raw],true);assert.equal(result.recommendations.length,0,mode);assert.equal(f.paper.read().length,0);
    }finally{fs.rmSync(f.root,{recursive:true,force:true});}
  }
});
test('college storage and corrupted forecast evidence fail closed without erasing records',async()=>{
  const f=fixture();try{
    const first=await f.service.scan([f.row],[f.raw],true),pick=first.recommendations[0].pick;
    const evidenceFile=path.join(f.root,'college_forecast_evidence',pick.collegeForecast.forecastEvidenceHash+'.json');
    fs.writeFileSync(evidenceFile,'corrupted fixture');assert.equal(f.paper.replay(pick.id).forecastReplay.status,'evidence_unavailable_or_corrupt');
    assert.equal(f.paper.read()[0].result,'PENDING');assert.equal(f.paper.exportRecord().missingEvidence.length,1);
    assert.throws(()=>f.paper.saveCollegeModel(f.event,pick.quote,f.identity,pick.collegeForecast,f.bundle.payload.validation));
    assert.throws(()=>f.paper.saveCollegeModel(f.event,{...pick.quote,market:'totals'},f.identity,pick.collegeForecast,f.bundle.payload.validation),/gate/);
    assert.throws(()=>f.paper.saveCollegeModel({...f.event,sportKey:'americanfootball_nfl'},pick.quote,f.identity,pick.collegeForecast,f.bundle.payload.validation),/gate/);
    fs.writeFileSync(path.join(f.root,'college_paper_picks.json'),'corrupt ledger fixture');
    const failed=await f.service.scan([f.row],[f.raw],true);assert.equal(failed.recommendations.length,0);
    assert.equal(fs.readFileSync(path.join(f.root,'college_paper_picks.json'),'utf8'),'corrupt ledger fixture');
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
