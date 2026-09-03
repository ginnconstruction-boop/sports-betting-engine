import {randomUUID} from 'crypto';
import {collegeDate} from './collegeDayScan';
import {MarketBoardError} from './nflMarketBoard';
import type {NflPaperPick} from './nflPaper';

interface Dependencies {
  scan:(date:string,trackPaper:boolean)=>Promise<any>;
  read:()=>NflPaperPick[];
  gradeEvents:(ids:string[])=>Promise<{checked:number;sourceFailures:number}>;
  now:()=>number;
}
export interface CollegeDailyJob {
  id:string;date:string;startedAt:string;finishedAt?:string;
  status:'running'|'complete'|'partial'|'failed';stage:'scanning'|'grading'|'finished';
  scan:any|null;warnings:string[];
  grading:{gamesPlanned:number;gamesChecked:number;picksChecked:number;sourceFailures:number;pending:number;review:number};
}
/** One explicit click starts finite work, not a scheduler. The job survives a
 * disconnected browser, but not a server restart. Saved picks/results are durable.
 * Grade each eligible game at most once per run, including unresolved games. */
export class CollegeDailyRun {
  private jobs=new Map<string,CollegeDailyJob>();
  private active:CollegeDailyJob|null=null;
  constructor(private deps:Dependencies){}
  start(){
    if(this.active)return this.get(this.active.id);
    for(const id of [...this.jobs.keys()].slice(0,Math.max(0,this.jobs.size-9)))this.jobs.delete(id);
    const job:CollegeDailyJob={id:randomUUID(),date:collegeDate(this.deps.now()),startedAt:new Date(this.deps.now()).toISOString(),
      status:'running',stage:'scanning',scan:null,warnings:[],grading:{gamesPlanned:0,gamesChecked:0,picksChecked:0,sourceFailures:0,pending:0,review:0}};
    this.jobs.set(job.id,job);this.active=job;
    void this.execute(job).catch(()=>{job.status='failed';job.warnings.push('Daily run interrupted. Saved picks/results remain intact; inspect the record before retrying.');})
      .finally(()=>{job.stage='finished';job.finishedAt=new Date(this.deps.now()).toISOString();this.active=null;});
    return this.get(job.id);
  }
  get(id:string){
    const job=this.jobs.get(id);if(!job)throw new MarketBoardError('Run not found or server restarted. Saved paper records remain intact. Click College football to start a fresh run.',404);
    return structuredClone(job);
  }
  private async execute(job:CollegeDailyJob){
    // Scan first so a large old grading backlog cannot make fresh pregame odds
    // expire. The date is chosen by the server, never by a stale browser picker.
    try{
      job.scan=await this.deps.scan(job.date,true);
      if(job.scan.warnings?.length)job.warnings.push(...job.scan.warnings);
      if(job.scan.coverage==='incomplete'||job.scan.oddsStatus==='unavailable'
        ||['model_data_unavailable','blocked_model_validation'].includes(job.scan.recommendationStatus))
        job.warnings.push('Today’s scan has incomplete data or model checks. Review coverage; no missing recommendation was assumed.');
    }catch{job.warnings.push('Today’s scan could not finish. Grading existing paper picks will still be attempted. No automatic odds retry.');}
    job.stage='grading';
    try{
      const eligible=this.deps.read().filter(p=>p.event.sportKey==='americanfootball_ncaaf'&&['PENDING','REVIEW'].includes(p.result)
        &&Date.parse(p.event.commenceTime)+4*3600_000<this.deps.now());
      const ids=[...new Set(eligible.map(p=>p.espnEventId))];job.grading.gamesPlanned=ids.length;
      for(let i=0;i<ids.length;i+=10){
        const batch=ids.slice(i,i+10),r=await this.deps.gradeEvents(batch);
        job.grading.gamesChecked+=batch.length;job.grading.picksChecked+=r.checked;job.grading.sourceFailures+=r.sourceFailures;
      }
      const picks=this.deps.read();job.grading.pending=picks.filter(p=>p.result==='PENDING').length;job.grading.review=picks.filter(p=>p.result==='REVIEW').length;
      if(job.grading.sourceFailures)job.warnings.push('Some result sources were unavailable. Those selections remain unresolved, never assumed losses.');
    }catch{job.warnings.push('Grading could not finish. Previously saved picks/results were preserved; inspect the paper record.');}
    job.status=job.warnings.length?'partial':'complete';
  }
}
