import * as fs from 'fs';
import * as path from 'path';
import { PickRecord, isOfficialRecommendationPick } from './closingLineTracker';
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
  trackedBySport: Record<string, number>;
  gradedBySport: Record<string, number>;
  bySport: Record<string, CalibrationStats>;
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

export interface SportCalibrationProgress {
  tracked: number;
  graded: number;
  displayThreshold: number;
}

export interface NCAACalibrationStatsReport {
  totalTracked: number;
  totalGraded: number;
  bySignalCombo: Record<string, CalibrationStats>;
  byEdgeConfidenceBucket: Record<string, CalibrationStats>;
  byModelProbabilityBucket: Record<string, CalibrationStats>;
}

export interface NCAACalibrationAdjustment {
  multiplier: number;
  reasons: string[];
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

function normalizeHistoricalSportKey(pick: Partial<PickRecord>): string {
  const normalizedSportKey = String(pick.sportKey ?? '').toLowerCase();
  if (normalizedSportKey) return normalizedSportKey;

  const normalizedSport = String(pick.sport ?? '').toLowerCase();
  if (normalizedSport === 'ncaa baseball') return 'baseball_ncaa';
  if (normalizedSport === 'ncaab') return 'basketball_ncaab';
  if (normalizedSport === 'ncaaf') return 'americanfootball_ncaaf';
  return normalizedSportKey;
}

function isNCAAGameSportKey(sportKey: string): boolean {
  return sportKey === 'baseball_ncaa'
    || sportKey === 'basketball_ncaab'
    || sportKey === 'americanfootball_ncaaf';
}

function isOfficialNCAAGamePick(pick: PickRecord): boolean {
  return isOfficialRecommendationPick(pick)
    && (pick.marketType ?? 'game_line') === 'game_line'
    && isNCAAGameSportKey(normalizeHistoricalSportKey(pick));
}

function deriveHistoricalGameModelProbability(pick: PickRecord): number | null {
  if (typeof pick.modelProbability === 'number' && Number.isFinite(pick.modelProbability)) {
    return pick.modelProbability;
  }
  if (typeof pick.score !== 'number' || !Number.isFinite(pick.score)) return null;
  const clampedScore = Math.max(0, Math.min(100, pick.score));
  return Math.round((0.50 + (clampedScore / 100) * 0.15) * 1000) / 1000;
}

function isSupportedNBAPropType(propType?: string | null): boolean {
  const normalized = String(propType ?? '').toLowerCase();
  return normalized === 'player_points'
    || normalized === 'player_rebounds'
    || normalized === 'player_assists'
    || normalized === 'player_threes';
}

function isSupportedMLBPropType(propType?: string | null): boolean {
  const normalized = String(propType ?? '').toLowerCase();
  return normalized === 'pitcher_strikeouts'
    || normalized === 'pitcher_hits_allowed'
    || normalized === 'pitcher_earned_runs'
    || normalized === 'batter_hits'
    || normalized === 'batter_total_bases';
}

function isSupportedNHLPropType(propType?: string | null): boolean {
  const normalized = String(propType ?? '').toLowerCase();
  return normalized === 'player_shots_on_goal'
    || normalized === 'player_total_saves'
    || normalized === 'goalie_saves';
}

function isCalibratedOfficialProp(pick: PickRecord): boolean {
  return (
    isOfficialRecommendationPick(pick) &&
    pick.marketType === 'player_prop' &&
    (
      (pick.sportKey === 'basketball_nba' && isSupportedNBAPropType(pick.propType)) ||
      (pick.sportKey === 'baseball_mlb' && isSupportedMLBPropType(pick.propType)) ||
      (pick.sportKey === 'icehockey_nhl' && isSupportedNHLPropType(pick.propType))
    )
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
  const trackedProps = loadPicks().filter(isCalibratedOfficialProp);
  const gradedProps = trackedProps.filter(
    (p): p is PickRecord & { gameResult: 'WIN' | 'LOSS' | 'PUSH' } => isGradedResult(p.gameResult)
  );

  const report: CalibrationReport = {
    generatedAt: new Date().toISOString(),
    totalTrackedProps: trackedProps.length,
    gradedTrackedProps: gradedProps.length,
    trackedBySport: {},
    gradedBySport: {},
    bySport: {},
    byPropType: {},
    bySignalType: {},
    bySignalCombo: {},
    byEdgeConfidenceBucket: {},
    byModelProbabilityBucket: {},
    byProjectionEdgeBucket: {},
    byPropTypeAndEdgeProbabilityBucket: {},
  };

  for (const pick of trackedProps) {
    const sportKey = String(pick.sportKey ?? 'unknown').toLowerCase();
    report.trackedBySport[sportKey] = (report.trackedBySport[sportKey] ?? 0) + 1;
  }

  for (const pick of gradedProps) {
    const sportKey = String(pick.sportKey ?? 'unknown').toLowerCase();
    const propType = (pick.propType ?? 'unknown').toLowerCase();
    const edgeBucket = bucketEdgeConfidence(pick.edgeConfidence);
    const probabilityBucket = bucketProbability(pick.modelProbability);
    const projectionEdgeBucket = bucketProjectionEdge(pick.projectionEdge);
    const signalCombo = stableSignalCombo(pick.signalTypes);
    const propTypeKey = `${sportKey} | ${propType}`;
    const comboKey = `${sportKey} | ${propType} | edge:${edgeBucket} | prob:${probabilityBucket}`;
    const price = typeof pick.pickedPrice === 'number' && Number.isFinite(pick.pickedPrice) && pick.pickedPrice !== 0
      ? pick.pickedPrice
      : -110;

    report.gradedBySport[sportKey] = (report.gradedBySport[sportKey] ?? 0) + 1;
    upsert(report.bySport, sportKey, pick.gameResult, price);
    upsert(report.byPropType, propTypeKey, pick.gameResult, price);
    upsert(report.bySignalCombo, signalCombo, pick.gameResult, price);
    upsert(report.byEdgeConfidenceBucket, edgeBucket, pick.gameResult, price);
    upsert(report.byModelProbabilityBucket, probabilityBucket, pick.gameResult, price);
    upsert(report.byProjectionEdgeBucket, `${sportKey} | ${projectionEdgeBucket}`, pick.gameResult, price);
    upsert(report.byPropTypeAndEdgeProbabilityBucket, comboKey, pick.gameResult, price);

    for (const signalType of [...new Set((pick.signalTypes ?? []).map(s => s.toUpperCase()))]) {
      upsert(report.bySignalType, signalType, pick.gameResult, price);
    }
  }

  saveCalibrationReport(report);
  return report;
}

export function getCalibrationProgressForSport(
  sportKey: string,
  report?: CalibrationReport,
): SportCalibrationProgress {
  const calibration = report ?? buildCalibrationReport();
  const normalizedSportKey = String(sportKey ?? 'unknown').toLowerCase();
  return {
    tracked: calibration.trackedBySport[normalizedSportKey] ?? 0,
    graded: calibration.gradedBySport[normalizedSportKey] ?? 0,
    displayThreshold: MIN_DISPLAY_SAMPLE_SIZE,
  };
}

export function buildNCAACalibrationStatsReport(): NCAACalibrationStatsReport {
  const tracked = loadPicks().filter(isOfficialNCAAGamePick);
  const graded = tracked.filter(
    (pick): pick is PickRecord & { gameResult: 'WIN' | 'LOSS' | 'PUSH' } => isGradedResult(pick.gameResult)
  );

  const report: NCAACalibrationStatsReport = {
    totalTracked: tracked.length,
    totalGraded: graded.length,
    bySignalCombo: {},
    byEdgeConfidenceBucket: {},
    byModelProbabilityBucket: {},
  };

  for (const pick of graded) {
    const price = typeof pick.pickedPrice === 'number' && Number.isFinite(pick.pickedPrice) && pick.pickedPrice !== 0
      ? pick.pickedPrice
      : -110;
    upsert(report.bySignalCombo, stableSignalCombo(pick.signalTypes), pick.gameResult, price);
    upsert(report.byEdgeConfidenceBucket, bucketEdgeConfidence(pick.edgeConfidence), pick.gameResult, price);
    upsert(
      report.byModelProbabilityBucket,
      bucketProbability(deriveHistoricalGameModelProbability(pick) ?? undefined),
      pick.gameResult,
      price,
    );
  }

  return report;
}

export function getNCAACalibrationAdjustment(
  candidate: DecisionCandidate,
  report?: NCAACalibrationStatsReport,
): NCAACalibrationAdjustment | null {
  const sportKey = String(candidate.sportKey ?? '').toLowerCase();
  if (candidate.marketType !== 'game_line' || !isNCAAGameSportKey(sportKey)) {
    return null;
  }

  const calibration = report ?? buildNCAACalibrationStatsReport();
  let multiplier = 0;
  const reasons: string[] = [];

  const signalComboKey = stableSignalCombo(candidate.signals);
  const signalComboStats = calibration.bySignalCombo[signalComboKey];
  if (signalComboStats && signalComboStats.sampleSize >= 10) {
    if (signalComboStats.winRate < 55) {
      multiplier -= 0.05;
      reasons.push(`combo ${signalComboStats.winRate.toFixed(1)}% over ${signalComboStats.sampleSize}`);
    } else if (signalComboStats.winRate > 60) {
      multiplier += 0.03;
      reasons.push(`combo ${signalComboStats.winRate.toFixed(1)}% over ${signalComboStats.sampleSize}`);
    }
  }

  const edgeBucketKey = bucketEdgeConfidence(candidate.edgeConfidence);
  const edgeBucketStats = calibration.byEdgeConfidenceBucket[edgeBucketKey];
  if (edgeBucketStats && edgeBucketStats.sampleSize >= 10) {
    if (edgeBucketStats.winRate < 55) {
      multiplier -= 0.05;
      reasons.push(`edgeConf ${edgeBucketKey} -> ${edgeBucketStats.winRate.toFixed(1)}% over ${edgeBucketStats.sampleSize}`);
    } else if (edgeBucketStats.winRate > 60) {
      multiplier += 0.03;
      reasons.push(`edgeConf ${edgeBucketKey} -> ${edgeBucketStats.winRate.toFixed(1)}% over ${edgeBucketStats.sampleSize}`);
    }
  }

  const probabilityBucketKey = bucketProbability(candidate.winProbability);
  const probabilityBucketStats = calibration.byModelProbabilityBucket[probabilityBucketKey];
  if (probabilityBucketStats && probabilityBucketStats.sampleSize >= 10) {
    if (probabilityBucketStats.winRate < 55) {
      multiplier -= 0.05;
      reasons.push(`modelProb ${probabilityBucketKey} -> ${probabilityBucketStats.winRate.toFixed(1)}% over ${probabilityBucketStats.sampleSize}`);
    } else if (probabilityBucketStats.winRate > 60) {
      multiplier += 0.03;
      reasons.push(`modelProb ${probabilityBucketKey} -> ${probabilityBucketStats.winRate.toFixed(1)}% over ${probabilityBucketStats.sampleSize}`);
    }
  }

  const clampedMultiplier = Math.max(-0.05, Math.min(0.05, multiplier));
  if (clampedMultiplier === 0 || reasons.length === 0) return null;

  return {
    multiplier: Math.round(clampedMultiplier * 1000) / 1000,
    reasons,
  };
}

export function applyNCAACalibrationWeighting(
  candidates: DecisionCandidate[],
  report?: NCAACalibrationStatsReport,
): DecisionCandidate[] {
  const calibration = report ?? buildNCAACalibrationStatsReport();
  return candidates.map(candidate => {
    const adjustment = getNCAACalibrationAdjustment(candidate, calibration);
    if (!adjustment || candidate.adjustedEdge === undefined) return candidate;

    const preCalibrationAdjustedEdge = candidate.adjustedEdge;
    const calibratedAdjustedEdge = Math.round(
      preCalibrationAdjustedEdge * (1 + adjustment.multiplier) * 1000
    ) / 1000;

    return {
      ...candidate,
      preCalibrationAdjustedEdge,
      adjustedEdge: calibratedAdjustedEdge,
      calibrationMultiplier: adjustment.multiplier,
      calibrationReasons: adjustment.reasons,
    };
  });
}

export function getCalibrationDisplayForCandidate(
  candidate: DecisionCandidate,
  report?: CalibrationReport,
): CandidateCalibrationDisplay | null {
  if (
    candidate.marketType !== 'player_prop' ||
    (
      candidate.sportKey !== 'basketball_nba' &&
      candidate.sportKey !== 'baseball_mlb' &&
      candidate.sportKey !== 'icehockey_nhl'
    )
  ) {
    return null;
  }

  const calibration = report ?? buildCalibrationReport();
  const sportKey = String(candidate.sportKey ?? 'unknown').toLowerCase();
  const propType = (candidate.market ?? 'unknown').toLowerCase();
  const edgeBucket = bucketEdgeConfidence(candidate.edgeConfidence);
  const probabilityBucket = bucketProbability(candidate.probability);
  const propTypeKey = `${sportKey} | ${propType}`;
  const comboKey = `${sportKey} | ${propType} | edge:${edgeBucket} | prob:${probabilityBucket}`;
  const bestMatch = calibration.byPropTypeAndEdgeProbabilityBucket[comboKey];

  if (bestMatch && bestMatch.sampleSize >= MIN_DISPLAY_SAMPLE_SIZE) {
    return {
      historicalWinRate: bestMatch.winRate,
      sampleSize: bestMatch.sampleSize,
      roi: bestMatch.roi,
      sourceKey: comboKey,
    };
  }

  const propTypeOnly = calibration.byPropType[propTypeKey];
  if (propTypeOnly && propTypeOnly.sampleSize >= MIN_DISPLAY_SAMPLE_SIZE) {
    return {
      historicalWinRate: propTypeOnly.winRate,
      sampleSize: propTypeOnly.sampleSize,
      roi: propTypeOnly.roi,
      sourceKey: propTypeKey,
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
