import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
import {CollegeResult,fitCollegeScores,parseCollegeResults,mergeCollegeResults,COLLEGE_MODEL_VERSION} from './collegeScoreModel';
import {selectCollegeQuotes,COLLEGE_SELECTION_VERSION} from './collegeModelQuotes';
import {NflEvidenceArchive} from './nflEvidence';
import {NflPaperLedger} from './nflPaper';
import {flattenNflQuotes} from './nflMarketBoard';
import {fetchNflJson,nflSeason} from './nflResearch';
import {ESPN_COLLEGE} from './collegeResearch';
import type {RawEvent} from '../types/odds';
import {loadCollegeRosterSnapshots,loadCollegeContextCoefficients} from './collegeContext';
import {assessCollegeSafety,COLLEGE_SAFETY_VERSION} from './collegeSafety';
import {loadCollegeCalibration} from './collegeCalibration';
export const COLLEGE_MODEL_LIMITATIONS='Paper observation only. Missing verified roster/QB/depth inputs reduce confidence; no invented talent points. Raw probabilities are not calibrated. Current roster point adjustments are inactive pending dated data and validation. Totals, Kelly, stake sizing and real-money recommendations disabled.';
export function loadCollegeModelBundle(file=path.resolve(__dirname,'../data/college-score-ridge-v1.json')){
  const bundle=JSON.parse(fs.readFileSync(file,'utf8'));
  if(bundle.schema!==1||createHash('sha256').update(JSON.stringify(bundle.payload)).digest('hex')!==bundle.sha256
    ||bundle.payload.version!==COLLEGE_MODEL_VERSION||bundle.payload.validation.moneyBettingApproved!==false)throw Error('College model bundle integrity check failed');
  for(const [name,key]of [['collegeScoreModel.ts','modelCodeHash'],['collegeModelQuotes.ts','selectionCodeHash']]){
    const code=fs.readFileSync(path.join(__dirname,name),'utf8').replace(/\r\n/g,'\n');
    if(createHash('sha256').update(code).digest('hex')!==bundle.payload[key])throw Error('College model code does not match its frozen historical audit');
  }
  return bundle;
}
export class CollegePredictions {
  private cache:{at:number;season:number;games:CollegeResult[];sources:any[]}|null=null;
  private archive:NflEvidenceArchive;
  constructor(private paper:NflPaperLedger,private root:string,private get=fetchNflJson,private now=()=>Date.now(),private load=loadCollegeModelBundle){
    this.archive=new NflEvidenceArchive(path.join(root,'college_forecast_evidence'));
  }
  readiness(){const b=this.load(),calibration=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/college-score-audit-details.json'),'utf8'));
    return{version:b.payload.version,safetyVersion:COLLEGE_SAFETY_VERSION,bundleHash:b.sha256,validation:b.payload.validation,oddsAudit:b.payload.oddsAudit,calibration,
      calibrationResearch:loadCollegeCalibration()?.evaluation??null,limitations:COLLEGE_MODEL_LIMITATIONS};}
  private async current(season:number){
    if(this.cache&&this.cache.season===season&&this.now()-this.cache.at<3600_000)return this.cache;
    const groups:CollegeResult[][]=[],sources:any[]=[],today=new Date(this.now()).toISOString().slice(0,10).replace(/-/g,'');
    const month=new Date(this.now()).getUTCMonth()+1;
    if(month<8)throw Error('College model needs a new-season data review before use.');
    for(let m=8;m<=month;m++){
      const start=`${season}${String(m).padStart(2,'0')}01`,end=m===month?today:`${season}${String(m).padStart(2,'0')}${new Date(Date.UTC(season,m,0)).getUTCDate()}`;
      await Promise.all([80,81].map(async group=>{
        const source=`${ESPN_COLLEGE}/scoreboard?dates=${start}-${end}&groups=${group}&limit=1000`;
        const data=await this.get(source),parsed=parseCollegeResults(data,season);
        const archived=this.archive.record({kind:'college_current_scores_source_v1',source,fetchedAt:new Date(this.now()).toISOString(),data});
        groups.push(parsed.games);sources.push({source,hash:archived.hash,events:data.events.length,parsed:parsed.games.length,skipped:parsed.skipped});
      }));
    }
    this.cache={at:this.now(),season,games:mergeCollegeResults(groups),sources:sources.sort((a,b)=>a.source.localeCompare(b.source))};return this.cache;
  }
  async scan(rows:any[],raw:RawEvent[],trackPaper:boolean){
    const recommendations:any[]=[],monitors:any[]=[],projections:any[]=[],warnings:string[]=[];
    const readiness=this.readiness(),bundle=this.load(),b=bundle.payload;
    const eligible=rows.filter(r=>r.identity&&r.status!=='ambiguous_provider_game'&&Date.parse(r.event.commenceTime)>this.now());
    if(!eligible.length)return{recommendations,monitors,projections,modelReadiness:readiness,recommendationStatus:'no_verified_upcoming_games',warnings};
    let rosters:ReturnType<typeof loadCollegeRosterSnapshots>=[];
    try{rosters=loadCollegeRosterSnapshots(this.root);}catch{warnings.push('Roster-context store invalid; missing-data penalties apply.');}
    const calibrator=loadCollegeCalibration()?.artifact;
    const contextCoefficients=loadCollegeContextCoefficients();
    let all:CollegeResult[],model:ReturnType<typeof fitCollegeScores>,asOf:number,inputsHash:string;
    try{
      if(b.historySeason!==nflSeason(this.now())-1)throw Error('Prior-season model bundle requires an update.');
      const current=await this.current(nflSeason(this.now()));all=mergeCollegeResults([b.history,current.games]);asOf=this.now();
      model=fitCollegeScores(all,asOf,b.config);
      inputsHash=this.archive.record({kind:'college_model_inputs_v1',asOf:new Date(asOf).toISOString(),history:all,config:b.config,
        marginResiduals:b.marginResiduals,totalResiduals:b.totalResiduals,bundleHash:bundle.sha256,validation:b.validation,currentSources:current.sources}).hash;
    }catch{
      warnings.push('College model history or evidence storage is unavailable. No model recommendations issued; do not substitute market-price comparisons.');
      return{recommendations,projections,modelReadiness:readiness,recommendationStatus:'model_data_unavailable',warnings};
    }
    for(const row of eligible){
      const p=model.predict(row.identity.homeTeamId,row.identity.awayTeamId,row.identity.neutralSite);
      if(!p){row.modelReason='No model selection: fewer than six historical games for a team, or venue unknown.';continue;}
      const matches=raw.filter(e=>e.id===row.event.id),event=matches[0];
      const exact=matches.length===1&&event.sport_key===row.event.sportKey&&event.home_team===row.event.homeTeam&&event.away_team===row.event.awayTeam
        &&Date.parse(event.commence_time)===Date.parse(row.event.commenceTime);
      const quotes=exact?flattenNflQuotes(event,['spreads','totals'],this.now()):[];
      const {selected,assessed}=selectCollegeQuotes(row.event,quotes,p,b,asOf,{spreads:b.validation.paperApproved.spreads,totals:false});
      const candidate=selected.find(c=>c.quote.market==='spreads')??assessed.filter(c=>c.quote.market==='spreads').sort((a,b)=>b.assessment.pointGap-a.assessment.pointGap)[0];
      const safety=assessCollegeSafety({event:row.event,identity:row.identity,projection:p,quotes,candidate,rosters,now:asOf,
        spreadHoldoutPassed:b.validation.paperApproved.spreads,calibrator,contextCoefficients});
      const item={event:row.event,projection:p,safety,market:candidate?.quote,selected:trackPaper?undefined:safety.trackable?selected:[],
        reason:safety.classification+': '+safety.reasons.join(' '),quotesAssessed:assessed.length};
      row.modelReason=item.reason;projections.push(item);
      if(!trackPaper)continue;
      if(Date.parse(row.event.commenceTime)<=this.now()){row.modelReason='Kickoff passed before archival; no new forward paper prediction.';continue;}
      // Archive warnings/passes too; never quietly erase unfavorable forward evidence.
      try{this.archive.record({kind:'college_diagnostic_v2',createdAt:new Date(this.now()).toISOString(),inputEvidenceHash:inputsHash,
        event:row.event,identity:row.identity,projection:p,safety,rawOdds:event??null,rosters,calibrator,contextCoefficients});}
      catch{warnings.push('Diagnostic evidence could not be archived. No paper save for this game.');continue;}
      for(const candidate of safety.trackable?selected:[]){
        try{
          const evidenceHash=this.archive.record({kind:'college_forecast_v1',event:row.event,identity:row.identity,projection:p,
            ...candidate,safety,rosters,calibrator,contextCoefficients,inputEvidenceHash:inputsHash,selectionVersion:COLLEGE_SELECTION_VERSION,rawOdds:event}).hash;
          const result=this.paper.saveCollegeModel(row.event,candidate.quote,row.identity,{projection:p,assessment:candidate.assessment,
            inputEvidenceHash:inputsHash,forecastEvidenceHash:evidenceHash,bundleHash:bundle.sha256,selectionVersion:COLLEGE_SELECTION_VERSION,safety},b.validation);
          (safety.qualified?recommendations:monitors).push({...result,label:safety.classification+' — not a real-money betting recommendation'});
        }catch{row.modelReason='Eligible selection could not be safely recorded. No recommendation issued for that selection.';warnings.push(`${row.event.awayTeam} @ ${row.event.homeTeam}: paper recommendation logging failed.`);}
      }
      try{if(quotes.length)this.paper.observe(row.event.id,quotes);}catch{warnings.push('Latest pregame quote observations could not be saved. Original picks remain unchanged.');}
    }
    const huge=projections.filter(p=>p.safety.mismatch.hugeFcsUnderdog);
    if(huge.length>=3)warnings.push(`REGRESSION-TO-MEAN WARNING: ${huge.length} huge FCS underdogs favored by the raw model. No automatic confidence increase; depth/talent validation required.`);
    return{recommendations,monitors,projections,modelReadiness:readiness,recommendationStatus:trackPaper?'experimental_paper':'preview_only',warnings};
  }
}
