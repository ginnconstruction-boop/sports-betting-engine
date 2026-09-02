import * as fs from 'fs';
import * as path from 'path';
const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../snapshots/college-model-v1/odds-audit-report.json'),'utf8'));
const rows=source.rows.filter((r:any)=>['WIN','LOSS','PUSH'].includes(r.result));
const meanForecastProbability=rows.reduce((s:number,r:any)=>s+r.assessment.probability,0)/rows.length;
const winRate=rows.filter((r:any)=>r.result==='WIN').length/rows.length;
const brier=rows.reduce((s:number,r:any)=>s+(r.assessment.probability-(r.result==='WIN'?1:0))**2,0)/rows.length;
const calibrationBins=[.5,.6,.7,.8,.9].map(from=>{const bin=rows.filter((r:any)=>r.assessment.probability>=from&&r.assessment.probability<from+.1);
  return{from,to:from+.1,sample:bin.length,wins:bin.filter((r:any)=>r.result==='WIN').length,
    meanProbability:bin.length?bin.reduce((s:number,r:any)=>s+r.assessment.probability,0)/bin.length:null};});
let equity=0,peak=0,maxDrawdown=0;for(const r of rows){equity+=r.profitUnits;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity);}
const details={version:'college-score-ridge-v1',generatedAt:new Date().toISOString(),sample:rows.length,meanForecastProbability,winRate,brier,
  constant50PercentBrier:.25,calibrationBins,maxDrawdown,calibrationApproved:false,moneyBettingApproved:false,
  note:'Held-out historical probabilities are overconfident and are not calibrated win chances. Positive sample ROI does not override this failure. Paper observation only; no real-money or staking recommendation. No formula or selection threshold was retuned after inspecting these results.'};
fs.writeFileSync(path.resolve(__dirname,'../data/college-score-audit-details.json'),JSON.stringify(details,null,2),{flag:'wx'});
console.log(JSON.stringify(details,null,2));
