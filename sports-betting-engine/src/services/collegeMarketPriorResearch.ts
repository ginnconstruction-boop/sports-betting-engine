import {createHash} from 'crypto';
import {americanBreakEven,edgeBucket,EdgeBucket,profitForPrice,stableStringify} from './collegeEdgeResearch';

export const COLLEGE_MARKET_PRIOR_VERSION='college-market-prior-v1';
export type EnsembleDecision='ENSEMBLE PASSES RESEARCH GATE'|'ENSEMBLE INCONCLUSIVE'|'ENSEMBLE FAILS RESEARCH GATE';

export interface MarketPriorConfig {
  version:string;
  trainDateCount:number;
  validationDateCount:number;
  ridgeLambdas:number[];
  disagreementBuckets:EdgeBucket[];
  marketSpreadBuckets:EdgeBucket[];
  passGate:{minimumTestGames:number;minimumRmseImprovementPoints:number;minimumRelativeRmseImprovement:number;requireMaeImprovement:boolean};
}

export interface MarketPriorObservation {
  observationId:string;gameId:string;evidenceClass:'RECONSTRUCTED_FORECAST';sourceLabel:string;
  forecastAt:string;marketAt:string;inputsAsOf:string;kickoff:string;modelVersion:string;marketDefinition:string;
  modelHomeMargin:number;marketHomeMargin:number;actualHomeMargin:number;americanPrice?:number|null;priceSide?:'HOME'|'AWAY'|null;
  week?:number|null;matchupClass?:string|null;marketHomeSpread:number;neutralSite?:boolean|null;
}

export interface ErrorMetrics {n:number;bias:number|null;mae:number|null;rmse:number|null;}
export interface EnsembleFit {kind:'CONVEX_BLEND'|'RIDGE';name:string;trainedObservationIds:string[];parameters:{intercept:number;modelCoefficient:number;marketCoefficient:number;lambda:number|null;modelShare:number|null};}
export interface CandidateResult {name:string;fit:EnsembleFit;validation:ErrorMetrics;}
export interface SplitRows {dates:{train:string[];validation:string[];test:string[]};train:MarketPriorObservation[];validation:MarketPriorObservation[];test:MarketPriorObservation[];}
export interface Comparison {n:number;modelOnly:ErrorMetrics;marketOnly:ErrorMetrics;ensemble:ErrorMetrics|null;}

export interface MarketPriorArtifact {
  schemaVersion:string;researchLabel:'DISCOVERY_SAMPLE_NOT_PRODUCTION';generatedAt:string;applicationVersion:string;
  datasetVersion:string;datasetHash:string;scoreModelVersions:string[];marketSourceDefinitions:string[];configuration:MarketPriorConfig;configurationHash:string;
  audit:{inputRows:number;eligibleRows:number;excludedRows:number;exclusions:Record<string,number>;allForecastsBeforeKickoff:boolean;allMarketsAtOrBeforeForecast:boolean;allInputsAtOrBeforeForecast:boolean;allFinalMarginsPresent:boolean;scoreModelIndependentOfMarket:true;modelIndependenceBasis:string;lastFiveMinuteProxyUsed:false;evidenceClass:'RECONSTRUCTED_FORECAST'};
  split:{method:string;dates:SplitRows['dates'];counts:{train:number;validation:number;test:number};noveltyWarning:string};
  candidates:CandidateResult[];selectedCandidate:string;selectionMetric:'VALIDATION_RMSE_THEN_MAE';lockedFit:EnsembleFit;
  allEligibleModelVsMarket:Comparison;validationComparison:Comparison;testComparison:Comparison;
  allBaselineSegments:{matchup:Record<string,Comparison>;week:Record<string,Comparison>;marketSpread:Record<string,Comparison>};
  testSegments:{matchup:Record<string,Comparison>;week:Record<string,Comparison>;marketSpread:Record<string,Comparison>;disagreement:Record<string,Comparison>};
  residualAnalysis:{correlationWithSignedDisagreement:number|null;linearSlopeOnSignedDisagreement:number|null;byDisagreement:Record<string,ErrorMetrics>;byDirection:Record<string,ErrorMetrics>;byMarketSpread:Record<string,ErrorMetrics>;byWeek:Record<string,ErrorMetrics>;byMatchup:Record<string,ErrorMetrics>;byHomeAwayEdge:Record<string,ErrorMetrics>};
  secondaryAts:{testModelSide:any;testEnsembleSide:any;marketOnly:string};
  decision:EnsembleDecision;decisionReasons:string[];productionChanged:false;limitations:string[];
}

const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const stamp=(v:string)=>Number.isFinite(Date.parse(v))?Date.parse(v):null;
const round=(v:number|null,d=6)=>v===null?null:Number(v.toFixed(d));
const sha=(v:unknown)=>createHash('sha256').update(stableStringify(v)).digest('hex');

export function marketHomeMarginFromSpread(homeSpread:number){return -homeSpread;}
export function signedModelMinusMarket(modelHomeMargin:number,marketHomeMargin:number){return modelHomeMargin-marketHomeMargin;}
export function errorMetrics(rows:MarketPriorObservation[],predict:(row:MarketPriorObservation)=>number):ErrorMetrics{
  const errors=rows.map(row=>row.actualHomeMargin-predict(row));return {n:errors.length,bias:round(errors.length?errors.reduce((a,b)=>a+b,0)/errors.length:null),
    mae:round(errors.length?errors.reduce((a,b)=>a+Math.abs(b),0)/errors.length:null),rmse:round(errors.length?Math.sqrt(errors.reduce((a,b)=>a+b*b,0)/errors.length):null)};
}

export function auditMarketPriorRows(input:MarketPriorObservation[]){
  const rows:MarketPriorObservation[]=[],exclusions:Record<string,number>={};const reject=(reason:string)=>exclusions[reason]=(exclusions[reason]??0)+1;
  for(const row of input){const forecast=stamp(row.forecastAt),market=stamp(row.marketAt),inputs=stamp(row.inputsAsOf),kickoff=stamp(row.kickoff);
    if(row.evidenceClass!=='RECONSTRUCTED_FORECAST'){reject('WRONG_EVIDENCE_CLASS');continue;}
    if([forecast,market,inputs,kickoff].some(v=>v===null)){reject('INVALID_TIMESTAMP');continue;}
    if((forecast as number)>=(kickoff as number)){reject('FORECAST_NOT_BEFORE_KICKOFF');continue;}
    if((market as number)>(forecast as number)){reject('POST_FORECAST_MARKET_LEAKAGE');continue;}
    if((inputs as number)>(forecast as number)){reject('POST_FORECAST_MODEL_INPUT_LEAKAGE');continue;}
    if(![row.modelHomeMargin,row.marketHomeMargin,row.actualHomeMargin,row.marketHomeSpread].every(finite)){reject('MISSING_MARGIN_OR_MARKET');continue;}
    if(Math.abs(row.marketHomeMargin+row.marketHomeSpread)>1e-9){reject('MARKET_SIGN_INCONSISTENT');continue;}
    rows.push(row);
  }
  return {rows,exclusions};
}

export function chronologicalMarketPriorSplit(rows:MarketPriorObservation[],config:MarketPriorConfig):SplitRows{
  const dates=[...new Set(rows.map(r=>r.forecastAt.slice(0,10)))].sort();
  if(dates.length<config.trainDateCount+config.validationDateCount+1)throw new Error('Insufficient distinct chronological dates for train/validation/test.');
  const trainDates=dates.slice(0,config.trainDateCount),validationDates=dates.slice(config.trainDateCount,config.trainDateCount+config.validationDateCount),testDates=dates.slice(config.trainDateCount+config.validationDateCount);
  const select=(selected:string[])=>rows.filter(r=>selected.includes(r.forecastAt.slice(0,10))).sort((a,b)=>Date.parse(a.forecastAt)-Date.parse(b.forecastAt)||a.observationId.localeCompare(b.observationId));
  return {dates:{train:trainDates,validation:validationDates,test:testDates},train:select(trainDates),validation:select(validationDates),test:select(testDates)};
}

function model(fit:EnsembleFit,row:MarketPriorObservation){const p=fit.parameters;return p.intercept+p.modelCoefficient*row.modelHomeMargin+p.marketCoefficient*row.marketHomeMargin;}
export function fitConvexBlend(rows:MarketPriorObservation[]):EnsembleFit{
  if(!rows.length)throw new Error('Cannot fit an empty ensemble.');let numerator=0,denominator=0;
  for(const row of rows){const d=row.modelHomeMargin-row.marketHomeMargin;numerator+=d*(row.actualHomeMargin-row.marketHomeMargin);denominator+=d*d;}
  const weight=denominator?Math.max(0,Math.min(1,numerator/denominator)):0;
  return {kind:'CONVEX_BLEND',name:'CONVEX_BLEND',trainedObservationIds:rows.map(r=>r.observationId).sort(),parameters:{intercept:0,modelCoefficient:weight,marketCoefficient:1-weight,lambda:null,modelShare:weight}};
}

function solve3(matrix:number[][],vector:number[]){const a=matrix.map((r,i)=>[...r,vector[i]]);for(let c=0;c<3;c++){let pivot=c;for(let r=c+1;r<3;r++)if(Math.abs(a[r][c])>Math.abs(a[pivot][c]))pivot=r;
    if(Math.abs(a[pivot][c])<1e-10)throw new Error('Singular ensemble design matrix.');[a[c],a[pivot]]=[a[pivot],a[c]];const d=a[c][c];for(let j=c;j<4;j++)a[c][j]/=d;
    for(let r=0;r<3;r++)if(r!==c){const f=a[r][c];for(let j=c;j<4;j++)a[r][j]-=f*a[c][j];}}
  return [a[0][3],a[1][3],a[2][3]];
}
export function fitRidgeEnsemble(rows:MarketPriorObservation[],lambda:number):EnsembleFit{
  if(!rows.length||!finite(lambda)||lambda<=0)throw new Error('Ridge requires data and a positive lambda.');const xx=Array.from({length:3},()=>[0,0,0]),xy=[0,0,0];
  for(const row of rows){const x=[1,row.modelHomeMargin,row.marketHomeMargin];for(let i=0;i<3;i++){xy[i]+=x[i]*row.actualHomeMargin;for(let j=0;j<3;j++)xx[i][j]+=x[i]*x[j];}}
  xx[1][1]+=lambda;xx[2][2]+=lambda;const [intercept,mc,kc]=solve3(xx,xy),sum=Math.abs(mc)+Math.abs(kc);
  return {kind:'RIDGE',name:`RIDGE_${lambda}`,trainedObservationIds:rows.map(r=>r.observationId).sort(),parameters:{intercept,modelCoefficient:mc,marketCoefficient:kc,lambda,modelShare:sum?Math.abs(mc)/sum:null}};
}

export function evaluateCandidates(train:MarketPriorObservation[],validation:MarketPriorObservation[],config:MarketPriorConfig){
  const fits=[fitConvexBlend(train),...config.ridgeLambdas.map(lambda=>fitRidgeEnsemble(train,lambda))];
  const results=fits.map(fit=>({name:fit.name,fit,validation:errorMetrics(validation,row=>model(fit,row))}));
  return results.sort((a,b)=>(a.validation.rmse as number)-(b.validation.rmse as number)||(a.validation.mae as number)-(b.validation.mae as number)||a.name.localeCompare(b.name));
}
export function refitSelected(name:string,rows:MarketPriorObservation[],config:MarketPriorConfig){return name==='CONVEX_BLEND'?fitConvexBlend(rows):fitRidgeEnsemble(rows,Number(name.slice('RIDGE_'.length)));}

function comparison(rows:MarketPriorObservation[],fit?:EnsembleFit):Comparison{return {n:rows.length,modelOnly:errorMetrics(rows,r=>r.modelHomeMargin),marketOnly:errorMetrics(rows,r=>r.marketHomeMargin),ensemble:fit?errorMetrics(rows,r=>model(fit,r)):null};}
function grouped(rows:MarketPriorObservation[],key:(r:MarketPriorObservation)=>string,fit?:EnsembleFit){const groups=new Map<string,MarketPriorObservation[]>();for(const row of rows){const k=key(row);groups.set(k,[...(groups.get(k)??[]),row]);}
  return Object.fromEntries([...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,comparison(v,fit)]));}
function residualGrouped(rows:MarketPriorObservation[],key:(r:MarketPriorObservation)=>string){return Object.fromEntries(Object.entries(grouped(rows,key)).map(([k,v])=>[k,v.modelOnly]));}
const week=(r:MarketPriorObservation)=>!Number.isInteger(r.week)?'UNKNOWN':(r.week as number)<=2?'WEEK_0_TO_2':(r.week as number)<=5?'WEEK_3_TO_5':'WEEK_6_PLUS';
const direction=(r:MarketPriorObservation)=>{const edge=signedModelMinusMarket(r.modelHomeMargin,r.marketHomeMargin),favorite=r.marketHomeMargin>0?'HOME':r.marketHomeMargin<0?'AWAY':'PICK_EM',side=edge>0?'HOME':edge<0?'AWAY':'NO_EDGE';return favorite==='PICK_EM'?'PICK_EM':side===favorite?'MODEL_FAVORS_FAVORITE':'MODEL_FAVORS_UNDERDOG';};
function correlation(xs:number[],ys:number[]){if(xs.length<2)return null;const xm=xs.reduce((a,b)=>a+b,0)/xs.length,ym=ys.reduce((a,b)=>a+b,0)/ys.length;
  const cross=xs.reduce((s,x,i)=>s+(x-xm)*(ys[i]-ym),0),xx=xs.reduce((s,x)=>s+(x-xm)**2,0),yy=ys.reduce((s,y)=>s+(y-ym)**2,0);return xx&&yy?round(cross/Math.sqrt(xx*yy)):null;}
function slope(xs:number[],ys:number[]){if(xs.length<2)return null;const xm=xs.reduce((a,b)=>a+b,0)/xs.length,ym=ys.reduce((a,b)=>a+b,0)/ys.length,xx=xs.reduce((s,x)=>s+(x-xm)**2,0);return xx?round(xs.reduce((s,x,i)=>s+(x-xm)*(ys[i]-ym),0)/xx):null;}
function ats(rows:MarketPriorObservation[],predict:(r:MarketPriorObservation)=>number){let w=0,l=0,p=0,units=0,unitN=0,priceMissing=0;
  for(const row of rows){const edge=predict(row)-row.marketHomeMargin;if(edge===0)continue;const side=edge>0?'HOME':'AWAY',value=edge>0?row.actualHomeMargin+row.marketHomeSpread:-(row.actualHomeMargin+row.marketHomeSpread),result=value===0?'PUSH':value>0?'WIN':'LOSS';
    result==='WIN'?w++:result==='LOSS'?l++:p++;if(row.priceSide===side&&finite(row.americanPrice)&&americanBreakEven(row.americanPrice)!==null){units+=profitForPrice(result,row.americanPrice);unitN++;}else priceMissing++;}
  return {observations:w+l+p,wins:w,losses:l,pushes:p,atsRate:w+l?w/(w+l):null,units:unitN?round(units):null,roi:unitN?round(units/unitN):null,unitEligible:unitN,priceMissing};}

export function runCollegeMarketPriorResearch(input:MarketPriorObservation[],options:{generatedAt:string;applicationVersion:string;datasetVersion:string;config:MarketPriorConfig}):MarketPriorArtifact{
  if(stamp(options.generatedAt)===null)throw new Error('Valid generatedAt required.');const audited=auditMarketPriorRows(input),rows=audited.rows,split=chronologicalMarketPriorSplit(rows,options.config);
  const candidates=evaluateCandidates(split.train,split.validation,options.config),selected=candidates[0],locked=refitSelected(selected.name,[...split.train,...split.validation],options.config);
  const validationComparison=comparison(split.validation,selected.fit),testComparison=comparison(split.test,locked),bestTest=Math.min(testComparison.modelOnly.rmse as number,testComparison.marketOnly.rmse as number),bestMae=Math.min(testComparison.modelOnly.mae as number,testComparison.marketOnly.mae as number),ensemble=testComparison.ensemble!;
  const rmseGain=bestTest-(ensemble.rmse as number),relative=rmseGain/bestTest,maeGain=bestMae-(ensemble.mae as number),reasons=[`Locked test RMSE improvement versus best primary baseline: ${round(rmseGain)} points (${round(100*relative,3)}%).`,`Locked test MAE improvement versus best primary baseline: ${round(maeGain)} points.`];
  let decision:EnsembleDecision;if(split.test.length>=options.config.passGate.minimumTestGames&&rmseGain>=options.config.passGate.minimumRmseImprovementPoints&&relative>=options.config.passGate.minimumRelativeRmseImprovement&&(!options.config.passGate.requireMaeImprovement||maeGain>0))decision='ENSEMBLE PASSES RESEARCH GATE';
  else if((ensemble.rmse as number)>=bestTest&&(ensemble.mae as number)>=bestMae)decision='ENSEMBLE FAILS RESEARCH GATE';else decision='ENSEMBLE INCONCLUSIVE';
  reasons.push(decision==='ENSEMBLE PASSES RESEARCH GATE'?'Predeclared predictive test thresholds passed; production remains unchanged.':decision==='ENSEMBLE FAILS RESEARCH GATE'?'Locked ensemble did not beat the best baseline on either RMSE or MAE.':'Some improvement occurred, but the predeclared research threshold was not fully met.');
  const disagreement=(r:MarketPriorObservation)=>edgeBucket(Math.abs(signedModelMinusMarket(r.modelHomeMargin,r.marketHomeMargin)),options.config.disagreementBuckets),spread=(r:MarketPriorObservation)=>edgeBucket(Math.abs(r.marketHomeMargin),options.config.marketSpreadBuckets);
  const residuals=rows.map(r=>r.actualHomeMargin-r.modelHomeMargin),edges=rows.map(r=>signedModelMinusMarket(r.modelHomeMargin,r.marketHomeMargin));
  return {schemaVersion:COLLEGE_MARKET_PRIOR_VERSION,researchLabel:'DISCOVERY_SAMPLE_NOT_PRODUCTION',generatedAt:new Date(options.generatedAt).toISOString(),applicationVersion:options.applicationVersion,
    datasetVersion:options.datasetVersion,datasetHash:sha(input),scoreModelVersions:[...new Set(rows.map(r=>r.modelVersion))].sort(),marketSourceDefinitions:[...new Set(rows.map(r=>r.marketDefinition))].sort(),configuration:options.config,configurationHash:sha(options.config),
    audit:{inputRows:input.length,eligibleRows:rows.length,excludedRows:input.length-rows.length,exclusions:audited.exclusions,allForecastsBeforeKickoff:rows.every(r=>Date.parse(r.forecastAt)<Date.parse(r.kickoff)),allMarketsAtOrBeforeForecast:rows.every(r=>Date.parse(r.marketAt)<=Date.parse(r.forecastAt)),allInputsAtOrBeforeForecast:rows.every(r=>Date.parse(r.inputsAsOf)<=Date.parse(r.forecastAt)),
      allFinalMarginsPresent:rows.every(r=>finite(r.actualHomeMargin)),scoreModelIndependentOfMarket:true,modelIndependenceBasis:'Score Model A accepts dated final scores, team IDs, venue, as-of time, and fixed ridge configuration; no market line or quote enters its fit or predict functions.',lastFiveMinuteProxyUsed:false,evidenceClass:'RECONSTRUCTED_FORECAST'},
    split:{method:'Six archived dates: first 3 TRAIN; fourth VALIDATION for architecture/lambda selection; final 2 locked TEST. No shuffle.',dates:split.dates,counts:{train:split.train.length,validation:split.validation.length,test:split.test.length},noveltyWarning:'The TEST rows are untouched by Phase 4 fitting and selection, but their outcomes were inspected in Phase 3; this is not a new external holdout.'},
    candidates,selectedCandidate:selected.name,selectionMetric:'VALIDATION_RMSE_THEN_MAE',lockedFit:locked,allEligibleModelVsMarket:comparison(rows),validationComparison,testComparison,
    allBaselineSegments:{matchup:grouped(rows,r=>r.matchupClass??'UNKNOWN'),week:grouped(rows,week),marketSpread:grouped(rows,spread)},
    testSegments:{matchup:grouped(split.test,r=>r.matchupClass??'UNKNOWN',locked),week:grouped(split.test,week,locked),marketSpread:grouped(split.test,spread,locked),disagreement:grouped(split.test,disagreement,locked)},
    residualAnalysis:{correlationWithSignedDisagreement:correlation(edges,residuals),linearSlopeOnSignedDisagreement:slope(edges,residuals),byDisagreement:residualGrouped(rows,disagreement),
      byDirection:residualGrouped(rows,direction),byMarketSpread:residualGrouped(rows,spread),byWeek:residualGrouped(rows,week),byMatchup:residualGrouped(rows,r=>r.matchupClass??'UNKNOWN'),
      byHomeAwayEdge:residualGrouped(rows,r=>signedModelMinusMarket(r.modelHomeMargin,r.marketHomeMargin)>0?'MODEL_EDGE_HOME':signedModelMinusMarket(r.modelHomeMargin,r.marketHomeMargin)<0?'MODEL_EDGE_AWAY':'NO_EDGE')},
    secondaryAts:{testModelSide:ats(split.test,r=>r.modelHomeMargin),testEnsembleSide:ats(split.test,r=>model(locked,r)),marketOnly:'No directional edge exists against its own line; ATS/ROI not computed.'},
    decision,decisionReasons:reasons,productionChanged:false,limitations:['All rows are reconstructed discovery evidence from one season and six dates.','The locked test was not used for Phase 4 fitting, but was previously inspected in Phase 3.','The market prior is a contemporaneous consensus-adjacent exact book line, not a verified close.','Subgroup results are descriptive and sparse; no multiple-comparison winner becomes a rule.','ATS and ROI are secondary diagnostics and never select candidates.']};
}

export function renderCollegeMarketPriorReport(a:MarketPriorArtifact){
  const metric=(m:ErrorMetrics)=>`${m.n} | ${m.mae?.toFixed(3)??'N/A'} | ${m.rmse?.toFixed(3)??'N/A'} | ${m.bias?.toFixed(3)??'N/A'}`;
  const lines=[`# College market-prior ensemble research — ${a.schemaVersion}`,'',`**${a.researchLabel}**`,`Generated: ${a.generatedAt}`,'',
    '## Dataset / point-in-time audit','',`Eligible: ${a.audit.eligibleRows}/${a.audit.inputRows}; excluded: ${a.audit.excludedRows}. Evidence: ${a.audit.evidenceClass}.`,
    `Forecast-before-kickoff: ${a.audit.allForecastsBeforeKickoff}; market-at/before-forecast: ${a.audit.allMarketsAtOrBeforeForecast}; model-inputs-at/before-forecast: ${a.audit.allInputsAtOrBeforeForecast}; final margins present: ${a.audit.allFinalMarginsPresent}.`,
    `Independent score model: ${a.audit.scoreModelIndependentOfMarket}. ${a.audit.modelIndependenceBasis} Last-five-minute proxy used: ${a.audit.lastFiveMinuteProxyUsed}.`,'',
    '## Chronological design','',a.split.method,`TRAIN ${a.split.counts.train}; VALIDATION ${a.split.counts.validation}; TEST ${a.split.counts.test}.`,a.split.noveltyWarning,'',
    '## Primary performance','', '| Sample / predictor | N | MAE | RMSE | Bias |','|---|---:|---:|---:|---:|',
    `| All 318 — model only | ${metric(a.allEligibleModelVsMarket.modelOnly)} |`,`| All 318 — market only | ${metric(a.allEligibleModelVsMarket.marketOnly)} |`,
    `| Locked test — model only | ${metric(a.testComparison.modelOnly)} |`,`| Locked test — market only | ${metric(a.testComparison.marketOnly)} |`,`| Locked test — ensemble | ${metric(a.testComparison.ensemble!)} |`,'',
    '## Candidate selection','',`Selected on validation RMSE, then MAE: **${a.selectedCandidate}**.`,`Locked parameters: intercept ${a.lockedFit.parameters.intercept.toFixed(6)}, model coefficient ${a.lockedFit.parameters.modelCoefficient.toFixed(6)}, market coefficient ${a.lockedFit.parameters.marketCoefficient.toFixed(6)}, model share ${a.lockedFit.parameters.modelShare?.toFixed(4)??'N/A'}.`,'',
    '| Candidate | Validation N | MAE | RMSE | Model coefficient | Market coefficient |','|---|---:|---:|---:|---:|---:|'];
  for(const c of a.candidates)lines.push(`| ${c.name} | ${c.validation.n} | ${c.validation.mae?.toFixed(3)} | ${c.validation.rmse?.toFixed(3)} | ${c.fit.parameters.modelCoefficient.toFixed(4)} | ${c.fit.parameters.marketCoefficient.toFixed(4)} |`);
  const add=(title:string,groups:Record<string,Comparison>)=>{lines.push('',`## ${title}`,'','| Segment | N | Model RMSE | Market RMSE | Ensemble RMSE | Model MAE | Market MAE | Ensemble MAE |','|---|---:|---:|---:|---:|---:|---:|---:|');for(const [k,v]of Object.entries(groups))lines.push(`| ${k} | ${v.n} | ${v.modelOnly.rmse?.toFixed(3)} | ${v.marketOnly.rmse?.toFixed(3)} | ${v.ensemble?.rmse?.toFixed(3)??'N/A'} | ${v.modelOnly.mae?.toFixed(3)} | ${v.marketOnly.mae?.toFixed(3)} | ${v.ensemble?.mae?.toFixed(3)??'N/A'} |`);};
  add('All-sample matchup baselines',a.allBaselineSegments.matchup);add('All-sample season-stage baselines',a.allBaselineSegments.week);add('All-sample market-spread baselines',a.allBaselineSegments.marketSpread);
  add('Locked-test disagreement analysis',a.testSegments.disagreement);add('Locked-test matchup analysis',a.testSegments.matchup);add('Locked-test season-stage analysis',a.testSegments.week);add('Locked-test market-spread analysis',a.testSegments.marketSpread);
  lines.push('','## Residual analysis','',`Correlation(actual − model, model − market): ${a.residualAnalysis.correlationWithSignedDisagreement??'N/A'}.`,`Linear residual slope on signed disagreement: ${a.residualAnalysis.linearSlopeOnSignedDisagreement??'N/A'}. A negative slope indicates market information systematically pulls Model A toward the result.`,'',
    '### Model residual groups','', '| Segment family | Segment | N | Bias | MAE | RMSE |','|---|---|---:|---:|---:|---:|');
  for(const [family,groups]of [['Disagreement',a.residualAnalysis.byDisagreement],['Direction',a.residualAnalysis.byDirection],['Season stage',a.residualAnalysis.byWeek],['Matchup',a.residualAnalysis.byMatchup],['Home/away edge',a.residualAnalysis.byHomeAwayEdge]] as Array<[string,Record<string,ErrorMetrics>]>)
    for(const [name,m]of Object.entries(groups))lines.push(`| ${family} | ${name} | ${m.n} | ${m.bias?.toFixed(3)} | ${m.mae?.toFixed(3)} | ${m.rmse?.toFixed(3)} |`);
  lines.push('','No chronological out-of-sample ensemble estimate exists for Weeks 0–2 or 3–5: those regimes occur before the validation/test windows. Their model-versus-market comparisons are reported, but an ensemble score is not fabricated.','',
    '## ATS/ROI secondary diagnostics','',`Model side on test: ${a.secondaryAts.testModelSide.wins}W–${a.secondaryAts.testModelSide.losses}L–${a.secondaryAts.testModelSide.pushes}P; ROI ${a.secondaryAts.testModelSide.roi===null?'N/A':(100*a.secondaryAts.testModelSide.roi).toFixed(1)+'%'} on ${a.secondaryAts.testModelSide.unitEligible} exact-price observations.`,
    `Ensemble side on test: ${a.secondaryAts.testEnsembleSide.wins}W–${a.secondaryAts.testEnsembleSide.losses}L–${a.secondaryAts.testEnsembleSide.pushes}P; ROI ${a.secondaryAts.testEnsembleSide.roi===null?'N/A':(100*a.secondaryAts.testEnsembleSide.roi).toFixed(1)+'%'} on ${a.secondaryAts.testEnsembleSide.unitEligible} exact-price observations; ${a.secondaryAts.testEnsembleSide.priceMissing} opposite-side prices unavailable.`,'',
    '## Decision','',`**${a.decision}**`,...a.decisionReasons.map(x=>`- ${x}`),'','## Limitations','',...a.limitations.map(x=>`- ${x}`),'','Production behavior remains unchanged.');return lines.join('\n');
}
