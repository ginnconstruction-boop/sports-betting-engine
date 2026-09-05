import * as fs from 'fs';
import * as path from 'path';
import {randomUUID} from 'crypto';
import type {ContextIngestionReason} from './collegeContextEvidence';

export const COLLEGE_CONTEXT_SOURCE_REGISTRY_VERSION='college-context-source-registry-v1';
export type CollegeContextCategory='QB'|'CURRENT_SEASON'|'COACHING'|'ROSTER'|'TRANSFERS'|'RETURNING_PRODUCTION'|'TALENT_DEPTH'|'INJURIES'|'WEATHER'|'CLASSIFICATION';
export type CollegeContextSourceResult=ContextIngestionReason|'NO_SOURCE_ATTEMPTED';
export interface CollegeContextSourceState {
  id:string;category:CollegeContextCategory;sourceName:string;sourceType:'PUBLIC_PROVIDER'|'CONFIGURED_API'|'VERIFIED_INTERNAL';sourceTier:1|2|3|4;
  enabled:boolean;configured:boolean;credentialsRequired:boolean;credentialsPresent:boolean;refreshInterval:string;
  lastAttempt:string|null;lastSuccess:string|null;lastFailure:string|null;failureReason:string|null;lastResult:CollegeContextSourceResult;
}
interface RegistryFile {schema:1;version:string;updatedAt:string;sources:CollegeContextSourceState[];}
const definitions=(cfbdConfigured:boolean):CollegeContextSourceState[]=>[
  ...(['QB','CURRENT_SEASON','INJURIES','WEATHER'] as CollegeContextCategory[]).map(category=>({id:`espn-game-summary:${category}`,category,sourceName:'ESPN game summary',sourceType:'PUBLIC_PROVIDER' as const,sourceTier:2 as const,
    enabled:true,configured:true,credentialsRequired:false,credentialsPresent:true,refreshInterval:'15 minutes',lastAttempt:null,lastSuccess:null,lastFailure:null,failureReason:null,lastResult:'NO_SOURCE_ATTEMPTED' as const})),
  ...(['ROSTER','COACHING'] as CollegeContextCategory[]).map(category=>({id:`espn-roster:${category}`,category,sourceName:'ESPN current-season roster',sourceType:'PUBLIC_PROVIDER' as const,sourceTier:2 as const,
    enabled:true,configured:true,credentialsRequired:false,credentialsPresent:true,refreshInterval:'7 days',lastAttempt:null,lastSuccess:null,lastFailure:null,failureReason:null,lastResult:'NO_SOURCE_ATTEMPTED' as const})),
  {id:'verified-schedule:CLASSIFICATION',category:'CLASSIFICATION',sourceName:'Verified college schedule identity',sourceType:'VERIFIED_INTERNAL',sourceTier:2,enabled:true,configured:true,
    credentialsRequired:false,credentialsPresent:true,refreshInterval:'per slate',lastAttempt:null,lastSuccess:null,lastFailure:null,failureReason:null,lastResult:'NO_SOURCE_ATTEMPTED'},
  ...(['TRANSFERS','RETURNING_PRODUCTION','TALENT_DEPTH','COACHING'] as CollegeContextCategory[]).map(category=>({id:`cfbd:${category}`,category,sourceName:'CollegeFootballData',sourceType:'CONFIGURED_API' as const,sourceTier:3 as const,
    enabled:true,configured:cfbdConfigured,credentialsRequired:true,credentialsPresent:cfbdConfigured,refreshInterval:'24 hours',lastAttempt:null,lastSuccess:null,lastFailure:null,
    failureReason:cfbdConfigured?null:'CFBD_API_KEY is not configured',lastResult:(cfbdConfigured?'NO_SOURCE_ATTEMPTED':'NO_PROVIDER_CONFIGURED') as CollegeContextSourceResult})),
];
function registryPath(root:string){return path.join(root,'college_context','source-registry-v1.json');}
function safeReason(value:unknown){return String(value instanceof Error?value.message:value).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/[?&](key|token|apiKey)=[^&\s]+/gi,'?$1=[redacted]').slice(0,500);}
export class CollegeContextSourceRegistry {
  private rows:CollegeContextSourceState[];readonly loadFailure:string|null;
  constructor(private root:string,cfbdConfigured:boolean,private now=()=>Date.now()){
    const defaults=definitions(cfbdConfigured),file=registryPath(root);let prior:RegistryFile|null=null,loadFailure:string|null=null;
    if(fs.existsSync(file))try{const parsed=JSON.parse(fs.readFileSync(file,'utf8'));if(parsed?.schema!==1||parsed?.version!==COLLEGE_CONTEXT_SOURCE_REGISTRY_VERSION||!Array.isArray(parsed.sources))throw Error('Invalid source registry');prior=parsed;}
    catch(error){loadFailure=safeReason(error);}
    const byId=new Map((prior?.sources??[]).map(row=>[row.id,row]));
    this.rows=defaults.map(row=>{const old=byId.get(row.id);return old?{...row,lastAttempt:old.lastAttempt??null,lastSuccess:old.lastSuccess??null,lastFailure:old.lastFailure??null,
      failureReason:row.configured?old.failureReason??null:row.failureReason,lastResult:row.configured?old.lastResult??'NO_SOURCE_ATTEMPTED':'NO_PROVIDER_CONFIGURED'}:row;});
    this.loadFailure=loadFailure;
  }
  mark(sourcePrefix:string,result:CollegeContextSourceResult,reason?:unknown,at=new Date(this.now()).toISOString()){
    for(const row of this.rows.filter(item=>item.id.startsWith(sourcePrefix))){row.lastAttempt=at;row.lastResult=result;
      if(['SUCCESS','PARTIAL_SUCCESS'].includes(result)){row.lastSuccess=at;row.failureReason=result==='PARTIAL_SUCCESS'?safeReason(reason??'Some provider fields were unavailable'):null;}
      else{row.lastFailure=at;row.failureReason=safeReason(reason??result);}}
  }
  markCategory(sourcePrefix:string,category:CollegeContextCategory,result:CollegeContextSourceResult,reason?:unknown,at=new Date(this.now()).toISOString()){
    const row=this.rows.find(item=>item.id===`${sourcePrefix}:${category}`);if(!row)return;row.lastAttempt=at;row.lastResult=result;
    if(['SUCCESS','PARTIAL_SUCCESS'].includes(result)){row.lastSuccess=at;row.failureReason=result==='PARTIAL_SUCCESS'?safeReason(reason??'Some provider fields were unavailable'):null;}
    else{row.lastFailure=at;row.failureReason=safeReason(reason??result);}
  }
  snapshot(){return{version:COLLEGE_CONTEXT_SOURCE_REGISTRY_VERSION,loadStatus:this.loadFailure?'LOAD_FAILED':'SUCCESS',loadFailure:this.loadFailure,sources:structuredClone(this.rows)};}
  save(){
    if(this.loadFailure)return{status:'LOAD_FAILED' as const,error:this.loadFailure};
    const file=registryPath(this.root),dir=path.dirname(file);try{fs.mkdirSync(dir,{recursive:true});const payload:RegistryFile={schema:1,version:COLLEGE_CONTEXT_SOURCE_REGISTRY_VERSION,
      updatedAt:new Date(this.now()).toISOString(),sources:this.rows};const tmp=path.join(dir,randomUUID()+'.registry.tmp');fs.writeFileSync(tmp,JSON.stringify(payload,null,2),{flag:'wx'});fs.renameSync(tmp,file);return{status:'SUCCESS' as const,error:null};}
    catch(error){return{status:'STORE_FAILED' as const,error:safeReason(error)};}
  }
}
export function loadCollegeContextSourceRegistry(root:string,cfbdConfigured=Boolean(process.env.CFBD_API_KEY)){
  return new CollegeContextSourceRegistry(root,cfbdConfigured).snapshot();
}
export function safeContextFailure(value:unknown){return safeReason(value);}
