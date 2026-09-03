import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
import {evaluateCollegeSeason,mergeCollegeResults} from '../services/collegeScoreModel';
import {CalibrationRow,fitCollegeCalibrator,calibratedProbability,calibrationMetrics} from '../services/collegeCalibration';
import {collegeDivision} from '../services/collegeContext';
import {assessCollegeSafety} from '../services/collegeSafety';
import {flattenNflQuotes} from '../services/nflMarketBoard';
const root=path.resolve(__dirname,'../../snapshots/college-model-v1');
const read=(name:string)=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
function spreadBucket(line:number){const n=Math.abs(line);return n<=3?'0–3':n<=7?'3.5–7':n<=14?'7.5–14':n<=21?'14.5–21':n<=30?'21.5–30':n<=40?'30.5–40':'40+';}
const weekBucket=(n:number)=>!Number.isInteger(n)?'unknown':n<=3?'1–3':n<=6?'4–6':'7+';
function ats(rows:any[]){const settled=rows.filter(r=>['WIN','LOSS','PUSH'].includes(r.result)),profit=settled.reduce((s,r)=>s+r.profitUnits,0);
  return {sample:settled.length,wins:settled.filter(r=>r.result==='WIN').length,losses:settled.filter(r=>r.result==='LOSS').length,
    pushes:settled.filter(r=>r.result==='PUSH').length,units:profit,roi:settled.length?profit/settled.length:null};}
function grouped(rows:any[],key:(r:any)=>string,metric:(r:any[])=>any){const groups=new Map<string,any[]>();for(const r of rows){const k=key(r);groups.set(k,[...(groups.get(k)??[]),r]);}
  return Object.fromEntries([...groups].map(([k,v])=>[k,metric(v)]));}
async function main(){
  const protocol=fs.readFileSync(path.resolve(__dirname,'../../research/COLLEGE_CONTEXT_PROTOCOL_2026_09_02.md'),'utf8');
  const original=read('holdout-report.json'),lock=read('configuration-lock.json'),oldOdds=read('odds-audit-report.json');
  const beforeHashes=Object.fromEntries(['holdout-report.json','odds-audit-report.json','configuration-lock.json'].map(n=>[n,hash(fs.readFileSync(path.join(root,n),'utf8'))]));
  const all=mergeCollegeResults([read('development-data.json').games,read('holdout-data.json').games]);
  console.log('Replaying unchanged chronological 2025 scores; no network or paid odds requests.');
  const replay=evaluateCollegeSeason(all,2025,lock.config);
  if(hash(replay.rows)!==hash(original.rows))throw Error('Frozen chronological replay changed');
  const schedule=new Map<string,any>();for(const name of fs.readdirSync(path.join(root,'sources')).filter(n=>n.startsWith('2025-')))
    for(const event of read('sources/'+name).data.events)schedule.set(String(event.id),event);
  function context(id:string){const g=schedule.get(id),h=g?.competitions?.[0]?.competitors?.find((t:any)=>t.homeAway==='home')?.team,
    a=g?.competitions?.[0]?.competitors?.find((t:any)=>t.homeAway==='away')?.team,hd=collegeDivision(2025,String(h?.conferenceId)),ad=collegeDivision(2025,String(a?.conferenceId));
    return {week:g?.week?.number,homeConferenceId:String(h?.conferenceId??''),awayConferenceId:String(a?.conferenceId??''),
      matchup:hd==='UNKNOWN'||ad==='UNKNOWN'?'UNKNOWN':hd===ad?hd+' vs '+ad:'FBS vs FCS'};}
  const frozen=read('registered-protocol.json').protocol.oddsAudit.dates.map((date:string)=>read('frozen/'+date+'.json'));
  const forecastById=new Map(frozen.flatMap((d:any)=>d.rows.filter((r:any)=>r.projection).map((r:any)=>[r.event.id,{...r,asOf:d.asOf}]))) as Map<string,any>;
  const auditRows=oldOdds.rows.map((r:any)=>({...r,context:context(forecastById.get(r.event.id)?.identity.espnEventId)}));
  const observations:CalibrationRow[]=auditRows.filter((r:any)=>['WIN','LOSS'].includes(r.result)).map((r:any)=>({id:r.event.id,predictedAt:forecastById.get(r.event.id).asOf,
    kickoff:r.event.commenceTime,resolvedAt:new Date(Date.parse(r.event.commenceTime)+24*3600_000).toISOString(),
    probability:r.assessment.probability/(1-r.assessment.pushProbability),outcome:r.result==='WIN'?1:0}));
  const cutoff=Date.parse('2025-10-25T00:00:00Z'),test=observations.filter(r=>Date.parse(r.predictedAt)>=cutoff);
  const artifacts={platt:fitCollegeCalibrator(observations,cutoff,'platt'),isotonic:fitCollegeCalibrator(observations,cutoff,'isotonic')};
  const methods=Object.fromEntries(Object.entries(artifacts).map(([method,a])=>[method,{trainingGames:a.trainingIds.length,
    test:calibrationMetrics(test.map(r=>({probability:calibratedProbability(a,r.probability,Date.parse(r.predictedAt)),outcome:r.outcome}))),model:a.model}]));
  const rolling:Record<string,any>={};for(const method of ['platt','isotonic']as const){const rows=[];
    for(const r of observations){let a;try{a=fitCollegeCalibrator(observations,Date.parse(r.predictedAt),method);}catch{continue;}
      if(a.trainingIds.includes(r.id))throw Error('Calibration leakage');rows.push({probability:calibratedProbability(a,r.probability,Date.parse(r.predictedAt)+1),outcome:r.outcome});}
    rolling[method]=calibrationMetrics(rows);}
  const classifications:any[]=[],fcs:any[]=[];
  for(const day of frozen){const raw=read('odds/'+day.date+'.json').data.data;
    for(const r of day.rows.filter((r:any)=>r.projection)){
      const c=context(r.identity.espnEventId),quotes=flattenNflQuotes(raw.find((e:any)=>e.id===r.event.id),['spreads','totals'],Date.parse(day.asOf));
      const candidate=r.selected.find((s:any)=>s.quote.market==='spreads');
      const s=assessCollegeSafety({event:r.event,identity:{...r.identity,...c},projection:r.projection,quotes,candidate,rosters:[],now:Date.parse(day.asOf),
        spreadHoldoutPassed:true,calibrator:Date.parse(day.asOf)>cutoff?artifacts.platt:undefined});
      classifications.push({id:r.event.id,game:r.event.awayTeam+' @ '+r.event.homeTeam,classification:s.classification,disagreement:s.marketDisagreementPoints,
        mismatch:s.mismatch,context:c,quote:candidate?.quote,rawMargin:r.projection.homeMargin});
      if(c.matchup==='FBS vs FCS'&&candidate){const outcome=auditRows.find((o:any)=>o.event.id===r.event.id);if(outcome)fcs.push({...outcome,
        hugeFcsUnderdog:s.mismatch.hugeFcsUnderdog,marginError:original.rows.find((o:any)=>o.id===r.identity.espnEventId)?.marginError});}
    }
  }
  const scoreMetric=(rows:any[])=>({sample:rows.length,spreadRmse:rows.length?Math.sqrt(rows.reduce((s,r)=>s+r.marginError**2,0)/rows.length):null,
    baselineRmse:rows.length?Math.sqrt(rows.reduce((s,r)=>s+r.naiveMarginError**2,0)/rows.length):null,
    signedMarginError:rows.length?rows.reduce((s,r)=>s+r.marginError,0)/rows.length:null});
  const evaluation={protocolHash:hash(protocol),trainingCutoff:new Date(cutoff).toISOString(),methods,rolling,
    rawSameTest:calibrationMetrics(test.map(r=>({probability:r.probability,outcome:r.outcome}))),
    fullRaw:calibrationMetrics(observations.map(r=>({probability:r.probability,outcome:r.outcome}))),
    approved:false,note:'Already-inspected 2025 chronological research, not a new untouched holdout. Both calibrators evaluated; neither promoted. Prospective test required.'};
  const report={protocolHash:hash(protocol),generatedAt:new Date().toISOString(),baseModelUnchanged:true,replayHash:hash(replay.rows),
    before:{spreadRmse:original.modelMargin.rmse,baselineRmse:original.naiveMargin.rmse,totalRmse:original.modelTotal.rmse,totalBaselineRmse:original.naiveTotal.rmse,ats:ats(auditRows)},
    after:{spreadRmse:replay.modelMargin.rmse,baselineRmse:replay.naiveMargin.rmse,totalRmse:replay.modelTotal.rmse,
      qualifiedPaper:ats([]),note:'Missing dated roster/QB data: no qualified v2 bets. Raw forecast RMSE unchanged. Monitors/warnings are not silently counted as BET/LEAN.'},
    calibration:evaluation,scoreByMatchup:grouped(replay.rows,r=>context(r.id).matchup,scoreMetric),scoreByWeek:grouped(replay.rows,r=>weekBucket(context(r.id).week),scoreMetric),
    atsBySpread:grouped(auditRows,r=>spreadBucket(r.quote.line),ats),atsByMatchup:grouped(auditRows,r=>r.context.matchup,ats),atsByWeek:grouped(auditRows,r=>weekBucket(r.context.week),ats),
    classifications:grouped(classifications,r=>r.classification,r=>({games:r.length})),fcsAudit:{selected:ats(fcs),hugeUnderdogs:ats(fcs.filter(r=>r.hugeFcsUnderdog)),rows:fcs},
    diagnosticRows:classifications,clv:null,clvReason:'Historical snapshots are morning lines only; no closing snapshots. No fabricated historical CLV.',
    rosterDataAvailable:false,pointAdjustmentsEnabled:false,realMoney:false,kelly:false,totals:false};
  for(const [n,h]of Object.entries(beforeHashes))if(hash(fs.readFileSync(path.join(root,n),'utf8'))!==h)throw Error('Original research altered');
  const output=path.resolve(__dirname,'../../snapshots/college-safety-v2',report.generatedAt.replace(/[:.]/g,'-'));fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
  const payload={artifact:artifacts.platt,evaluation},bundle={payload,sha256:hash(payload)},file=path.resolve(__dirname,'../data/college-calibration-v2.json');
  if(fs.existsSync(file)){if(JSON.stringify(JSON.parse(fs.readFileSync(file,'utf8')))!==JSON.stringify(bundle))throw Error('Calibration bundle changed; version explicitly');}
  else fs.writeFileSync(file,JSON.stringify(bundle,null,2),{flag:'wx'});
  console.log(JSON.stringify({output,before:report.before,after:report.after,calibration:evaluation,classifications:report.classifications,
    fcs:report.fcsAudit.selected,huge:report.fcsAudit.hugeUnderdogs,scoreByMatchup:report.scoreByMatchup,atsBySpread:report.atsBySpread},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
