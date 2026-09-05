import {gunzipSync} from 'zlib';
import {nflName} from './nflResearch';
import {NflContextResult,safeNflContextFailure} from './nflContextSources';

export const NFLVERSE_SNAP_VERSION='nflverse-snap-research-v1';
const scheduleUrl='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv.gz';
const snapUrl=(season:number)=>`https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv.gz`;
type ByteFetcher=(url:string)=>Promise<Buffer>;
interface RawSnap {gameId:string;season:number;week:number;player:string;playerId:string;position:string;team:string;opponent:string;offenseSnaps:number;offensePct:number;}
export interface NflSnapRow extends RawSnap {date:string;}
export interface NflSnapContext {version:string;status:NflContextResult;player:string;pfrPlayerId:string|null;fetchedAt:string;sources:string[];current:NflSnapRow[];prior:NflSnapRow[];
  recent:NflSnapRow[];meanRecentOffensePct:number|null;note:string;modelAdjustmentEnabled:false;}
function csv(text:string){const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const char=text[i];if(quoted){if(char==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(char==='"')quoted=false;else cell+=char;}
    else if(char==='"')quoted=true;else if(char===','){row.push(cell);cell='';}else if(char==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=char;}if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}if(quoted)throw Error('Unclosed CSV field.');return rows;}
function numeric(value:string){const n=Number(value);return value.trim()!==''&&Number.isFinite(n)?n:null;}
export function parseNflverseSnapCounts(text:string,season:number){const rows=csv(text),headers=rows.shift()??[],needed=['game_id','season','game_type','week','player','pfr_player_id','position','team','opponent','offense_snaps','offense_pct'];
  if(needed.some(name=>!headers.includes(name)))throw Error('nflverse snap-count schema changed.');const at=(name:string)=>headers.indexOf(name),result:RawSnap[]=[];
  for(const row of rows){if(row[at('game_type')]!=='REG'||numeric(row[at('season')])!==season)continue;const week=numeric(row[at('week')]),snaps=numeric(row[at('offense_snaps')]),pct=numeric(row[at('offense_pct')]);
    if(!row[at('game_id')]||!row[at('player')]||!row[at('pfr_player_id')]||!row[at('team')]||!row[at('opponent')]||week===null||snaps===null||pct===null||pct<0||pct>1)throw Error('nflverse snap-count row is incomplete.');
    result.push({gameId:row[at('game_id')],season,week,player:row[at('player')],playerId:row[at('pfr_player_id')],position:row[at('position')],team:row[at('team')],opponent:row[at('opponent')],offenseSnaps:snaps,offensePct:pct});}
  const seen=new Set<string>();for(const row of result){const key=`${row.gameId}:${row.playerId}:${row.team}`;if(seen.has(key))throw Error('Duplicate nflverse player-game snap row.');seen.add(key);}return result;
}
export function parseNflverseSchedule(text:string){const rows=csv(text),headers=rows.shift()??[],needed=['game_id','gameday'];if(needed.some(name=>!headers.includes(name)))throw Error('nflverse schedule schema changed.');
  const game=headers.indexOf('game_id'),day=headers.indexOf('gameday'),result=new Map<string,string>();for(const row of rows){if(!row[game]||!/\d{4}-\d{2}-\d{2}/.test(row[day]))continue;if(result.has(row[game]))throw Error('Duplicate nflverse schedule game.');
    // End-of-day is intentionally conservative: a later-retrieved target-game
    // snap row can never enter a forecast made earlier on that calendar day.
    result.set(row[game],`${row[day]}T23:59:59.999Z`);}return result;}
async function bytes(source:string){const response=await fetch(source,{headers:{'User-Agent':'sports-betting-engine/2.1 personal research; contact via repository'},signal:AbortSignal.timeout(20_000)});if(!response.ok)throw Error(`nflverse source returned HTTP ${response.status}`);
  if(!['github.com','release-assets.githubusercontent.com'].includes(new URL(response.url).hostname))throw Error('nflverse source redirected outside approved hosts.');const data=Buffer.from(await response.arrayBuffer());if(data.length>3_000_000)throw Error('nflverse compressed response exceeded safety limit.');return data;}
function result(error:unknown):NflContextResult{const message=safeNflContextFailure(error);if(/HTTP\s+404\b/.test(message))return'SOURCE_RETURNED_EMPTY';if(/HTTP\s+(401|403)\b/.test(message))return'SOURCE_AUTH_FAILED';
  if(/HTTP\s+429\b|rate.?limit/i.test(message))return'SOURCE_RATE_LIMITED';if(/schema|incomplete|duplicate|safety|CSV/i.test(message))return'PARSER_FAILED';return'SOURCE_HTTP_ERROR';}
export class NflverseSnapResearch {
  private cache=new Map<string,{at:number;status:NflContextResult;value:any;reason:string}>();private pending=new Map<string,Promise<any>>();
  constructor(private get:ByteFetcher=bytes,private now=()=>Date.now()){}
  private async load(source:string,kind:'schedule'|'snaps',season?:number){const old=this.cache.get(source);if(old&&this.now()-old.at<6*3600_000)return old;if(this.pending.has(source))return this.pending.get(source);
    const task=(async()=>{try{const raw=await this.get(source),text=gunzipSync(raw,{maxOutputLength:20_000_000}).toString('utf8'),value=kind==='schedule'?parseNflverseSchedule(text):parseNflverseSnapCounts(text,season!),row={at:this.now(),status:'SUCCESS' as NflContextResult,value,reason:''};this.cache.set(source,row);return row;}
      catch(error){const row={at:this.now(),status:result(error),value:kind==='schedule'?new Map():[],reason:safeNflContextFailure(error)};this.cache.set(source,row);return row;}})().finally(()=>this.pending.delete(source));this.pending.set(source,task);return task;}
  async context(player:string,season:number,cutoff:number):Promise<NflSnapContext>{const sources=[scheduleUrl,snapUrl(season),snapUrl(season-1)],loaded=await Promise.all([this.load(sources[0],'schedule'),this.load(sources[1],'snaps',season),this.load(sources[2],'snaps',season-1)]),
    schedule:Map<string,string>=loaded[0].value,all:RawSnap[]=[...loaded[1].value,...loaded[2].value],matches=all.filter(row=>nflName(row.player)===nflName(player)),ids=[...new Set(matches.map(row=>row.playerId))],fetchedAt=new Date(Math.max(...loaded.map(row=>row.at))).toISOString();
    if(ids.length!==1)return{version:NFLVERSE_SNAP_VERSION,status:ids.length?'TEAM_MATCH_FAILED':'SOURCE_RETURNED_EMPTY',player,pfrPlayerId:null,fetchedAt,sources,current:[],prior:[],recent:[],meanRecentOffensePct:null,
      note:ids.length?'Exact player name matched multiple PFR identifiers; no snap context assumed.':'No exact player snap-count match returned.',modelAdjustmentEnabled:false};
    const dated=matches.map(row=>({...row,date:schedule.get(row.gameId)??''})).filter(row=>Number.isFinite(Date.parse(row.date))&&Date.parse(row.date)<cutoff).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)),current=dated.filter(row=>row.season===season),prior=dated.filter(row=>row.season===season-1),recent=dated.slice(0,5),mean=recent.length?recent.reduce((n,row)=>n+row.offensePct,0)/recent.length:null;
    return{version:NFLVERSE_SNAP_VERSION,status:loaded[0].status==='SUCCESS'&&prior.length?(loaded[1].status==='SUCCESS'?'SUCCESS':'PARTIAL_SUCCESS'):'SOURCE_RETURNED_EMPTY',player,pfrPlayerId:ids[0],fetchedAt,sources,current,prior,recent,
      meanRecentOffensePct:mean===null?null:Number(mean.toFixed(4)),note:'Free CC-BY-4.0 cross-provider snap context. Exact name maps to one PFR ID, but no official ESPN↔PFR ID crosswalk exists; diagnostic only, with no route/red-zone inference or model weight.',modelAdjustmentEnabled:false};}
}
