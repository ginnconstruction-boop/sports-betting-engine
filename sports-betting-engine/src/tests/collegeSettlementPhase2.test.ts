import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {collegeResultEvidence,createCollegePaperLedger,COLLEGE_PAPER_RULES,gradeCollegePaper,settleCollegePaper} from '../services/collegePaper';
import {GameResultEvidence,PAPER_APPLICATION_RELEASE,PAPER_SETTLEMENT_VERSION} from '../services/footballSettlement';
import {footballPaperMetrics} from '../services/footballValidation';
import {nflPaperReport,paperProfit} from '../services/nflPaper';

const kickoff='2026-09-03T22:00:00Z',saveTime=Date.parse(kickoff)-60_000,gradeTime=Date.parse(kickoff)+5*3600_000;
const event={id:'odds-provider-a',sportKey:'americanfootball_ncaaf',homeTeam:'Rutgers Scarlet Knights',awayTeam:'UMass Minutemen',commenceTime:kickoff};
const identity={espnEventId:'1234',homeTeamId:'164',awayTeamId:'113',neutralSite:true,source:'fixture',fetchedAt:new Date(saveTime).toISOString()};
const quote={market:'spreads',participant:'',side:event.homeTeam,line:-6.5,price:-110,book:'Test Book',bookKey:'test',updatedAt:new Date(saveTime).toISOString(),stale:false};
const pick=(changes:any={}):any=>({id:'pick',event,espnEventId:'1234',verifiedEvent:identity,quote,season:2026,version:'college-manual-paper-v1',
  rules:COLLEGE_PAPER_RULES,savedAt:new Date(saveTime).toISOString(),origin:'manual',result:'PENDING',note:'',...changes});
function result(status='STATUS_FINAL',homeScore:any='31',awayScore:any='24',changes:any={}){return {header:{league:{slug:'college-football'},season:{year:2026,type:2},competitions:[{
  id:'1234',date:kickoff,neutralSite:true,status:{type:{name:status,completed:['STATUS_FINAL','STATUS_FINAL_OVERTIME'].includes(status),state:['STATUS_FINAL','STATUS_FINAL_OVERTIME'].includes(status)?'post':'pre'}},
  competitors:[{homeAway:'home',team:{id:'164',displayName:'Rutgers'},score:homeScore},{homeAway:'away',team:{id:'113',displayName:'Massachusetts'},score:awayScore}],...changes}]}};}
function evidence(changes:Partial<GameResultEvidence>={}):GameResultEvidence{return {sourceProvider:'ESPN',providerEventId:'1234',canonicalEventId:'1234',homeCanonicalId:'164',awayCanonicalId:'113',
  homeFinalScore:31,awayFinalScore:24,explicitStatus:'STATUS_FINAL',statusCompleted:true,statusState:'post',eventCompletionTimestamp:null,
  sourceRetrievalTimestamp:'2026-09-04T03:00:00Z',gradingTimestamp:'2026-09-04T03:01:00Z',...changes};}

test('Phase 2 deterministic spread settlement covers favorite, underdog, half-point and whole-number push cases',()=>{
  assert.equal(settleCollegePaper(pick(),evidence()).result,'WIN');
  assert.equal(settleCollegePaper(pick({quote:{...quote,line:-7.5}}),evidence()).result,'LOSS');
  assert.equal(settleCollegePaper(pick({quote:{...quote,side:event.awayTeam,line:7.5}}),evidence()).result,'WIN');
  assert.equal(settleCollegePaper(pick({quote:{...quote,side:event.awayTeam,line:6.5}}),evidence()).result,'LOSS');
  assert.equal(settleCollegePaper(pick({quote:{...quote,line:-7}}),evidence()).result,'PUSH');
  assert.equal(settleCollegePaper(pick({quote:{...quote,line:0}}),evidence({homeFinalScore:0,awayFinalScore:1})).result,'LOSS');
});

test('Phase 2 status semantics grade final overtime, void canceled, retain postponed, and fail closed on unknown status',()=>{
  assert.equal(gradeCollegePaper(pick(),result('STATUS_FINAL_OVERTIME')).result,'WIN');
  assert.equal(gradeCollegePaper(pick(),result('STATUS_CANCELED',null,null)).result,'VOID');
  assert.equal(gradeCollegePaper(pick(),result('STATUS_POSTPONED',null,null)).result,'PENDING');
  const missing=result();delete (missing.header.competitions[0].status as any).type.name;
  assert.equal(gradeCollegePaper(pick(),missing).result,'UNABLE_TO_GRADE');
  assert.equal(gradeCollegePaper(pick(),result('STATUS_IN_PROGRESS')).result,'PENDING');
  const fakeFinal=result('STATUS_FINAL');fakeFinal.header.competitions[0].status.type.completed=false;
  assert.equal(gradeCollegePaper(pick(),fakeFinal).result,'UNABLE_TO_GRADE');
});

test('Phase 2 canonical identity controls grading while display aliases and neutral venue do not alter settlement',()=>{
  assert.equal(gradeCollegePaper(pick(),result()).result,'WIN');
  const wrong=result();wrong.header.competitions[0].competitors[1].team.id='999';
  assert.equal(gradeCollegePaper(pick(),wrong).result,'UNABLE_TO_GRADE');
  const unknown=result();unknown.header.competitions[0].id='9999';
  assert.equal(gradeCollegePaper(pick(),unknown).result,'UNABLE_TO_GRADE');
  const rematch=pick({id:'rematch',espnEventId:'5678',verifiedEvent:{...identity,espnEventId:'5678'}});
  assert.equal(settleCollegePaper(rematch,evidence({providerEventId:'5678',canonicalEventId:'5678'})).result,'WIN');
  assert.equal(settleCollegePaper(rematch,evidence()).result,'UNABLE_TO_GRADE');
});

test('Phase 2 saved line and price are immutable settlement inputs despite later market movement',()=>{
  const archived=pick({quote:{...quote,side:event.awayTeam,line:6.5,price:-105},latestPregame:{line:3.5,price:-125,updatedAt:'2026-09-03T21:59:00Z',observedAt:'2026-09-03T21:59:10Z'}});
  const final=evidence({homeFinalScore:24,awayFinalScore:19});
  assert.equal(settleCollegePaper(archived,final).result,'WIN');
  assert.equal(archived.quote.line,6.5);assert.equal(archived.quote.price,-105);
});

function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'phase2-paper-'));}
function schedule(providerId=event.id){return {events:[{id:'1234',date:kickoff,season:{year:2026,type:2},competitions:[{id:'1234',neutralSite:true,
  competitors:[{homeAway:'home',team:{id:'164',displayName:event.homeTeam}},{homeAway:'away',team:{id:'113',displayName:'Massachusetts Minutemen'}}]}]}],providerId};}

test('Phase 2 ledger deduplicates canonical provider duplicates and seals complete opening provenance',async()=>{
  const dir=temp();try{let now=saveTime;const research:any={identity:async()=>identity,summary:async()=>result(),matchEvent:async()=>identity.espnEventId};
    const ledger=createCollegePaperLedger(path.join(dir,'paper.json'),research,()=>now);
    const first=await ledger.save(event,quote,COLLEGE_PAPER_RULES);
    const duplicate=await ledger.save({...event,id:'odds-provider-duplicate'},quote,COLLEGE_PAPER_RULES);
    assert.equal(duplicate.duplicate,true);assert.equal(ledger.read().length,1);
    const saved=ledger.read()[0];assert.equal(saved.selectionSnapshot.canonicalEventId,'1234');assert.equal(saved.selectionSnapshot.homeCanonicalId,'164');
    assert.equal(saved.selectionSnapshot.exactLine,-6.5);assert.equal(saved.selectionSnapshot.exactAmericanPrice,-110);
    assert.equal(saved.selectionSnapshot.applicationRelease,PAPER_APPLICATION_RELEASE);assert.equal(saved.selectionSnapshot.settlementVersion,PAPER_SETTLEMENT_VERSION);
    assert.equal(saved.compatibility.schema,'PHASE2');assert.equal(saved.openingHashVersion,'paper-opening-v2');assert.equal(first.pick.id,saved.id);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Phase 2 manual opening hash refuses an altered archived line or price',async()=>{
  const dir=temp();try{const file=path.join(dir,'paper.json'),research:any={identity:async()=>identity,summary:async()=>result(),matchEvent:async()=>identity.espnEventId};
    const ledger=createCollegePaperLedger(file,research,()=>saveTime);await ledger.save(event,quote,COLLEGE_PAPER_RULES);
    const bytes=JSON.parse(fs.readFileSync(file,'utf8'));bytes.picks[0].quote.line=-3.5;bytes.picks[0].quote.price=-125;
    fs.writeFileSync(file,JSON.stringify(bytes));assert.throws(()=>ledger.read(),/Immutable opening prediction/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Phase 2 grading is idempotent and correction replay records both authoritative states',async()=>{
  const dir=temp();try{let now=saveTime,data=result();const research:any={identity:async()=>identity,summary:async()=>data,matchEvent:async()=>identity.espnEventId};
    const ledger=createCollegePaperLedger(path.join(dir,'paper.json'),research,()=>now);await ledger.save(event,quote,COLLEGE_PAPER_RULES);now=gradeTime;
    await ledger.grade();const once=ledger.read()[0];assert.equal(once.result,'WIN');assert.equal(once.gradingAudit.length,1);
    await ledger.grade();const twice=ledger.read()[0];assert.equal(twice.gradingAudit.length,1);assert.equal(twice.result,'WIN');
    data=result('STATUS_FINAL','27','24');now+=60_000;await ledger.grade(true);const corrected=ledger.read()[0];
    assert.equal(corrected.result,'LOSS');assert.equal(corrected.gradingAudit.length,2);assert.equal(corrected.settlementCorrections.length,1);
    assert.equal(corrected.settlementCorrections[0].previousResult,'WIN');assert.equal(corrected.settlementCorrections[0].newResult,'LOSS');
    assert.deepEqual(ledger.replay(corrected.id).audits.map((a:any)=>a.status),['matched','matched']);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Phase 2 source failure becomes unable-to-grade and can later recover without becoming a loss',async()=>{
  const dir=temp();try{let now=saveTime,offline=true;const research:any={identity:async()=>identity,matchEvent:async()=>identity.espnEventId,
      summary:async()=>{if(offline)throw Error('offline');return result();}};
    const ledger=createCollegePaperLedger(path.join(dir,'paper.json'),research,()=>now);await ledger.save(event,quote,COLLEGE_PAPER_RULES);now=gradeTime;
    await ledger.grade();assert.equal(ledger.read()[0].result,'UNABLE_TO_GRADE');offline=false;await ledger.grade();assert.equal(ledger.read()[0].result,'WIN');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Phase 2 legacy rows report missing provenance without invented values',()=>{
  const dir=temp();try{const file=path.join(dir,'paper.json'),legacy=pick();delete legacy.openingHash;delete legacy.selectionSnapshot;
    fs.writeFileSync(file,JSON.stringify({schema:1,picks:[legacy]}));const ledger=createCollegePaperLedger(file,{} as any,()=>gradeTime);
    const row=ledger.read()[0];assert.equal(row.compatibility.schema,'LEGACY');assert.ok(row.compatibility.missingFields.includes('versioned selection snapshot'));
    assert.equal(ledger.replay(row.id).openingIntegrity,'legacy_hash_unavailable');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Phase 2 risk-one-unit accounting excludes push, void, pending, unable and legacy review from W/L and loss accounting',()=>{
  const rows=['WIN','LOSS','PUSH','VOID','PENDING','UNABLE_TO_GRADE','REVIEW'].map((result,i)=>pick({id:String(i),result}));
  const report=nflPaperReport(rows).buckets[0];assert.equal(report.wins,1);assert.equal(report.losses,1);assert.equal(report.pushes,1);
  assert.equal(report.voids,1);assert.equal(report.unableToGrade,1);assert.equal(report.legacyReview,1);
  assert.equal(report.profitUnits,100/110-1);assert.equal(report.roi,(100/110-1)/3);
  assert.equal(paperProfit('WIN',-110),100/110);assert.equal(paperProfit('WIN',120),1.2);assert.equal(paperProfit('VOID',-110),0);
  const metrics=footballPaperMetrics(rows,gradeTime)[0];assert.equal(metrics.settled,3);assert.equal(metrics.voids,1);
  assert.equal(metrics.unableToGrade,1);assert.equal(metrics.pending,1);assert.equal(metrics.legacyReview,1);
});

test('Phase 2 result evidence records source, IDs, final score, explicit status and audit timestamps',()=>{
  const row=gradeCollegePaper(pick(),result(),{sourceProvider:'ESPN fixture',sourceRetrievalTimestamp:'2026-09-04T03:00:00Z',gradingTimestamp:'2026-09-04T03:01:00Z'});
  assert.equal(row.resultEvidence.sourceProvider,'ESPN fixture');assert.equal(row.resultEvidence.providerEventId,'1234');
  assert.equal(row.resultEvidence.homeFinalScore,31);assert.equal(row.resultEvidence.awayFinalScore,24);
  assert.equal(row.resultEvidence.explicitStatus,'STATUS_FINAL');assert.equal(row.resultEvidence.sourceRetrievalTimestamp,'2026-09-04T03:00:00Z');
  assert.equal(collegeResultEvidence(pick(),result()).eventCompletionTimestamp,null);
});
