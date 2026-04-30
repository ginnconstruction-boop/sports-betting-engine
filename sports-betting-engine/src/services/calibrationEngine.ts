import * as fs from 'fs';
import * as path from 'path';
import { PickRecord } from './closingLineTracker';
import { DecisionCandidate } from './decisionTypes';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const PICKS_FILE = path.join(SNAPSHOT_DIR, 'picks_log.json');
const CALIBRATION_FILE = path.join(SNAPSHOT_DIR, 'calibration_report.json');

const MIN_DISPLAY_SAMPLE_SIZE = 20;

export interface CalibrationStats {
  sampleSize: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
}

export interface CalibrationReport {
  generatedAt: string;
  totalTrackedProps: number;
  gradedTrackedProps: number;
  byPropType: Record<string, CalibrationStats>;
  bySignalType: Record<string, CalibrationStats>;
  bySignalCombo: Record<string, CalibrationStats>;
  byEdgeConfidenceBucket: Record<string, CalibrationStats>;
  byModelProbabilityBucket: Record<string, CalibrationStats>;
  byProjectionEdgeBucket: Record<string, CalibrationStats>;
  byPropTypeAndEdgeProbabilityBucket: Record<string, CalibrationStats>;
}

export interface CandidateCalibrationDisplay {
  historicalWinRate: number;
  sampleSize: number;
  roi: number;
  sourceKey: string;
}

function loadPicks(): PickRecord[] {
  if (!fs.existsSync(PICKS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(PICKS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveCalibrationReport(report: CalibrationReport): void {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
  fs.writeFileSync(CALIBRATION_FILE, JSON.stringify(report, null, 2));
}

function emptyStats(): CalibrationStats {
  return { sampleSize: 0, wins: 0, losses: 0, pushes: 0, winRate: 0, roi: 0 };
}

function updateStats(stats: CalibrationStats, result: PickRecord['gameResult'], price: number): CalibrationStats {
  const next = { ...stats };
  next.sampleSize++;
  if (result === 'WIN') next.wins++;
  else if (result === 'LOSS') next.losses++;
  else next.pushes++;

  const unitProfit = result === 'WIN'
    ? (price > 0 ? price / 100 : 100 / Math.abs(price))
    : result === 'LOSS'
      ? -1
      : 0;

  next.roi = Math.round((((stats.roi / 100) * stats.sampleSize) + unitProfit) / next.sampleSize * 10000) / 100;
  const graded = next.wins + next.losses;
  next.winRate = graded > 0 ? Math.round((next.wins / graded) * 1000) / 10 : 0;
  return next;
}

function bucketEdgeConfidence(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return 'unknown';
  if (value < 0.50) return '<0.50';
  if (value < 0.65) return '0.50-0.65';
  if (value < 0.80) return '0.65-0.80';
  return '>0.80';
}

function bucketProbability(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return 'unknown';
  if (value < 0.55) return '50-55';
  if (value < 0.60) return '55-60';
  if (value < 0.65) return '60-65';
  return '65+';
}

function bucketProjectionEdge(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return 'unknown';
  const abs = Math.abs(value);
  if (abs < 1.0) return '0.5-1.0';
  if (abs < 2.0) return '1.0-2.0';
  return '2.0+';
}

function stableSignalCombo(signalTypes?: string[]): string {
  if (!signalTypes || signalTypes.length === 0) return 'none';
  return [...new Set(signalTypes.map(s => s.toUpperCase()))].sort().join(' + ');
}

function isTrackedNBAProp(pick: PickRecord): boolean {
  return (
    pick.sportKey === 'basketball_nba' &&
    pick.marketType === 'player_prop' &&
    (pick.savedAsRecommendation === true || pick.recommendedLabel === 'BET' || pick.recommendedLabel === 'LEAN')
  );
}

function isGradedResult(result: PickRecord['gameResult']): result is 'WIN' | 'LOSS' | 'PUSH' {
  return result === 'WIN' || result === 'LOSS' || result === 'PUSH';
}

function upsert(
  bucket: Record<string, CalibrationStats>,
  key: string,
  result: 'WIN' | 'LOSS' | 'PUSH',
  price: number,
): void {
  bucket[key] = updateStats(bucket[key] ?? emptyStats(), result, price);
}

export function buildCalibrationReport(): CalibrationReport {
  const trackedProps = loadPicks().filter(isTrackedNBAProp);
  const gradedProps = trackedProps.filter(
    (p): p is PickRecord & { gameResult: 'WIN' | 'LOSS' | 'PUSH' } => isGradedResult(p.gameResult)
  );

  const report: CalibrationReport = {
    generatedAt: new Date().toISOString(),
    totalTrackedProps: trackedProps.length,
    gradedTrackedProps: gradedProps.length,
    byPropType: {},
    bySignalType: {},
    bySignalCombo: {},
    byEdgeConfidenceBucket: {},
    byModelProbabilityBucket: {},
    byProjectionEdgeBucket: {},
    byPropTypeAndEdgeProbabilityBucket: {},
  };

  for (const pick of gradedProps) {
    const propType = (pick.propType ?? 'unknown').toLowerCase();
    const edgeBucket = bucketEdgeConfidence(pick.edgeConfidence);
    const probabilityBucket = bucketProbability(pick.modelProbability);
    const projectionEdgeBucket = bucketProjectionEdge(pick.projectionEdge);
    const signalCombo = stableSignalCombo(pick.signalTypes);
    const comboKey = `${propType} | edge:${edgeBucket} | prob:${probabilityBucket}`;
    const price = typeof pick.pickedPrice === 'number' && Number.isFinite(pick.pickedPrice) && pick.pickedPrice !== 0
      ? pick.pickedPrice
      : -110;

    upsert(report.byPropType, propType, pick.gameResult, price);
    upsert(report.bySignalCombo, signalCombo, pick.gameResult, price);
    upsert(report.byEdgeConfidenceBucket, edgeBucket, pick.gameResult, price);
    upsert(report.byModelProbabilityBucket, probabilityBucket, pick.gameResult, price);
    upsert(report.byProjectionEdgeBucket, projectionEdgeBucket, pick.gameResult, price);
    upsert(report.byPropTypeAndEdgeProbabilityBucket, comboKey, pick.gameResult, price);

    for (const signalType of [...new Set((pick.signalTypes ?? []).map(s => s.toUpperCase()))]) {
      upsert(report.bySignalType, signalType, pick.gameResult, price);
    }
  }

  saveCalibrationReport(report);
  return report;
}

export function getCalibrationDisplayForCandidate(
  candidate: DecisionCandidate,
  report?: CalibrationReport,
): CandidateCalibrationDisplay | null {
  if (candidate.sportKey !== 'basketball_nba' || candidate.marketType !== 'player_prop') return null;

  const calibration = report ?? buildCalibrationReport();
  const propType = (candidate.market ?? 'unknown').toLowerCase();
  const edgeBucket = bucketEdgeConfidence(candidate.edgeConfidence);
  const probabilityBucket = bucketProbability(candidate.probability);
  const comboKey = `${propType} | edge:${edgeBucket} | prob:${probabilityBucket}`;
  const bestMatch = calibration.byPropTypeAndEdgeProbabilityBucket[comboKey];

  if (bestMatch && bestMatch.sampleSize >= MIN_DISPLAY_SAMPLE_SIZE) {
    return {
      historicalWinRate: bestMatch.winRate,
      sampleSize: bestMatch.sampleSize,
      roi: bestMatch.roi,
      sourceKey: comboKey,
    };
  }

  const propTypeOnly = calibration.byPropType[propType];
  if (propTypeOnly && propTypeOnly.sampleSize >= MIN_DISPLAY_SAMPLE_SIZE) {
    return {
      historicalWinRate: propTypeOnly.winRate,
      sampleSize: propTypeOnly.sampleSize,
      roi: propTypeOnly.roi,
      sourceKey: propType,
    };
  }

  return null;
}

export function decorateCandidatesWithCalibration(
  candidates: DecisionCandidate[],
  report?: CalibrationReport,
): DecisionCandidate[] {
  const calibration = report ?? buildCalibrationReport();
  return candidates.map(candidate => {
    const display = getCalibrationDisplayForCandidate(candidate, calibration);
    if (!display) return candidate;
    return {
      ...candidate,
      calibrationHistoricalWinRate: display.historicalWinRate,
      calibrationSampleSize: display.sampleSize,
      calibrationRoi: display.roi,
    };
  });
}
