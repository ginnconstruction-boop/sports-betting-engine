import test from 'node:test';
import assert from 'node:assert/strict';
import {MarketPriorConfig,MarketPriorObservation,auditMarketPriorRows,chronologicalMarketPriorSplit,evaluateCandidates,fitConvexBlend,marketHomeMarginFromSpread,runCollegeMarketPriorResearch,signedModelMinusMarket} from '../services/collegeMarketPriorResearch';
import {phase4Rows} from '../dev/collegeMarketPriorResearch';

const config:MarketPriorConfig={version:'test-v1',trainDateCount:3,validationDateCount:1,ridgeLambdas:[.1,1,10],
  disagreementBuckets:[{label:'0–1.5',minExclusive:null,maxInclusive:1.5},{label:'>1.5–3',minExclusive:1.5,maxInclusive:3},{label:'>3',minExclusive:3,maxInclusive:null}],
  marketSpreadBuckets:[{label:'0–3',minExclusive:null,maxInclusive:3},{label:'>3–7',minExclusive:3,maxInclusive:7},{label:'>7',minExclusive:7,maxInclusive:null}],
  passGate:{minimumTestGames:2,minimumRmseImprovementPoints:.01,minimumRelativeRmseImprovement:0,requireMaeImprovement:true}};

const dates=['2025-09-01','2025-09-08','2025-09-15','2025-09-22','2025-09-29','2025-10-06'];
const row=(i:number,overrides:Partial<MarketPriorObservation>={}):MarketPriorObservation=>{const date=dates[Math.floor(i/2)]??dates.at(-1)!;
  return {observationId:`o${i}`,gameId:`g${i}`,evidenceClass:'RECONSTRUCTED_FORECAST',sourceLabel:'test',forecastAt:`${date}T12:00:00Z`,marketAt:`${date}T11:59:00Z`,
    inputsAsOf:`${date}T11:58:00Z`,kickoff:`${date}T18:00:00Z`,modelVersion:'score-v1',marketDefinition:'exact contemporaneous test line',
    modelHomeMargin:8,marketHomeMargin:6,actualHomeMargin:6,americanPrice:-110,priceSide:'HOME',week:Math.floor(i/2)+1,
    matchupClass:i%3===0?'FBS vs FCS':'FBS vs FBS',marketHomeSpread:-6,neutralSite:false,...overrides};};
const sample=()=>Array.from({length:12},(_,i)=>row(i,{modelHomeMargin:8+i%2,marketHomeMargin:6+i%2,marketHomeSpread:-(6+i%2),actualHomeMargin:6+i%2+(i%3-1)}));

test('market spread and home-margin sign conventions are exact',()=>{
  assert.equal(marketHomeMarginFromSpread(-7),7);assert.equal(marketHomeMarginFromSpread(3.5),-3.5);
  assert.equal(signedModelMinusMarket(10,7),3);assert.equal(signedModelMinusMarket(4,7),-3);
});

test('chronological split uses the first three dates, fourth validation and final two test without shuffle',()=>{
  const s=chronologicalMarketPriorSplit(sample(),config);assert.deepEqual(s.dates.train,dates.slice(0,3));assert.deepEqual(s.dates.validation,[dates[3]]);assert.deepEqual(s.dates.test,dates.slice(4));
  assert.equal(s.train.length,6);assert.equal(s.validation.length,2);assert.equal(s.test.length,4);
});

test('point-in-time audit rejects future market/model inputs and post-kickoff forecasts',()=>{
  const bad=[row(0,{marketAt:'2025-09-01T12:01:00Z'}),row(1,{inputsAsOf:'2025-09-01T12:01:00Z'}),row(2,{forecastAt:'2025-09-08T18:00:00Z'})];
  const a=auditMarketPriorRows(bad);assert.equal(a.rows.length,0);assert.equal(a.exclusions.POST_FORECAST_MARKET_LEAKAGE,1);assert.equal(a.exclusions.POST_FORECAST_MODEL_INPUT_LEAKAGE,1);assert.equal(a.exclusions.FORECAST_NOT_BEFORE_KICKOFF,1);
});

test('convex ensemble learns only from supplied training rows',()=>{
  const s=chronologicalMarketPriorSplit(sample(),config),fit=fitConvexBlend(s.train);assert.deepEqual(fit.trainedObservationIds,s.train.map(r=>r.observationId).sort());
  assert.ok(s.validation.every(r=>!fit.trainedObservationIds.includes(r.observationId)));assert.ok(s.test.every(r=>!fit.trainedObservationIds.includes(r.observationId)));
});

test('candidate selection uses validation RMSE and deterministic tie ordering',()=>{
  const s=chronologicalMarketPriorSplit(sample(),config),c=evaluateCandidates(s.train,s.validation,config);
  assert.ok(c.every((x,i)=>i===0||(c[i-1].validation.rmse!<=x.validation.rmse!)));
  assert.equal(c[0].name,evaluateCandidates(s.train,s.validation,config)[0].name);
});

test('locked fit never contains untouched test observation IDs',()=>{
  const a=runCollegeMarketPriorResearch(sample(),{generatedAt:'2026-09-07T05:00:00Z',applicationVersion:'test',datasetVersion:'test',config});
  const s=chronologicalMarketPriorSplit(sample(),config);assert.ok(s.test.every(r=>!a.lockedFit.trainedObservationIds.includes(r.observationId)));
  assert.equal(a.testComparison.n,4);
});

test('changing untouched test outcomes cannot change architecture or locked parameters',()=>{
  const original=sample(),changed=original.map(r=>dates.slice(4).includes(r.forecastAt.slice(0,10))?{...r,actualHomeMargin:r.actualHomeMargin+100}:r);
  const options={generatedAt:'2026-09-07T05:00:00Z',applicationVersion:'test',datasetVersion:'test',config},a=runCollegeMarketPriorResearch(original,options),b=runCollegeMarketPriorResearch(changed,options);
  assert.equal(a.selectedCandidate,b.selectedCandidate);assert.deepEqual(a.lockedFit.parameters,b.lockedFit.parameters);assert.notDeepEqual(a.testComparison,b.testComparison);
});

test('FBS/FCS, week, disagreement and spread segments are preserved',()=>{
  const a=runCollegeMarketPriorResearch(sample(),{generatedAt:'2026-09-07T05:00:00Z',applicationVersion:'test',datasetVersion:'test',config});
  assert.ok(a.allBaselineSegments.matchup['FBS vs FCS']);assert.ok(a.allBaselineSegments.matchup['FBS vs FBS']);
  assert.ok(a.allBaselineSegments.week.WEEK_0_TO_2);assert.ok(Object.keys(a.testSegments.disagreement).length);assert.ok(Object.keys(a.testSegments.marketSpread).length);
});

test('residual analysis detects market correction of systematic model disagreement',()=>{
  const rows=sample().map((r,i)=>({...r,marketHomeMargin:i,marketHomeSpread:-i,modelHomeMargin:i+(i%4+1),actualHomeMargin:i}));
  const a=runCollegeMarketPriorResearch(rows,{generatedAt:'2026-09-07T05:00:00Z',applicationVersion:'test',datasetVersion:'test',config});
  assert.equal(a.residualAnalysis.correlationWithSignedDisagreement,-1);assert.equal(a.residualAnalysis.linearSlopeOnSignedDisagreement,-1);
});

test('report artifact is deterministic for identical rows, config and timestamp',()=>{
  const options={generatedAt:'2026-09-07T05:00:00Z',applicationVersion:'test',datasetVersion:'test',config};assert.deepEqual(runCollegeMarketPriorResearch(sample(),options),runCollegeMarketPriorResearch(sample(),options));
});

test('real Phase 4 adapter retains all 318 point-in-time reconstructed games',()=>{
  const rows=phase4Rows(),a=auditMarketPriorRows(rows);assert.equal(rows.length,318);assert.equal(a.rows.length,318);assert.deepEqual(a.exclusions,{});
  assert.ok(rows.some(r=>r.matchupClass==='FBS vs FCS'));assert.ok(rows.every(r=>r.marketHomeMargin===-r.marketHomeSpread));
});

test('ensemble decision output is one of the exact research-gate states and never changes production',()=>{
  const a=runCollegeMarketPriorResearch(sample(),{generatedAt:'2026-09-07T05:00:00Z',applicationVersion:'test',datasetVersion:'test',config});
  assert.ok(['ENSEMBLE PASSES RESEARCH GATE','ENSEMBLE INCONCLUSIVE','ENSEMBLE FAILS RESEARCH GATE'].includes(a.decision));assert.equal(a.productionChanged,false);
});
