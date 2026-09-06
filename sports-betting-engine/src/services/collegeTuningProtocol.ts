export const COLLEGE_TUNING_VERSION='college-spread-v2-research-protocol-1';
export const COLLEGE_TUNING_FORWARD_CUTOFF='2026-09-07T05:00:00.000Z';

export const COLLEGE_TUNING_PROTOCOL={
  version:COLLEGE_TUNING_VERSION,
  lockedAt:'2026-09-06T16:15:00.000Z',
  developmentData:'All verified regular-season games with kickoff before the forward cutoff. The 2023-2025 seasons and September 5, 2026 results are already inspected and are development evidence only.',
  forwardData:`Games with kickoff at or after ${COLLEGE_TUNING_FORWARD_CUTOFF}; prediction and every input snapshot must predate kickoff.`,
  control:'Frozen college-score-ridge-v1 on the identical eligible games.',
  marketBenchmark:'Archived consensus spread captured before kickoff on the identical games; closing observations are reported separately and never substituted for an unavailable pregame quote.',
  candidateInputs:[
    'opponent-adjusted offensive and defensive efficiency',
    'declining preseason prior',
    'returning production and starting-QB continuity',
    'recruiting/talent and transfer movement',
    'coaching/coordinator continuity',
    'FBS/FCS quality tier and depth mismatch',
    'neutral-site and empirically fitted home field',
    'garbage-time/blowout down-weighting',
  ],
  prohibited:[
    'tuning to September 5 or any other single slate',
    'using outcomes, closing lines, injuries or roster facts published after the forecast timestamp',
    'treating missing context as neutral or zero',
    'activating totals, Kelly staking or real-money recommendations',
  ],
  gates:{forwardGames:300,earlySeasonGames:75,fbsFcsGames:50,minimumRmseImprovement:0.05,
    maximumBrier:0.25,maximumCalibrationGap:0.05,clvSamples:100,minimumPositiveClvRate:0.5},
} as const;

export type CollegeTuningPartition='DEVELOPMENT_INSPECTED'|'FORWARD_2026';
export function collegeTuningPartition(kickoff:string):CollegeTuningPartition{
  const value=Date.parse(kickoff);if(!Number.isFinite(value))throw Error('Invalid tuning kickoff');
  return value<Date.parse(COLLEGE_TUNING_FORWARD_CUTOFF)?'DEVELOPMENT_INSPECTED':'FORWARD_2026';
}

export interface CollegeTuningObservation {gameId:string;kickoff:string;forecastAt:string;inputsAsOf:string;modelVersion:string;}
export function validateCollegeForwardObservation(row:CollegeTuningObservation){
  const reasons:string[]=[],kickoff=Date.parse(row.kickoff),forecast=Date.parse(row.forecastAt),inputs=Date.parse(row.inputsAsOf);
  if(!row.gameId||!row.modelVersion)reasons.push('Missing game or model identity.');
  if(![kickoff,forecast,inputs].every(Number.isFinite))reasons.push('Invalid evidence timestamp.');
  else{
    if(collegeTuningPartition(row.kickoff)!=='FORWARD_2026')reasons.push('Game belongs to already-inspected development data.');
    if(forecast>=kickoff)reasons.push('Forecast was not frozen before kickoff.');
    if(inputs>forecast)reasons.push('Input snapshot postdates the forecast.');
  }
  return{eligible:reasons.length===0,reasons,partition:Number.isFinite(kickoff)?collegeTuningPartition(row.kickoff):null};
}

export interface CollegeTuningGateReport {forwardGames:number;earlySeasonGames:number;fbsFcsGames:number;candidateRmse:number;controlRmse:number;
  marketRmse:number;brier:number;maximumCalibrationGap:number;clvSamples:number;averageSpreadClv:number;positiveClvRate:number;}
export function assessCollegeTuningGate(report:CollegeTuningGateReport){
  const g=COLLEGE_TUNING_PROTOCOL.gates,reasons:string[]=[];
  if(report.forwardGames<g.forwardGames)reasons.push(`Need ${g.forwardGames} forward games.`);
  if(report.earlySeasonGames<g.earlySeasonGames)reasons.push(`Need ${g.earlySeasonGames} forward Week 1-3 games.`);
  if(report.fbsFcsGames<g.fbsFcsGames)reasons.push(`Need ${g.fbsFcsGames} forward FBS/FCS games.`);
  if(!Number.isFinite(report.candidateRmse)||!Number.isFinite(report.controlRmse)||report.candidateRmse>report.controlRmse*(1-g.minimumRmseImprovement))
    reasons.push('Candidate margin RMSE has not beaten the frozen control by 5%.');
  if(!Number.isFinite(report.marketRmse)||report.candidateRmse>=report.marketRmse)reasons.push('Candidate margin RMSE has not beaten the same-cohort market benchmark.');
  if(!Number.isFinite(report.brier)||report.brier>g.maximumBrier)reasons.push('Forward Brier score exceeds 0.250.');
  if(!Number.isFinite(report.maximumCalibrationGap)||report.maximumCalibrationGap>g.maximumCalibrationGap)reasons.push('A populated calibration bucket misses observed frequency by more than five points.');
  if(report.clvSamples<g.clvSamples||!Number.isFinite(report.averageSpreadClv)||report.averageSpreadClv<=0||!Number.isFinite(report.positiveClvRate)||report.positiveClvRate<=g.minimumPositiveClvRate)
    reasons.push('Forward CLV evidence is insufficient or non-positive.');
  return{approved:reasons.length===0,reasons,moneyBettingApproved:false,totalsEnabled:false,kellyEnabled:false};
}

export function collegeTuningReadiness(cfbdConfigured:boolean){return{
  version:COLLEGE_TUNING_VERSION,protocolLocked:true,forwardCutoff:COLLEGE_TUNING_FORWARD_CUTOFF,
  dataStatus:cfbdConfigured?'CFBD_KEY_CONFIGURED':'AWAITING_FREE_CFBD_KEY',
  nextAction:cfbdConfigured?'Import versioned preseason and efficiency snapshots; keep all new weights research-only.':'Create a free CFBD key and store it only in server-side environment configuration.',
  activationApproved:false,moneyBettingApproved:false,totalsEnabled:false,
};}
