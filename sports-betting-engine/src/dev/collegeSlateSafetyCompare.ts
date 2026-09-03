// Replay safety policy on an archived pregame scan. Never saves forward picks or buys odds.
import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
import {loadCollegeModelBundle} from '../services/collegePredictions';
import {loadCollegeCalibration} from '../services/collegeCalibration';
import {selectCollegeQuotes} from '../services/collegeModelQuotes';
import {flattenNflQuotes} from '../services/nflMarketBoard';
import {matchCollegeEvent} from '../services/collegeResearch';
import {assessCollegeSafety} from '../services/collegeSafety';
const file=process.argv[2];if(!file)throw Error('Supply an archived college-day scan JSON path; no current scan is triggered.');
const bytes=fs.readFileSync(path.resolve(file),'utf8'),scan=JSON.parse(bytes),b=loadCollegeModelBundle().payload,calibrator=loadCollegeCalibration()?.artifact;
const rows=(scan.projections??[]).map((r:any)=>{
  const p=r.projection,now=Date.parse(p.asOf),raw=scan.sources.odds.find((e:any)=>e.id===r.event.id);
  const identity=matchCollegeEvent(r.event,scan.sources.schedule,'archived-scan-schedule',p.asOf);
  const quotes=flattenNflQuotes(raw,['spreads','totals'],now),candidate=selectCollegeQuotes(r.event,quotes,p,b,now,{spreads:true,totals:false}).selected[0];
  const s=assessCollegeSafety({event:r.event,identity,projection:p,quotes,candidate,rosters:[],now,spreadHoldoutPassed:true,calibrator});
  return {game:r.event.awayTeam+' @ '+r.event.homeTeam,oldCandidate:candidate?{side:candidate.quote.side,line:candidate.quote.line,price:candidate.quote.price}:null,
    oldRawHomeMargin:p.homeMargin,newRawHomeMargin:p.homeMargin,classification:s.classification,disagreement:s.marketDisagreementPoints,
    matchup:s.mismatch,checks:s.checks,reasons:s.reasons,qualified:s.qualified,trackable:s.trackable};
});
const report={sourceHash:createHash('sha256').update(bytes).digest('hex'),date:scan.date,originalScannedAt:scan.scannedAt,
  mode:'reconstructed safety-policy comparison on identical archived inputs; not new forward picks',oldCandidates:rows.filter((r:any)=>r.oldCandidate).length,
  qualifiedNow:rows.filter((r:any)=>r.qualified).length,monitorOnly:rows.filter((r:any)=>r.classification==='PAPER MONITOR').length,
  warnings:rows.filter((r:any)=>r.classification==='MODEL WARNING').length,unlisted:scan.unlisted,rows};
const output=path.resolve(__dirname,'../../snapshots/college-safety-v2','slate-'+scan.date+'-'+report.sourceHash.slice(0,12)+'.json');
fs.mkdirSync(path.dirname(output),{recursive:true});
if(!fs.existsSync(output))fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({output,...report},null,2));
