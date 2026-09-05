import {gunzipSync} from 'zlib';
import {safeNflContextFailure,NflContextResult} from './nflContextSources';

export const NFLVERSE_TEAM_RESEARCH_VERSION='nflverse-team-research-v1';
const url=(season:number)=>`https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv.gz`;
type ByteFetcher=(url:string)=>Promise<Buffer>;
interface Row {season:number;week:number;team:string;opponent:string;gameId:string;attempts:number;carries:number;passingYards:number;rushingYards:number;passingEpa:number;rushingEpa:number;defSacks:number;defQbHits:number;}
export interface TeamEfficiencySlice {season:number;games:number;throughWeek:number|null;passEpaPerAttempt:number|null;rushEpaPerCarry:number|null;passYardsPerAttempt:number|null;rushYardsPerCarry:number|null;
  passEpaAllowedPerAttempt:number|null;rushEpaAllowedPerCarry:number|null;sacksPerGame:number|null;qbHitsPerGame:number|null;}
export interface NflTeamResearchContext {version:string;status:NflContextResult;source:string;fetchedAt:string;team:string;opponent:string;current:TeamEfficiencySlice|null;prior:TeamEfficiencySlice|null;
  note:string;modelAdjustmentEnabled:false;}
function csvRows(text:string){const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const char=text[i];if(quoted){if(char==='"'&&text[i+1]==='"'){cell+='"';i++;}
      else if(char==='"')quoted=false;else cell+=char;}else if(char==='"')quoted=true;else if(char===','){row.push(cell);cell='';}else if(char==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=char;}
  if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}if(quoted)throw Error('Unclosed CSV field.');return rows;}
function number(value:string){const n=Number(value);return value.trim()!==''&&Number.isFinite(n)?n:null;}
export function parseNflverseTeamStats(text:string,season:number){const data=csvRows(text),headers=data.shift()??[],required=['season','week','team','season_type','game_id','opponent_team','attempts','carries','passing_yards','rushing_yards','passing_epa','rushing_epa','def_sacks','def_qb_hits'];
  if(required.some(name=>!headers.includes(name)))throw Error('nflverse team-stat schema changed.');const index=(name:string)=>headers.indexOf(name),rows:Row[]=[];
  for(const values of data){if(values[index('season_type')]!=='REG'||number(values[index('season')])!==season)continue;const nums=required.slice(1).filter(name=>!['team','season_type','game_id','opponent_team'].includes(name)).map(name=>number(values[index(name)]));
    if(nums.some(value=>value===null)||!values[index('game_id')]||!values[index('team')]||!values[index('opponent_team')])throw Error('nflverse team-stat row is incomplete.');
    rows.push({season,week:nums[0]!,team:values[index('team')],opponent:values[index('opponent_team')],gameId:values[index('game_id')],attempts:nums[1]!,carries:nums[2]!,passingYards:nums[3]!,rushingYards:nums[4]!,
      passingEpa:nums[5]!,rushingEpa:nums[6]!,defSacks:nums[7]!,defQbHits:nums[8]!});}
  const keys=new Set<string>();for(const row of rows){const key=`${row.gameId}:${row.team}`;if(keys.has(key))throw Error('Duplicate nflverse team-game row.');keys.add(key);}return rows;
}
async function fetchBytes(source:string){const response=await fetch(source,{headers:{'User-Agent':'sports-betting-engine/2.1 personal research; contact via repository'},signal:AbortSignal.timeout(20_000)});if(!response.ok)throw Error(`nflverse source returned HTTP ${response.status}`);
  if(!['github.com','release-assets.githubusercontent.com'].includes(new URL(response.url).hostname))throw Error('nflverse source redirected outside approved hosts.');const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>3_000_000)throw Error('nflverse compressed response exceeded safety limit.');return bytes;}
function failure(error:unknown):NflContextResult{const message=safeNflContextFailure(error);if(/HTTP\s+404\b/.test(message))return'SOURCE_RETURNED_EMPTY';if(/HTTP\s+(401|403)\b/.test(message))return'SOURCE_AUTH_FAILED';
  if(/HTTP\s+429\b|rate.?limit/i.test(message))return'SOURCE_RATE_LIMITED';if(/schema|incomplete|duplicate|safety|CSV/i.test(message))return'PARSER_FAILED';return'SOURCE_HTTP_ERROR';}
function divide(a:number,b:number){return b>0?Number((a/b).toFixed(4)):null;}
function slice(rows:Row[],team:string,season:number):TeamEfficiencySlice|null{const own=rows.filter(row=>row.team===team),against=rows.filter(row=>row.opponent===team);if(!own.length||own.length!==against.length)return null;
  const sum=(items:Row[],field:keyof Row)=>items.reduce((n,row)=>n+Number(row[field]),0);return{season,games:own.length,throughWeek:Math.max(...own.map(row=>row.week)),passEpaPerAttempt:divide(sum(own,'passingEpa'),sum(own,'attempts')),
    rushEpaPerCarry:divide(sum(own,'rushingEpa'),sum(own,'carries')),passYardsPerAttempt:divide(sum(own,'passingYards'),sum(own,'attempts')),rushYardsPerCarry:divide(sum(own,'rushingYards'),sum(own,'carries')),
    passEpaAllowedPerAttempt:divide(sum(against,'passingEpa'),sum(against,'attempts')),rushEpaAllowedPerCarry:divide(sum(against,'rushingEpa'),sum(against,'carries')),sacksPerGame:divide(sum(own,'defSacks'),own.length),qbHitsPerGame:divide(sum(own,'defQbHits'),own.length)};}
export class NflverseTeamResearch {
  private cache=new Map<number,{at:number;status:NflContextResult;rows:Row[];reason:string;fetchedAt:string}>();private pending=new Map<number,Promise<any>>();
  constructor(private get:ByteFetcher=fetchBytes,private now=()=>Date.now()){}
  private async season(season:number){const old=this.cache.get(season);if(old&&this.now()-old.at<6*3600_000)return old;if(this.pending.has(season))return this.pending.get(season);
    const task=(async()=>{const fetchedAt=new Date(this.now()).toISOString();try{const bytes=await this.get(url(season)),text=gunzipSync(bytes,{maxOutputLength:20_000_000}).toString('utf8'),rows=parseNflverseTeamStats(text,season),value={at:this.now(),status:(rows.length?'SUCCESS':'SOURCE_RETURNED_EMPTY') as NflContextResult,rows,reason:rows.length?'':'No regular-season rows returned.',fetchedAt};this.cache.set(season,value);return value;}
      catch(error){const value={at:this.now(),status:failure(error),rows:[] as Row[],reason:safeNflContextFailure(error),fetchedAt};this.cache.set(season,value);return value;}})().finally(()=>this.pending.delete(season));this.pending.set(season,task);return task;}
  async context(team:string,opponent:string,season:number,week:number):Promise<NflTeamResearchContext>{const [current,prior]=await Promise.all([this.season(season),this.season(season-1)]),currentRows=current.rows.filter((row:Row)=>row.week<week),
    status:NflContextResult=prior.status==='SUCCESS'?(current.status==='SUCCESS'?'SUCCESS':'PARTIAL_SUCCESS'):prior.status,source=`${url(season)} | ${url(season-1)}`;
    return{version:NFLVERSE_TEAM_RESEARCH_VERSION,status,source,fetchedAt:new Date(Math.max(Date.parse(current.fetchedAt),Date.parse(prior.fetchedAt))).toISOString(),team,opponent,current:slice(currentRows,team,season),prior:slice(prior.rows,team,season-1),
      note:current.status==='SOURCE_RETURNED_EMPTY'?'Current-season file is not published yet; prior-season diagnostics are shown separately and receive no automatic point weight.':'Only completed earlier weeks enter current-season diagnostics; no model coefficient is enabled.',modelAdjustmentEnabled:false};}
}
