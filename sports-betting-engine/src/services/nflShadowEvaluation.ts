import { NflObservation } from './nflResearch';
import { nflPointForecast } from './nflForecast';
import { nflShareShadowForecast } from './nflWorkloadContext';

export function evaluateNflShareShadow(rows: Array<NflObservation & { teamOpportunity?: number }>, start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('Invalid evaluation window.');
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.eventId || seen.has(row.eventId) || !Number.isFinite(Date.parse(row.date))) throw new Error('Invalid/duplicate shadow event.');
    seen.add(row.eventId);
  }
  const ordered = [...rows].sort((a,b) => Date.parse(a.date) - Date.parse(b.date));
  const tests = [], excluded = [];
  for (const target of ordered.filter(r => Date.parse(r.date) >= start && Date.parse(r.date) < end)) {
    // Same chronological last-20 window, no cherry-picking older complete rows.
    const history = ordered.filter(r => r.teamId === target.teamId && Date.parse(r.date) < Date.parse(target.date)).slice(-20);
    const baseline = nflPointForecast(history), candidate = nflShareShadowForecast(history);
    if (!baseline || !candidate || !Number.isFinite(target.value) || !Number.isInteger(target.teamOpportunity) || target.teamOpportunity <= 0) {
      excluded.push({ eventId: target.eventId, date: target.date, reason: 'Insufficient or incomplete prior-game training evidence.' }); continue;
    }
    tests.push({ eventId: target.eventId, date: target.date, trainingThrough: history.at(-1).date,
      trainingEventIds: history.map(r => r.eventId), actual: target.value,
      meanPrediction: baseline.baseline, workloadPrediction: baseline.projection, shadowPrediction: candidate.projection });
  }
  const avg = (xs: number[]) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
  return { tested: tests.length, excluded, tests,
    meanMae: avg(tests.map(t => Math.abs(t.actual - t.meanPrediction))),
    workloadMae: avg(tests.map(t => Math.abs(t.actual - t.workloadPrediction))),
    shadowMae: avg(tests.map(t => Math.abs(t.actual - t.shadowPrediction))),
    shadowImprovedGamesVsWorkload: tests.filter(t => Math.abs(t.actual - t.shadowPrediction) < Math.abs(t.actual - t.workloadPrediction)).length,
    distinctGames: new Set(tests.map(t=>t.eventId)).size, promoted: false,
    note: 'Fixed chronological stat-forecast comparison using revised public logs. Not historical bet results, independent probability calibration or prospective validation.' };
}
