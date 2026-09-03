export const COLLEGE_TEAM_ALIASES: Record<string,string[]> = {
  '113':['Massachusetts','UMass','UMass Minutemen','Massachusetts Minutemen'],
  '399':['Albany','UAlbany','Albany Great Danes'],
  '2029':['Arkansas Pine Bluff Golden Lions','Arkansas-Pine Bluff','UAPB'],
  '2754':['Youngstown St Penguins'], '2643':['Citadel Bulldogs','The Citadel'],
  '2026':['Appalachian State Mountaineers','App State'],
  '2572':['Southern Mississippi Golden Eagles','Southern Miss'],
  '2447':['Nicholls State Colonels'], '2277':['Houston Baptist Huskies','Houston Christian Huskies'],
  '2545':['Southeastern Louisiana Lions'], '2534':['Sam Houston State Bearkats','Sam Houston Bearkats'],
};
export interface CollegeTeamEntity {id:string;displayName?:string;shortDisplayName?:string;location?:string;abbreviation?:string;conferenceId?:string;}
export function canonicalCollegeName(name:string){
  return String(name??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/&/g,' and ').replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function names(t:CollegeTeamEntity){return [t.displayName,t.shortDisplayName,t.location,...(COLLEGE_TEAM_ALIASES[t.id]??[])].filter(Boolean);}
export function resolveCollegeTeam(name:string,teams:CollegeTeamEntity[],providerTeamId?:string){
  const key=canonicalCollegeName(name),unique=[...new Map(teams.map(t=>[String(t.id),t])).values()];
  const answer=(matches:CollegeTeamEntity[],method:string)=>matches.length===1?
    {resolved:true,canonicalTeamId:'espn:'+matches[0].id,espnTeamId:String(matches[0].id),canonicalTeamName:matches[0].displayName??matches[0].location,
      providerTeamName:name,method,confidence:1,suggestions:[] as string[]}:
    {resolved:false,canonicalTeamId:null,espnTeamId:null,canonicalTeamName:null,providerTeamName:name,method:'unresolved',confidence:0,suggestions:matches.map(t=>'espn:'+t.id)};
  if(providerTeamId!==undefined)return answer(unique.filter(t=>String(t.id)===providerTeamId),'provider_id');
  if(!key)return answer([],'unresolved');
  const knownIds=Object.entries(COLLEGE_TEAM_ALIASES).filter(([,aliases])=>aliases.some(n=>canonicalCollegeName(n)===key)).map(([id])=>id);
  if(knownIds.length&&(!unique.some(t=>knownIds.includes(String(t.id)))||knownIds.length>1))return answer([],'unresolved');
  const aliases=unique.filter(t=>(COLLEGE_TEAM_ALIASES[t.id]??[]).some(n=>canonicalCollegeName(n)===key));
  const exact=unique.filter(t=>names(t).some(n=>canonicalCollegeName(n)===key));
  // Never resolve an alias that collides with another team's canonical name.
  if(exact.length)return answer(exact,aliases.length?'canonical_alias':'normalized_exact');
  const tokens=new Set(key.split(' '));
  const suggestions=unique.map(t=>({t,score:Math.max(...names(t).map(n=>{const other=new Set(canonicalCollegeName(n).split(' '));
    const overlap=[...tokens].filter(x=>other.has(x)).length;return overlap/new Set([...tokens,...other]).size;}))}))
    .filter(r=>r.score>=.8).sort((a,b)=>b.score-a.score).slice(0,3);
  return {...answer([],'unresolved'),method:suggestions.length?'fuzzy_manual_review':'unresolved',
    confidence:suggestions[0]?.score??0,suggestions:suggestions.map(r=>'espn:'+r.t.id)};
}
export function collegeTeamMatches(name:string,team:CollegeTeamEntity){
  return !!team?.id&&resolveCollegeTeam(name,[team]).resolved;
}
