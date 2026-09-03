import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveCollegeTeam,canonicalCollegeName} from '../services/collegeEntities';
import {collegeDivision,earlySeasonBlend,rosterContext,ROSTER_FIELDS,contextMarginAdjustment,selectRosterSnapshot} from '../services/collegeContext';
import {assessCollegeSafety,marketDisagreement,collegeMarketConsensus} from '../services/collegeSafety';
import {fitCollegeCalibrator,calibratedProbability,calibrationMetrics,chronologicalCalibrationRows,CalibrationRow} from '../services/collegeCalibration';
import {collegeLineObservations,collegePickClv,collegeClvReport} from '../services/collegeClv';
const now=Date.parse('2026-09-03T12:00:00Z'),date=new Date(now).toISOString();
function fixture(){
  const event:any={id:'provider',sportKey:'americanfootball_ncaaf',homeTeam:'FBS Home',awayTeam:'FCS Away',commenceTime:'2026-09-03T23:00:00Z'};
  const identity:any={espnEventId:'123',homeTeamId:'1',awayTeamId:'2',homeConferenceId:'8',awayConferenceId:'24',neutralSite:false,week:1};
  const projection:any={version:'college-score-ridge-v1',homeId:'1',awayId:'2',homeMargin:20,homeScore:35,awayScore:15,total:50,neutral:false,asOf:date,
    homeGames:12,awayGames:12,homeCurrentGames:0,awayCurrentGames:0,homeLastGame:'2025-11-20T12:00:00Z',awayLastGame:'2025-11-20T12:00:00Z'};
  const quotes:any[]=['fanduel','betmgm','other'].flatMap(bookKey=>[{bookKey,book:bookKey,market:'spreads',participant:'',side:event.homeTeam,line:-42.5,price:-110,updatedAt:date,stale:false},
    {bookKey,book:bookKey,market:'spreads',participant:'',side:event.awayTeam,line:42.5,price:-110,updatedAt:date,stale:false}]);
  const candidate:any={quote:quotes[1],assessment:{eligible:true,probability:.85,pushProbability:0,estimatedEV:.6}};
  return {event,identity,projection,quotes,candidate,rosters:[],now,spreadHoldoutPassed:true};
}
test('canonical UMass aliases, punctuation, hyphenation, renamed programs and directional schools resolve safely',()=>{
  const umass={id:'113',displayName:'Massachusetts Minutemen'};
  for(const name of ['Massachusetts','UMass','UMass Minutemen','Massachusetts Minutemen'])assert.equal(resolveCollegeTeam(name,[umass]).espnTeamId,'113');
  assert.equal(canonicalCollegeName('Bethune–Cookman Wildcats'),canonicalCollegeName('Bethune-Cookman Wildcats'));
  assert.equal(resolveCollegeTeam('Arkansas-Pine Bluff Golden Lions',[{id:'2029',displayName:'Arkansas Pine Bluff Golden Lions'}]).resolved,true);
  assert.equal(resolveCollegeTeam('Houston Baptist Huskies',[{id:'2277',displayName:'Houston Christian Huskies'}]).resolved,true);
  const teams=[{id:'1',displayName:'North Carolina'},{id:'2',displayName:'North Carolina State'},{id:'3',displayName:'North Dakota'},{id:'4',displayName:'South Dakota'}];
  assert.equal(resolveCollegeTeam('North Carolina State',teams).espnTeamId,'2');
  assert.equal(resolveCollegeTeam('N Carolina',teams).resolved,false);assert.equal(resolveCollegeTeam('South Dakota',teams).espnTeamId,'4');
  assert.equal(resolveCollegeTeam('unknown name',teams,'1').method,'provider_id');
  assert.equal(resolveCollegeTeam('North Carolina',teams,'999').resolved,false);
  assert.equal(resolveCollegeTeam('UMass',[umass,{id:'999',displayName:'UMass'}]).resolved,false);
  assert.equal(resolveCollegeTeam('North Carolina State Wolfpack!', [{id:'7',displayName:'North Carolina State Wolfpack'}]).resolved,true);
  const fuzzy=resolveCollegeTeam('North Carolina State Wolfpack extra',[{id:'7',displayName:'North Carolina State Wolfpack'}]);
  assert.equal(fuzzy.resolved,false);assert.equal(fuzzy.method,'fuzzy_manual_review');
});
test('FBS/FCS classification is season-scoped and unknown never becomes FCS by default',()=>{
  assert.equal(collegeDivision(2025,'8'),'FBS');assert.equal(collegeDivision(2026,'24'),'FCS');
  assert.equal(collegeDivision(2027,'8'),'UNKNOWN');assert.equal(collegeDivision(2026,'9999'),'UNKNOWN');
});
test('documented early-season blend shifts with sample and never treats missing quality as known',()=>{
  assert.equal(earlySeasonBlend(1,0,1).preseasonWeight,1);
  assert.ok(earlySeasonBlend(3,2,1).preseasonWeight>.5);
  assert.ok(earlySeasonBlend(5,4,1).currentSeasonWeight>earlySeasonBlend(3,2,1).currentSeasonWeight);
  assert.ok(earlySeasonBlend(7,6,1).currentSeasonWeight>.5);
  assert.equal(earlySeasonBlend(8,6,null).currentSeasonWeight,0);
  assert.equal(earlySeasonBlend(8,6,0).currentSeasonWeight,0);
  assert.throws(()=>earlySeasonBlend(1,-1,1));assert.throws(()=>earlySeasonBlend(1,2,1.1));
});
test('dated roster context rejects future, stale, wrong-season, impossible and wrong-game QB data',()=>{
  const features=Object.fromEntries(ROSTER_FIELDS.map(k=>[k,0]));
  const snap:any={teamId:'1',season:2026,version:'source-v1',source:'https://example.test/roster',publishedAt:date,fetchedAt:date,validUntil:'2026-09-04T12:00:00Z',features,sampleQuality:1,
    qb:{eventId:'123',starterId:'777',verifiedAt:date,source:'https://example.test/status',injuryStatusVerified:true}};
  const check=(s:any)=>rosterContext(s,'1',2026,'123',now+3600_000,now);
  assert.equal(check(snap).completeness,1);assert.equal(check(snap).qbVerified,true);
  for(const patch of [{season:2025},{fetchedAt:'2026-09-04T12:00:00Z'},{validUntil:'2026-09-02T12:00:00Z'},{teamId:'2'}])assert.equal(check({...snap,...patch}).completeness,0);
  assert.equal(check({...snap,features:{...features,returningProduction:1.2}}).completeness,0);
  assert.equal(check({...snap,qb:{...snap.qb,eventId:'999'}}).qbVerified,false);
  assert.equal(check(undefined).quality,null);
  assert.equal(selectRosterSnapshot([snap,{...snap,fetchedAt:'2026-09-04T12:00:00Z'}],'1',2026,now),snap);
});
test('mismatch framework has no fixed FBS bonus; missing inputs yield null, validated quality interactions vary',()=>{
  const f=fixture(),missing=rosterContext(undefined,'1',2026,'123',now+3600_000,now);
  const absent=contextMarginAdjustment(missing,missing,['FBS','FCS'],1,[0,0],now);assert.equal(absent.mismatchPoints,null);assert.equal(absent.adjusted,false);
  const home:any={...missing,completeness:1,quality:1,features:Object.fromEntries(ROSTER_FIELDS.map(k=>[k,k==='talentRating'?8:0]))};
  const away:any={...home,features:{...home.features,talentRating:3}};
  const artifact:any={version:'test-only',trainedThrough:'2024-01-01',trainingDataHash:'a'.repeat(64),validation:{approvedForPaper:true,games:600,baselineRmse:20,rmse:18},roster:{},mismatch:{talentRating:2}};
  assert.equal(contextMarginAdjustment(home,away,['FBS','FCS'],1,[0,0],now,artifact).mismatchPoints,10);
  away.features.talentRating=7;assert.equal(contextMarginAdjustment(home,away,['FBS','FCS'],1,[0,0],now,artifact).mismatchPoints,2);
  assert.equal(contextMarginAdjustment(home,away,['FBS','FBS'],1,[0,0],now,artifact).mismatchPoints,0);
});
test('market boundaries are explicit; extreme discrepancies and provider anomalies cannot raise confidence',()=>{
  for(const [points,label]of [[0,'NORMAL'],[2.99,'NORMAL'],[3,'MEANINGFUL'],[6,'LARGE'],[10,'EXTREME'],[-10,'EXTREME']]as const)assert.ok(marketDisagreement(points).startsWith(label));
  const f=fixture(),s=assessCollegeSafety(f);assert.equal(s.classification,'MODEL WARNING');assert.equal(s.confidence,'LOW');assert.equal(s.trackable,false);
  assert.equal(s.mismatch.hugeFcsUnderdog,true);assert.equal(s.talentAdjustedHomeMargin,null);assert.equal(s.kellyEnabled,false);assert.equal(s.recommendedStake,null);
  for(const q of f.quotes)q.line=q.side===f.event.homeTeam?-25:25;
  assert.equal(assessCollegeSafety(f).classification,'PAPER MONITOR');
  f.quotes[0].line=-7;assert.equal(assessCollegeSafety(f).classification,'MODEL WARNING');
});
test('totals, stale lines, started games and invalid venue never become qualified paper bets',()=>{
  const f=fixture();f.candidate.quote={...f.candidate.quote,market:'totals'};
  const s=assessCollegeSafety(f);assert.equal(s.classification,'PAPER PASS');assert.equal(s.trackable,false);assert.match(s.totalsStatus,/holdout gate failed/);
  const a=fixture();a.now=Date.parse(a.event.commenceTime);assert.equal(assessCollegeSafety(a).trackable,false);
  const b=fixture();b.quotes.forEach(q=>q.updatedAt='2026-09-02T12:00:00Z');assert.equal(collegeMarketConsensus(b.event,b.quotes,now).homeLine,null);
  const c=fixture();c.identity.neutralSite=null;assert.equal(assessCollegeSafety(c).classification,'MODEL WARNING');
});
function calibrationRows():CalibrationRow[]{return Array.from({length:200},(_,i)=>({id:String(i),predictedAt:'2024-01-01T00:00:00Z',kickoff:'2024-01-02T00:00:00Z',
  resolvedAt:'2024-01-03T00:00:00Z',probability:i<100?.6:.9,outcome:(i%10<(i<100?3:7)?1:0)as 0|1}));}
test('Platt and PAV isotonic learn held-out frequency without target/future/duplicate leakage',()=>{
  const rows=calibrationRows(),cutoff=Date.parse('2024-02-01'),future={...rows[0],id:'future',resolvedAt:'2025-01-01'};
  for(const method of ['platt','isotonic']as const){const a=fitCollegeCalibrator([...rows,future],cutoff,method);
    assert.equal(a.trainingIds.length,200);assert.equal(a.approved,false);assert.equal(calibratedProbability(a,.6,cutoff),null);
    assert.ok(Math.abs(calibratedProbability(a,.6,cutoff+1)-.3)<.01);assert.ok(Math.abs(calibratedProbability(a,.9,cutoff+1)-.7)<.01);
    assert.deepEqual(a,fitCollegeCalibrator([...rows,{...future,outcome:1}],cutoff,method));}
  assert.throws(()=>chronologicalCalibrationRows([...rows,rows[0]],cutoff),/Duplicate/);
  assert.throws(()=>chronologicalCalibrationRows([{...rows[0],predictedAt:'2024-01-04'}],cutoff));
});
test('reliability buckets conserve all samples/Brier contributions and report observed outcomes',()=>{
  const rows=calibrationRows().map(r=>({probability:r.probability,outcome:r.outcome})),m=calibrationMetrics(rows);
  assert.equal(m.reliability.reduce((s,b)=>s+b.count,0),200);
  assert.ok(Math.abs(m.reliability.reduce((s,b)=>s+b.brierContribution,0)-m.brier)<1e-12);
  assert.equal(m.reliability.find(b=>b.label==='60–64%').actualWinRate,.3);
  const ideal=calibrationMetrics(rows.map(r=>({...r,probability:r.probability===.6?.3:.7})));
  assert.ok(Math.abs(ideal.calibrationIntercept)<.01);assert.ok(Math.abs(ideal.calibrationSlope-1)<.01);
  assert.equal(calibrationMetrics([]).brier,null);
});
test('spread CLV signs and exact-line price CLV are separate from wins/losses; early quotes are not closes',()=>{
  const f=fixture(),kickoff=Date.parse(f.event.commenceTime),p:any={id:'pick',event:f.event,quote:{...f.candidate.quote,line:24.5},result:'LOSS'};
  let q={...p.quote,line:22,updatedAt:new Date(kickoff-60_000).toISOString()};
  p.collegeLineObservations=collegeLineObservations(p,[q],kickoff-50_000);
  const close=collegePickClv(p,kickoff+1);assert.equal(close.lineClv,2.5);assert.equal(close.priceClv,null);assert.equal(p.quote.line,24.5);
  const win=collegePickClv({...p,result:'WIN'},kickoff+1);assert.deepEqual(win,close);
  q={...q,line:24.5,price:-120};p.collegeLineObservations=collegeLineObservations(p,[q],kickoff-50_000);
  assert.ok(collegePickClv(p,kickoff+1).priceClvProbabilityPoints>0);
  p.collegeLineObservations=collegeLineObservations(p,[{...q,updatedAt:date}],now);assert.equal(collegePickClv(p,kickoff+1).lineClv,null);
  assert.equal(collegeLineObservations(p,[q],kickoff).length,0);
  assert.equal(collegeClvReport([p],kickoff+1).averageSpreadClv,null);
  p.quote.line=-7;q={...q,line:-9};p.collegeLineObservations=collegeLineObservations(p,[q],kickoff-50_000);
  assert.equal(collegePickClv(p,kickoff+1).lineClv,2);
});
