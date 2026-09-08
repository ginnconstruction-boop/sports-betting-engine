import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { printTopTen } from '../services/topTenBets';

test('legacy NFL signal output cannot present a research row as a bet, grade or Kelly stake',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-legacy-output-')),old=process.env.SNAPSHOT_DIR,lines:string[]=[],log=console.log;
  process.env.SNAPSHOT_DIR=root;console.log=(value?:any)=>lines.push(String(value??''));
  try{
    printTopTen([{rank:1,tier:'MONITOR',grade:'A+',score:99,priceScore:30,lineScore:20,sharpScore:0,signalCount:3,sport:'NFL',sportKey:'americanfootball_nfl',
      eventId:'game-1',matchup:'Away @ Home',startTime:'2026-09-10T00:00:00Z',hoursUntilGame:2,betType:'Spread',side:'Home -3',bestUserBook:'FanDuel',bestUserPrice:-110,
      bestUserLine:-3,altUserBook:'BetMGM',altUserPrice:-105,altUserLine:-3, userBookGap:0,userBookGapAlert:false,consensusPrice:-108,consensusLine:-3,
      priceDiff:-2,marketBestPrice:-105,marketBestBook:'BetMGM',lineDiff:0,bookCount:4,bookConfidence:'high',sharpSignal:'',recommendation:'RESEARCH RANK — no validated edge',
      fadePublicFlag:false,fadePublicDetail:'',weatherAlert:null,injuryFlags:[],lineMovementAlert:false,lineMovementDetail:'',priceMovementAlert:false,priceMovementDetail:'',
      isRecentMovement:false,fullReasoning:[],kellyPct:0} as any],24);
    const output=lines.join('\n');assert.match(output,/SIDE UNDER REVIEW/);assert.match(output,/No stake/);assert.match(output,/not confidence/);
    assert.doesNotMatch(output,/\[OK\] BET:/);assert.doesNotMatch(output,/Grade: A\+/);assert.doesNotMatch(output,/Kelly: 0\.0%/);
  }finally{console.log=log;if(old===undefined)delete process.env.SNAPSHOT_DIR;else process.env.SNAPSHOT_DIR=old;fs.rmSync(root,{recursive:true,force:true});}
});
