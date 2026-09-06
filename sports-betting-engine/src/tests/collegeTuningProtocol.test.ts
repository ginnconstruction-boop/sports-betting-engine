import test from 'node:test';
import assert from 'node:assert/strict';
import {assessCollegeTuningGate,collegeTuningPartition,collegeTuningReadiness,validateCollegeForwardObservation} from '../services/collegeTuningProtocol';

test('college v2 tuning keeps inspected games out of the frozen forward sample',()=>{
  assert.equal(collegeTuningPartition('2026-09-06T23:30:00Z'),'DEVELOPMENT_INSPECTED');
  assert.equal(collegeTuningPartition('2026-09-07T05:00:00Z'),'FORWARD_2026');
  const valid=validateCollegeForwardObservation({gameId:'future',kickoff:'2026-09-12T16:00:00Z',forecastAt:'2026-09-12T14:00:00Z',inputsAsOf:'2026-09-12T13:59:00Z',modelVersion:'candidate'});
  assert.equal(valid.eligible,true);
  for(const row of [
    {gameId:'old',kickoff:'2026-09-06T20:00:00Z',forecastAt:'2026-09-06T15:00:00Z',inputsAsOf:'2026-09-06T14:00:00Z',modelVersion:'candidate'},
    {gameId:'late',kickoff:'2026-09-12T16:00:00Z',forecastAt:'2026-09-12T16:00:00Z',inputsAsOf:'2026-09-12T14:00:00Z',modelVersion:'candidate'},
    {gameId:'future-input',kickoff:'2026-09-12T16:00:00Z',forecastAt:'2026-09-12T14:00:00Z',inputsAsOf:'2026-09-12T15:00:00Z',modelVersion:'candidate'},
  ])assert.equal(validateCollegeForwardObservation(row).eligible,false);
});

test('college v2 activation requires broad forward accuracy, calibration and CLV together',()=>{
  const base={forwardGames:300,earlySeasonGames:75,fbsFcsGames:50,candidateRmse:14,controlRmse:15,marketRmse:14.5,brier:.24,maximumCalibrationGap:.04,
    clvSamples:100,averageSpreadClv:.2,positiveClvRate:.51};
  assert.equal(assessCollegeTuningGate(base).approved,true);
  assert.equal(assessCollegeTuningGate({...base,forwardGames:299}).approved,false);
  assert.equal(assessCollegeTuningGate({...base,candidateRmse:14.4}).approved,false);
  assert.equal(assessCollegeTuningGate({...base,marketRmse:13.9}).approved,false);
  assert.equal(assessCollegeTuningGate({...base,brier:.251}).approved,false);
  assert.equal(assessCollegeTuningGate({...base,positiveClvRate:.5}).approved,false);
  assert.equal(assessCollegeTuningGate(base).moneyBettingApproved,false);
});

test('college tuning readiness names the missing free data credential without weakening gates',()=>{
  assert.equal(collegeTuningReadiness(false).dataStatus,'AWAITING_FREE_CFBD_KEY');
  assert.equal(collegeTuningReadiness(true).dataStatus,'CFBD_KEY_CONFIGURED');
  assert.equal(collegeTuningReadiness(true).activationApproved,false);
});
