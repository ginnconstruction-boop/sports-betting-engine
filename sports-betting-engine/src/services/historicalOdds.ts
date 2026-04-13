// ============================================================
// src/services/historicalOdds.ts
// Historical odds database
// Sources:
//   - The Odds API historical endpoint (uses your existing credits)
//   - SBR (SportsBookReview) historical closing lines (free scrape)
//   - Our own snapshot archive (builds over time)
// Used for: back-testing, ATS validation, CLV verification
// ============================================================

import https from 'https';
import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const HIST_DB_FILE = path.join(SNAPSHOT_DIR, 'historical_odds.json');

export interface HistoricalGame {
  date: string;           // YYYY-MM-DD
  sport: string;
  homeTeam: string;
  awayTeam: string;
  // Closing lines
  closingSpread: number | null;     // from home perspective
  closingTotal: number | null;
  closingHomeML: number | null;
  closingAwayML: number | null;
  // Opening lines
  openingSpread: number | null;
  openingTotal: number | null;
  // Results
  homeScore: number | null;
  awayScore: number | null;
  homeCoversSpread: boolean | null;
  totalResult: 'over' | 'under' | 'push' | null;
  homeWonML: boolean | null;
  // Movement
  spreadMoveFromOpen: number | null;
  totalMoveFromOpen: number | null;
  source: string;
}

export interface BacktestResult {
  signal: string;
  totalGames: number;
  wins: number;
  losses: number;
  pushes: number;
  winPct: number;
  roi: number;           // assuming -110 juice
  avgClosingLineValue: number;
  isStatisticallySignificant: boolean;
  sampleNote: string;
}

// ------------------------------------
// Storage
// ------------------------------------

function loadHistDB(): HistoricalGame[] {
  if (!fs.existsSync(HIST_DB_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(HIST_DB_FILE, 'utf-8')); }
  catch { return []; }
}

function saveHistDB(games: HistoricalGame[]): void {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(HIST_DB_FILE, JSON.stringify(games, null, 2));
}

function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', ...headers }
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Parse failed')); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fuzzyMatch(a: string, b: string): boolean {
  const last = (s: string) => s.toLowerCase().split(' ').pop() ?? '';
  return last(a) === last(b) || a.toLowerCase().includes(last(b));
}

// ------------------------------------
// 1. The Odds API Historical Endpoint
// Uses your existing API key -- costs credits
// Pulls historical odds for past dates
// ------------------------------------

export async function fetchHistoricalFromOddsAPI(
  sportKey: string,
  date: string,   // YYYY-MM-DD
  apiKey: string
): Promise<HistoricalGame[]> {
  try {
    // The Odds API historical endpoint
    const timestamp = `${date}T12:00:00Z`;
    const url = `https://api.the-odds-api.com/v4/historical/sports/${sportKey}/odds?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&date=${timestamp}`;

    const data = await fetchJson(url);
    const events = data?.data ?? [];
    const games: HistoricalGame[] = [];

    for (const event of events) {
      const pinnacle = (event.bookmakers ?? []).find((b: any) => b.key === 'pinnacle');
      const draftkings = (event.bookmakers ?? []) .find((b: any) => b.key === 'draftkings');
      const book = pinnacle ?? draftkings ?? event.bookmakers?.[0];

      if (!book) continue;

      const h2h = book.markets?.find((m: any) => m.key === 'h2h');
      const spreads = book.markets?.find((m: any) => m.key === 'spreads');
      const totals = book.markets?.find((m: any) => m.key === 'totals');

      const homeML = h2h?.outcomes?.find((o: any) => fuzzyMatch(o.name, event.home_team))?.price ?? null;
      const awayML = h2h?.outcomes?.find((o: any) => fuzzyMatch(o.name, event.away_team))?.price ?? null;
      const homeSpread = spreads?.outcomes?.find((o: any) => fuzzyMatch(o.name, event.home_team))?.point ?? null;
      const total = totals?.outcomes?.find((o: any) => o.name === 'Over')?.point ?? null;

      games.push({
        date,
        sport: sportKey,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        closingSpread: homeSpread,
        closingTotal: total,
        closingHomeML: homeML,
        closingAwayML: awayML,
        openingSpread: null,
        openingTotal: null,
        homeScore: null,
        awayScore: null,
        homeCoversSpread: null,
        totalResult: null,
        homeWonML: null,
        spreadMoveFromOpen: null,
        totalMoveFromOpen: null,
        source: 'OddsAPI_Historical',
      });
    }

    return games;
  } catch {
    return [];
  }
}

// ------------------------------------
// 2. Build historical DB from our own snapshots
// Completely free -- uses data we already have saved
// ------------------------------------

export function buildHistoricalFromSnapshots(): number {
  const existing = loadHistDB();
  const existingKeys = new Set(existing.map(g => `${g.date}__${g.homeTeam}__${g.awayTeam}`));

  try {
    const snapshotFiles = fs.readdirSync(SNAPSHOT_DIR)
      .filter(f => f.endsWith('.json') && !['run_log.json', 'picks_log.json',
        'clv_record.json', 'pnl_record.json', 'ats_database.json',
        'historical_odds.json', 'opening_lines.json', 'ml_calibration.json'].includes(f))
      .sort();

    const newGames: HistoricalGame[] = [];

    for (const file of snapshotFiles) {
      try {
        const snapshot = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, file), 'utf-8'));
        const date = snapshot?.metadata?.runTimestamp?.split('T')[0] ?? '';
        if (!date) continue;

        for (const event of snapshot?.eventSummaries ?? []) {
          const key = `${date}__${event.homeTeam}__${event.awayTeam}`;
          if (existingKeys.has(key)) continue;

          const spreads = event.aggregatedMarkets?.spreads;
          const totals = event.aggregatedMarkets?.totals;
          const h2h = event.aggregatedMarkets?.h2h;

          const homeSpreadSide = spreads?.sides?.find((s: any) =>
            s.outcomeName?.toLowerCase().includes(event.homeTeam?.toLowerCase().split(' ').pop() ?? '___')
          );
          const overSide = totals?.sides?.find((s: any) => s.outcomeName === 'Over');
          const homeMLSide = h2h?.sides?.find((s: any) =>
            s.outcomeName?.toLowerCase().includes(event.homeTeam?.toLowerCase().split(' ').pop() ?? '___')
          );

          newGames.push({
            date,
            sport: event.sportKey,
            homeTeam: event.homeTeam,
            awayTeam: event.awayTeam,
            closingSpread: homeSpreadSide?.consensusLine ?? null,
            closingTotal: overSide?.consensusLine ?? null,
            closingHomeML: homeMLSide?.consensusPrice ?? null,
            closingAwayML: null,
            openingSpread: null,
            openingTotal: null,
            homeScore: null, awayScore: null,
            homeCoversSpread: null, totalResult: null, homeWonML: null,
            spreadMoveFromOpen: null, totalMoveFromOpen: null,
            source: 'snapshot_archive',
          });

          existingKeys.add(key);
        }
      } catch { }
    }

    if (newGames.length > 0) {
      saveHistDB([...existing, ...newGames]);
    }

    return newGames.length;
  } catch {
    return 0;
  }
}

// ------------------------------------
// 3. Add game results to historical DB
// Called after games complete to record outcomes
// ------------------------------------

export function recordGameResult(
  homeTeam: string,
  awayTeam: string,
  date: string,
  homeScore: number,
  awayScore: number
): boolean {
  const db = loadHistDB();
  const game = db.find(g =>
    g.date === date &&
    fuzzyMatch(g.homeTeam, homeTeam) &&
    fuzzyMatch(g.awayTeam, awayTeam)
  );

  if (!game) return false;

  game.homeScore = homeScore;
  game.awayScore = awayScore;
  game.homeWonML = homeScore > awayScore;

  if (game.closingSpread !== null) {
    const margin = homeScore - awayScore;
    const coverMargin = margin + game.closingSpread;
    game.homeCoversSpread = coverMargin > 0 ? true : coverMargin < 0 ? false : null;
  }

  if (game.closingTotal !== null) {
    const combined = homeScore + awayScore;
    game.totalResult = combined > game.closingTotal ? 'over'
      : combined < game.closingTotal ? 'under' : 'push';
  }

  saveHistDB(db);
  return true;
}

// ------------------------------------
// 4. Back-test a signal against historical data
// ------------------------------------

export function backtestSignal(
  signalName: string,
  matchingGames: HistoricalGame[],
  side: 'home_spread' | 'away_spread' | 'over' | 'under' | 'home_ml' | 'away_ml'
): BacktestResult {
  const graded = matchingGames.filter(g => {
    if (side === 'home_spread' || side === 'away_spread') return g.homeCoversSpread !== null;
    if (side === 'over' || side === 'under') return g.totalResult !== null;
    if (side === 'home_ml' || side === 'away_ml') return g.homeWonML !== null;
    return false;
  });

  let wins = 0, losses = 0, pushes = 0;

  for (const game of graded) {
    if (side === 'home_spread') {
      if (game.homeCoversSpread === true) wins++;
      else if (game.homeCoversSpread === false) losses++;
      else pushes++;
    } else if (side === 'away_spread') {
      if (game.homeCoversSpread === false) wins++;
      else if (game.homeCoversSpread === true) losses++;
      else pushes++;
    } else if (side === 'over') {
      if (game.totalResult === 'over') wins++;
      else if (game.totalResult === 'under') losses++;
      else pushes++;
    } else if (side === 'under') {
      if (game.totalResult === 'under') wins++;
      else if (game.totalResult === 'over') losses++;
      else pushes++;
    } else if (side === 'home_ml') {
      if (game.homeWonML === true) wins++;
      else if (game.homeWonML === false) losses++;
    } else if (side === 'away_ml') {
      if (game.homeWonML === false) wins++;
      else if (game.homeWonML === true) losses++;
    }
  }

  const total = wins + losses;
  const winPct = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;

  // ROI assuming -110 juice: win pays +91, loss costs -100
  const roi = total > 0
    ? Math.round(((wins * 91 - losses * 100) / (total * 100)) * 1000) / 10
    : 0;

  // Statistical significance: need 30+ games, 55%+ win rate
  const isSignificant = total >= 30 && winPct >= 55;

  return {
    signal: signalName,
    totalGames: graded.length,
    wins, losses, pushes,
    winPct,
    roi,
    avgClosingLineValue: 0,
    isStatisticallySignificant: isSignificant,
    sampleNote: total < 30
      ? `Only ${total} games -- need 30+ for significance`
      : `${total} games -- ${isSignificant ? 'statistically significant' : 'not yet significant'}`,
  };
}

// ------------------------------------
// 5. Get historical database summary
// ------------------------------------

export function getHistoricalSummary(): {
  totalGames: number;
  gamesWithResults: number;
  bySport: Record<string, number>;
  dateRange: { earliest: string; latest: string };
} {
  const db = loadHistDB();
  const withResults = db.filter(g => g.homeScore !== null);
  const bySport: Record<string, number> = {};
  for (const g of db) bySport[g.sport] = (bySport[g.sport] ?? 0) + 1;
  const dates = db.map(g => g.date).sort();

  return {
    totalGames: db.length,
    gamesWithResults: withResults.length,
    bySport,
    dateRange: {
      earliest: dates[0] ?? 'none',
      latest: dates[dates.length - 1] ?? 'none',
    },
  };
}

// ------------------------------------
// 6. Print historical database report
// ------------------------------------

export function printHistoricalReport(): void {
  // First rebuild from snapshots
  const newGames = buildHistoricalFromSnapshots();
  const summary = getHistoricalSummary();

  console.log('\n');
  console.log('+==============================================================+');
  console.log('|              HISTORICAL ODDS DATABASE                       |');
  console.log('+==============================================================+');
  console.log(`\n  Total games in DB  : ${summary.totalGames}`);
  console.log(`  Games with results : ${summary.gamesWithResults}`);
  console.log(`  New games added    : ${newGames}`);
  console.log(`  Date range         : ${summary.dateRange.earliest} -> ${summary.dateRange.latest}`);

  if (Object.keys(summary.bySport).length > 0) {
    console.log('\n  By sport:');
    for (const [sport, count] of Object.entries(summary.bySport).sort((a,b) => b[1]-a[1])) {
      console.log(`    ${sport.padEnd(30)} ${count} games`);
    }
  }

  if (summary.gamesWithResults >= 30) {
    console.log('\n  Running backtests...');
    const db = loadHistDB();
    const withResults = db.filter(g => g.homeScore !== null);

    // Test some basic signals
    const homeTests = backtestSignal('All Home Teams ATS', withResults, 'home_spread');
    const awayTests = backtestSignal('All Away Teams ATS', withResults, 'away_spread');
    const overTests = backtestSignal('All Overs', withResults, 'over');
    const underTests = backtestSignal('All Unders', withResults, 'under');

    console.log('\n  Backtest results:');
    for (const result of [homeTests, awayTests, overTests, underTests]) {
      const icon = result.roi > 5 ? '[G]' : result.roi > 0 ? '[Y]' : '[R]';
      console.log(`  ${icon} ${result.signal.padEnd(28)} ${result.wins}-${result.losses}  Win%: ${result.winPct}%  ROI: ${result.roi > 0 ? '+' : ''}${result.roi}%  ${result.sampleNote}`);
    }
  } else {
    console.log(`\n  Need ${30 - summary.gamesWithResults} more games with results for backtesting.`);
    console.log('  Results populate as you enter game outcomes in GO.bat -> option 9.');
  }
  console.log('');
}
