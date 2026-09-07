import {createHash} from 'crypto';

export const COLLEGE_EDGE_RESEARCH_VERSION='college-edge-research-v1';
export const COLLEGE_EDGE_DISCOVERY_LABEL='DISCOVERY_SAMPLE_NOT_ACTIVATION_EVIDENCE';

export type CollegeEvidenceClass='ARCHIVED_LIVE_FORECAST'|'RECONSTRUCTED_FORECAST'|'SYNTHETIC_DERIVED_RESEARCH';
export type AtsResult='WIN'|'LOSS'|'PUSH';
export type ArchivedResearchResult=AtsResult|'VOID'|'UNABLE_TO_GRADE'|'REVIEW'|'PENDING';

export interface EdgeBucket {label:string;minExclusive:number|null;maxInclusive:number|null;}
export interface CollegeEdgeResearchConfig {
  version:string;
  edgeBuckets:EdgeBucket[];
  marketSpreadBuckets:EdgeBucket[];
  minimumSamples:{insufficient:number;low:number;moderate:number};
}

export const DEFAULT_COLLEGE_EDGE_RESEARCH_CONFIG:CollegeEdgeResearchConfig={
  version:COLLEGE_EDGE_RESEARCH_VERSION,
  edgeBuckets:[
    {label:'0–1.5',minExclusive:null,maxInclusive:1.5},
    {label:'>1.5–3',minExclusive:1.5,maxInclusive:3},
    {label:'>3–5',minExclusive:3,maxInclusive:5},
    {label:'>5–7',minExclusive:5,maxInclusive:7},
    {label:'>7–10',minExclusive:7,maxInclusive:10},
    {label:'>10',minExclusive:10,maxInclusive:null},
  ],
  marketSpreadBuckets:[
    {label:'0–3',minExclusive:null,maxInclusive:3},
    {label:'>3–7',minExclusive:3,maxInclusive:7},
    {label:'>7–14',minExclusive:7,maxInclusive:14},
    {label:'>14–21',minExclusive:14,maxInclusive:21},
    {label:'>21–30',minExclusive:21,maxInclusive:30},
    {label:'>30–40',minExclusive:30,maxInclusive:40},
    {label:'>40',minExclusive:40,maxInclusive:null},
  ],
  minimumSamples:{insufficient:10,low:30,moderate:100},
};

export interface CollegeEdgeResearchRow {
  observationId:string;
  gameId:string;
  evidenceClass:CollegeEvidenceClass;
  sourceLabel:string;
  homeTeam:string;
  awayTeam:string;
  kickoff:string;
  forecastAt:string;
  inputsAsOf?:string|null;
  resolvedAt?:string|null;
  modelVersion:string;
  modelHomeMargin:number;
  actualHomeMargin?:number|null;
  marketHomeSpread?:number|null;
  americanPrice?:number|null;
  archivedResult?:ArchivedResearchResult|null;
  quoteUpdatedAt?:string|null;
  week?:number|null;
  homeConference?:string|null;
  awayConference?:string|null;
  matchupClass?:string|null;
  neutralSite?:boolean|null;
  contextCritical?:Record<string,boolean|null|undefined>|null;
  comparisonHomeSpread?:number|null;
  comparisonKind?:'VERIFIED_CLOSE'|'LATEST_PRE_KICK_PROXY'|null;
}

export interface PreparedCollegeEdgeRow extends CollegeEdgeResearchRow {
  modelHomeSpread:number;
  signedEdgeTowardHome:number|null;
  absoluteEdge:number|null;
  modelSide:'HOME'|'AWAY'|'NO_EDGE'|null;
  derivedResult:AtsResult|null;
  profitUnits:number|null;
  direction:string|null;
  favoriteComparison:string|null;
  contextCompleteness:'COMPLETE'|'INCOMPLETE'|'UNKNOWN';
  movementBucket:'MODEL_SIDE_MARKET_MOVED_TOWARD'|'LITTLE_OR_NO_MOVEMENT'|'MODEL_SIDE_MARKET_MOVED_AGAINST'|'MOVEMENT_UNKNOWN';
  eligibleForAts:boolean;
  eligibleForUnits:boolean;
  exclusions:string[];
  integrityWarnings:string[];
}

export interface ResearchMetrics {
  observations:number;
  distinctGames:number;
  correlatedRepeatObservations:number;
  wins:number;
  losses:number;
  pushes:number;
  atsPercentage:number|null;
  averageUnits:number|null;
  totalUnits:number|null;
  roi:number|null;
  unitEligible:number;
  averageAmericanPrice:number|null;
  priceSample:number;
  disagreement:{signedMean:number|null;absoluteMean:number|null;absoluteMedian:number|null;absoluteStdDev:number|null};
  winRateStandardError:number|null;
  confidenceInterval95:{low:number;high:number;method:'WILSON'}|null;
  averageBreakEvenRate:number|null;
  excessWinRateVsPrice:number|null;
  approximateZVsPrice:number|null;
  modelMarginError:{sample:number;meanError:number|null;mae:number|null;rmse:number|null};
  sampleWarning:string;
}

export interface EvidenceResearchResult {
  evidenceClass:CollegeEvidenceClass;
  counts:{inputRows:number;atsEligible:number;marginErrorEligible:number;excludedFromAts:number;exactDuplicatesExcluded:number};
  overall:ResearchMetrics;
  byEdgeBucket:Record<string,ResearchMetrics>;
  byDirection:Record<string,ResearchMetrics>;
  byFavoriteComparison:Record<string,ResearchMetrics>;
  byMarketSpread:Record<string,ResearchMetrics>;
  byWeekRegime:Record<string,ResearchMetrics>;
  byMatchup:Record<string,ResearchMetrics>;
  byConference:Record<string,ResearchMetrics>;
  byNeutralSite:Record<string,ResearchMetrics>;
  byContextCompleteness:Record<string,ResearchMetrics>;
  byLineMovement:Record<string,ResearchMetrics>;
  baselines:{allEligibleModelSides:ResearchMetrics;random50Reference:{atsRate:number;roi:null};marketNoEdgeReference:{atsRate:number;roi:null;note:string}};
  monotonicity:{eligible:boolean;direction:'INCREASING'|'DECREASING'|'NOT_MONOTONIC'|'INSUFFICIENT';rates:Array<{bucket:string,n:number,atsPercentage:number|null}>};
  hypothesesWorthForwardTesting:string[];
  resultsAgainstModel:string[];
  exclusions:Record<string,number>;
  integrityWarnings:Record<string,number>;
}

export interface CollegeEdgeResearchArtifact {
  schemaVersion:string;
  researchLabel:string;
  generatedAt:string;
  applicationVersion:string;
  configuration:CollegeEdgeResearchConfig;
  configurationHash:string;
  datasetHash:string;
  pointInTimeRules:{forecastBeforeKickoff:boolean;inputsNoLaterThanForecast:boolean;resultsNoEarlierThanKickoff:boolean};
  evidencePolicy:string;
  evidence:Partial<Record<CollegeEvidenceClass,EvidenceResearchResult>>;
  datasetInventory:Record<CollegeEvidenceClass,{rows:number;atsEligible:number;marginErrorEligible:number}>;
  modelVersionsByEvidence:Record<CollegeEvidenceClass,string[]>;
  sourceLabelsByEvidence:Record<CollegeEvidenceClass,string[]>;
  crossEvidenceCombinedMetrics:null;
  limitations:string[];
  multipleComparisonsWarning:string;
}

const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const isoMs=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
const round=(v:number|null,d=6)=>v===null?null:Number(v.toFixed(d));
const sha=(value:unknown)=>createHash('sha256').update(stableStringify(value)).digest('hex');
function stableValue(value:any):any {
  if(Array.isArray(value))return value.map(stableValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stableValue(value[k])]));
  return value;
}
export function stableStringify(value:unknown){return JSON.stringify(stableValue(value));}

export function signedCollegeEdge(modelHomeSpread:number,marketHomeSpread:number){return marketHomeSpread-modelHomeSpread;}
export function edgeBucket(value:number,buckets:EdgeBucket[]){
  const n=Math.abs(value),match=buckets.find(b=>(b.minExclusive===null||n>b.minExclusive)&&(b.maxInclusive===null||n<=b.maxInclusive));
  if(!match)throw new Error(`No configured bucket contains ${n}.`);return match.label;
}
export function americanBreakEven(price:number){
  if(!finite(price)||Math.abs(price)<100)return null;
  return price<0?Math.abs(price)/(Math.abs(price)+100):100/(price+100);
}
export function profitForPrice(result:AtsResult,price:number){
  if(result==='PUSH')return 0;if(result==='LOSS')return -1;
  return price<0?100/Math.abs(price):price/100;
}

function derivedResult(row:CollegeEdgeResearchRow,edge:number):AtsResult|null {
  if(!finite(row.actualHomeMargin)||!finite(row.marketHomeSpread)||edge===0)return null;
  const selectedValue=edge>0?row.actualHomeMargin+row.marketHomeSpread:-(row.actualHomeMargin+row.marketHomeSpread);
  return selectedValue===0?'PUSH':selectedValue>0?'WIN':'LOSS';
}
function contextStatus(context:CollegeEdgeResearchRow['contextCritical']):PreparedCollegeEdgeRow['contextCompleteness']{
  if(!context||!Object.keys(context).length)return 'UNKNOWN';const values=Object.values(context);
  if(values.some(v=>v===false))return 'INCOMPLETE';return values.every(v=>v===true)?'COMPLETE':'UNKNOWN';
}
function direction(row:CollegeEdgeResearchRow,edge:number){
  if(!finite(row.marketHomeSpread)||edge===0)return {direction:'NO_EDGE',comparison:'NO_EDGE'};
  const marketFavorite=row.marketHomeSpread<0?'HOME':row.marketHomeSpread>0?'AWAY':null;
  const modelSide=edge>0?'HOME':'AWAY';const modelSpread=-row.modelHomeMargin;
  if(!marketFavorite)return {direction:'NO_MARKET_FAVORITE',comparison:'PICK_EM'};
  const primary=modelSide===marketFavorite?'MODEL_FAVORS_FAVORITE':'MODEL_FAVORS_UNDERDOG';
  if(modelSpread!==0&&Math.sign(modelSpread)!==Math.sign(row.marketHomeSpread))return {direction:primary,comparison:'MODEL_FLIPS_MARKET_FAVORITE'};
  if(Math.abs(modelSpread)>Math.abs(row.marketHomeSpread))return {direction:primary,comparison:'MODEL_MAKES_FAVORITE_STRONGER'};
  if(Math.abs(modelSpread)<Math.abs(row.marketHomeSpread))return {direction:primary,comparison:'MODEL_MAKES_FAVORITE_WEAKER'};
  return {direction:primary,comparison:'MODEL_AGREES_SAME_MAGNITUDE'};
}
function movement(row:CollegeEdgeResearchRow,edge:number|null):PreparedCollegeEdgeRow['movementBucket']{
  if(edge===null||edge===0||!finite(row.comparisonHomeSpread)||!row.comparisonKind)return 'MOVEMENT_UNKNOWN';
  const originalSelected=edge>0?row.marketHomeSpread as number:-(row.marketHomeSpread as number);
  const comparisonSelected=edge>0?row.comparisonHomeSpread:-row.comparisonHomeSpread;
  return originalSelected>comparisonSelected?'MODEL_SIDE_MARKET_MOVED_TOWARD':originalSelected<comparisonSelected?'MODEL_SIDE_MARKET_MOVED_AGAINST':'LITTLE_OR_NO_MOVEMENT';
}

export function prepareCollegeEdgeRow(row:CollegeEdgeResearchRow):PreparedCollegeEdgeRow {
  const exclusions:string[]=[],integrityWarnings:string[]=[];const kickoff=isoMs(row.kickoff),forecast=isoMs(row.forecastAt),inputs=isoMs(row.inputsAsOf);
  if(kickoff===null||forecast===null)exclusions.push('INVALID_FORECAST_OR_KICKOFF_TIMESTAMP');
  else if(forecast>=kickoff)exclusions.push('FORECAST_NOT_BEFORE_KICKOFF');
  if(row.inputsAsOf&&inputs===null)exclusions.push('INVALID_INPUTS_AS_OF');
  else if(inputs!==null&&forecast!==null&&inputs>forecast)exclusions.push('INPUTS_AFTER_FORECAST');
  const resolved=isoMs(row.resolvedAt);if(row.resolvedAt&&resolved===null)exclusions.push('INVALID_RESOLVED_AT');
  else if(resolved!==null&&kickoff!==null&&resolved<kickoff)exclusions.push('RESULT_BEFORE_KICKOFF');
  if(!finite(row.modelHomeMargin))exclusions.push('INVALID_MODEL_MARGIN');
  const hasLine=finite(row.marketHomeSpread),modelHomeSpread=finite(row.modelHomeMargin)?-row.modelHomeMargin:NaN;
  const edge=hasLine&&finite(modelHomeSpread)?signedCollegeEdge(modelHomeSpread,row.marketHomeSpread as number):null;
  if(row.evidenceClass!=='SYNTHETIC_DERIVED_RESEARCH'&&!hasLine)exclusions.push('MISSING_ARCHIVED_MARKET_LINE');
  const result=edge===null?null:derivedResult(row,edge);
  if(row.archivedResult&&!['WIN','LOSS','PUSH'].includes(row.archivedResult))exclusions.push(`NON_ATS_STATUS_${row.archivedResult}_EXCLUDED`);
  if(row.archivedResult&&['WIN','LOSS','PUSH'].includes(row.archivedResult)&&result&&row.archivedResult!==result)integrityWarnings.push('ARCHIVED_RESULT_DISAGREES_WITH_REPLAY');
  if(edge===0)exclusions.push('ZERO_EDGE_HAS_NO_MODEL_SIDE');
  const priceValid=finite(row.americanPrice)&&americanBreakEven(row.americanPrice as number)!==null;
  if(hasLine&&!priceValid)integrityWarnings.push('PRICE_UNAVAILABLE_UNITS_NOT_COMPUTED');
  const eligibleBase=exclusions.length===0&&row.evidenceClass!=='SYNTHETIC_DERIVED_RESEARCH';
  const dir=edge===null?{direction:null,comparison:null}:direction(row,edge);
  return {...row,modelHomeSpread,signedEdgeTowardHome:edge,absoluteEdge:edge===null?null:Math.abs(edge),modelSide:edge===null?null:edge>0?'HOME':edge<0?'AWAY':'NO_EDGE',
    derivedResult:result,profitUnits:result&&priceValid?profitForPrice(result,row.americanPrice as number):null,direction:dir.direction,favoriteComparison:dir.comparison,
    contextCompleteness:contextStatus(row.contextCritical),movementBucket:movement(row,edge),eligibleForAts:eligibleBase&&result!==null,
    eligibleForUnits:eligibleBase&&result!==null&&priceValid,exclusions,integrityWarnings};
}

function mean(values:number[]){return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;}
function median(values:number[]){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function std(values:number[]){const m=mean(values);return m===null?null:Math.sqrt(values.reduce((s,v)=>s+(v-m)**2,0)/values.length);}
function wilson(wins:number,n:number){if(!n)return null;const z=1.959963984540054,p=wins/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/d;return {low:round(Math.max(0,c-h)),high:round(Math.min(1,c+h)),method:'WILSON' as const};}
function warning(n:number,c:CollegeEdgeResearchConfig){return n<c.minimumSamples.insufficient?'INSUFFICIENT_SAMPLE':n<c.minimumSamples.low?'LOW_SAMPLE':n<c.minimumSamples.moderate?'RESEARCH_SAMPLE':'LARGER_SAMPLE';}

export function researchMetrics(rows:PreparedCollegeEdgeRow[],config=DEFAULT_COLLEGE_EDGE_RESEARCH_CONFIG):ResearchMetrics {
  const eligible=rows.filter(r=>r.eligibleForAts&&r.derivedResult),settled=eligible.filter(r=>r.derivedResult!=='PUSH'),unitRows=eligible.filter(r=>r.eligibleForUnits&&r.profitUnits!==null);
  const wins=eligible.filter(r=>r.derivedResult==='WIN').length,losses=eligible.filter(r=>r.derivedResult==='LOSS').length,pushes=eligible.filter(r=>r.derivedResult==='PUSH').length,n=wins+losses;
  const prices=unitRows.map(r=>r.americanPrice as number),bes=prices.map(americanBreakEven).filter(finite),p=n?wins/n:null,be=mean(bes);
  const edges=eligible.map(r=>r.signedEdgeTowardHome as number),absolute=edges.map(Math.abs),units=unitRows.reduce((s,r)=>s+(r.profitUnits as number),0);
  const errors=rows.filter(r=>finite(r.actualHomeMargin)&&finite(r.modelHomeMargin)).map(r=>(r.actualHomeMargin as number)-r.modelHomeMargin);
  return {observations:eligible.length,distinctGames:new Set(eligible.map(r=>r.gameId)).size,correlatedRepeatObservations:eligible.length-new Set(eligible.map(r=>r.gameId)).size,
    wins,losses,pushes,atsPercentage:round(p),averageUnits:unitRows.length?round(units/unitRows.length):null,totalUnits:unitRows.length?round(units):null,
    roi:unitRows.length?round(units/unitRows.length):null,unitEligible:unitRows.length,averageAmericanPrice:round(mean(prices)),priceSample:prices.length,
    disagreement:{signedMean:round(mean(edges)),absoluteMean:round(mean(absolute)),absoluteMedian:round(median(absolute)),absoluteStdDev:round(std(absolute))},
    winRateStandardError:p===null||!n?null:round(Math.sqrt(p*(1-p)/n)),confidenceInterval95:wilson(wins,n),averageBreakEvenRate:round(be),
    excessWinRateVsPrice:p===null||be===null?null:round(p-be),approximateZVsPrice:p===null||be===null||!n?null:round((p-be)/Math.sqrt(be*(1-be)/n)),
    modelMarginError:{sample:errors.length,meanError:round(mean(errors)),mae:round(mean(errors.map(Math.abs))),rmse:errors.length?round(Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length)):null},sampleWarning:warning(n,config)};
}

function group(rows:PreparedCollegeEdgeRow[],key:(row:PreparedCollegeEdgeRow)=>string,config:CollegeEdgeResearchConfig){const m=new Map<string,PreparedCollegeEdgeRow[]>();
  for(const row of rows){const k=key(row);m.set(k,[...(m.get(k)??[]),row]);}return Object.fromEntries([...m.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,researchMetrics(v,config)]));}
function countStrings(rows:PreparedCollegeEdgeRow[],field:'exclusions'|'integrityWarnings'){const out:Record<string,number>={};for(const row of rows)for(const value of row[field])out[value]=(out[value]??0)+1;return out;}
function weekRegime(week:number|null|undefined){return !Number.isInteger(week)?'UNKNOWN':(week as number)<=2?'WEEK_0_TO_2':(week as number)<=5?'WEEK_3_TO_5':'WEEK_6_PLUS';}
function conference(row:PreparedCollegeEdgeRow){return row.homeConference&&row.awayConference?`${row.awayConference} @ ${row.homeConference}`:'UNAVAILABLE';}

function resultForEvidence(evidenceClass:CollegeEvidenceClass,rows:PreparedCollegeEdgeRow[],config:CollegeEdgeResearchConfig,duplicateCount:number):EvidenceResearchResult {
  const ats=rows.filter(r=>r.eligibleForAts),bucketed=ats.filter(r=>r.absoluteEdge!==null),rates=config.edgeBuckets.map(b=>{const selected=bucketed.filter(r=>edgeBucket(r.absoluteEdge as number,config.edgeBuckets)===b.label),m=researchMetrics(selected,config);return {bucket:b.label,n:m.wins+m.losses,atsPercentage:m.atsPercentage};});
  const usable=rates.filter(r=>r.n>=config.minimumSamples.insufficient&&r.atsPercentage!==null),differences=usable.slice(1).map((r,i)=>(r.atsPercentage as number)-(usable[i].atsPercentage as number));
  const monotonicity=usable.length<3?'INSUFFICIENT':differences.every(d=>d>=0)?'INCREASING':differences.every(d=>d<=0)?'DECREASING':'NOT_MONOTONIC';
  const overall=researchMetrics(rows,config),best=[...rates].filter(r=>r.n>=config.minimumSamples.low&&r.atsPercentage!==null).sort((a,b)=>(b.atsPercentage as number)-(a.atsPercentage as number))[0];
  const hypotheses=best?[`Preregister an untouched forward comparison of the ${best.bucket} disagreement bucket; its discovery ATS rate was ${(100*(best.atsPercentage as number)).toFixed(1)}% across ${best.n} non-push results.`]:[];
  const against:string[]=[];if(monotonicity==='NOT_MONOTONIC'||monotonicity==='DECREASING')against.push('Larger model-market disagreement did not improve ATS results monotonically.');
  if(overall.atsPercentage!==null&&overall.averageBreakEvenRate!==null&&overall.atsPercentage<overall.averageBreakEvenRate)against.push('The all-model-sides ATS rate was below the average archived-price break-even rate.');
  return {evidenceClass,counts:{inputRows:rows.length+duplicateCount,atsEligible:ats.length,marginErrorEligible:rows.filter(r=>finite(r.actualHomeMargin)&&finite(r.modelHomeMargin)).length,excludedFromAts:rows.length-ats.length,exactDuplicatesExcluded:duplicateCount},
    overall,byEdgeBucket:group(bucketed,r=>edgeBucket(r.absoluteEdge as number,config.edgeBuckets),config),
    byDirection:group(ats,r=>r.direction??'UNKNOWN',config),byFavoriteComparison:group(ats,r=>r.favoriteComparison??'UNKNOWN',config),
    byMarketSpread:group(ats,r=>finite(r.marketHomeSpread)?edgeBucket(Math.abs(r.marketHomeSpread),config.marketSpreadBuckets):'UNAVAILABLE',config),
    byWeekRegime:group(ats,r=>weekRegime(r.week),config),byMatchup:group(ats,r=>r.matchupClass??'UNAVAILABLE',config),byConference:group(ats,conference,config),
    byNeutralSite:group(ats,r=>r.neutralSite===true?'NEUTRAL':r.neutralSite===false?'NON_NEUTRAL':'UNAVAILABLE',config),
    byContextCompleteness:group(ats,r=>r.contextCompleteness,config),byLineMovement:group(ats,r=>r.movementBucket,config),
    baselines:{allEligibleModelSides:overall,random50Reference:{atsRate:.5,roi:null},marketNoEdgeReference:{atsRate:.5,roi:null,note:'Symmetric direction reference only; no selectable price or ROI is inferred.'}},
    monotonicity:{eligible:usable.length>=3,direction:monotonicity as any,rates},hypothesesWorthForwardTesting:hypotheses,resultsAgainstModel:against,
    exclusions:countStrings(rows,'exclusions'),integrityWarnings:countStrings(rows,'integrityWarnings')};
}

export function runCollegeEdgeResearch(input:CollegeEdgeResearchRow[],options:{generatedAt:string;config?:CollegeEdgeResearchConfig;applicationVersion?:string}):CollegeEdgeResearchArtifact {
  if(isoMs(options.generatedAt)===null)throw new Error('A valid generatedAt timestamp is required for reproducibility.');const config=options.config??DEFAULT_COLLEGE_EDGE_RESEARCH_CONFIG;
  const seen=new Set<string>(),duplicates:Record<CollegeEvidenceClass,number>={ARCHIVED_LIVE_FORECAST:0,RECONSTRUCTED_FORECAST:0,SYNTHETIC_DERIVED_RESEARCH:0},prepared:PreparedCollegeEdgeRow[]=[];
  for(const row of [...input].sort((a,b)=>`${a.evidenceClass}|${a.observationId}`.localeCompare(`${b.evidenceClass}|${b.observationId}`))){
    const key=`${row.evidenceClass}|${row.observationId}`;if(seen.has(key)){duplicates[row.evidenceClass]++;continue;}seen.add(key);prepared.push(prepareCollegeEdgeRow(row));
  }
  const evidence:CollegeEdgeResearchArtifact['evidence']={},inventory={} as CollegeEdgeResearchArtifact['datasetInventory'],modelVersions={} as CollegeEdgeResearchArtifact['modelVersionsByEvidence'],sourceLabels={} as CollegeEdgeResearchArtifact['sourceLabelsByEvidence'];
  for(const evidenceClass of ['ARCHIVED_LIVE_FORECAST','RECONSTRUCTED_FORECAST','SYNTHETIC_DERIVED_RESEARCH'] as CollegeEvidenceClass[]){const rows=prepared.filter(r=>r.evidenceClass===evidenceClass);if(rows.length)evidence[evidenceClass]=resultForEvidence(evidenceClass,rows,config,duplicates[evidenceClass]);
    inventory[evidenceClass]={rows:rows.length,atsEligible:rows.filter(r=>r.eligibleForAts).length,marginErrorEligible:rows.filter(r=>finite(r.actualHomeMargin)&&finite(r.modelHomeMargin)).length};
    modelVersions[evidenceClass]=[...new Set(rows.map(r=>r.modelVersion))].sort();sourceLabels[evidenceClass]=[...new Set(rows.map(r=>r.sourceLabel))].sort();}
  const canonicalInput=[...input].sort((a,b)=>`${a.evidenceClass}|${a.observationId}`.localeCompare(`${b.evidenceClass}|${b.observationId}`));
  return {schemaVersion:COLLEGE_EDGE_RESEARCH_VERSION,researchLabel:COLLEGE_EDGE_DISCOVERY_LABEL,generatedAt:new Date(options.generatedAt).toISOString(),applicationVersion:options.applicationVersion??'NOT_RECORDED',configuration:config,
    configurationHash:sha(config),datasetHash:sha(canonicalInput),pointInTimeRules:{forecastBeforeKickoff:true,inputsNoLaterThanForecast:true,resultsNoEarlierThanKickoff:true},
    evidencePolicy:'Evidence classes are analyzed separately. Cross-evidence pooling is prohibited.',evidence,datasetInventory:inventory,modelVersionsByEvidence:modelVersions,sourceLabelsByEvidence:sourceLabels,crossEvidenceCombinedMetrics:null,
    limitations:['This is exploratory historical research, not validation or activation evidence.','Historical selection effects and repeated games across model versions can create dependence.','Context and line-movement segments are unavailable unless timestamped fields were archived.','No price, closing line, context field, or result is imputed.'],
    multipleComparisonsWarning:'Many exploratory subgroup comparisons are reported without multiplicity correction. Apparent winners require preregistered untouched forward confirmation.'};
}

export function renderCollegeEdgeResearchReport(a:CollegeEdgeResearchArtifact){
  const lines=[`# College football historical edge research — ${a.schemaVersion}`,'',`**${a.researchLabel}**`,`Generated: ${a.generatedAt}`,`Application version: ${a.applicationVersion}`,'',
    'Evidence classes are not pooled. All percentages and units are descriptive historical outputs, not activation thresholds or betting advice.','',
    '## Dataset audit','', '| Evidence class | Rows | ATS eligible | Margin-error eligible | Model version(s) | Source label(s) |','|---|---:|---:|---:|---|---|'];
  for(const type of ['ARCHIVED_LIVE_FORECAST','RECONSTRUCTED_FORECAST','SYNTHETIC_DERIVED_RESEARCH'] as CollegeEvidenceClass[]){const i=a.datasetInventory[type];
    lines.push(`| ${type} | ${i.rows} | ${i.atsEligible} | ${i.marginErrorEligible} | ${(a.modelVersionsByEvidence[type]??[]).join(', ')||'N/A'} | ${(a.sourceLabelsByEvidence[type]??[]).join(', ')||'N/A'} |`);}
  lines.push('','Only exact archived prices contribute to units/ROI. Context, consensus/closing data, and movement remain unavailable when no timestamped record exists.','');
  for(const type of Object.keys(a.evidence).sort() as CollegeEvidenceClass[]){const r=a.evidence[type] as EvidenceResearchResult,m=r.overall;
    lines.push(`## ${type}`,'',`Inputs: ${r.counts.inputRows}; ATS eligible: ${r.counts.atsEligible}; margin-error eligible: ${r.counts.marginErrorEligible}; exact duplicates excluded: ${r.counts.exactDuplicatesExcluded}.`,
      `Overall: ${m.wins}W–${m.losses}L–${m.pushes}P across ${m.observations} observations / ${m.distinctGames} distinct games; ATS ${m.atsPercentage===null?'N/A':(100*m.atsPercentage).toFixed(1)+'%'}.`,
      `Price-based units: ${m.totalUnits??'N/A'} on ${m.unitEligible} exact-price observations; ROI ${m.roi===null?'N/A':(100*m.roi).toFixed(1)+'%'}. No default price was assumed.`,
      `95% Wilson interval: ${m.confidenceInterval95?`${(100*m.confidenceInterval95.low).toFixed(1)}%–${(100*m.confidenceInterval95.high).toFixed(1)}%`:'N/A'}; sample warning: ${m.sampleWarning}.`,'',
      '| Absolute edge bucket | N | W-L-P | ATS | Avg price | Units | ROI | 95% CI | Warning |','|---|---:|---:|---:|---:|---:|---:|---|---|');
    for(const b of a.configuration.edgeBuckets){const x=r.byEdgeBucket[b.label];if(!x){lines.push(`| ${b.label} | 0 | 0-0-0 | N/A | N/A | N/A | N/A | N/A | INSUFFICIENT_SAMPLE |`);continue;}
      lines.push(`| ${b.label} | ${x.observations} | ${x.wins}-${x.losses}-${x.pushes} | ${x.atsPercentage===null?'N/A':(100*x.atsPercentage).toFixed(1)+'%'} | ${x.averageAmericanPrice??'N/A'} | ${x.totalUnits??'N/A'} | ${x.roi===null?'N/A':(100*x.roi).toFixed(1)+'%'} | ${x.confidenceInterval95?`${(100*x.confidenceInterval95.low).toFixed(1)}%–${(100*x.confidenceInterval95.high).toFixed(1)}%`:'N/A'} | ${x.sampleWarning} |`);}
    lines.push('',`Monotonicity diagnostic: ${r.monotonicity.direction}. This is descriptive and not a threshold recommendation.`,'');
    lines.push('### Model projected margin error by edge bucket','', '| Absolute edge bucket | N | Bias | MAE | RMSE |','|---|---:|---:|---:|---:|');
    for(const b of a.configuration.edgeBuckets){const x=r.byEdgeBucket[b.label]?.modelMarginError;lines.push(`| ${b.label} | ${x?.sample??0} | ${x?.meanError??'N/A'} | ${x?.mae??'N/A'} | ${x?.rmse??'N/A'} |`);}lines.push('');
    for(const [title,groups] of [['Direction',r.byDirection],['Favorite comparison',r.byFavoriteComparison],['Market spread',r.byMarketSpread],
      ['Week regime',r.byWeekRegime],['Matchup class',r.byMatchup],['Context completeness',r.byContextCompleteness],['Line movement',r.byLineMovement]] as Array<[string,Record<string,ResearchMetrics>]>) {
      lines.push(`### ${title}`,'','| Segment | N | W-L-P | ATS | Units | ROI | Warning |','|---|---:|---:|---:|---:|---:|---|');
      for(const [label,x] of Object.entries(groups))lines.push(`| ${label} | ${x.observations} | ${x.wins}-${x.losses}-${x.pushes} | ${x.atsPercentage===null?'N/A':(100*x.atsPercentage).toFixed(1)+'%'} | ${x.totalUnits??'N/A'} | ${x.roi===null?'N/A':(100*x.roi).toFixed(1)+'%'} | ${x.sampleWarning} |`);
      lines.push('');
    }
    lines.push('### Baselines','',`- All eligible model sides: ${m.atsPercentage===null?'N/A':(100*m.atsPercentage).toFixed(1)+'%'} ATS.`,`- Random directional reference: ${(100*r.baselines.random50Reference.atsRate).toFixed(1)}%.`,`- Market/no-edge directional reference: ${(100*r.baselines.marketNoEdgeReference.atsRate).toFixed(1)}%; ${r.baselines.marketNoEdgeReference.note}`,'',
      '### Hypotheses worth testing later','',...(r.hypothesesWorthForwardTesting.length?r.hypothesesWorthForwardTesting.map(x=>`- ${x}`):['- None supported by a minimally sized discovery segment.']),'',
      '### Results that argue against the model','',...(r.resultsAgainstModel.length?r.resultsAgainstModel.map(x=>`- ${x}`):['- No additional result beyond the displayed uncertainty and limitations.']),'');
  }
  lines.push('## Limitations','',...a.limitations.map(x=>`- ${x}`),'',`- ${a.multipleComparisonsWarning}`,'','No live score weights, recommendation gates, probability calibration, Kelly logic, totals status, or UI behavior were changed.','');return lines.join('\n');
}
