import * as child from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
import {stableStringify} from '../services/collegeEdgeResearch';
import {ForwardOperationsStore} from '../services/collegeForwardOperations';
import {buildForwardMonitoringReport,COLLEGE_FORWARD_MONITORING_VERSION} from '../services/collegeForwardMonitoring';

const option=(name:string)=>{const prefix=`--${name}=`;return process.argv.slice(2).find(value=>value.startsWith(prefix))?.slice(prefix.length);};
const sha=(value:unknown)=>createHash('sha256').update(stableStringify(value)).digest('hex');
function commitHashes(root:string){const result:Record<string,string|null>={};for(const run of new ForwardOperationsStore(root).runs()){try{const relative=path.relative(process.cwd(),path.join(root,'college_forward_research','v1','operations','runs',`${run.runId}.json`)).replace(/\\/g,'/'),value=child.execFileSync('git',['log','-1','--format=%H','--',relative],{cwd:process.cwd(),encoding:'utf8'}).trim();result[run.runId]=value||null;}catch{result[run.runId]=null;}}return result;}
const json=(value:unknown)=>['```json',JSON.stringify(value,null,2),'```'];
function markdown(a:any){const lines=[
  '# Phase 8 — forward validation monitoring and data quality','',`Generated: ${a.generatedAt}`,'',
  '## A. Phase 7 operational verification','',`Workflow configured: ${a.phase7.workflowConfigured}. Schedules: ${a.phase7.schedule.morning} and ${a.phase7.schedule.afternoon}; exactly ${a.phase7.schedule.runsPerDay} scheduled runs/day. DST uses America/Chicago. Required secrets verified: ${a.phase7.requiredSecretsVerified===null?'UNKNOWN — requires an authenticated run':a.phase7.requiredSecretsVerified}. Provider access verified by scheduled success: ${a.phase7.providerAccessVerified}. Authority: ${a.phase7.durableAuthority}.`,'',
  '## B. Scheduled run evidence','',...json(a.scheduledRunEvidence),'',
  '## C. Current archive counts','',...json(a.counts),'',
  '## D. Eligible-universe capture rate','',...json(a.eligibleUniverse),'',
  '## E. Feature coverage table','',...json(a.coverage.aggregate),'',
  '## F. Critical feature coverage','',...json({critical:a.criticalFeatureCoverage,fcsQuality:a.fcsQualityCoverage}),'',
  '## G. Provider reliability','',...json(a.providerReliability),'',
  '## H. Entity match quality','',...json(a.entityMatchQuality),'',
  '## I. Snapshot timing distribution','',...json(a.snapshotTiming),'',
  '## J. Morning vs afternoon data completeness','',...json(a.completenessByTiming),'',
  '## K. Market/football separation audit','',...json(a.marketFootballSeparation),'',
  '## L. Future-leakage audit','',...json(a.futureLeakageAudit),'',
  '## M. FBS/FCS data status','',...json({counts:a.counts.regime,coverage:a.fcsQualityCoverage,gate:a.modelBV2Readiness.fbsFcs}),'',
  '## N. Current Model A descriptive results','',...json(a.modelAForward),'',
  '## O. Current market benchmark','',...json(a.marketForward),'',
  '## P. Forward holdout policy','',a.holdoutPolicy,'',
  '## Q. Predeclared Model B v2 readiness gate','',...json(a.modelBV2Readiness),'',
  '## R. Research dashboard status','',`- FORWARD DATASET STATUS: ${a.datasetStatus}`,`- CURRENT N: ${a.counts.gamesWithAtLeastOneValidPregameSnapshot}`,`- FINALIZED N: ${a.counts.gamesFinalized}`,`- FBS/FBS N: ${a.counts.regime.fbsFbs}`,`- FBS/FCS N: ${a.counts.regime.fbsFcs}`,`- 7 AM: ${a.missedScheduledCaptures.morning}`,`- 2 PM: ${a.missedScheduledCaptures.afternoon}`,`- LEAKAGE: ${a.futureLeakageAudit.status}`,`- NEXT MILESTONE: ${a.nextResearchMilestone??'ALL PREDECLARED MILESTONES REACHED'}`,`- MODEL B V2: ${a.modelBV2Readiness.fbsFbs.ready?'READY':'NOT READY'}`,`- ALERTS: ${a.alerts.length?a.alerts.join(', '):'NONE'}`,'',
  '## S. Tests added','','Scheduled configuration/execution semantics, dataset counting, transparent coverage, six-stage aggregation, provider reliability, entity matching, timing, contamination, leakage, append-only corrections, missed-capture classification, universe capture rate, FBS/FCS isolation, minimum-N suppression, milestones, readiness, deterministic reporting, and hash integrity.','',
  '## T. Full regression results','',a.verification.fullRegression,'',
  '## U. Typecheck/lint','',a.verification.typecheckLint,'',
  '## V. Production impact','','No production recommendation, coefficient, qualification, calibration, Kelly, staking, parlay, totals, or paper-selection behavior changed.','',
  '## W. Final decision','',`**${a.finalDecision}**`,''
];return lines.join('\n');}
function main(){const generatedAt=new Date(option('generated-at')??Date.now()).toISOString(),root=path.resolve(option('root')??process.env.FORWARD_RESEARCH_ROOT??path.join(process.cwd(),'research','forward-archive')),monitor=buildForwardMonitoringReport(root,generatedAt,{commitHashes:commitHashes(root),schedulerConfigured:true,secretsVerified:null}),report={...monitor,verification:{phase8Focused:option('focused-tests')??'NOT RECORDED',fullRegression:option('full-regression')??'NOT RECORDED',typecheckLint:option('typecheck-lint')??'NOT RECORDED'}},artifactHash=sha(report),runId=`${COLLEGE_FORWARD_MONITORING_VERSION}-${artifactHash.slice(0,12)}-${generatedAt.replace(/[:.]/g,'-')}`,directory=path.resolve(option('output-root')??path.join(process.cwd(),'research','results',COLLEGE_FORWARD_MONITORING_VERSION),runId),files={'artifact.json':JSON.stringify(report,null,2),'manifest.json':JSON.stringify({schemaVersion:`${COLLEGE_FORWARD_MONITORING_VERSION}-manifest`,generatedAt,artifactHash,datasetHash:report.datasetHash,files:['artifact.json','manifest.json','report.md']},null,2),'report.md':markdown(report)};fs.mkdirSync(directory,{recursive:true});for(const [name,body]of Object.entries(files)){const file=path.join(directory,name);if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')!==body)throw Error('Immutable Phase 8 report collision.');if(!fs.existsSync(file))fs.writeFileSync(file,body,{flag:'wx'});}console.log(JSON.stringify({directory,artifactHash,datasetStatus:report.datasetStatus,finalDecision:report.finalDecision,alerts:report.alerts,counts:report.counts},null,2));}
main();
