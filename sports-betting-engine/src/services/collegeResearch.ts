import { UpcomingEvent } from '../api/oddsApiClient';
import { MarketBoardError } from './nflMarketBoard';
import { fetchNflJson, nflName, nflSeason } from './nflResearch';
import type { NflPaperPick } from './nflPaper';

export const ESPN_COLLEGE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
// Explicit source-ID aliases reviewed against the current ESPN scoreboard.
// Do not guess by initials, fuzzy edit distance or treating State as optional.
export const COLLEGE_TEAM_ALIASES: Record<string,string[]> = {
  '113': ['UMass Minutemen'], '399': ['Albany'],
  '2029': ['Arkansas Pine Bluff Golden Lions'],
  // September 2 Week 1 feed review: explicit aliases bound to ESPN team IDs.
  '2754': ['Youngstown St Penguins'], '2643': ['Citadel Bulldogs'],
  '2026': ['Appalachian State Mountaineers'], '2572': ['Southern Mississippi Golden Eagles'],
  '2447': ['Nicholls State Colonels'], '2277': ['Houston Baptist Huskies'],
  '2545': ['Southeastern Louisiana Lions'], '2534': ['Sam Houston State Bearkats'],
};
export function collegeTeamMatches(name:string,team:any): boolean {
  if(!team?.id||!name)return false;
  return [team.displayName,team.shortDisplayName,team.location,
    ...(COLLEGE_TEAM_ALIASES[String(team.id)]??[])].filter(Boolean).some(n=>nflName(n)===nflName(name));
}
export function matchCollegeEvent(event:UpcomingEvent,data:any,source:string,fetchedAt:string): NonNullable<NflPaperPick['verifiedEvent']> {
  if(event.sportKey!=='americanfootball_ncaaf'||!Number.isFinite(Date.parse(event.commenceTime)))throw new MarketBoardError('Not a valid college game.');
  const matches=(data.events??[]).filter((e:any)=>{
    const c=e.competitions?.[0],home=c?.competitors?.filter((t:any)=>t.homeAway==='home')??[],away=c?.competitors?.filter((t:any)=>t.homeAway==='away')??[];
    return e.competitions?.length===1&&String(c.id)===String(e.id)&&home.length===1&&away.length===1&&c.competitors.length===2
      &&Number(e.season?.year)===nflSeason(event.commenceTime)&&Number(e.season?.type)===2
      &&Math.abs(Date.parse(e.date)-Date.parse(event.commenceTime))<=15*60_000
      &&collegeTeamMatches(event.homeTeam,home[0].team)&&collegeTeamMatches(event.awayTeam,away[0].team);
  });
  if(matches.length!==1||!/^\d+$/.test(String(matches[0].id))){
    const sameTeams=(data.events??[]).filter((e:any)=>{
      const teams=e.competitions?.[0]?.competitors??[];
      return collegeTeamMatches(event.homeTeam,teams.find((t:any)=>t.homeAway==='home')?.team)
        &&collegeTeamMatches(event.awayTeam,teams.find((t:any)=>t.homeAway==='away')?.team);
    });
    if(sameTeams.length===1&&Number.isFinite(Date.parse(sameTeams[0].date))
      &&Math.abs(Date.parse(sameTeams[0].date)-Date.parse(event.commenceTime))>15*60_000)
      throw new MarketBoardError(`College kickoff conflict: odds feed ${event.commenceTime}; independent schedule ${sameTeams[0].date}. No pick until the sources agree.`,422);
    throw new MarketBoardError('Unique college game identity could not be verified. No fuzzy team-name guess or pick was made.',422);
  }
  const competition=matches[0].competitions[0],homeTeamId=String(competition.competitors.find((c:any)=>c.homeAway==='home').team.id),
    awayTeamId=String(competition.competitors.find((c:any)=>c.homeAway==='away').team.id);
  if(!/^\d+$/.test(homeTeamId)||!/^\d+$/.test(awayTeamId)||homeTeamId===awayTeamId)throw new MarketBoardError('College team IDs are invalid.',422);
  return {espnEventId:String(matches[0].id),homeTeamId,awayTeamId,
    neutralSite:typeof competition.neutralSite==='boolean'?competition.neutralSite:null,source,fetchedAt};
}

export class CollegeResearch {
  private cache=new Map<string,{at:number;data:any}>();
  private pending=new Map<string,Promise<any>>();
  constructor(private get=fetchNflJson,private now=()=>Date.now()){}
  private async cached(url:string) {
    const hit=this.cache.get(url);if(hit&&this.now()-hit.at<60_000)return hit.data;
    if(this.pending.has(url))return this.pending.get(url);
    const request=this.get(url).then(data=>{
      for(const [key,row]of this.cache)if(this.now()-row.at>3600_000)this.cache.delete(key);
      this.cache.set(url,{at:this.now(),data});return data;
    }).finally(()=>this.pending.delete(url));this.pending.set(url,request);return request;
  }
  async identity(event:UpcomingEvent) {
    const date=Date.parse(event.commenceTime);if(!Number.isFinite(date))throw new MarketBoardError('Invalid college kickoff.');
    const day=(ms:number)=>new Date(ms).toISOString().slice(0,10).replace(/-/g,'');
    const source=`${ESPN_COLLEGE}/scoreboard?dates=${day(date-86400_000)}-${day(date+86400_000)}&groups=80&limit=500`;
    const data=await this.cached(source);
    return matchCollegeEvent(event,data,source,new Date(this.cache.get(source).at).toISOString());
  }
  async matchEvent(event:UpcomingEvent){return (await this.identity(event)).espnEventId;}
  async summary(id:string){if(!/^\d+$/.test(id))throw new Error('Invalid college event ID');return this.cached(`${ESPN_COLLEGE}/summary?event=${id}`);}
}
