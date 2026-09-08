import {createHash} from 'crypto';
import {nflName} from './nflResearch';

export const NFL_INACTIVES_SOURCE = 'https://www.nfl.com/inactives/';
export type GameDayAvailabilityState = 'ACTIVE_VERIFIED' | 'INACTIVE_VERIFIED' | 'STATUS_PENDING' | 'STATUS_UNKNOWN';

export interface OfficialInactivePlayer {
  name:string;
  team:string;
  providerPlayerId:string|null;
}
export interface OfficialInactiveGame {
  providerGameId:string|null;
  homeTeam:string;
  awayTeam:string;
  complete:boolean;
  players:OfficialInactivePlayer[];
}
export interface OfficialInactiveObservation {
  source:string;
  sourceTimestamp:string|null;
  retrievedAt:string;
  rawPayloadHash:string;
  pageState:'COMPLETE_GAME_LISTS'|'SEASON_PENDING'|'MALFORMED_OR_UNVERIFIED';
  games:OfficialInactiveGame[];
  note:string;
}

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const text=(html:string)=>html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();

// NFL.com currently serves a season-pending shell before weekly lists exist. A
// complete structured payload is accepted only when every game explicitly says
// it is complete. Absence from a partial page can never prove ACTIVE.
export function parseOfficialInactives(html:string,retrievedAt:string):OfficialInactiveObservation {
  const plain=text(html),base={source:NFL_INACTIVES_SOURCE,sourceTimestamp:null,retrievedAt,rawPayloadHash:sha(html)};
  if(/please check back soon for nfl inactive reports/i.test(plain))return{...base,pageState:'SEASON_PENDING',games:[],note:'Official NFL page has not published game-day inactive lists; participation remains pending.'};
  const marker=html.match(/<script[^>]+id=["']__NFL_INACTIVES_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if(!marker)return{...base,pageState:'MALFORMED_OR_UNVERIFIED',games:[],note:'Official page structure is not a verified complete inactive-list schema; participation remains unknown.'};
  try{
    const value=JSON.parse(marker[1]),games:OfficialInactiveGame[]=(value.games??[]).map((game:any)=>({
      providerGameId:game.id==null?null:String(game.id),homeTeam:String(game.homeTeam??''),awayTeam:String(game.awayTeam??''),complete:game.complete===true,
      players:(game.inactivePlayers??[]).map((player:any)=>({name:String(player.name??''),team:String(player.team??''),providerPlayerId:player.id==null?null:String(player.id)})),
    }));
    if(!games.length||games.some(game=>!game.complete||!game.homeTeam||!game.awayTeam||game.players.some(player=>!player.name||!player.team)))throw Error('incomplete');
    return{...base,sourceTimestamp:typeof value.sourceTimestamp==='string'?value.sourceTimestamp:null,pageState:'COMPLETE_GAME_LISTS',games,note:'Official game lists are explicitly complete.'};
  }catch{return{...base,pageState:'MALFORMED_OR_UNVERIFIED',games:[],note:'Official inactive payload failed strict validation; participation remains unknown.'};}
}

export function resolveGameDayAvailability(observation:OfficialInactiveObservation,game:{providerGameId?:string|null;homeTeam:string;awayTeam:string},player:{providerPlayerId?:string|null;name:string;team:string}){
  if(observation.pageState==='SEASON_PENDING')return{state:'STATUS_PENDING' as const,reason:observation.note};
  if(observation.pageState!=='COMPLETE_GAME_LISTS')return{state:'STATUS_UNKNOWN' as const,reason:observation.note};
  const matches=observation.games.filter(row=>game.providerGameId&&row.providerGameId===game.providerGameId||
    nflName(row.homeTeam)===nflName(game.homeTeam)&&nflName(row.awayTeam)===nflName(game.awayTeam));
  if(matches.length!==1||!matches[0].complete)return{state:'STATUS_UNKNOWN' as const,reason:'A unique complete official game list was not resolved.'};
  const rows=matches[0].players.filter(row=>player.providerPlayerId&&row.providerPlayerId===player.providerPlayerId||nflName(row.name)===nflName(player.name)&&nflName(row.team)===nflName(player.team));
  if(rows.length>1)return{state:'STATUS_UNKNOWN' as const,reason:'Official player identity is ambiguous.'};
  return rows.length===1?{state:'INACTIVE_VERIFIED' as const,reason:'Player appears on the complete official game-day inactive list.'}:
    {state:'ACTIVE_VERIFIED' as const,reason:'Player is absent from a uniquely matched, explicitly complete official game-day inactive list.'};
}

export async function fetchOfficialInactives(now=()=>Date.now(),fetcher:typeof fetch=fetch){const retrievedAt=new Date(now()).toISOString();try{const response=await fetcher(NFL_INACTIVES_SOURCE,{headers:{'User-Agent':'sports-betting-engine/2.1 forward research'},signal:AbortSignal.timeout(12_000)});if(!response.ok)throw Error(`HTTP ${response.status}`);return parseOfficialInactives(await response.text(),retrievedAt);}catch(error){return{source:NFL_INACTIVES_SOURCE,sourceTimestamp:null,retrievedAt,rawPayloadHash:sha(String(error)),pageState:'MALFORMED_OR_UNVERIFIED' as const,games:[],note:`Official inactive source unavailable: ${error instanceof Error?error.message:String(error)}`};}}
