import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
const root=path.resolve(__dirname,'../../snapshots/college-model-v1');
const read=(n:string)=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8'));
const lock=read('configuration-lock.json'),validation=read('validation-summary.json'),odds=read('odds-audit-report.json');
const history=read('holdout-data.json'),protocol=read('registered-protocol.json');
const wins=odds.summary.wins,n=odds.summary.wins+odds.summary.losses,p=wins/n,z=1.959963984540054,denom=1+z*z/n;
const center=(p+z*z/(2*n))/denom,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denom;
const byDate=odds.summary.dates.map((date:string)=>{const rows=odds.rows.filter((r:any)=>r.date===date);return{date,picks:rows.length,
  wins:rows.filter((r:any)=>r.result==='WIN').length,losses:rows.filter((r:any)=>r.result==='LOSS').length,profitUnits:rows.reduce((n:number,r:any)=>n+(r.profitUnits??0),0)};});
const payload={version:'college-score-ridge-v1',historySeason:2025,packagedAt:new Date().toISOString(),config:lock.config,
  modelCodeHash:lock.modelCodeHash,selectionCodeHash:read('odds-selection-lock.json').codeHash,protocolHash:protocol.hash,
  history:history.games,sourceCoverage:history.coverage,marginResiduals:lock.marginResiduals,totalResiduals:lock.totalResiduals,
  validation,oddsAudit:{...odds.summary,winRate:wins/n,winRate95Wilson:[center-half,center+half],byDate},limitations:protocol.protocol.limitations};
const bundle={schema:1,sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),payload};
const target=path.resolve(__dirname,'../data/college-score-ridge-v1.json');fs.mkdirSync(path.dirname(target),{recursive:true});
fs.writeFileSync(target,JSON.stringify(bundle),{flag:'wx'});
console.log(JSON.stringify({file:'src/data/college-score-ridge-v1.json',bytes:fs.statSync(target).size,hash:bundle.sha256,games:history.games.length,
  winRate95Wilson:payload.oddsAudit.winRate95Wilson,byDate},null,2));
