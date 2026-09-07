import {createHash} from 'crypto';
import type {CollegeResult} from './collegeScoreModel';
import {stableStringify} from './collegeEdgeResearch';

export const COLLEGE_SCORE_MODEL_B_RESEARCH_VERSION='college-score-model-b-research-v1';
export type ModelBArchitecture='B1_OPPONENT_ADJUSTED_MARGIN'|'B2_PRESEASON_CURRENT_BLEND'|'B3_NONLINEAR_MISMATCH';
export interface B1Config {ridge:number;previousSeasonWeight:number;halfLifeDays:number|null;}
export interface B2Config {ridge:number;transitionGames:number;}
export interface B3Config extends B2Config {mismatchThreshold:number;beyondThresholdFactor:number;}
export type ModelBCandidateConfig={architecture:'B1_OPPONENT_ADJUSTED_MARGIN';parameters:B1Config}|{architecture:'B2_PRESEASON_CURRENT_BLEND';parameters:B2Config}|{architecture:'B3_NONLINEAR_MISMATCH';parameters:B3Config};
export interface ModelBGrid {b1:B1Config[];b2:B2Config[];b3:B3Config[];}
export interface ModelBPrediction {gameId:string;date:string;season:number;architecture:ModelBArchitecture;candidateName:string;modelHomeMargin:number|null;actualHomeMargin:number;status:'PROJECTED'|'MODEL_UNAVAILABLE';reason:string|null;features:{priorHomeGames:number;priorAwayGames:number;currentHomeGames:number;currentAwayGames:number;neutral:boolean;independentMismatchMagnitude:number|null};}
export interface ModelBMetrics {eligible:number;unavailable:number;coverage:number;bias:number|null;mae:number|null;rmse:number|null;}
export interface ModelBFitSnapshot {asOf:string;candidateName:string;fits:{margin?:SerializedFit|null;prior?:SerializedFit|null;current?:SerializedFit|null};}
export interface SerializedFit {base:number;homeAdvantage:number;strength:Array<[string,number]>;offense:Array<[string,number]>;defense:Array<[string,number]>;gamesByTeam:Array<[string,number]>;}
export interface ModelBCandidateResult {candidate:ModelBCandidateConfig;candidateName:string;metrics:ModelBMetrics;predictions:ModelBPrediction[];fitSnapshots:ModelBFitSnapshot[];}

const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const round=(v:number|null,d=6)=>v===null?null:Number(v.toFixed(d));
export const modelBCandidateName=(candidate:ModelBCandidateConfig)=>`${candidate.architecture}:${createHash('sha256').update(stableStringify(candidate.parameters)).digest('hex').slice(0,10)}`;

interface RatingFit {ids:Set<string>;strength:Map<string,number>;offense:Map<string,number>;defense:Map<string,number>;base:number;homeAdvantage:number;gamesByTeam:Map<string,number>;}
function counts(games:CollegeResult[]){const result=new Map<string,number>();for(const g of games)for(const id of [g.homeId,g.awayId])result.set(id,(result.get(id)??0)+1);return result;}
function serializeFit(fit:RatingFit|null):SerializedFit|null{return fit?{base:round(fit.base) as number,homeAdvantage:round(fit.homeAdvantage) as number,
  strength:[...fit.strength.entries()].map(([id,value])=>[id,round(value) as number]),offense:[...fit.offense.entries()].map(([id,value])=>[id,round(value) as number]),
  defense:[...fit.defense.entries()].map(([id,value])=>[id,round(value) as number]),gamesByTeam:[...fit.gamesByTeam.entries()].sort(([a],[b])=>a.localeCompare(b))}:null;}

function coordinate(rows:Array<{y:number;weight:number;x:Array<[number,number]>}>,size:number,penalty:(j:number)=>number){
  const coefficients=new Float64Array(size),residual=rows.map(r=>r.y),adj=Array.from({length:size},()=>[] as Array<{row:number;x:number}>);
  rows.forEach((r,i)=>r.x.forEach(([j,x])=>{if(x)adj[j].push({row:i,x});}));
  for(let iteration=0;iteration<160;iteration++){let change=0;for(let j=0;j<size;j++){let numerator=0,denominator=penalty(j);
      for(const item of adj[j]){const r=rows[item.row];numerator+=r.weight*item.x*(residual[item.row]+item.x*coefficients[j]);denominator+=r.weight*item.x*item.x;}
      const next=denominator?numerator/denominator:0,delta=next-coefficients[j];coefficients[j]=next;change=Math.max(change,Math.abs(delta));for(const item of adj[j])residual[item.row]-=item.x*delta;}
    if(change<1e-7)break;}return coefficients;
}

function fitMargin(games:CollegeResult[],asOf:number,season:number,config:B1Config):RatingFit|null{
  const eligible=games.filter(g=>(g.season===season||g.season===season-1)&&Date.parse(g.date)+12*3600_000<asOf);if(eligible.length<100)return null;
  const ids=[...new Set(eligible.flatMap(g=>[g.homeId,g.awayId]))].sort(),index=new Map(ids.map((id,i)=>[id,i]));
  const rows=eligible.map(g=>{const age=(asOf-Date.parse(g.date))/86400_000,decay=config.halfLifeDays===null?1:Math.pow(.5,age/config.halfLifeDays),weight=(g.season===season?1:config.previousSeasonWeight)*decay;
    return {y:g.homeScore-g.awayScore,weight,x:[[0,g.neutral?0:1],[1+index.get(g.homeId)!,1],[1+index.get(g.awayId)!,-1]] as Array<[number,number]>};});
  const c=coordinate(rows,1+ids.length,j=>j===0?config.ridge:config.ridge),strength=new Map(ids.map((id,i)=>[id,c[1+i]]));
  return {ids:new Set(ids),strength,offense:new Map(),defense:new Map(),base:0,homeAdvantage:c[0],gamesByTeam:counts(eligible)};
}

function fitScore(games:CollegeResult[],ridge:number):RatingFit|null{
  if(games.length<20)return null;const ids=[...new Set(games.flatMap(g=>[g.homeId,g.awayId]))].sort(),index=new Map(ids.map((id,i)=>[id,i])),rows:Array<{y:number;weight:number;x:Array<[number,number]>}>=[];
  for(const g of games)for(const home of [true,false]){const offense=index.get(home?g.homeId:g.awayId)!,defense=index.get(home?g.awayId:g.homeId)!;
    rows.push({y:home?g.homeScore:g.awayScore,weight:1,x:[[0,1],[1,g.neutral?0:home?.5:-.5],[2+offense,1],[2+ids.length+defense,1]]});}
  const c=coordinate(rows,2+2*ids.length,j=>j===0?0:ridge),offense=new Map(ids.map((id,i)=>[id,c[2+i]])),defense=new Map(ids.map((id,i)=>[id,c[2+ids.length+i]]));
  return {ids:new Set(ids),strength:new Map(),offense,defense,base:c[0],homeAdvantage:c[1],gamesByTeam:counts(games)};
}

function candidateSpecs(grid:ModelBGrid):ModelBCandidateConfig[]{return [...grid.b1.map(parameters=>({architecture:'B1_OPPONENT_ADJUSTED_MARGIN' as const,parameters})),
  ...grid.b2.map(parameters=>({architecture:'B2_PRESEASON_CURRENT_BLEND' as const,parameters})),...grid.b3.map(parameters=>({architecture:'B3_NONLINEAR_MISMATCH' as const,parameters}))];}
function blended(prior:number|undefined,current:number|undefined,currentGames:number,tau:number){if(!finite(prior)&&!finite(current))return null;if(!finite(prior))return current as number;if(!finite(current)||currentGames===0)return prior;
  if(tau===0)return current;const priorWeight=tau/(tau+currentGames);return priorWeight*prior+(1-priorWeight)*current;}
function nonlinear(value:number,threshold:number,factor:number){const magnitude=Math.abs(value);return magnitude<=threshold?value:Math.sign(value)*(threshold+factor*(magnitude-threshold));}

function predictB1(fit:RatingFit|null,g:CollegeResult):number|null{if(!fit||!fit.ids.has(g.homeId)||!fit.ids.has(g.awayId))return null;
  return (g.neutral?0:fit.homeAdvantage)+(fit.strength.get(g.homeId) as number)-(fit.strength.get(g.awayId) as number);}
function predictB2(prior:RatingFit|null,current:RatingFit|null,g:CollegeResult,parameters:B2Config){
  const priorHasTeams=Boolean(prior?.ids.has(g.homeId)&&prior.ids.has(g.awayId)),currentHasTeams=Boolean(current?.ids.has(g.homeId)&&current.ids.has(g.awayId));
  if(!priorHasTeams&&!currentHasTeams)return null;const hg=current?.gamesByTeam.get(g.homeId)??0,ag=current?.gamesByTeam.get(g.awayId)??0,tau=parameters.transitionGames;
  const ho=blended(prior?.offense.get(g.homeId),current?.offense.get(g.homeId),hg,tau),hd=blended(prior?.defense.get(g.homeId),current?.defense.get(g.homeId),hg,tau),
    ao=blended(prior?.offense.get(g.awayId),current?.offense.get(g.awayId),ag,tau),ad=blended(prior?.defense.get(g.awayId),current?.defense.get(g.awayId),ag,tau);
  if([ho,hd,ao,ad].some(v=>v===null))return null;const leagueGames=current?current.gamesByTeam.size?Math.max(0,[...current.gamesByTeam.values()].reduce((a,b)=>a+b,0)/current.gamesByTeam.size):0:0,
    priorWeight=prior?tau===0?0:tau/(tau+leagueGames):0,base=priorWeight*(prior?.base??0)+(1-priorWeight)*(current?.base??prior?.base??0),hfa=priorWeight*(prior?.homeAdvantage??0)+(1-priorWeight)*(current?.homeAdvantage??prior?.homeAdvantage??0);
  const homeScore=base+(ho as number)+(ad as number)+(g.neutral?0:hfa/2),awayScore=base+(ao as number)+(hd as number)-(g.neutral?0:hfa/2);return homeScore-awayScore;
}

export function modelBMetrics(predictions:ModelBPrediction[]):ModelBMetrics{const projected=predictions.filter(p=>p.status==='PROJECTED'&&finite(p.modelHomeMargin)),errors=projected.map(p=>p.actualHomeMargin-(p.modelHomeMargin as number));return {eligible:projected.length,unavailable:predictions.length-projected.length,coverage:predictions.length?round(projected.length/predictions.length):0,
  bias:round(errors.length?errors.reduce((a,b)=>a+b,0)/errors.length:null),mae:round(errors.length?errors.reduce((a,b)=>a+Math.abs(b),0)/errors.length:null),rmse:round(errors.length?Math.sqrt(errors.reduce((a,b)=>a+b*b,0)/errors.length):null)};}

export function evaluateModelBGrid(allGames:CollegeResult[],season:number,grid:ModelBGrid,options:{forceNeutral?:boolean;noPrior?:boolean;includeRatings?:boolean}={}):ModelBCandidateResult[]{
  const targets=allGames.filter(g=>g.season===season).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||a.id.localeCompare(b.id)),specs=candidateSpecs(grid),predictions=new Map(specs.map(s=>[modelBCandidateName(s),[] as ModelBPrediction[]])),fitSnapshots=new Map(specs.map(s=>[modelBCandidateName(s),[] as ModelBFitSnapshot[]]));
  const days=[...new Set(targets.map(g=>g.date.slice(0,10)))];
  for(const day of days){const asOf=Date.parse(`${day}T00:00:00Z`),dayGames=targets.filter(g=>g.date.startsWith(day)),history=allGames.filter(g=>Date.parse(g.date)+12*3600_000<asOf),priorGames=history.filter(g=>g.season===season-1),currentGames=history.filter(g=>g.season===season),
      priorCounts=counts(priorGames),currentCounts=counts(currentGames),b1Fits=new Map<string,RatingFit|null>(),scoreFits=new Map<number,{prior:RatingFit|null;current:RatingFit|null}>();
    for(const spec of specs)if(spec.architecture==='B1_OPPONENT_ADJUSTED_MARGIN'){const key=stableStringify(spec.parameters);if(!b1Fits.has(key))b1Fits.set(key,fitMargin(allGames,asOf,season,spec.parameters));}
    for(const ridge of [...new Set(specs.filter(s=>s.architecture!=='B1_OPPONENT_ADJUSTED_MARGIN').map(s=>(s.parameters as B2Config).ridge))])scoreFits.set(ridge,{prior:options.noPrior?null:fitScore(priorGames,ridge),current:fitScore(currentGames,ridge)});
    if(options.includeRatings)for(const spec of specs){const name=modelBCandidateName(spec);if(spec.architecture==='B1_OPPONENT_ADJUSTED_MARGIN')fitSnapshots.get(name)!.push({asOf:new Date(asOf).toISOString(),candidateName:name,fits:{margin:serializeFit(b1Fits.get(stableStringify(spec.parameters))??null)}});
      else{const fits=scoreFits.get(spec.parameters.ridge)!;fitSnapshots.get(name)!.push({asOf:new Date(asOf).toISOString(),candidateName:name,fits:{prior:serializeFit(fits.prior),current:serializeFit(fits.current)}});}}
    for(const original of dayGames){const g=options.forceNeutral?{...original,neutral:true}:original;for(const spec of specs){let margin:null|number=null;
        if(spec.architecture==='B1_OPPONENT_ADJUSTED_MARGIN')margin=predictB1(b1Fits.get(stableStringify(spec.parameters))??null,g);
        else{const fits=scoreFits.get(spec.parameters.ridge)!;margin=predictB2(fits.prior,fits.current,g,options.noPrior?{...spec.parameters,transitionGames:0}:spec.parameters);if(margin!==null&&spec.architecture==='B3_NONLINEAR_MISMATCH')margin=nonlinear(margin,spec.parameters.mismatchThreshold,spec.parameters.beyondThresholdFactor);}
        predictions.get(modelBCandidateName(spec))!.push({gameId:original.id,date:original.date,season,architecture:spec.architecture,candidateName:modelBCandidateName(spec),modelHomeMargin:margin,actualHomeMargin:original.homeScore-original.awayScore,status:margin===null?'MODEL_UNAVAILABLE':'PROJECTED',
          reason:margin===null?'Required prior/current opponent-adjusted team identity was unavailable.':null,features:{priorHomeGames:priorCounts.get(original.homeId)??0,priorAwayGames:priorCounts.get(original.awayId)??0,currentHomeGames:currentCounts.get(original.homeId)??0,currentAwayGames:currentCounts.get(original.awayId)??0,neutral:original.neutral,independentMismatchMagnitude:margin===null?null:Math.abs(margin)}});}}
  }
  return specs.map(candidate=>{const name=modelBCandidateName(candidate),rows=predictions.get(name)!;return {candidate,candidateName:name,metrics:modelBMetrics(rows),predictions:rows,fitSnapshots:fitSnapshots.get(name)!};});
}

export function selectModelBCandidate(results:ModelBCandidateResult[]){if(!results.length)throw Error('No Model B candidates.');return [...results].sort((a,b)=>(a.metrics.rmse??Infinity)-(b.metrics.rmse??Infinity)||(a.metrics.mae??Infinity)-(b.metrics.mae??Infinity)||b.metrics.coverage-a.metrics.coverage||a.candidateName.localeCompare(b.candidateName))[0];}

export function gamesPlayedPriorWeight(transitionGames:number,gamesPlayed:number){if(transitionGames<0||gamesPlayed<0)throw Error('Invalid transition inputs.');return transitionGames===0?(gamesPlayed===0?0:0):transitionGames/(transitionGames+gamesPlayed);}
export function fbsFcsResearchDisposition(validatedMethodology:boolean):'PROJECT'|'MODEL_UNAVAILABLE'{return validatedMethodology?'PROJECT':'MODEL_UNAVAILABLE';}
