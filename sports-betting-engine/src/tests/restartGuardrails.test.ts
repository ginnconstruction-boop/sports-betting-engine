import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSaveAsOfficialRecommendation } from '../services/closingLineTracker';
import { applyFootballGuardrails, FOOTBALL_MIN_GRADED_SAMPLES } from '../services/footballGuardrail';
import { DecisionCandidate } from '../services/decisionTypes';
import { getNCAACalibrationAdjustment, NCAACalibrationStatsReport } from '../services/calibrationEngine';
import { scoreFromMLBScheduleData } from '../services/retroAnalysis';

function candidate(overrides: Partial<DecisionCandidate> = {}): DecisionCandidate {
  return {
    id: 'game__Spread__Home',
    sport: 'NCAAF',
    sportKey: 'americanfootball_ncaaf',
    marketType: 'game_line',
    matchup: 'Away @ Home',
    side: 'Home',
    betType: 'Spread',
    bestBook: 'FanDuel',
    bestPrice: -110,
    consensusPrice: -115,
    priceDiff: 5,
    score: 85,
    signalCount: 3,
    bookCount: 7,
    tier: 'BET',
    grade: 'A',
    qualificationPassed: true,
    qualificationReasons: [],
    rejectionReasons: [],
    adjustedEdge: 0.08,
    finalDecisionLabel: 'BET',
    finalGrade: 'A',
    labelReasons: ['base label'],
    ...overrides,
  };
}

test('official restart policy only accepts BET moneylines and spreads', () => {
  assert.equal(shouldSaveAsOfficialRecommendation({ recommendedLabel: 'BET', marketType: 'game_line', betType: 'Spread' }), true);
  assert.equal(shouldSaveAsOfficialRecommendation({ recommendedLabel: 'BET', marketType: 'game_line', betType: 'Moneyline' }), true);
  assert.equal(shouldSaveAsOfficialRecommendation({ recommendedLabel: 'LEAN', marketType: 'game_line', betType: 'Spread' }), false);
  assert.equal(shouldSaveAsOfficialRecommendation({ recommendedLabel: 'BET', marketType: 'game_line', betType: 'Total' }), false);
  assert.equal(shouldSaveAsOfficialRecommendation({ recommendedLabel: 'BET', marketType: 'player_prop', betType: 'Player Prop' }), false);
});

test('football BET is capped at LEAN until 20 graded comparable picks', () => {
  const [result] = applyFootballGuardrails([candidate()], []);
  assert.equal(result.finalDecisionLabel, 'LEAN');
  assert.equal(result.footballGuardrailActive, true);
  assert.equal(result.footballHistorySampleSize, 0);
});

test('football totals stay research-only even after 20 positive results', () => {
  const positiveHistory = Array.from({ length: FOOTBALL_MIN_GRADED_SAMPLES }, () => ({
    sport: 'NCAAF', sportKey: 'americanfootball_ncaaf', marketType: 'game_line',
    betType: 'Total', pickedPrice: -110, gameResult: 'WIN',
  }));
  const [positive] = applyFootballGuardrails([candidate({ betType: 'Total' })], positiveHistory);
  assert.equal(positive.finalDecisionLabel, 'MONITOR');

  const negativeHistory = positiveHistory.map(p => ({ ...p, gameResult: 'LOSS' }));
  const [negative] = applyFootballGuardrails([candidate({ betType: 'Total' })], negativeHistory);
  assert.equal(negative.finalDecisionLabel, 'MONITOR');
});

test('NCAA calibration does not leak baseball performance into NCAAF', () => {
  const stats = { sampleSize: 20, wins: 14, losses: 6, pushes: 0, winRate: 70, roi: 20 };
  const report: NCAACalibrationStatsReport = {
    totalTracked: 20,
    totalGraded: 20,
    bySignalCombo: { 'baseball_ncaa | SHARP_INTEL': stats },
    byEdgeConfidenceBucket: { 'baseball_ncaa | unknown': stats },
    byModelProbabilityBucket: { 'baseball_ncaa | 60-65': stats },
  };
  assert.equal(getNCAACalibrationAdjustment(candidate({ signals: ['SHARP_INTEL'], winProbability: 0.61 }), report), null);
});

test('MLB schedule fallback requires both teams and preserves score orientation', () => {
  const payload = {
    dates: [{ games: [{
      status: { abstractGameState: 'Final', detailedState: 'Final' },
      teams: {
        away: { team: { name: 'Seattle Mariners' }, score: 2 },
        home: { team: { name: 'Kansas City Royals' }, score: 0 },
      },
    }] }],
  };
  assert.deepEqual(scoreFromMLBScheduleData(payload, 'Kansas City Royals', 'Seattle Mariners'), {
    homeScore: 0, awayScore: 2, final: true, source: 'MLB_STATSAPI_SCHEDULE',
  });
  assert.equal(scoreFromMLBScheduleData(payload, 'Milwaukee Brewers', 'Seattle Mariners'), null);
});

test('MLB schedule fallback chooses the game closest to the stored start time in a series', () => {
  const payload = {
    dates: [{ games: [
      {
        gameDate: '2026-05-23T20:00:00Z',
        status: { abstractGameState: 'Final', detailedState: 'Final' },
        teams: {
          away: { team: { name: 'Texas Rangers' }, score: 5 },
          home: { team: { name: 'Los Angeles Angels' }, score: 2 },
        },
      },
      {
        gameDate: '2026-05-23T01:38:00Z',
        status: { abstractGameState: 'Final', detailedState: 'Final' },
        teams: {
          away: { team: { name: 'Texas Rangers' }, score: 6 },
          home: { team: { name: 'Los Angeles Angels' }, score: 9 },
        },
      },
    ] }],
  };
  assert.deepEqual(
    scoreFromMLBScheduleData(payload, 'Los Angeles Angels', 'Texas Rangers', '2026-05-23T01:39:00Z'),
    { homeScore: 9, awayScore: 6, final: true, source: 'MLB_STATSAPI_SCHEDULE' },
  );
});
