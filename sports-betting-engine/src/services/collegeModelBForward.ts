import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
import {stableStringify} from './collegeEdgeResearch';

export const COLLEGE_MODEL_B_FORWARD_SCHEMA='college-model-b-forward-v1';
export interface ForwardFeatureValue {value:string|number|boolean|null;asOf:string;provenance:string;availability:'VERIFIED_POINT_IN_TIME'|'SAFE_HISTORICAL_SNAPSHOT'|'RECONSTRUCTED_WITHOUT_FUTURE_INFO'|'UNAVAILABLE';}
export interface CollegeModelBForwardSnapshot {
  schemaVersion:typeof COLLEGE_MODEL_B_FORWARD_SCHEMA;
  gameId:string;kickoff:string;forecastAt:string;modelAVersion:string;modelAHomeMargin:number|null;
  modelBVersion:string;modelBCandidate:string;modelBHomeMargin:number|null;
  features:Record<string,ForwardFeatureValue>;context:Record<string,ForwardFeatureValue>;
  externalMarketBenchmark:{homeSpread:number|null;americanPrice:number|null;capturedAt:string|null;source:string|null};
}
export interface CollegeModelBSettlement {schemaVersion:'college-model-b-settlement-v1';gameId:string;settledAt:string;actualHomeMargin:number;finalStatus:'STATUS_FINAL'|'STATUS_FINAL_OVERTIME';source:string;}

const forbidden=/(sportsbook|spread|moneyline|total|consensus|line movement|closing line|market.implied|odds)/i;
const parse=(value:string,label:string)=>{const n=Date.parse(value);if(!Number.isFinite(n))throw Error(`Invalid ${label} timestamp.`);return n;};
const sha=(value:unknown)=>createHash('sha256').update(stableStringify(value)).digest('hex');
const safeId=(value:string)=>{if(!/^[A-Za-z0-9._-]+$/.test(value))throw Error('Unsafe game ID.');return value;};

export function validateModelBForwardSnapshot(snapshot:CollegeModelBForwardSnapshot){
  if(snapshot.schemaVersion!==COLLEGE_MODEL_B_FORWARD_SCHEMA)throw Error('Unsupported forward snapshot schema.');
  safeId(snapshot.gameId);const forecast=parse(snapshot.forecastAt,'forecast'),kickoff=parse(snapshot.kickoff,'kickoff');
  if(forecast>=kickoff)throw Error('Forward forecast must be archived before kickoff.');
  for(const [family,values] of Object.entries({features:snapshot.features,context:snapshot.context}))for(const [name,entry] of Object.entries(values)){
    if(forbidden.test(name)||forbidden.test(entry.provenance))throw Error(`Sportsbook contamination inside Model B ${family}: ${name}.`);
    if(parse(entry.asOf,`${family}.${name}`)>forecast)throw Error(`Future information in ${family}.${name}.`);
  }
  const market=snapshot.externalMarketBenchmark;if(market.capturedAt!==null&&parse(market.capturedAt,'external market')>forecast)throw Error('External market benchmark is after forecast.');
  return {contentHash:sha(snapshot),featureCount:Object.keys(snapshot.features).length,contextCount:Object.keys(snapshot.context).length};
}

export class CollegeModelBForwardArchive {
  constructor(private readonly root:string){}
  archiveForecast(snapshot:CollegeModelBForwardSnapshot){const audit=validateModelBForwardSnapshot(snapshot),dir=path.join(this.root,safeId(snapshot.gameId)),file=path.join(dir,'forecast.json'),contents=JSON.stringify(snapshot,null,2);
    fs.mkdirSync(dir,{recursive:true});if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==contents)throw Error(`Immutable forward forecast already exists for ${snapshot.gameId}.`);return {file,created:false,...audit};}
    fs.writeFileSync(file,contents,{flag:'wx'});return {file,created:true,...audit};}
  settle(result:CollegeModelBSettlement){if(result.schemaVersion!=='college-model-b-settlement-v1'||result.gameId===''||!Number.isFinite(result.actualHomeMargin)||!['STATUS_FINAL','STATUS_FINAL_OVERTIME'].includes(result.finalStatus))throw Error('Invalid Model B settlement.');
    parse(result.settledAt,'settlement');const dir=path.join(this.root,safeId(result.gameId)),forecastFile=path.join(dir,'forecast.json');if(!fs.existsSync(forecastFile))throw Error('Cannot settle a game without an archived forecast.');
    const forecast=JSON.parse(fs.readFileSync(forecastFile,'utf8')) as CollegeModelBForwardSnapshot;if(parse(result.settledAt,'settlement')<parse(forecast.kickoff,'kickoff'))throw Error('Settlement precedes kickoff.');
    const file=path.join(dir,'settlement.json'),contents=JSON.stringify(result,null,2);if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==contents)throw Error(`Immutable settlement already exists for ${result.gameId}.`);return {file,created:false,contentHash:sha(result)};}
    fs.writeFileSync(file,contents,{flag:'wx'});return {file,created:true,contentHash:sha(result)};}
}
