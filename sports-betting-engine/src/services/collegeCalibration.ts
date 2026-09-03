import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
export interface CalibrationRow {id:string;predictedAt:string;kickoff:string;resolvedAt:string;probability:number;outcome:0|1;}
export type Calibrator={method:'platt';intercept:number;slope:number}|{method:'isotonic';knots:Array<{x:number;y:number}>};
export interface CalibrationArtifact {version:string;trainedThrough:string;trainingIds:string[];model:Calibrator;approved:false;note:string;}
const clamp=(p:number)=>Math.max(1e-6,Math.min(1-1e-6,p));
const logit=(p:number)=>Math.log(clamp(p)/(1-clamp(p)));
const sigmoid=(x:number)=>1/(1+Math.exp(-Math.max(-40,Math.min(40,x))));
function logisticFit(values:Array<{p:number;y:number}>){
  if(values.length<2||!values.some(r=>r.y===0)||!values.some(r=>r.y===1))return null;
  let a=0,b=1;
  const loss=(intercept:number,slope:number)=>values.reduce((sum,r)=>{const z=intercept+slope*logit(r.p);
    return sum+Math.max(z,0)+Math.log1p(Math.exp(-Math.abs(z)))-r.y*z;},.5e-4*slope*slope);
  // Deterministic Newton iterations, tiny ridge for numerical conditioning only.
  for(let iteration=0;iteration<100;iteration++){
    let ga=0,gb=-1e-4*b,haa=1e-8,hab=0,hbb=1e-4;
    for(const r of values){const x=logit(r.p),p=sigmoid(a+b*x),w=p*(1-p);ga+=r.y-p;gb+=(r.y-p)*x;haa+=w;hab+=w*x;hbb+=w*x*x;}
    const det=haa*hbb-hab*hab;if(det<=1e-12)break;
    let da=(ga*hbb-gb*hab)/det,db=(gb*haa-ga*hab)/det;
    let scale=1;const before=loss(a,b);
    while(scale>1e-8&&loss(a+da*scale,b+db*scale)>before)scale/=2;
    da*=scale;db*=scale;a+=da;b+=db;
    if(Math.max(Math.abs(da),Math.abs(db))<1e-8)break;
  }
  return {intercept:a,slope:b};
}
export function chronologicalCalibrationRows(rows:CalibrationRow[],cutoff:number){
  if(!Number.isFinite(cutoff))throw Error('Invalid calibration cutoff');
  const seen=new Set<string>();
  return rows.filter(r=>{
    if(seen.has(r.id))throw Error('Duplicate calibration game');seen.add(r.id);
    const [at,kickoff,resolved]=[r.predictedAt,r.kickoff,r.resolvedAt].map(Date.parse);
    if(![at,kickoff,resolved,r.probability].every(Number.isFinite)||at>=kickoff||resolved<kickoff||r.probability<0||r.probability>1||![0,1].includes(r.outcome))
      throw Error('Invalid calibration observation');
    return resolved<cutoff;
  });
}
export function fitCollegeCalibrator(rows:CalibrationRow[],cutoff:number,method:'platt'|'isotonic'):CalibrationArtifact{
  const train=chronologicalCalibrationRows(rows,cutoff);if(train.length<20)throw Error('At least 20 prior resolved games required for a research fit');
  let model:Calibrator;
  if(method==='platt'){
    const fit=logisticFit(train.map(r=>({p:r.probability,y:r.outcome})));if(!fit)throw Error('Calibration needs both outcomes');model={method,...fit};
  }else{
    const groups=new Map<number,{x:number;sum:number;n:number}>();
    for(const r of train){const g=groups.get(r.probability)??{x:r.probability,sum:0,n:0};g.sum+=r.outcome;g.n++;groups.set(g.x,g);}
    const blocks:Array<{xs:number[];sum:number;n:number}>=[];
    for(const g of [...groups.values()].sort((a,b)=>a.x-b.x)){
      blocks.push({xs:[g.x],sum:g.sum,n:g.n});
      while(blocks.length>1){const a=blocks.at(-2),b=blocks.at(-1);if(a.sum/a.n<=b.sum/b.n)break;
        blocks.splice(-2,2,{xs:[...a.xs,...b.xs],sum:a.sum+b.sum,n:a.n+b.n});}
    }
    model={method,knots:blocks.flatMap(b=>b.xs.map(x=>({x,y:b.sum/b.n})))};
  }
  return {version:'college-calibration-v2-'+method,trainedThrough:new Date(cutoff).toISOString(),trainingIds:train.map(r=>r.id),model,approved:false,
    note:'Research calibrator; previously inspected historical outcomes, limited sample, no prospective approval. No Kelly or stake sizing.'};
}
export function calibratedProbability(artifact:CalibrationArtifact|undefined,p:number,asOf:number):number|null{
  if(!artifact||!Number.isFinite(p)||p<0||p>1||!Number.isFinite(asOf)||Date.parse(artifact.trainedThrough)>=asOf)return null;
  const m=artifact.model;if(m.method==='platt')return sigmoid(m.intercept+m.slope*logit(p));
  const knots=m.knots;if(!knots.length)return null;
  if(p<=knots[0].x)return knots[0].y;if(p>=knots.at(-1).x)return knots.at(-1).y;
  for(let i=1;i<knots.length;i++)if(p<=knots[i].x){const a=knots[i-1],b=knots[i];return a.y+(b.y-a.y)*(p-a.x)/(b.x-a.x);}
  return null;
}
export function calibrationMetrics(rows:Array<{probability:number;outcome:number}>){
  if(rows.some(r=>!Number.isFinite(r.probability)||r.probability<0||r.probability>1||![0,1].includes(r.outcome)))throw Error('Invalid calibration metric row');
  const n=rows.length,mean=(f:(r:typeof rows[number])=>number)=>n?rows.reduce((s,r)=>s+f(r),0)/n:null;
  const fit=logisticFit(rows.map(r=>({p:r.probability,y:r.outcome})));
  const boundaries=[0,.5,.55,.6,.65,.7,1.000001],labels=['below 50%','50–54%','55–59%','60–64%','65–69%','70%+'];
  return {sample:n,meanProbability:mean(r=>r.probability),observedWinRate:mean(r=>r.outcome),brier:mean(r=>(r.probability-r.outcome)**2),
    constant50Brier:n?.25:null,calibrationIntercept:fit?.intercept??null,calibrationSlope:fit?.slope??null,
    reliability:labels.map((label,i)=>{const b=rows.filter(r=>r.probability>=boundaries[i]&&r.probability<boundaries[i+1]);
      const total=b.reduce((s,r)=>s+(r.probability-r.outcome)**2,0);return {label,count:b.length,
        predictedAverage:b.length?b.reduce((s,r)=>s+r.probability,0)/b.length:null,actualWinRate:b.length?b.reduce((s,r)=>s+r.outcome,0)/b.length:null,
        brier:b.length?total/b.length:null,brierContribution:n?total/n:null};})};
}
export function loadCollegeCalibration(){
  const file=path.resolve(__dirname,'../data/college-calibration-v2.json');if(!fs.existsSync(file))return null;
  const b=JSON.parse(fs.readFileSync(file,'utf8'));
  if(createHash('sha256').update(JSON.stringify(b.payload)).digest('hex')!==b.sha256||b.payload.artifact.approved!==false)
    throw Error('Calibration artifact integrity/approval mismatch');
  return b.payload as {artifact:CalibrationArtifact;evaluation:any};
}
