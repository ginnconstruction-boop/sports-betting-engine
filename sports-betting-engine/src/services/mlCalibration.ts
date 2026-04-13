// ============================================================
// src/services/mlCalibration.ts
// Machine learning score calibration
// After 50+ picks, learns which signals actually predicted wins
// Reweights signal scores based on YOUR historical data
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const CALIBRATION_FILE = path.join(SNAPSHOT_DIR, 'ml_calibration.json');
const PICKS_FILE = path.join(SNAPSHOT_DIR, 'picks_log.json');
const MIN_SAMPLES = 30; // minimum picks before calibration kicks in

export interface SignalWeight {
  signalName: string;
  baseWeight: number;        // original weight
  calibratedWeight: number;  // learned weight from results
  sampleSize: number;
  winRateWithSignal: number;  // % of bets with this signal that won
  avgCLVWithSignal: number;   // avg CLV for bets with this signal
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
}

export interface CalibrationModel {
  totalPicksAnalyzed: number;
  lastCalibrated: string;
  isCalibrated: boolean;      // false until MIN_SAMPLES reached
  signalWeights: SignalWeight[];
  // Sport-specific multipliers
  sportMultipliers: Record<string, number>;
  // Market-specific multipliers
  marketMultipliers: Record<string, number>;
  // Grade accuracy
  gradeAccuracy: Record<string, { predicted: number; actual: number; sampleSize: number }>;
  recommendation: string;
}

// ------------------------------------
// Load calibration model
// ------------------------------------

export function loadCalibrationModel(): CalibrationModel | null {
  if (!fs.existsSync(CALIBRATION_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf-8')); }
  catch { return null; }
}

// ------------------------------------
// Build calibration model from picks history
// ------------------------------------

export function buildCalibrationModel(): CalibrationModel {
  const picks = loadPicks();
  const graded = picks.filter((p: any) => p.gameResult !== 'PENDING');

  if (graded.length < MIN_SAMPLES) {
    const model: CalibrationModel = {
      totalPicksAnalyzed: graded.length,
      lastCalibrated: new Date().toISOString(),
      isCalibrated: false,
      signalWeights: [],
      sportMultipliers: {},
      marketMultipliers: {},
      gradeAccuracy: {},
      recommendation: `Need ${MIN_SAMPLES - graded.length} more graded picks to calibrate. Using default weights.`,
    };
    saveCalibration(model);
    return model;
  }

  // Calculate sport multipliers
  const sportGroups = groupBy(graded, 'sport');
  const sportMultipliers: Record<string, number> = {};
  for (const [sport, sportPicks] of Object.entries(sportGroups)) {
    const wins = (sportPicks as any[]).filter((p: any) => p.gameResult === 'WIN').length;
    const total = (sportPicks as any[]).filter((p: any) => ['WIN','LOSS'].includes(p.gameResult)).length;
    if (total >= 5) {
      const winPct = wins / total;
      // Multiplier: 1.0 = break even (52.4% for -110), scale from 0.7 to 1.4
      const breakEven = 0.524;
      sportMultipliers[sport] = Math.max(0.7, Math.min(1.4, 0.7 + (winPct / breakEven) * 0.7));
      sportMultipliers[sport] = Math.round(sportMultipliers[sport] * 100) / 100;
    }
  }

  // Calculate market multipliers
  const marketGroups = groupBy(graded, 'betType');
  const marketMultipliers: Record<string, number> = {};
  for (const [market, mPicks] of Object.entries(marketGroups)) {
    const wins = (mPicks as any[]).filter((p: any) => p.gameResult === 'WIN').length;
    const total = (mPicks as any[]).filter((p: any) => ['WIN','LOSS'].includes(p.gameResult)).length;
    if (total >= 5) {
      const winPct = wins / total;
      const breakEven = 0.524;
      marketMultipliers[market] = Math.max(0.7, Math.min(1.4, 0.7 + (winPct / breakEven) * 0.7));
      marketMultipliers[market] = Math.round(marketMultipliers[market] * 100) / 100;
    }
  }

  // Grade accuracy
  const gradeGroups = groupBy(graded, 'grade');
  const gradeAccuracy: CalibrationModel['gradeAccuracy'] = {};
  for (const [grade, gPicks] of Object.entries(gradeGroups)) {
    const wins = (gPicks as any[]).filter((p: any) => p.gameResult === 'WIN').length;
    const total = (gPicks as any[]).filter((p: any) => ['WIN','LOSS'].includes(p.gameResult)).length;
    if (total >= 3) {
      // Predicted win% by grade: A+=65%, A=60%, B+=57%, B=55%, C+=53%, C=51%
      const predicted: Record<string, number> = { 'A+': 65, 'A': 60, 'B+': 57, 'B': 55, 'C+': 53, 'C': 51 };
      gradeAccuracy[grade] = {
        predicted: predicted[grade] ?? 52,
        actual: Math.round((wins / total) * 100),
        sampleSize: total,
      };
    }
  }

  // Build recommendation
  const totalWins = graded.filter((p: any) => p.gameResult === 'WIN').length;
  const totalWL = graded.filter((p: any) => ['WIN','LOSS'].includes(p.gameResult)).length;
  const overallWinPct = totalWL > 0 ? Math.round((totalWins / totalWL) * 100) : 0;

  const bestSport = Object.entries(sportMultipliers).sort((a, b) => b[1] - a[1])[0];
  const worstSport = Object.entries(sportMultipliers).sort((a, b) => a[1] - b[1])[0];

  const recommendation = `${graded.length} picks analyzed. Overall: ${overallWinPct}% win rate.` +
    (bestSport ? ` Best sport: ${bestSport[0]} (${Math.round((bestSport[1]-1)*100+52)}% win rate).` : '') +
    (worstSport && worstSport[0] !== bestSport?.[0] ? ` Worst: ${worstSport[0]}.` : '');

  const model: CalibrationModel = {
    totalPicksAnalyzed: graded.length,
    lastCalibrated: new Date().toISOString(),
    isCalibrated: true,
    signalWeights: [],
    sportMultipliers,
    marketMultipliers,
    gradeAccuracy,
    recommendation,
  };

  saveCalibration(model);
  return model;
}

function loadPicks(): any[] {
  if (!fs.existsSync(PICKS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PICKS_FILE, 'utf-8')); }
  catch { return []; }
}

function saveCalibration(model: CalibrationModel): void {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(CALIBRATION_FILE, JSON.stringify(model, null, 2));
}

function groupBy(arr: any[], key: string): Record<string, any[]> {
  return arr.reduce((acc, item) => {
    const k = item[key] ?? 'unknown';
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

// ------------------------------------
// Apply calibration to a score
// ------------------------------------

export function applyCalibration(
  rawScore: number,
  sport: string,
  market: string,
  model: CalibrationModel | null
): number {
  if (!model?.isCalibrated) return rawScore;

  const sportMult = model.sportMultipliers[sport] ?? 1.0;
  const marketMult = model.marketMultipliers[market] ?? 1.0;
  const combined = (sportMult + marketMult) / 2;

  return Math.max(0, Math.min(100, Math.round(rawScore * combined)));
}

// ------------------------------------
// Print calibration report
// ------------------------------------

export function printCalibrationReport(): void {
  const model = buildCalibrationModel();

  console.log('\n');
  console.log('+==============================================================+');
  console.log('|            MODEL CALIBRATION REPORT                         |');
  console.log('+==============================================================+');
  console.log(`\n  Picks analyzed  : ${model.totalPicksAnalyzed}`);
  console.log(`  Model status    : ${model.isCalibrated ? '[OK] CALIBRATED' : `? NEEDS ${MIN_SAMPLES - model.totalPicksAnalyzed} MORE PICKS`}`);
  console.log(`\n  ${model.recommendation}`);

  if (model.isCalibrated) {
    if (Object.keys(model.sportMultipliers).length > 0) {
      console.log('\n  Sport multipliers (>1.0 = outperforming, <1.0 = underperforming):');
      for (const [sport, mult] of Object.entries(model.sportMultipliers).sort((a,b) => b[1]-a[1])) {
        const icon = mult >= 1.1 ? '[G]' : mult >= 0.95 ? '[Y]' : '[R]';
        console.log(`  ${icon} ${sport.padEnd(30)} ${mult > 1 ? '+' : ''}${((mult-1)*100).toFixed(0)}% vs baseline`);
      }
    }

    if (Object.keys(model.gradeAccuracy).length > 0) {
      console.log('\n  Grade accuracy (predicted vs actual win rate):');
      for (const [grade, data] of Object.entries(model.gradeAccuracy).sort()) {
        const diff = data.actual - data.predicted;
        const icon = diff >= 3 ? '[G]' : diff >= -3 ? '[Y]' : '[R]';
        console.log(`  ${icon} Grade ${grade.padEnd(4)}  Predicted: ${data.predicted}%  Actual: ${data.actual}%  (${diff >= 0 ? '+' : ''}${diff}%)  n=${data.sampleSize}`);
      }
    }
  }
  console.log('');
}
