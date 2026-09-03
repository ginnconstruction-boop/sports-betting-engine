import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {appendCollegeContextRecords,contextBlendWeights,loadCollegeContextRecords,NewCollegeContextRecord,resolveCollegeTeamContext,resolveContextField} from '../services/collegeContextEvidence';
import {contextRecordsFromCfbd,contextRecordsFromEspnSummary,contextSourceReliability} from '../services/collegeContextIngestion';

const hash='a'.repeat(64),asOf=Date.parse('2026-09-03T16:00:00Z');
function row(field:string,value:unknown,patch:Partial<NewCollegeContextRecord>={}):NewCollegeContextRecord{return{
  teamId:'164',teamName:'Rutgers Scarlet Knights',season:2026,eventId:null,playerId:null,domain:field.startsWith('qb.')?'qb':field.startsWith('weather.')?'weather':field.startsWith('injur')?'injuries':field.startsWith('returning.')?'returning_production':field.startsWith('transfers.')?'transfers':field.startsWith('coaching.')?'coaching':field.startsWith('fcs.')?'fcs':'talent',
  field,value,effectiveFrom:'2026-09-03T12:00:00Z',effectiveTo:null,source:{name:'Official Rutgers',url:'https://scarletknights.com/context',tier:1,reliability:'HIGH',publishedAt:'2026-09-03T11:00:00Z',retrievedAt:'2026-09-03T12:00:00Z'},
  verification:'VERIFIED',rawPayloadHash:hash,...patch};}
test('source hierarchy and reliability distinguish official verification from secondary and unverified data',()=>{
  assert.equal(contextSourceReliability(1,'VERIFIED'),'HIGH');assert.equal(contextSourceReliability(2,'REPORTED'),'MEDIUM');assert.equal(contextSourceReliability(4,'REPORTED'),'LOW');
  const official=row('qb.status','CONFIRMED'),secondary=row('qb.status','EXPECTED',{source:{...row('',0).source,name:'ESPN',url:'https://espn.com/a',tier:2,reliability:'MEDIUM'}});
  assert.equal(resolveContextField([withId(secondary),withId(official)],{teamId:'164',season:2026,eventId:'1',field:'qb.status',asOf}).value,'CONFIRMED');
});
function withId(input:NewCollegeContextRecord):any{return{id:'test',schema:1,...input};}
test('as-of selection rejects future publication/retrieval/effective records and expired injuries/weather',()=>{
  const future=row('qb.status','CONFIRMED',{source:{...row('',0).source,publishedAt:'2026-09-04T11:00:00Z',retrievedAt:'2026-09-04T12:00:00Z'},effectiveFrom:'2026-09-04T12:00:00Z'});
  assert.equal(resolveContextField([withId(future)],{teamId:'164',season:2026,eventId:'1',field:'qb.status',asOf}).status,'MISSING');
  const oldInjury=row('injuries.teamStatus',{count:0},{domain:'injuries',source:{...row('',0).source,publishedAt:'2026-09-01T10:00:00Z',retrievedAt:'2026-09-01T10:00:00Z'},effectiveFrom:'2026-09-01T10:00:00Z'});
  assert.equal(resolveContextField([withId(oldInjury)],{teamId:'164',season:2026,eventId:'1',field:'injuries.teamStatus',asOf}).status,'STALE');
  const expired=row('weather.temperatureF',75,{domain:'weather',eventId:'1',effectiveTo:'2026-09-03T15:00:00Z'});
  assert.equal(resolveContextField([withId(expired)],{teamId:'164',season:2026,eventId:'1',field:'weather.temperatureF',asOf}).status,'MISSING');
});
test('equal-priority source conflict is preserved and reduces reliability instead of picking a QB',()=>{
  const a=withId(row('qb.status','CONFIRMED')),b=withId(row('qb.status','EXPECTED',{source:{...row('',0).source,name:'Official opponent release',url:'https://conference.test/qb'}}));
  const result=resolveContextField([a,b],{teamId:'164',season:2026,eventId:'1',field:'qb.status',asOf});
  assert.equal(result.status,'CONFLICT');assert.equal(result.value,null);assert.equal(result.records.length,2);assert.equal(result.reliability,'LOW');
});
test('a later injury status from the same source supersedes its earlier observation without rewriting it',()=>{
  const earlier=withId(row('injury.status','QUESTIONABLE',{domain:'injuries',eventId:'1'})),later=withId(row('injury.status','AVAILABLE',{domain:'injuries',eventId:'1',
    effectiveFrom:'2026-09-03T14:00:00Z',source:{...row('',0).source,publishedAt:'2026-09-03T14:00:00Z',retrievedAt:'2026-09-03T14:00:00Z'}}));
  const resolved=resolveContextField([earlier,later],{teamId:'164',season:2026,eventId:'1',field:'injury.status',asOf});
  assert.equal(resolved.value,'AVAILABLE');assert.equal(resolved.records.length,2);
});
test('QB hierarchy keeps EXPECTED separate from CONFIRMED and ESPN depth chart cannot confirm a starter',()=>{
  const team:any={teamId:'164',teamName:'Rutgers Scarlet Knights',eventId:'1',commenceTime:'2026-09-03T22:00:00Z',division:'FBS'};
  const records=contextRecordsFromEspnSummary({depthchart:[{team:{id:'164'},positions:[{position:{abbreviation:'QB'},athletes:[{athlete:{id:'7',displayName:'Example QB'}}]}]}]},[team],'https://site.api.espn.com/summary',asOf,hash);
  assert.equal(records.find(r=>r.field==='qb.status')?.value,'EXPECTED');assert.ok(!records.some(r=>r.value==='CONFIRMED'));
});
test('context completeness is transparent, separate from reliability and never creates point adjustments',()=>{
  const fields=[row('qb.status','CONFIRMED',{eventId:'1'}),row('qb.starterName','Example QB',{eventId:'1'}),row('returning.overallPct',.6),row('returning.offensePct',.5),row('returning.defensePct',.7),
    row('transfers.additions',10),row('transfers.departures',8),row('transfers.quality',{rated:5}),row('coaching.headCoach','Coach'),row('coaching.newHeadCoach',false),
    row('coaching.offensiveCoordinator','OC'),row('coaching.newOc',false),row('coaching.defensiveCoordinator','DC'),row('coaching.newDc',true),row('coaching.playCallerContinuity',true),
    row('talent.rosterComposite',700),row('talent.depthTier','HIGH'),row('talent.classification','FBS')].map(withId);
  const c=resolveCollegeTeamContext(fields,{teamId:'164',teamName:'Rutgers',season:2026,eventId:'1',asOf,currentGames:0});
  assert.equal(c.sections.qb.status,'complete');assert.equal(c.sections.weather.status,'missing');assert.ok(c.completeness>50&&c.completeness<90);assert.equal(c.reliability,'HIGH');
  assert.equal(c.contextAdjustedMargin,null);assert.match(c.contextAdjustmentReason,/not validated/);
});
test('Week 1 blend exposes structure but remains explicitly unfitted',()=>{
  const first=contextBlendWeights(1,0,80),later=contextBlendWeights(7,6,80);assert.equal(first.priorSeasonWeight,1);assert.equal(first.currentSeasonWeight,0);
  assert.ok(later.currentSeasonWeight>first.currentSeasonWeight);assert.equal(first.rosterContextWeight,.4);assert.equal(first.calibrated,false);
});
test('normalized context store is content-addressed, duplicate-safe and append-only',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'college-context-')),input=row('qb.status','CONFIRMED',{eventId:'1'});
  assert.deepEqual(appendCollegeContextRecords(root,[input]),{added:1,total:1});assert.deepEqual(appendCollegeContextRecords(root,[input]),{added:0,total:1});
  const loaded=loadCollegeContextRecords(root);assert.equal(loaded.length,1);assert.equal(loaded[0].value,'CONFIRMED');assert.ok(fs.existsSync(path.join(root,'college_context','evidence-v1','records',loaded[0].id+'.json')));
});
test('FCS tier remains unknown until a dated source supplies it',()=>{
  const missing=resolveCollegeTeamContext([],{teamId:'70',teamName:'Idaho',season:2026,eventId:'1',asOf,currentGames:1});assert.equal(missing.fcsTier.status,'MISSING');
  const supplied=resolveCollegeTeamContext([withId(row('fcs.tier','ELITE_FCS',{teamId:'70',teamName:'Idaho',domain:'fcs'}))],{teamId:'70',teamName:'Idaho',season:2026,eventId:'1',asOf,currentGames:1});
  assert.equal(supplied.fcsTier.value,'ELITE_FCS');
});
test('CFBD fixtures map returning production, portal movement, talent, coaching and prior FCS quality without inventing adjustments',()=>{
  const teams:any[]=[
    {teamId:'164',teamName:'Rutgers Scarlet Knights',aliases:['Rutgers','RUTG'],eventId:'1',commenceTime:'2026-09-03T22:00:00Z',division:'FBS'},
    {teamId:'70',teamName:'Idaho Vandals',aliases:['Idaho','IDHO'],eventId:'2',commenceTime:'2026-09-03T22:00:00Z',division:'FCS'},
  ];
  const payloads={
    returning:[{team:'Rutgers',percentPPA:.61,percentDefensePPA:.57,percentPassingPPA:.72,percentReceivingPPA:.64,percentRushingPPA:.53}],
    portal:[
      {origin:'Rutgers',destination:'Idaho',position:'QB',rating:.86,eligibility:'Immediate'},
      {origin:'Idaho',destination:'Rutgers',position:'WR',rating:.81,eligibility:'Immediate'},
      {origin:'Rutgers',destination:null,position:'RB',rating:.75,eligibility:'Withdrawn'},
    ],
    talent:[{school:'Rutgers',talent:712.4},{school:'Idaho',talent:321.7}],
    coaches:[{firstName:'Greg',lastName:'Schiano',seasons:[{year:2025,school:'Rutgers'},{year:2026,school:'Rutgers'}]}],
    fcsRatings:[{team:'Idaho',rating:18.2,ranking:3}],records:[{team:'Idaho',total:{wins:10,losses:4}}],
  };
  const urls=Object.fromEntries(Object.keys(payloads).map(key=>[key,`https://api.collegefootballdata.com/${key}`]));
  const hashes=Object.fromEntries(Object.keys(payloads).map(key=>[key,hash]));
  const records=contextRecordsFromCfbd(payloads,teams,urls,asOf,hashes);
  const get=(teamId:string,field:string)=>records.find(r=>r.teamId===teamId&&r.field===field)?.value;
  assert.equal(get('164','returning.offensePct'),.61);assert.equal(get('164','returning.overallPct'),undefined);
  assert.equal(get('164','transfers.additions'),1);assert.equal(get('164','transfers.departures'),1);
  assert.equal(get('164','talent.rosterComposite'),712.4);assert.equal(get('164','coaching.headCoach'),'Greg Schiano');
  assert.equal(get('164','coaching.newHeadCoach'),false);assert.equal(get('70','fcs.previousSrsRank'),3);
  assert.equal(get('70','fcs.tier'),'ELITE_FCS');assert.deepEqual(get('70','fcs.previousRecord'),{wins:10,losses:4});assert.equal(get('70','talent.providerChecked'),true);
  assert.ok(records.every(r=>r.source.tier===3));assert.ok(records.every(r=>!r.field.includes('adjustment')));
});
