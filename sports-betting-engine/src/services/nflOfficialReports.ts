import {safeNflContextFailure,NflContextResult} from './nflContextSources';

export const NFL_OFFICIAL_INJURY_REPORT_VERSION='nfl-official-injury-report-v1';
export const nflOfficialInjuryUrl=(season:number,week:number)=>{
  if(!Number.isInteger(season)||season<2000||season>2100||!Number.isInteger(week)||week<1||week>18)throw Error('Invalid NFL regular-season injury-report date.');
  return `https://www.nfl.com/injuries/league/${season}/reg${week}`;
};
export interface OfficialNflInjuryRow {team:string;player:string;position:string;injury:string;practiceStatus:string;gameStatus:string;}
export interface OfficialNflInjuryReport {version:string;season:number;week:number;source:string;fetchedAt:string;status:NflContextResult;teams:string[];rows:OfficialNflInjuryRow[];note:string;}
type TextFetcher=(url:string)=>Promise<string>;
function decode(value:string){return value.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
  .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/\s+/g,' ').trim();}
function cells(fragment:string,tag:'td'|'th'){return[...fragment.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,'gi'))].map(match=>decode(match[1]));}
export function parseOfficialNflInjuryReport(html:string){
  if(typeof html!=='string'||html.length<100||html.length>2_000_000||!/<title>[^<]*Official[^<]*NFL Injury Report/i.test(html))throw Error('Official NFL injury-report page identity failed.');
  const teams:string[]=[],rows:OfficialNflInjuryRow[]=[];
  const blocks=html.matchAll(/<div\b[^>]*class=["'][^"']*d3-o-section-sub-title[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>[\s\S]*?<table\b[^>]*class=["'][^"']*d3-o-reports--detailed[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi);
  for(const block of blocks){const team=decode(block[1]),table=block[2],header=cells(table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1]??'','th');
    if(!team||header.join('|')!=='Player|Position|Injuries|Practice Status|Game Status')throw Error('Official NFL injury-report table schema changed.');
    if(teams.includes(team))throw Error('Duplicate team on official NFL injury report.');teams.push(team);
    const body=table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1]??'';
    for(const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const values=cells(row[1],'td');if(values.length!==5||!values[0])throw Error('Official NFL injury-report row schema changed.');
      rows.push({team,player:values[0],position:values[1],injury:values[2],practiceStatus:values[3],gameStatus:values[4]});}
  }
  return{teams,rows};
}
export async function fetchNflHtml(url:string){const response=await fetch(url,{headers:{'User-Agent':'sports-betting-engine/2.1 personal research; contact via repository'},signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw Error(`Official NFL source returned HTTP ${response.status}`);if(!response.url.startsWith('https://www.nfl.com/injuries/'))throw Error('Official NFL source redirected outside the approved path.');
  const html=await response.text();if(Number(response.headers.get('content-length')??0)>2_000_000||html.length>2_000_000)throw Error('Official NFL injury-report response exceeded the safety limit.');return html;}
function failure(error:unknown):NflContextResult{const message=safeNflContextFailure(error);if(/HTTP\s+(401|403)\b/i.test(message))return'SOURCE_AUTH_FAILED';if(/HTTP\s+429\b|rate.?limit/i.test(message))return'SOURCE_RATE_LIMITED';
  if(/identity|schema|duplicate|safety limit/i.test(message))return'PARSER_FAILED';return'SOURCE_HTTP_ERROR';}
export class OfficialNflInjuryReports {
  private cache=new Map<string,{at:number;report:OfficialNflInjuryReport}>();private pending=new Map<string,Promise<OfficialNflInjuryReport>>();
  constructor(private get:TextFetcher=fetchNflHtml,private now=()=>Date.now()){}
  async report(season:number,week:number){const source=nflOfficialInjuryUrl(season,week),hit=this.cache.get(source);if(hit&&this.now()-hit.at<15*60_000)return structuredClone(hit.report);
    if(this.pending.has(source))return structuredClone(await this.pending.get(source));const task=this.load(source,season,week).finally(()=>this.pending.delete(source));this.pending.set(source,task);return structuredClone(await task);}
  private async load(source:string,season:number,week:number):Promise<OfficialNflInjuryReport>{const fetchedAt=new Date(this.now()).toISOString();try{const parsed=parseOfficialNflInjuryReport(await this.get(source)),status:NflContextResult=parsed.teams.length?'PARTIAL_SUCCESS':'SOURCE_RETURNED_EMPTY';
      const report={version:NFL_OFFICIAL_INJURY_REPORT_VERSION,season,week,source,fetchedAt,status,...parsed,note:parsed.teams.length?'Official team-submitted practice/game designations; not the game-day inactive list.':'NFL.com has not published structured team tables for this week yet.'};
      this.cache.set(source,{at:this.now(),report});return report;
    }catch(error){return{version:NFL_OFFICIAL_INJURY_REPORT_VERSION,season,week,source,fetchedAt,status:failure(error),teams:[],rows:[],note:safeNflContextFailure(error)};}}
}
