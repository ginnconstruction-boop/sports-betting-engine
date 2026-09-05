import * as fs from 'fs';
import * as path from 'path';
import {randomUUID} from 'crypto';

export const NFL_CONTEXT_SOURCE_REGISTRY_VERSION='nfl-context-source-registry-v1';
export type NflContextCategory='GAME_IDENTITY'|'CURRENT_SEASON'|'ROSTER'|'QB_ROLE'|'INJURIES'|'WEATHER'|'GAME_AVAILABILITY';
export type NflContextResult='SUCCESS'|'PARTIAL_SUCCESS'|'NO_PROVIDER_CONFIGURED'|'NO_SOURCE_ATTEMPTED'|'SOURCE_RETURNED_EMPTY'|'SOURCE_FIELD_UNAVAILABLE'|
  'SOURCE_HTTP_ERROR'|'SOURCE_RATE_LIMITED'|'SOURCE_AUTH_FAILED'|'PARSER_FAILED'|'TEAM_MATCH_FAILED'|'VALIDATION_FAILED'|'STORE_FAILED'|'LOAD_FAILED';
export interface NflContextSourceState {id:string;category:NflContextCategory;sourceName:string;sourceType:'PUBLIC_PROVIDER'|'OFFICIAL_PROVIDER';sourceTier:1|2|3;
  enabled:boolean;configured:boolean;credentialsRequired:boolean;credentialsPresent:boolean;refreshInterval:string;lastAttempt:string|null;lastSuccess:string|null;
  lastFailure:string|null;failureReason:string|null;lastResult:NflContextResult;}
interface RegistryFile {schema:1;version:string;updatedAt:string;sources:NflContextSourceState[];}
const definitions:NflContextSourceState[]=[
  {id:'espn-scoreboard:GAME_IDENTITY',category:'GAME_IDENTITY',sourceName:'ESPN NFL scoreboard',sourceType:'PUBLIC_PROVIDER',sourceTier:2,enabled:true,configured:true,credentialsRequired:false,credentialsPresent:true,refreshInterval:'5 minutes',lastAttempt:null,lastSuccess:null,lastFailure:null,failureReason:null,lastResult:'NO_SOURCE_ATTEMPTED'},
  {id:'espn-teams:GAME_IDENTITY',category:'GAME_IDENTITY',sourceName:'ESPN NFL team directory',sourceType:'PUBLIC_PROVIDER',sourceTier:2,enabled:true,configured:true,credentialsRequired:false,credentialsPresent:true,refreshInterval:'6 hours',lastAttempt:null,lastSuccess:null,lastFailure:null,failureReason:null,lastResult:'NO_SOURCE_ATTEMPTED'},
  ...(['CURRENT_SEASON','WEATHER'] as NflContextCategory[]).map(category=>({id:`espn-summary:${category}`,category,sourceName:'ESPN NFL game summary',sourceType:'PUBLIC_PROVIDER' as const,sourceTier:2 as const,enabled:true,configured:true,credentialsRequired:false,credentialsPresent:true,refreshInterval:'15 minutes',lastAttempt:null,lastSuccess:null,lastFailure:null,failureReason:null,lastResult:'NO_SOURCE_ATTEMPTED' as const})),
  {id:'espn-roster:ROSTER',category:'ROSTER',sourceName:'ESPN current-season roster',sourceType:'PUBLIC_PROVIDER',sourceTier:2,enabled:true,configured:true,credentialsRequired:false,credentialsPresent:true,refreshInterval:'6 hours',lastAttempt:null,lastSuccess:null,lastFailure:null,failureReason:null,lastResult:'NO_SOURCE_ATTEMPTED'},
  {id:'espn-injuries:INJURIES',category:'INJURIES',sourceName:'ESPN NFL injury/news feed',sourceType:'PUBLIC_PROVIDER',sourceTier:2,enabled:true,configured:true,credentialsRequired:false,credentialsPresent:true,refreshInterval:'15 minutes',lastAttempt:null,lastSuccess:null,lastFailure:null,failureReason:null,lastResult:'NO_SOURCE_ATTEMPTED'},
  {id:'espn-depthchart:QB_ROLE',category:'QB_ROLE',sourceName:'ESPN depth chart',sourceType:'PUBLIC_PROVIDER',sourceTier:2,enabled:true,configured:true,credentialsRequired:false,credentialsPresent:true,refreshInterval:'60 minutes',lastAttempt:null,lastSuccess:null,lastFailure:null,failureReason:null,lastResult:'NO_SOURCE_ATTEMPTED'},
  {id:'official-inactives:GAME_AVAILABILITY',category:'GAME_AVAILABILITY',sourceName:'Official game-specific inactive status',sourceType:'OFFICIAL_PROVIDER',sourceTier:1,enabled:false,configured:false,credentialsRequired:false,credentialsPresent:false,refreshInterval:'near kickoff',lastAttempt:null,lastSuccess:null,lastFailure:null,failureReason:'No complete automated official inactive adapter is configured',lastResult:'NO_PROVIDER_CONFIGURED'},
];
export function safeNflContextFailure(value:unknown){return String(value instanceof Error?value.message:value).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/[?&](key|token|apiKey)=[^&\s]+/gi,'?$1=[redacted]').slice(0,500);}
function file(root:string){return path.join(root,'nfl_context','source-registry-v1.json');}
export class NflContextSourceRegistry {
  private rows:NflContextSourceState[];readonly loadFailure:string|null;
  constructor(private root:string,private now=()=>Date.now()){
    let old:RegistryFile|null=null,loadFailure:string|null=null;const target=file(root);
    if(fs.existsSync(target))try{const parsed=JSON.parse(fs.readFileSync(target,'utf8'));if(parsed?.schema!==1||parsed?.version!==NFL_CONTEXT_SOURCE_REGISTRY_VERSION||!Array.isArray(parsed.sources))throw Error('Invalid NFL source registry');old=parsed;}catch(error){loadFailure=safeNflContextFailure(error);}
    const byId=new Map((old?.sources??[]).map(row=>[row.id,row]));this.rows=definitions.map(row=>{const prior=byId.get(row.id);return prior?{...row,lastAttempt:prior.lastAttempt,lastSuccess:prior.lastSuccess,lastFailure:prior.lastFailure,
      failureReason:row.configured?prior.failureReason:row.failureReason,lastResult:row.configured?prior.lastResult:'NO_PROVIDER_CONFIGURED'}:structuredClone(row);});this.loadFailure=loadFailure;
  }
  mark(id:string,result:NflContextResult,reason?:unknown,at=new Date(this.now()).toISOString()){const row=this.rows.find(item=>item.id===id);if(!row)return;row.lastAttempt=at;row.lastResult=result;
    if(['SUCCESS','PARTIAL_SUCCESS'].includes(result)){row.lastSuccess=at;row.failureReason=result==='PARTIAL_SUCCESS'?safeNflContextFailure(reason??'Some fields unavailable'):null;}
    else{row.lastFailure=at;row.failureReason=safeNflContextFailure(reason??result);}}
  snapshot(){return{version:NFL_CONTEXT_SOURCE_REGISTRY_VERSION,loadStatus:this.loadFailure?'LOAD_FAILED':'SUCCESS',loadFailure:this.loadFailure,sources:structuredClone(this.rows)};}
  save(){if(this.loadFailure)return{status:'LOAD_FAILED' as const,error:this.loadFailure};const target=file(this.root),dir=path.dirname(target);try{fs.mkdirSync(dir,{recursive:true});const tmp=path.join(dir,randomUUID()+'.tmp');
      fs.writeFileSync(tmp,JSON.stringify({schema:1,version:NFL_CONTEXT_SOURCE_REGISTRY_VERSION,updatedAt:new Date(this.now()).toISOString(),sources:this.rows},null,2),{flag:'wx'});fs.renameSync(tmp,target);return{status:'SUCCESS' as const,error:null};}
    catch(error){return{status:'STORE_FAILED' as const,error:safeNflContextFailure(error)};}}
}
export function loadNflContextSourceRegistry(root:string){return new NflContextSourceRegistry(root).snapshot();}
