// ============================================================
// src/services/retroAnalysis.ts
// Retrospective analysis -- runs automatically each morning
// Checks yesterday's picks against ESPN scores
// Identifies what signals were on wins vs losses
// Adjusts signal weights based on actual results
// ============================================================

import https from 'https';
import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const PICKS_FILE   = path.join(SNAPSHOT_DIR, 'picks_log.json');
const RETRO_FILE   = path.join(SNAPSHOT_DIR, 'retro_analysis.json');
const WEIGHTS_FILE = path.join(SNAPSHOT_DIR, 'signal_weights.json');
const CLV_WEIGHTS_FILE = path.join(SNAPSHOT_DIR, 'clv_weights.json');

// ------------------------------------
// Types
// ------------------------------------

export interface RetroResult {
  pickId: string;
  date: string;
  matchup: string;
  sport: string;
  betType: string;
  side: string;
  line: number | null;
  grade: string;
  score: number;
  signals: string[];           // signal types that fired
  gameResult: 'WIN' | 'LOSS' | 'PUSH' | 'PENDING';
  actualScore: string | null;  // "112-108" etc
  margin: number | null;       // how much we won/lost by vs the line
  clvActual: number | null;    // actual closing line value
  missedSignals: string[];     // signals that WOULD have helped if present
  autoGraded: boolean;
}

export interface SignalPerformance {
  signalType: string;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  avgScoreWhenPresent: number;
  avgScoreWhenAbsent: number;
  liftVsBaseline: number;      // how much this signal improves win rate
  shouldBoost: boolean;        // true = signal is genuinely predictive
  shouldPenalize: boolean;     // true = signal is noise or misleading
  recommendedWeight: number;   // 0.5-2.0 multiplier
}

export interface RetroReport {
  dateAnalyzed: string;
  picksAnalyzed: number;
  autoGraded: number;
  overallRecord: { wins: number; losses: number; pushes: number; winRate: number };
  byGrade: Record<string, { wins: number; losses: number; winRate: number }>;
  bySport: Record<string, { wins: number; losses: number; winRate: number }>;
  byBetType: Record<string, { wins: number; losses: number; winRate: number }>;
  signalPerformance: SignalPerformance[];
  topMissedSignals: string[];   // signals that were absent on most losses
  weightAdjustments: Record<string, number>;  // signal -> new multiplier
  insights: string[];
}

// ------------------------------------
// HTTP helper
// ------------------------------------

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Parse')); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ------------------------------------
// ESPN score lookup
// ------------------------------------

const ESPN_LEAGUES: Record<string, { sport: string; league: string }> = {
  basketball_nba:          { sport: 'basketball',   league: 'nba' },
  baseball_mlb:            { sport: 'baseball',     league: 'mlb' },
  americanfootball_nfl:    { sport: 'football',     league: 'nfl' },
  americanfootball_ncaaf:  { sport: 'football',     league: 'college-football' },
  basketball_ncaab:        { sport: 'basketball',   league: 'mens-college-basketball' },
  icehockey_nhl:           { sport: 'hockey',       league: 'nhl' },
};

// Multi-word team name matching -- tries last word, full name, abbreviations
function teamsMatch(searchHome: string, searchAway: string, nameA: string, nameB: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const words = (s: string) => norm(s).split(' ');
  const last = (s: string) => words(s).pop() ?? '';
  const abbrev = (s: string) => words(s).map(w => w[0]).join('');

  const h = norm(searchHome);
  const a = norm(searchAway);
  const n1 = norm(nameA);
  const n2 = norm(nameB);

  // Try matching both teams to both names in either order
  const matchPair = (t1: string, t2: string, n1: string, n2: string): boolean => {
    const checks = [
      () => (n1.includes(last(t1)) || last(n1) === last(t1) || abbrev(t1) === abbrev(n1)) &&
            (n2.includes(last(t2)) || last(n2) === last(t2) || abbrev(t2) === abbrev(n2)),
      () => n1.includes(t1) || t1.includes(n1),
      () => n2.includes(t2) || t2.includes(n2),
    ];
    return checks.some(c => { try { return c(); } catch { return false; } });
  };

  return matchPair(h, a, n1, n2) || matchPair(h, a, n2, n1) ||
         matchPair(a, h, n1, n2) || matchPair(a, h, n2, n1);
}

// Source 1: ESPN scoreboard API
async function getScoreFromESPN(
  sportKey: string, homeTeam: string, awayTeam: string, gameDate: string
): Promise<{ homeScore: number; awayScore: number; final: boolean } | null> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;
  try {
    const date = gameDate.split('T')[0].replace(/-/g, '');
    // Try both the game date and the day after (for late night games)
    const dates = [date];
    const d = new Date(gameDate);
    d.setDate(d.getDate() + 1);
    dates.push(d.toISOString().split('T')[0].replace(/-/g, ''));

    for (const tryDate of dates) {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/scoreboard?dates=${tryDate}`;
      const data = await fetchJson(url);
      const events = Array.isArray(data?.events) ? data.events : [];

      const event = events.find((e: any) => {
        const competitors = e?.competitions?.[0]?.competitors ?? [];
        const names = competitors.map((c: any) => c?.team?.displayName ?? '');
        const shorts = competitors.map((c: any) => c?.team?.shortDisplayName ?? '');
        const abbrevs = competitors.map((c: any) => c?.team?.abbreviation ?? '');
        const allNames = [...names, ...shorts, ...abbrevs];
        if (allNames.length < 2) return false;
        return teamsMatch(homeTeam, awayTeam, allNames[0], allNames[1]) ||
               teamsMatch(homeTeam, awayTeam, allNames[2] ?? allNames[0], allNames[3] ?? allNames[1]);
      });

      if (!event) continue;
      const comp = event?.competitions?.[0];
      if (comp?.status?.type?.completed !== true) continue;
      const competitors = comp?.competitors ?? [];
      const home = competitors.find((c: any) => c?.homeAway === 'home');
      const away = competitors.find((c: any) => c?.homeAway === 'away');
      const homeScore = parseFloat(home?.score ?? '0');
      const awayScore = parseFloat(away?.score ?? '0');
      if (homeScore === 0 && awayScore === 0) continue;
      return { homeScore, awayScore, final: true };
    }
    return null;
  } catch { return null; }
}

// Source 2: ESPN summary API (different endpoint, more reliable for older games)
async function getScoreFromESPNSummary(
  sportKey: string, homeTeam: string, awayTeam: string, gameDate: string
): Promise<{ homeScore: number; awayScore: number; final: boolean } | null> {
  const league = ESPN_LEAGUES[sportKey];
  if (!league) return null;
  try {
    const date = gameDate.split('T')[0].replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/scoreboard?dates=${date}&limit=50`;
    const data = await fetchJson(url);
    const events = Array.isArray(data?.events) ? data.events : [];

    for (const event of events) {
      const comp = event?.competitions?.[0];
      if (!comp) continue;
      const competitors = comp.competitors ?? [];
      if (competitors.length < 2) continue;
      const teamNames = competitors.flatMap((c: any) => [
        c?.team?.displayName ?? '',
        c?.team?.name ?? '',
        c?.team?.shortDisplayName ?? '',
        c?.team?.abbreviation ?? '',
      ]).filter(Boolean);

      // Try every combination
      let matched = false;
      for (let i = 0; i < teamNames.length - 1; i++) {
        for (let j = i + 1; j < teamNames.length; j++) {
          if (teamsMatch(homeTeam, awayTeam, teamNames[i], teamNames[j])) {
            matched = true; break;
          }
        }
        if (matched) break;
      }
      if (!matched) continue;
      if (comp?.status?.type?.completed !== true) continue;

      const home = competitors.find((c: any) => c?.homeAway === 'home');
      const away = competitors.find((c: any) => c?.homeAway === 'away');
      const homeScore = parseFloat(home?.score ?? '0');
      const awayScore = parseFloat(away?.score ?? '0');
      if (homeScore === 0 && awayScore === 0) continue;
      return { homeScore, awayScore, final: true };
    }
    return null;
  } catch { return null; }
}

// Master score lookup -- tries multiple sources, returns first hit
async function getGameScore(
  sportKey: string,
  homeTeam: string,
  awayTeam: string,
  gameDate: string
): Promise<{ homeScore: number; awayScore: number; final: boolean } | null> {
  // Try ESPN scoreboard (primary)
  const espn1 = await getScoreFromESPN(sportKey, homeTeam, awayTeam, gameDate);
  if (espn1) return espn1;

  // Try ESPN summary endpoint (fallback -- handles late night / next-day results)
  const espn2 = await getScoreFromESPNSummary(sportKey, homeTeam, awayTeam, gameDate);
  if (espn2) return espn2;

  // Try reversed home/away (sometimes matchup string is stored away @ home)
  const espn3 = await getScoreFromESPN(sportKey, awayTeam, homeTeam, gameDate);
  if (espn3) return { homeScore: espn3.awayScore, awayScore: espn3.homeScore, final: true };

  return null;
}

// ------------------------------------
// Determine if a pick won based on score
// ------------------------------------

function evaluatePick(
  betType: string,
  side: string,
  line: number | null,
  homeTeam: string,
  awayTeam: string,
  homeScore: number,
  awayScore: number
): 'WIN' | 'LOSS' | 'PUSH' {
  const last = (s: string) => s?.toLowerCase().split(' ').pop() ?? '';
  const sideIsHome = last(side).includes(last(homeTeam)) || side.toLowerCase().includes('home');
  const margin = homeScore - awayScore; // positive = home won

  if (betType === 'Moneyline' || betType === 'h2h') {
    if (sideIsHome) return homeScore > awayScore ? 'WIN' : homeScore < awayScore ? 'LOSS' : 'PUSH';
    else return awayScore > homeScore ? 'WIN' : awayScore < homeScore ? 'LOSS' : 'PUSH';
  }

  if ((betType === 'Spread' || betType === 'spreads') && line !== null) {
    // line is from the perspective of the side we bet
    const coverMargin = sideIsHome ? (margin + line) : (-margin + line);
    if (coverMargin > 0) return 'WIN';
    if (coverMargin < 0) return 'LOSS';
    return 'PUSH';
  }

  if ((betType === 'Total' || betType === 'totals') && line !== null) {
    const combined = homeScore + awayScore;
    if (side.toLowerCase().includes('over')) {
      return combined > line ? 'WIN' : combined < line ? 'LOSS' : 'PUSH';
    } else {
      return combined < line ? 'WIN' : combined > line ? 'LOSS' : 'PUSH';
    }
  }

  return 'PUSH';
}

// ------------------------------------
// Load/save data
// ------------------------------------

function loadPicks(): any[] {
  if (!fs.existsSync(PICKS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PICKS_FILE, 'utf-8')); }
  catch { return []; }
}

function savePicks(picks: any[]): void {
  fs.writeFileSync(PICKS_FILE, JSON.stringify(picks, null, 2));
}

function loadRetroResults(): RetroResult[] {
  if (!fs.existsSync(RETRO_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(RETRO_FILE, 'utf-8')); }
  catch { return []; }
}

function saveRetroResults(results: RetroResult[]): void {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(RETRO_FILE, JSON.stringify(results, null, 2));
}

export function loadSignalWeights(): Record<string, number> {
  if (!fs.existsSync(WEIGHTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(WEIGHTS_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveSignalWeights(weights: Record<string, number>): void {
  fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(weights, null, 2));
}

// ------------------------------------
// Auto-grade picks from ESPN scores
// ------------------------------------

export async function autoGradePicks(): Promise<number> {
  const picks = loadPicks();
  const existingRetro = loadRetroResults();
  const gradedIds = new Set(existingRetro.map(r => r.pickId));

  let newlyGraded = 0;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const cutoff = yesterday.toISOString();

  const toGrade = picks.filter((p: any) => {
    // gameTime is the correct field name (startTime was old name)
    const gameTime = p.gameTime ?? p.startTime;
    return (
      (p.gameResult === 'PENDING' || !p.gameResult) &&
      gameTime &&
      gameTime < cutoff &&
      !gradedIds.has(p.id ?? p.pickId ?? `${p.matchup}_${p.date}`)
    );
  });

  for (const pick of toGrade) {
    try {
      const [away, home] = (pick.matchup ?? '').split(' @ ');
      if (!away || !home) continue;

      const score = await getGameScore(
        (() => {
          const s = pick.sport ?? pick.sportKey ?? 'basketball_nba';
          // Normalize short names to full sport keys
          if (s === 'NBA') return 'basketball_nba';
          if (s === 'NFL') return 'americanfootball_nfl';
          if (s === 'MLB') return 'baseball_mlb';
          if (s === 'NHL') return 'icehockey_nhl';
          if (s === 'NCAAB') return 'basketball_ncaab';
          if (s === 'NCAAF') return 'americanfootball_ncaaf';
          return s;
        })(),
        home.trim(), away.trim(),
        pick.gameTime ?? pick.startTime ?? pick.date
      );

      if (!score || !score.final) continue;

      const result = evaluatePick(
        pick.betType ?? '', pick.side ?? '',
        pick.line ?? null,
        home.trim(), away.trim(),
        score.homeScore, score.awayScore
      );

      // Update picks log
      const pickIdx = picks.findIndex((p: any) =>
        (p.id ?? p.pickId ?? `${p.matchup}_${p.date}`) ===
        (pick.id ?? pick.pickId ?? `${pick.matchup}_${pick.date}`)
      );
      if (pickIdx >= 0) {
        picks[pickIdx].gameResult = result;
        picks[pickIdx].actualScore = `${score.homeScore}-${score.awayScore}`;
        picks[pickIdx].autoGraded = true;
      }

      // Build retro result with missed signal analysis
      const missedSignals = analyzeMissedSignals(pick, result);

      existingRetro.push({
        pickId: pick.id ?? pick.pickId ?? `${pick.matchup}_${pick.date}`,
        date: pick.date ?? pick.startTime?.split('T')[0],
        matchup: pick.matchup,
        sport: pick.sport,
        betType: pick.betType,
        side: pick.side,
        line: pick.line ?? null,
        grade: pick.grade,
        score: pick.score,
        signals: pick.signals ?? [],
        gameResult: result,
        actualScore: `${score.homeScore}-${score.awayScore}`,
        margin: null,
        clvActual: null,
        missedSignals,
        autoGraded: true,
      });

      newlyGraded++;
    } catch { /* individual grading errors are non-fatal */ }
  }

  if (newlyGraded > 0) {
    savePicks(picks);
    saveRetroResults(existingRetro);
  }

  return newlyGraded;
}

// ------------------------------------
// Analyze what signals were MISSING on a losing pick
// ------------------------------------

function analyzeMissedSignals(pick: any, result: 'WIN' | 'LOSS' | 'PUSH'): string[] {
  if (result !== 'LOSS') return [];

  const presentSignals = new Set((pick.signals ?? []).map((s: string) => s.toUpperCase()));
  const fullReasoning = (pick.fullReasoning ?? []).join(' ').toUpperCase();
  const missed: string[] = [];

  // Check for signals that commonly protect against losses
  if (!presentSignals.has('BACK_TO_BACK') && !fullReasoning.includes('B2B') && !fullReasoning.includes('BACK TO BACK')) {
    missed.push('B2B_NOT_CHECKED');
  }
  if (!presentSignals.has('KEY_PLAYER_OUT') && !fullReasoning.includes('INJURY') && !fullReasoning.includes('OUT')) {
    missed.push('INJURY_NOT_CHECKED');
  }
  if (!presentSignals.has('CONFIRMED_RLM') && !presentSignals.has('SHARP_INTEL')) {
    missed.push('NO_SHARP_SIGNAL');
  }
  if (!presentSignals.has('FORM_ADVANTAGE') && !presentSignals.has('HOT_STREAK')) {
    missed.push('NO_FORM_SIGNAL');
  }
  if (!fullReasoning.includes('POWER') && !fullReasoning.includes('RATING')) {
    missed.push('NO_POWER_RATING');
  }

  return missed;
}

// ------------------------------------
// Build full retro analysis report
// ------------------------------------

export function buildRetroReport(): RetroReport {
  const results = loadRetroResults();
  const graded = results.filter(r => r.gameResult !== 'PENDING');

  const wins = graded.filter(r => r.gameResult === 'WIN').length;
  const losses = graded.filter(r => r.gameResult === 'LOSS').length;
  const pushes = graded.filter(r => r.gameResult === 'PUSH').length;
  const wl = wins + losses;
  const winRate = wl > 0 ? Math.round((wins / wl) * 1000) / 10 : 0;

  // By grade
  const byGrade: Record<string, any> = {};
  for (const r of graded) {
    if (!byGrade[r.grade]) byGrade[r.grade] = { wins: 0, losses: 0, pushes: 0 };
    if (r.gameResult === 'WIN') byGrade[r.grade].wins++;
    else if (r.gameResult === 'LOSS') byGrade[r.grade].losses++;
    else byGrade[r.grade].pushes++;
  }
  for (const g of Object.keys(byGrade)) {
    const { wins: w, losses: l } = byGrade[g];
    byGrade[g].winRate = (w + l) > 0 ? Math.round((w / (w + l)) * 1000) / 10 : 0;
  }

  // By sport
  const bySport: Record<string, any> = {};
  for (const r of graded) {
    if (!bySport[r.sport]) bySport[r.sport] = { wins: 0, losses: 0, pushes: 0 };
    if (r.gameResult === 'WIN') bySport[r.sport].wins++;
    else if (r.gameResult === 'LOSS') bySport[r.sport].losses++;
    else bySport[r.sport].pushes++;
  }
  for (const s of Object.keys(bySport)) {
    const { wins: w, losses: l } = bySport[s];
    bySport[s].winRate = (w + l) > 0 ? Math.round((w / (w + l)) * 1000) / 10 : 0;
  }

  // By bet type
  const byBetType: Record<string, any> = {};
  for (const r of graded) {
    const bt = r.betType ?? 'Unknown';
    if (!byBetType[bt]) byBetType[bt] = { wins: 0, losses: 0, pushes: 0 };
    if (r.gameResult === 'WIN') byBetType[bt].wins++;
    else if (r.gameResult === 'LOSS') byBetType[bt].losses++;
    else byBetType[bt].pushes++;
  }
  for (const bt of Object.keys(byBetType)) {
    const { wins: w, losses: l } = byBetType[bt];
    byBetType[bt].winRate = (w + l) > 0 ? Math.round((w / (w + l)) * 1000) / 10 : 0;
  }

  // Signal performance analysis
  const signalTypes = new Set<string>();
  for (const r of graded) {
    for (const s of r.signals) signalTypes.add(s.toUpperCase());
  }

  const signalPerformance: SignalPerformance[] = [];
  for (const sig of signalTypes) {
    const withSignal = graded.filter(r =>
      r.signals.some(s => s.toUpperCase() === sig)
    );
    const withoutSignal = graded.filter(r =>
      !r.signals.some(s => s.toUpperCase() === sig)
    );

    if (withSignal.length < 3) continue; // need at least 3 samples

    const sigWins = withSignal.filter(r => r.gameResult === 'WIN').length;
    const sigLosses = withSignal.filter(r => r.gameResult === 'LOSS').length;
    const sigWL = sigWins + sigLosses;
    const sigWinRate = sigWL > 0 ? Math.round((sigWins / sigWL) * 1000) / 10 : 0;

    const withoutWins = withoutSignal.filter(r => r.gameResult === 'WIN').length;
    const withoutWL = withoutSignal.filter(r => ['WIN','LOSS'].includes(r.gameResult)).length;
    const withoutWinRate = withoutWL > 0 ? Math.round((withoutWins / withoutWL) * 1000) / 10 : winRate;

    const lift = sigWinRate - withoutWinRate;
    const avgScoreWith = withSignal.length > 0
      ? Math.round(withSignal.reduce((s, r) => s + (r.score ?? 0), 0) / withSignal.length)
      : 0;
    const avgScoreWithout = withoutSignal.length > 0
      ? Math.round(withoutSignal.reduce((s, r) => s + (r.score ?? 0), 0) / withoutSignal.length)
      : 0;

    // Recommended weight: 1.0 = neutral, >1 = boost, <1 = penalize
    const recommendedWeight =
      lift >= 10 ? 1.4 :
      lift >= 5  ? 1.2 :
      lift >= 0  ? 1.0 :
      lift >= -5 ? 0.8 : 0.6;

    signalPerformance.push({
      signalType: sig,
      wins: sigWins,
      losses: sigLosses,
      pushes: withSignal.filter(r => r.gameResult === 'PUSH').length,
      winRate: sigWinRate,
      avgScoreWhenPresent: avgScoreWith,
      avgScoreWhenAbsent: avgScoreWithout,
      liftVsBaseline: Math.round(lift * 10) / 10,
      shouldBoost: lift >= 5,
      shouldPenalize: lift <= -5,
      recommendedWeight,
    });
  }

  signalPerformance.sort((a, b) => b.liftVsBaseline - a.liftVsBaseline);

  // Top missed signals on losses
  const missedCounts: Record<string, number> = {};
  for (const r of graded.filter(r => r.gameResult === 'LOSS')) {
    for (const m of r.missedSignals) {
      missedCounts[m] = (missedCounts[m] ?? 0) + 1;
    }
  }
  const topMissed = Object.entries(missedCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([sig, count]) => `${sig} (missing on ${count} losses)`);

  // Build weight adjustments
  const weightAdjustments: Record<string, number> = {};
  for (const sp of signalPerformance) {
    if (sp.recommendedWeight !== 1.0 && (sp.wins + sp.losses) >= 5) {
      weightAdjustments[sp.signalType] = sp.recommendedWeight;
    }
  }
  if (Object.keys(weightAdjustments).length > 0) {
    saveSignalWeights(weightAdjustments);
  }

  // Generate insights
  const insights: string[] = [];

  if (wl >= 10) {
    const bestGrade = Object.entries(byGrade)
      .filter(([, d]) => (d.wins + d.losses) >= 3)
      .sort((a, b) => b[1].winRate - a[1].winRate)[0];
    if (bestGrade) insights.push(`Grade ${bestGrade[0]} is your best performing grade at ${bestGrade[1].winRate}% win rate`);

    const bestSport = Object.entries(bySport)
      .filter(([, d]) => (d.wins + d.losses) >= 3)
      .sort((a, b) => b[1].winRate - a[1].winRate)[0];
    if (bestSport) insights.push(`${bestSport[0]} is your most profitable sport at ${bestSport[1].winRate}% win rate`);

    const bestBetType = Object.entries(byBetType)
      .filter(([, d]) => (d.wins + d.losses) >= 3)
      .sort((a, b) => b[1].winRate - a[1].winRate)[0];
    if (bestBetType) insights.push(`${bestBetType[0]} bets are performing best at ${bestBetType[1].winRate}%`);

    const topSignal = signalPerformance.find(s => s.shouldBoost);
    if (topSignal) insights.push(`Signal ${topSignal.signalType} is your strongest predictor (+${topSignal.liftVsBaseline}% lift)`);

    const worstSignal = [...signalPerformance].reverse().find(s => s.shouldPenalize);
    if (worstSignal) insights.push(`Signal ${worstSignal.signalType} may be noise (${worstSignal.liftVsBaseline}% lift) -- consider reducing weight`);
  }

  if (topMissed.length > 0) {
    insights.push(`Most common missing factor on losses: ${topMissed[0]}`);
  }

  if (wl < 10) {
    insights.push(`Only ${wl} graded picks -- need 30+ for statistically meaningful analysis`);
  }

  return {
    dateAnalyzed: new Date().toISOString(),
    picksAnalyzed: graded.length,
    autoGraded: results.filter(r => r.autoGraded).length,
    overallRecord: { wins, losses, pushes, winRate },
    byGrade,
    bySport,
    byBetType,
    signalPerformance,
    topMissedSignals: topMissed,
    weightAdjustments,
    insights,
  };
}

// ------------------------------------
// Print retro report to console
// ------------------------------------

export function printRetroReport(report: RetroReport): void {
  console.log('\n');
  console.log('=================================================================');
  console.log('  RETROSPECTIVE ANALYSIS -- What We Got Right and Wrong');
  console.log('=================================================================');
  console.log(`  Picks analyzed  : ${report.picksAnalyzed}`);
  console.log(`  Auto-graded     : ${report.autoGraded}`);
  console.log(`  Overall record  : ${report.overallRecord.wins}-${report.overallRecord.losses}-${report.overallRecord.pushes}  (${report.overallRecord.winRate}% win rate)`);

  if (report.picksAnalyzed < 5) {
    console.log('\n  Not enough graded picks for meaningful analysis yet.');
    console.log('  Results auto-populate each morning from ESPN scores.');
    console.log('  You can also enter results manually via GO.bat option 12.\n');
    return;
  }

  // By grade
  console.log('\n  -- BY GRADE ------------------------------------');
  for (const [grade, data] of Object.entries(report.byGrade).sort()) {
    const total = data.wins + data.losses;
    if (total < 2) continue;
    const icon = data.winRate >= 55 ? '[+]' : data.winRate >= 50 ? '[~]' : '[-]';
    console.log(`  ${icon} Grade ${grade.padEnd(4)} ${data.wins}-${data.losses}  ${data.winRate}%`);
  }

  // By sport
  console.log('\n  -- BY SPORT ------------------------------------');
  for (const [sport, data] of Object.entries(report.bySport)) {
    const total = data.wins + data.losses;
    if (total < 2) continue;
    const icon = data.winRate >= 55 ? '[+]' : data.winRate >= 50 ? '[~]' : '[-]';
    const label = sport.replace('basketball_','').replace('americanfootball_','').replace('icehockey_','').toUpperCase();
    console.log(`  ${icon} ${label.padEnd(10)} ${data.wins}-${data.losses}  ${data.winRate}%`);
  }

  // By bet type
  console.log('\n  -- BY BET TYPE ---------------------------------');
  for (const [bt, data] of Object.entries(report.byBetType)) {
    const total = data.wins + data.losses;
    if (total < 2) continue;
    const icon = data.winRate >= 55 ? '[+]' : data.winRate >= 50 ? '[~]' : '[-]';
    console.log(`  ${icon} ${bt.padEnd(12)} ${data.wins}-${data.losses}  ${data.winRate}%`);
  }

  // Signal performance
  if (report.signalPerformance.length > 0) {
    console.log('\n  -- SIGNAL PERFORMANCE (min 3 samples) ----------');
    for (const sp of report.signalPerformance.slice(0, 8)) {
      const icon = sp.shouldBoost ? '[+]' : sp.shouldPenalize ? '[-]' : '[~]';
      const lift = sp.liftVsBaseline >= 0 ? `+${sp.liftVsBaseline}%` : `${sp.liftVsBaseline}%`;
      console.log(`  ${icon} ${sp.signalType.padEnd(25)} ${sp.wins}-${sp.losses}  ${sp.winRate}%  lift: ${lift}`);
    }
  }

  // Missed signals on losses
  if (report.topMissedSignals.length > 0) {
    console.log('\n  -- MOST COMMON MISSING FACTORS ON LOSSES -------');
    for (const m of report.topMissedSignals) {
      console.log(`  [!] ${m}`);
    }
  }

  // Weight adjustments applied
  if (Object.keys(report.weightAdjustments).length > 0) {
    console.log('\n  -- SIGNAL WEIGHT ADJUSTMENTS APPLIED -----------');
    for (const [sig, weight] of Object.entries(report.weightAdjustments)) {
      const direction = weight > 1 ? 'boosted' : 'reduced';
      console.log(`  [*] ${sig}: weight ${direction} to ${weight}x`);
    }
    console.log('  These adjustments will apply to todays scoring.');
  }

  // Insights
  if (report.insights.length > 0) {
    console.log('\n  -- KEY INSIGHTS --------------------------------');
    for (const insight of report.insights) {
      console.log(`  >> ${insight}`);
    }
  }

  console.log('');
}

// ------------------------------------
// Apply learned signal weights to a score
// Called from topTenBets and propScorer
// ------------------------------------

export function applyLearnedWeights(
  baseScore: number,
  presentSignals: string[],
  weights: Record<string, number>
): number {
  if (Object.keys(weights).length === 0) return baseScore;

  let multiplier = 1.0;
  let applied = 0;

  for (const sig of presentSignals) {
    const w = weights[sig.toUpperCase()];
    if (w) {
      multiplier = (multiplier + w) / 2; // blend, don't stack
      applied++;
    }
  }

  if (applied === 0) return baseScore;
  return Math.max(0, Math.min(100, Math.round(baseScore * multiplier)));
}

// ------------------------------------
// CLV Auto-Tuning Feedback Loop
// Analyzes which signals produced best Closing Line Value
// ------------------------------------

export interface CLVSignalAnalysis {
  signalCombo: string[];     // list of signals that were present
  avgCLV: number;            // average CLV when this combo present
  sampleSize: number;
  clvEdge: number;           // how much better than baseline CLV
  recommendedBoost: number;  // multiplier to apply: 0.8 - 1.5
}

export interface CLVWeightReport {
  dateAnalyzed: string;
  totalPicksWithCLV: number;
  baselineCLV: number;        // avg CLV across all picks
  topCombos: CLVSignalAnalysis[];
  bottomCombos: CLVSignalAnalysis[];
  signalCLVMap: Record<string, number>;  // signal -> avg CLV when present
  autoAdjustments: Record<string, number>; // signal -> recommended weight multiplier
}

export function buildCLVWeightReport(): CLVWeightReport {
  const picks = loadPicks();
  const picksWithCLV = picks.filter((p: any) => p.clvActual !== null && p.clvActual !== undefined);

  const totalPicksWithCLV = picksWithCLV.length;

  // Baseline CLV = average across all picks with CLV recorded
  const baselineCLV = totalPicksWithCLV > 0
    ? Math.round(
        (picksWithCLV.reduce((s: number, p: any) => s + (p.clvActual ?? 0), 0) / totalPicksWithCLV) * 100
      ) / 100
    : 0;

  // Per-signal CLV analysis
  const signalCLVAccum: Record<string, { sum: number; count: number }> = {};

  for (const pick of picksWithCLV) {
    const signals: string[] = (pick.signals ?? []).map((s: string) => s.toUpperCase());
    for (const sig of signals) {
      if (!signalCLVAccum[sig]) signalCLVAccum[sig] = { sum: 0, count: 0 };
      signalCLVAccum[sig].sum += pick.clvActual ?? 0;
      signalCLVAccum[sig].count++;
    }
  }

  const signalCLVMap: Record<string, number> = {};
  const autoAdjustments: Record<string, number> = {};

  for (const [sig, { sum, count }] of Object.entries(signalCLVAccum)) {
    if (count < 3) continue; // need minimum samples
    const avgCLV = Math.round((sum / count) * 100) / 100;
    signalCLVMap[sig] = avgCLV;

    const clvEdge = avgCLV - baselineCLV;
    let boost: number;
    if (clvEdge > 3) boost = 1.4;
    else if (clvEdge > 1) boost = 1.2;
    else if (clvEdge > -1) boost = 1.0;
    else if (clvEdge < -3) boost = 0.7;
    else boost = 0.8;

    if (boost !== 1.0) autoAdjustments[sig] = boost;
  }

  // Build top/bottom combos -- single-signal analysis
  const allAnalyses: CLVSignalAnalysis[] = Object.entries(signalCLVMap).map(([sig, avgCLV]) => ({
    signalCombo: [sig],
    avgCLV,
    sampleSize: signalCLVAccum[sig]?.count ?? 0,
    clvEdge: Math.round((avgCLV - baselineCLV) * 100) / 100,
    recommendedBoost: autoAdjustments[sig] ?? 1.0,
  }));

  allAnalyses.sort((a, b) => b.clvEdge - a.clvEdge);
  const topCombos = allAnalyses.slice(0, 5);
  const bottomCombos = [...allAnalyses].reverse().slice(0, 5);

  const report: CLVWeightReport = {
    dateAnalyzed: new Date().toISOString(),
    totalPicksWithCLV,
    baselineCLV,
    topCombos,
    bottomCombos,
    signalCLVMap,
    autoAdjustments,
  };

  // Save CLV weights
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(CLV_WEIGHTS_FILE, JSON.stringify(autoAdjustments, null, 2));
  } catch { /* non-fatal */ }

  // Merge CLV adjustments into signal_weights.json
  try {
    const existingWeights = loadSignalWeights();
    const merged: Record<string, number> = { ...existingWeights };
    for (const [sig, boost] of Object.entries(autoAdjustments)) {
      const existing = existingWeights[sig] ?? 1.0;
      // Average the two weight sources
      merged[sig] = Math.round(((existing + boost) / 2) * 100) / 100;
    }
    if (Object.keys(merged).length > 0) {
      saveSignalWeights(merged);
    }
  } catch { /* non-fatal */ }

  return report;
}

export function loadCLVWeights(): Record<string, number> {
  if (!fs.existsSync(CLV_WEIGHTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CLV_WEIGHTS_FILE, 'utf-8')); }
  catch { return {}; }
}
