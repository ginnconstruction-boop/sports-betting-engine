import { createHash } from 'crypto';
import { nflNumber,nflSeason } from './nflResearch';
export const COLLEGE_MODEL_VERSION='college-score-ridge-v1';
export interface CollegeResult {id:string;date:string;season:number;homeId:string;awayId:string;homeName:string;awayName:string;homeScore:number;awayScore:number;neutral:boolean;}
export interface CollegeModelConfig {ridge:number;halfLifeDays:number;}
export interface CollegeProjection {version:string;asOf:string;homeId:string;awayId:string;neutral:boolean;homeScore:number;awayScore:number;
  homeMargin:number;total:number;fairHomeSpread:number;naiveMargin:number;naiveTotal:number;homeGames:number;awayGames:number;
  homeCurrentGames:number;awayCurrentGames:number;homeLastGame:string;awayLastGame:string;learnedHomeAdvantage:number;historyHash:string;historyGames:number;config:CollegeModelConfig;}
export function parseCollegeResults(payload:any,season:number){
  if(!Array.isArray(payload?.events))throw Error('College history response has no event array');
  if(payload.events.length>=1000)throw Error('College history response may be truncated; split the source date range.');
  const games:CollegeResult[]=[],skipped:Record<string,number>={};
  const skip=(why:string)=>{skipped[why]=(skipped[why]??0)+1;};
  for(const e of payload.events){
    if(e?.season?.year!==season||e?.season?.type!==2){skip('outside_regular_season');continue;}
    const c=e.competitions?.[0],home=c?.competitors?.filter((t:any)=>t.homeAway==='home')??[],away=c?.competitors?.filter((t:any)=>t.homeAway==='away')??[];
    if(e.competitions?.length!==1||String(c.id)!==String(e.id)||!/^\d+$/.test(String(e.id))||c.competitors?.length!==2||home.length!==1||away.length!==1
      ||!Number.isFinite(Date.parse(e.date))||typeof c.neutralSite!=='boolean'){skip('invalid_identity_or_venue');continue;}
    if(c.status?.type?.completed!==true||c.status?.type?.state!=='post'||!['STATUS_FINAL','STATUS_FINAL_OVERTIME'].includes(c.status.type.name)){
      skip('not_final');continue;
    }
    const h=String(home[0].team?.id),a=String(away[0].team?.id),hs=nflNumber(home[0].score),as=nflNumber(away[0].score);
    if(!/^\d+$/.test(h)||!/^\d+$/.test(a)||h===a||hs===null||as===null||!Number.isInteger(hs)||!Number.isInteger(as)||hs<0||as<0||hs>150||as>150||hs+as===0){skip('invalid_team_or_score');continue;}
    games.push({id:String(e.id),date:new Date(e.date).toISOString(),season,homeId:h,awayId:a,homeName:String(home[0].team.displayName),awayName:String(away[0].team.displayName),homeScore:hs,awayScore:as,neutral:c.neutralSite});
  }
  return {games,skipped};
}
export function mergeCollegeResults(groups:CollegeResult[][]){
  const map=new Map<string,CollegeResult>();
  for(const g of groups.flat()){
    const old=map.get(g.id);
    if(old&&JSON.stringify({...old,homeName:'',awayName:''})!==JSON.stringify({...g,homeName:'',awayName:''}))throw Error('Conflicting college history for event '+g.id);
    map.set(g.id,g);
  }
  return [...map.values()].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||a.id.localeCompare(b.id));
}
export function fitCollegeScores(all:CollegeResult[],asOf:number,config:CollegeModelConfig){
  if(!Number.isFinite(asOf)||!Number.isFinite(config.ridge)||config.ridge<=0||!Number.isFinite(config.halfLifeDays)||config.halfLifeDays<=0)throw Error('Invalid college model configuration');
  const season=nflSeason(asOf),games=mergeCollegeResults([all]).filter(g=>(g.season===season||g.season===season-1)&&Date.parse(g.date)+12*3600_000<asOf);
  if(games.length<100)throw Error('Not enough verified league history for college score model');
  const ids=[...new Set(games.flatMap(g=>[g.homeId,g.awayId]))].sort(),index=new Map(ids.map((id,i)=>[id,i]));
  const coefficients=new Float64Array(2+2*ids.length),adj=Array.from({length:coefficients.length},()=>[] as Array<{row:number;x:number}>);
  const y:number[]=[],weights:number[]=[],residual:number[]=[];
  const histories=new Map<string,CollegeResult[]>();
  for(const g of games){
    for(const id of [g.homeId,g.awayId]){const rows=histories.get(id)??[];rows.push(g);histories.set(id,rows);}
    const w=(g.season===season?1:.65)*Math.pow(.5,(asOf-Date.parse(g.date))/(86400_000*config.halfLifeDays));
    for(const home of [true,false]){
      const row=y.length,target=home?g.homeScore:g.awayScore,off=index.get(home?g.homeId:g.awayId),def=index.get(home?g.awayId:g.homeId);
      const x:Array<[number,number]>=[[0,1],[1,g.neutral?0:home?.5:-.5],[2+off,1],[2+ids.length+def,1]];
      y.push(target);weights.push(w);residual.push(target);for(const [j,v]of x)if(v)adj[j].push({row,x:v});
    }
  }
  // Coordinate descent for sparse ridge least squares; intercept is unpenalized.
  for(let iteration=0;iteration<250;iteration++){
    let change=0;
    for(let j=0;j<coefficients.length;j++){
      let numerator=0,denominator=j===0?0:j===1?config.ridge:config.ridge;
      for(const {row,x}of adj[j]){numerator+=weights[row]*x*(residual[row]+x*coefficients[j]);denominator+=weights[row]*x*x;}
      const next=denominator?numerator/denominator:0,delta=next-coefficients[j];change=Math.max(change,Math.abs(delta));
      coefficients[j]=next;for(const {row,x}of adj[j])residual[row]-=x*delta;
    }
    if(change<1e-7)break;
  }
  const historyHash=createHash('sha256').update(JSON.stringify(games.map(g=>[g.id,g.date,g.homeId,g.awayId,g.homeScore,g.awayScore,g.neutral]))).digest('hex');
  function predict(homeId:string,awayId:string,neutral:boolean):CollegeProjection|null{
    const home=histories.get(homeId)??[],away=histories.get(awayId)??[];
    if(homeId===awayId||typeof neutral!=='boolean'||home.length<6||away.length<6||!index.has(homeId)||!index.has(awayId))return null;
    const h=index.get(homeId),a=index.get(awayId),v=neutral?0:coefficients[1]/2;
    const homeScore=Math.max(0,coefficients[0]+coefficients[2+h]+coefficients[2+ids.length+a]+v);
    const awayScore=Math.max(0,coefficients[0]+coefficients[2+a]+coefficients[2+ids.length+h]-v);
    const average=(rows:CollegeResult[],id:string,forTeam:boolean)=>rows.reduce((sum,g)=>sum+(g.homeId===id?(forTeam?g.homeScore:g.awayScore):(forTeam?g.awayScore:g.homeScore)),0)/rows.length;
    const naiveHome=(average(home,homeId,true)+average(away,awayId,false))/2+(neutral?0:1.5);
    const naiveAway=(average(away,awayId,true)+average(home,homeId,false))/2-(neutral?0:1.5);
    return {version:COLLEGE_MODEL_VERSION,asOf:new Date(asOf).toISOString(),homeId,awayId,neutral,homeScore,awayScore,homeMargin:homeScore-awayScore,total:homeScore+awayScore,
      fairHomeSpread:awayScore-homeScore,naiveMargin:naiveHome-naiveAway,naiveTotal:naiveHome+naiveAway,homeGames:home.length,awayGames:away.length,
      homeCurrentGames:home.filter(g=>g.season===season).length,awayCurrentGames:away.filter(g=>g.season===season).length,
      homeLastGame:home.at(-1).date,awayLastGame:away.at(-1).date,learnedHomeAdvantage:coefficients[1],historyHash,historyGames:games.length,config};
  }
  return {predict,games:games.length,historyHash};
}
export function evaluateCollegeSeason(all:CollegeResult[],season:number,config:CollegeModelConfig){
  const targets=all.filter(g=>g.season===season),rows:any[]=[],skipped:any[]=[];
  const models=new Map<string,ReturnType<typeof fitCollegeScores>>();
  for(const g of targets){
    // UTC calendar-day as-of before the target; no same-day outcomes in training.
    const day=g.date.slice(0,10),asOf=Date.parse(day+'T00:00:00Z');
    if(!models.has(day))models.set(day,fitCollegeScores(all,asOf,config));
    const p=models.get(day).predict(g.homeId,g.awayId,g.neutral);
    if(!p){skipped.push({id:g.id,reason:'Fewer than six historical games for one/both teams'});continue;}
    rows.push({id:g.id,date:g.date,projection:p,margin:g.homeScore-g.awayScore,total:g.homeScore+g.awayScore,
      marginError:g.homeScore-g.awayScore-p.homeMargin,totalError:g.homeScore+g.awayScore-p.total,
      naiveMarginError:g.homeScore-g.awayScore-p.naiveMargin,naiveTotalError:g.homeScore+g.awayScore-p.naiveTotal});
  }
  const metric=(key:string)=>({mae:rows.length?rows.reduce((s,r)=>s+Math.abs(r[key]),0)/rows.length:null,
    rmse:rows.length?Math.sqrt(rows.reduce((s,r)=>s+r[key]**2,0)/rows.length):null});
  return {season,config,games:rows.length,excluded:skipped.length,modelMargin:metric('marginError'),modelTotal:metric('totalError'),
    naiveMargin:metric('naiveMarginError'),naiveTotal:metric('naiveTotalError'),rows,skipped};
}
