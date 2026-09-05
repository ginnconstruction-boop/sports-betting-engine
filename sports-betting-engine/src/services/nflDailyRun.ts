import {randomUUID} from 'crypto';
import {collegeDate} from './collegeDayScan';
import {MarketBoardError} from './nflMarketBoard';
import type {NflPaperPick} from './nflPaper';

interface Dependencies {events:()=>Promise<any[]>;preflight:(events:any[])=>Promise<any>;read:()=>NflPaperPick[];gradeEvents:(ids:string[])=>Promise<{checked:number;sourceFailures:number}>;now:()=>number;}
export interface NflDailyJob {id:string;date:string;startedAt:string;finishedAt?:string;status:'running'|'complete'|'partial'|'failed';stage:'discovering'|'context'|'grading'|'finished';
  preflight:any|null;warnings:string[];grading:{gamesPlanned:number;gamesChecked:number;picksChecked:number;sourceFailures:number;pending:number;review:number};}
export class NflDailyRun {
  private jobs=new Map<string,NflDailyJob>();private active:NflDailyJob|null=null;
  constructor(private deps:Dependencies){}
  start(){if(this.active)return this.get(this.active.id);for(const id of [...this.jobs.keys()].slice(0,Math.max(0,this.jobs.size-9)))this.jobs.delete(id);
    const job:NflDailyJob={id:randomUUID(),date:collegeDate(this.deps.now()),startedAt:new Date(this.deps.now()).toISOString(),status:'running',stage:'discovering',preflight:null,warnings:[],
      grading:{gamesPlanned:0,gamesChecked:0,picksChecked:0,sourceFailures:0,pending:0,review:0}};this.jobs.set(job.id,job);this.active=job;
    void this.execute(job).catch(()=>{job.status='failed';job.warnings.push('NFL daily preflight was interrupted. Existing paper records remain intact.');}).finally(()=>{job.stage='finished';job.finishedAt=new Date(this.deps.now()).toISOString();this.active=null;});return this.get(job.id);}
  get(id:string){const job=this.jobs.get(id);if(!job)throw new MarketBoardError('NFL run not found or server restarted. Paper records remain intact; start a fresh preflight.',404);return structuredClone(job);}
  private async execute(job:NflDailyJob){let events:any[]=[];try{events=(await this.deps.events()).filter(event=>collegeDate(Date.parse(event.commenceTime))===job.date);job.stage='context';job.preflight=await this.deps.preflight(events);
      if(!events.length)job.warnings.push('No remaining NFL games were listed for today. No odds request was made.');if(job.preflight.warnings?.length)job.warnings.push(...job.preflight.warnings);}
    catch{job.warnings.push('NFL schedule or context preflight could not finish. No odds or recommendation was assumed.');}
    job.stage='grading';try{const eligible=this.deps.read().filter(p=>p.event.sportKey==='americanfootball_nfl'&&['PENDING','REVIEW'].includes(p.result)&&Date.parse(p.event.commenceTime)+4*3600_000<this.deps.now());
      const ids=[...new Set(eligible.map(p=>p.espnEventId))];job.grading.gamesPlanned=ids.length;for(let i=0;i<ids.length;i+=10){const batch=ids.slice(i,i+10),result=await this.deps.gradeEvents(batch);job.grading.gamesChecked+=batch.length;job.grading.picksChecked+=result.checked;job.grading.sourceFailures+=result.sourceFailures;}
      const picks=this.deps.read();job.grading.pending=picks.filter(p=>p.result==='PENDING').length;job.grading.review=picks.filter(p=>p.result==='REVIEW').length;
    }catch{job.warnings.push('NFL grading could not finish. Existing results remain unchanged.');}job.status=job.warnings.length?'partial':'complete';}
}
