import test from 'node:test';
import assert from 'node:assert/strict';
import {CollegeEdgeResearchRow,DEFAULT_COLLEGE_EDGE_RESEARCH_CONFIG,edgeBucket,prepareCollegeEdgeRow,renderCollegeEdgeResearchReport,runCollegeEdgeResearch,signedCollegeEdge} from '../services/collegeEdgeResearch';
import {archivedLiveRows,reconstructedRows} from '../dev/collegeEdgeResearch';

const base=(overrides:Partial<CollegeEdgeResearchRow>={}):CollegeEdgeResearchRow=>({
  observationId:'one',gameId:'game-1',evidenceClass:'ARCHIVED_LIVE_FORECAST',sourceLabel:'test archive',homeTeam:'Home',awayTeam:'Away',
  kickoff:'2026-09-12T17:00:00Z',forecastAt:'2026-09-12T15:00:00Z',inputsAsOf:'2026-09-12T14:59:00Z',resolvedAt:'2026-09-12T21:00:00Z',
  modelVersion:'model-v1',modelHomeMargin:10,actualHomeMargin:10,marketHomeSpread:-7,americanPrice:-110,archivedResult:'WIN',
  quoteUpdatedAt:'2026-09-12T14:58:00Z',week:2,homeConference:'A',awayConference:'B',matchupClass:'FBS vs FBS',neutralSite:false,
  contextCritical:{canonicalIds:true,providerLine:true,qbKnown:true},...overrides,
});

test('signed edge convention is toward home and is symmetric under home/away reversal',()=>{
  assert.equal(signedCollegeEdge(-10,-7),3);
  assert.equal(signedCollegeEdge(-4,-7),-3);
  const home=prepareCollegeEdgeRow(base()),away=prepareCollegeEdgeRow(base({homeTeam:'Away',awayTeam:'Home',modelHomeMargin:-10,actualHomeMargin:-10,marketHomeSpread:7}));
  assert.equal(home.signedEdgeTowardHome,3);assert.equal(home.modelSide,'HOME');assert.equal(home.derivedResult,'WIN');
  assert.equal(away.signedEdgeTowardHome,-3);assert.equal(away.modelSide,'AWAY');assert.equal(away.derivedResult,'WIN');
  assert.equal(home.absoluteEdge,away.absoluteEdge);
});

test('edge buckets obey exact boundary semantics',()=>{
  const b=DEFAULT_COLLEGE_EDGE_RESEARCH_CONFIG.edgeBuckets;
  assert.equal(edgeBucket(0,b),'0–1.5');assert.equal(edgeBucket(1.5,b),'0–1.5');assert.equal(edgeBucket(1.50001,b),'>1.5–3');
  assert.equal(edgeBucket(3,b),'>1.5–3');assert.equal(edgeBucket(3.01,b),'>3–5');assert.equal(edgeBucket(10,b),'>7–10');assert.equal(edgeBucket(10.01,b),'>10');
});

test('market spread ranges classify pick-em, key ranges and large favorites',()=>{
  const b=DEFAULT_COLLEGE_EDGE_RESEARCH_CONFIG.marketSpreadBuckets;
  assert.equal(edgeBucket(0,b),'0–3');assert.equal(edgeBucket(3,b),'0–3');assert.equal(edgeBucket(3.5,b),'>3–7');
  assert.equal(edgeBucket(7.5,b),'>7–14');assert.equal(edgeBucket(14.5,b),'>14–21');assert.equal(edgeBucket(21.5,b),'>21–30');
});

test('favorite and underdog directions distinguish stronger, weaker and flipped favorites',()=>{
  const stronger=prepareCollegeEdgeRow(base({modelHomeMargin:10,marketHomeSpread:-7}));
  const weaker=prepareCollegeEdgeRow(base({modelHomeMargin:4,marketHomeSpread:-7,actualHomeMargin:-1,archivedResult:'WIN'}));
  const flipped=prepareCollegeEdgeRow(base({modelHomeMargin:-2,marketHomeSpread:-7,actualHomeMargin:-1,archivedResult:'WIN'}));
  assert.equal(stronger.direction,'MODEL_FAVORS_FAVORITE');assert.equal(stronger.favoriteComparison,'MODEL_MAKES_FAVORITE_STRONGER');
  assert.equal(weaker.direction,'MODEL_FAVORS_UNDERDOG');assert.equal(weaker.favoriteComparison,'MODEL_MAKES_FAVORITE_WEAKER');
  assert.equal(flipped.direction,'MODEL_FAVORS_UNDERDOG');assert.equal(flipped.favoriteComparison,'MODEL_FLIPS_MARKET_FAVORITE');
});

test('missing prices never become -110 and units remain unavailable',()=>{
  const artifact=runCollegeEdgeResearch([base({americanPrice:null})],{generatedAt:'2026-09-13T00:00:00Z'});
  const metrics=artifact.evidence.ARCHIVED_LIVE_FORECAST!.overall;
  assert.equal(metrics.observations,1);assert.equal(metrics.wins,1);assert.equal(metrics.priceSample,0);
  assert.equal(metrics.averageAmericanPrice,null);assert.equal(metrics.totalUnits,null);assert.equal(metrics.roi,null);
  assert.equal(artifact.evidence.ARCHIVED_LIVE_FORECAST!.integrityWarnings.PRICE_UNAVAILABLE_UNITS_NOT_COMPUTED,1);
});

test('American price units and push handling are exact',()=>{
  const rows=[base({observationId:'a',americanPrice:-115}),base({observationId:'b',gameId:'g2',americanPrice:125}),
    base({observationId:'c',gameId:'g3',actualHomeMargin:7,archivedResult:'PUSH',americanPrice:-110})];
  const m=runCollegeEdgeResearch(rows,{generatedAt:'2026-09-13T00:00:00Z'}).evidence.ARCHIVED_LIVE_FORECAST!.overall;
  assert.equal(m.wins,2);assert.equal(m.pushes,1);assert.equal(m.losses,0);assert.equal(m.atsPercentage,1);
  assert.equal(m.totalUnits,Number((100/115+1.25).toFixed(6)));assert.equal(m.unitEligible,3);
});

test('point-in-time violations are excluded and never leak into ATS results',()=>{
  for(const row of [base({forecastAt:'2026-09-12T17:00:00Z'}),base({inputsAsOf:'2026-09-12T15:01:00Z'}),base({resolvedAt:'2026-09-12T16:59:00Z'})]){
    const p=prepareCollegeEdgeRow(row);assert.equal(p.eligibleForAts,false);assert.ok(p.exclusions.length>0);
  }
});

test('evidence classes remain segregated and cross-evidence metrics do not exist',()=>{
  const rows=[base(),base({observationId:'r',evidenceClass:'RECONSTRUCTED_FORECAST'}),base({observationId:'s',evidenceClass:'SYNTHETIC_DERIVED_RESEARCH',marketHomeSpread:null,americanPrice:null,archivedResult:null})];
  const a=runCollegeEdgeResearch(rows,{generatedAt:'2026-09-13T00:00:00Z'});
  assert.equal(a.evidence.ARCHIVED_LIVE_FORECAST!.overall.observations,1);
  assert.equal(a.evidence.RECONSTRUCTED_FORECAST!.overall.observations,1);
  assert.equal(a.evidence.SYNTHETIC_DERIVED_RESEARCH!.overall.observations,0);
  assert.equal(a.evidence.SYNTHETIC_DERIVED_RESEARCH!.overall.modelMarginError.sample,1);
  assert.equal(a.crossEvidenceCombinedMetrics,null);
});

test('exact duplicate observations are removed while version repeats remain disclosed',()=>{
  const duplicate=base(),otherVersion=base({observationId:'two',modelVersion:'model-v2'});
  const r=runCollegeEdgeResearch([duplicate,duplicate,otherVersion],{generatedAt:'2026-09-13T00:00:00Z'}).evidence.ARCHIVED_LIVE_FORECAST!;
  assert.equal(r.counts.exactDuplicatesExcluded,1);assert.equal(r.overall.observations,2);assert.equal(r.overall.distinctGames,1);assert.equal(r.overall.correlatedRepeatObservations,1);
});

test('line movement uses only an explicitly labeled close or pre-kick proxy',()=>{
  assert.equal(prepareCollegeEdgeRow(base()).movementBucket,'MOVEMENT_UNKNOWN');
  assert.equal(prepareCollegeEdgeRow(base({comparisonHomeSpread:-8,comparisonKind:'LATEST_PRE_KICK_PROXY'})).movementBucket,'MODEL_SIDE_MARKET_MOVED_TOWARD');
  assert.equal(prepareCollegeEdgeRow(base({comparisonHomeSpread:-6,comparisonKind:'VERIFIED_CLOSE'})).movementBucket,'MODEL_SIDE_MARKET_MOVED_AGAINST');
});

test('VOID, UNABLE_TO_GRADE and legacy REVIEW are excluded from ATS research',()=>{
  for(const archivedResult of ['VOID','UNABLE_TO_GRADE','REVIEW'] as const){const row=prepareCollegeEdgeRow(base({archivedResult}));
    assert.equal(row.eligibleForAts,false);assert.ok(row.exclusions.includes(`NON_ATS_STATUS_${archivedResult}_EXCLUDED`));}
});

test('small samples carry warnings and Wilson intervals instead of activation claims',()=>{
  const r=runCollegeEdgeResearch([base()],{generatedAt:'2026-09-13T00:00:00Z'}).evidence.ARCHIVED_LIVE_FORECAST!.overall;
  assert.equal(r.sampleWarning,'INSUFFICIENT_SAMPLE');assert.ok(r.confidenceInterval95!.low<r.confidenceInterval95!.high);
});

test('artifact and report are deterministic for fixed input, configuration and timestamp',()=>{
  const options={generatedAt:'2026-09-13T00:00:00Z'},a=runCollegeEdgeResearch([base()],options),b=runCollegeEdgeResearch([base()],options);
  assert.deepEqual(a,b);assert.equal(renderCollegeEdgeResearchReport(a),renderCollegeEdgeResearchReport(b));
  assert.match(renderCollegeEdgeResearchReport(a),/DISCOVERY_SAMPLE_NOT_ACTIVATION_EVIDENCE/);
});

test('monotonicity output is descriptive and requires at least three sufficiently sized buckets',()=>{
  const rows:CollegeEdgeResearchRow[]=[];let id=0;
  for(const [margin,line,wins] of [[2,-1,6],[5,-2,7],[10,-3,8]] as number[][])for(let i=0;i<10;i++){
    const homeWin=i<wins;rows.push(base({observationId:String(id),gameId:`g${id++}`,modelHomeMargin:margin,marketHomeSpread:line,
      actualHomeMargin:homeWin?-line+1:-line-1,archivedResult:homeWin?'WIN':'LOSS'}));
  }
  const monotonic=runCollegeEdgeResearch(rows,{generatedAt:'2026-09-13T00:00:00Z'}).evidence.ARCHIVED_LIVE_FORECAST!.monotonicity;
  assert.equal(monotonic.eligible,true);assert.equal(monotonic.direction,'INCREASING');
});

test('historical adapter evaluates all 318 line-available model sides, including small edges',()=>{
  const rows=reconstructedRows(),prepared=rows.map(prepareCollegeEdgeRow);
  assert.equal(rows.length,318);assert.ok(prepared.some(row=>(row.absoluteEdge??Infinity)<=1.5));
  assert.ok(prepared.every(row=>row.eligibleForAts));assert.ok(rows.every(row=>Date.parse(row.quoteUpdatedAt!)<=Date.parse(row.forecastAt)));
  assert.ok(rows.every(row=>Number.isFinite(row.americanPrice)&&Math.abs(row.americanPrice!)>=100));
});

test('archived live adapter uses immutable forecast fields and no absent close proxy',()=>{
  const rows=archivedLiveRows([{id:'pick',origin:'model',espnEventId:'espn',savedAt:'2026-09-12T15:00:00Z',version:'v5',result:'WIN',
    event:{id:'odds',sportKey:'americanfootball_ncaaf',homeTeam:'Home',awayTeam:'Away',commenceTime:'2026-09-12T17:00:00Z'},
    quote:{market:'spreads',participant:'',side:'Home',line:-7,price:-110,book:'Book',bookKey:'book',updatedAt:'2026-09-12T14:59:00Z',stale:false},
    verifiedEvent:{espnEventId:'espn',homeTeamId:'h',awayTeamId:'a',neutralSite:false,source:'ESPN',fetchedAt:'2026-09-12T14:58:00Z',week:2},
    collegeForecast:{projection:{version:'score-v1',asOf:'2026-09-12T14:58:00Z',homeId:'h',awayId:'a',neutral:false,homeScore:30,awayScore:20,homeMargin:10,total:50,
      fairHomeSpread:-10,naiveMargin:0,naiveTotal:0,homeGames:1,awayGames:1,homeCurrentGames:1,awayCurrentGames:1,homeLastGame:'2026-09-01T00:00:00Z',awayLastGame:'2026-09-01T00:00:00Z',learnedHomeAdvantage:3,historyHash:'x',historyGames:1,config:{ridge:1,halfLifeDays:365}},
      assessment:{} as any,inputEvidenceHash:'i',forecastEvidenceHash:'f',bundleHash:'b',selectionVersion:'s'},rules:'rules',season:2026,note:'',resultEvidence:{sourceProvider:'ESPN',providerEventId:'espn',canonicalEventId:'espn',homeCanonicalId:'h',awayCanonicalId:'a',homeFinalScore:27,awayFinalScore:17,explicitStatus:'STATUS_FINAL',statusCompleted:true,statusState:'post',eventCompletionTimestamp:'2026-09-12T21:00:00Z',sourceRetrievalTimestamp:'2026-09-12T21:01:00Z',gradingTimestamp:'2026-09-12T21:02:00Z'}} as any]);
  assert.equal(rows.length,1);assert.equal(rows[0].modelHomeMargin,10);assert.equal(rows[0].marketHomeSpread,-7);assert.equal(rows[0].comparisonKind,null);
});
