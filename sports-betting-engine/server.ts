// ============================================================
// server.ts -- Express API server
// ts-node runs in transpile-only mode for faster startup on Render
// Set TS_NODE_TRANSPILE_ONLY=true in environment for web dashboard
// v2 -- streaming output, scan history, results form endpoint
// ============================================================
import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { isPausedCommand } from './src/config/productionFocus';
import { NFL_MARKET_GROUPS, NFL_BOARD_WINDOW_DAYS } from './src/config/nflMarkets';
import { NflMarketBoard, MarketBoardError } from './src/services/nflMarketBoard';
import { NflResearch } from './src/services/nflResearch';
import { NflPaperLedger, nflPaperReport } from './src/services/nflPaper';
import { NflRecommendations } from './src/services/nflRecommendations';
import { CollegeMarketBoard, COLLEGE_WINDOW_DAYS } from './src/services/collegeMarketBoard';

const app  = express();
const PORT = process.env.PORT || 3000;

const USERNAME       = process.env.DASHBOARD_USER ?? '';
const PASSWORD       = process.env.DASHBOARD_PASS ?? '';
if (!USERNAME || !PASSWORD) {
  console.error('[FATAL] DASHBOARD_USER and DASHBOARD_PASS env vars must be set. Refusing to start with empty credentials.');
  process.exit(1);
}
const SNAPSHOT_DIR   = process.env.SNAPSHOT_DIR ?? path.join(__dirname, 'snapshots');
const HISTORY_FILE   = path.join(SNAPSHOT_DIR, 'scan_history.json');
const MAX_HISTORY    = 20;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Sessions ──
const sessions = new Map<string, { user: string; expires: number }>();
function genToken(): string { return randomBytes(32).toString('hex'); }
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Accept token from header (API calls) or query param (browser window.open for reports)
  const token = (req.headers['x-auth-token'] as string) || (req.query.token as string);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) { sessions.delete(token); return res.status(401).json({ error: 'Session expired' }); }
  next();
}

// ── Concurrent scan guard ──
const activeScans = new Set<string>();

// ── Allowed commands ──
const ALLOWED: Record<string, string> = {
  morning: 'morning', midday: 'midday', full: 'full',
  nba: 'nba', mlb: 'mlb', nhl: 'nhl', ncaab: 'ncaab',
  nfl: 'nfl', ncaaf: 'ncaaf', 'ncaa-baseball': 'ncaa-baseball',
  props: 'props', altparlays: 'altparlays',
  'altparlays-nfl': 'altparlays americanfootball_nfl',
  sgp: 'sgp', 'sgp-nfl': 'sgp americanfootball_nfl',
  results: 'results', record: 'record', retro: 'retro',
  week: 'week', clv: 'clv', calibrate: 'calibrate',
  historical: 'historical', 'clv-picks': 'clv picks',
  reset: 'reset',
  mock: 'mock', fixresults: 'fixresults',
  firstbasket: 'firstbasket', firsttd: 'firsttd',
  lategames: 'lategames',
  monitor: 'monitor',
  teasers: 'teasers',
  mlbprops: 'mlbprops', nhlprops: 'nhlprops', nflprops: 'nflprops',
};

// ── Scan history helpers ──
function ensureDir() {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}
function loadHistory(): any[] {
  try { if (fs.existsSync(HISTORY_FILE)) return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch {}
  return [];
}
function saveHistory(entry: { command: string; label: string; timestamp: string; output: string; ok: boolean }) {
  ensureDir();
  const history = loadHistory();
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// ── Login ──
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === USERNAME && password === PASSWORD) {
    const token = genToken();
    sessions.set(token, { user: username, expires: Date.now() + 24 * 60 * 60 * 1000 });
    res.json({ token, user: username });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// ── Logout ──
app.post('/api/logout', requireAuth, (req, res) => {
  sessions.delete(req.headers['x-auth-token'] as string);
  res.json({ ok: true });
});

// ── STREAMING run endpoint (SSE) ──
app.get('/api/stream/:command', requireAuth, (req, res) => {
  const { command } = req.params;
  const label = req.query.label as string ?? command;
  if (isPausedCommand(command)) return res.status(403).json({ error: 'This sport is paused. Production is focused on NFL and NCAAF; history is preserved.' });

  if (!ALLOWED[command]) {
    res.status(400).end();
    return;
  }

  if (activeScans.has(command)) {
    res.status(409).json({ error: `Scan '${command}' is already running` });
    return;
  }

  // ── Reset safety gate: require ?confirm=RESET ──
  if (command === 'reset' && req.query.confirm !== 'RESET') {
    res.status(400).json({
      error: 'Reset requires explicit confirmation. Add ?confirm=RESET to the request.',
    });
    return;
  }

  // ── [DBG] route entered ──
  console.error(`[DBG:server] route entered: ${command}`);

  // Set up Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering on Render
  res.flushHeaders();

  const send = (type: string, data: string) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // ── Immediate first-body-byte write ──
  // Render's proxy (and some CDN layers) will not forward ANY body bytes until
  // it sees at least one chunk after the headers.  flushHeaders() sends the
  // HTTP headers but zero body bytes.  Write a real data event immediately so
  // the proxy flushes and the browser's reader.read() unblocks right away.
  send('line', `[stream] ${command} connected — spawning...\n`);
  console.error(`[DBG:server] stream first-write sent for: ${command}`);

  activeScans.add(command);

  const args = ALLOWED[command].split(' ');
  // For reset: inject --confirm so runReset.ts knows it was properly authorized
  if (command === 'reset') args.push('--confirm');
  // Default to the same ts-node CLI path used by npm scripts so dashboard runs
  // the current source tree instead of any stale local dist/ artifact.
  // Opt into dist execution explicitly for environments that intentionally ship it.
  const distEntry = path.join(__dirname, 'dist', 'index.js');
  const usingDist = process.env.SBE_USE_DIST_CLI === 'true' && fs.existsSync(distEntry);
  const nodeArgs  = usingDist
    ? [distEntry, ...args]
    : ['--require', 'ts-node/register/transpile-only', 'src/index.ts', ...args];
  const proc = spawn('node', nodeArgs, {
    cwd: __dirname,
    env: { ...process.env },
  });

  console.error(`[DBG:server] spawned: node ${nodeArgs[0]} ${args[0]} (dist=${usingDist})`);

  let fullOutput = '';

  // Keepalive ping every 5 seconds.
  // Uses a real SSE data event (not just a comment) so that Render's nginx
  // proxy is forced to flush the chunk downstream.  SSE comment lines are
  // valid but some proxy layers buffer them; a data event with a special
  // "keepalive" type is always flushed.  The frontend ignores this event type.
  const keepaliveInterval = setInterval(() => {
    try { res.write('event: keepalive\ndata: ""\n\n'); } catch {}
  }, 5000);

  // Hard 12-minute timeout -- kills the subprocess if it ever hangs
  const SCAN_TIMEOUT_MS = 12 * 60 * 1000;
  const timeoutHandle = setTimeout(() => {
    clearInterval(keepaliveInterval);
    try { proc.kill(); } catch {}
    activeScans.delete(command);
    send('line', '\n[ERROR] Scan timed out after 12 minutes. Check server logs.\n');
    send('done', 'ERROR');
    res.end();
    saveHistory({ command, label, timestamp: new Date().toISOString(), output: fullOutput + '\n[TIMEOUT]', ok: false });
  }, SCAN_TIMEOUT_MS);

  let firstStdout = true;
  proc.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    fullOutput += text;
    if (firstStdout) {
      console.error(`[DBG:server] first stdout chunk (${chunk.length}B) for: ${command}`);
      firstStdout = false;
    }
    send('line', text);
  });

  let firstStderr = true;
  proc.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (firstStderr) {
      console.error(`[DBG:server] first stderr chunk (${chunk.length}B) for: ${command}`);
      firstStderr = false;
    }
    // Only send non-noise stderr
    if (!text.includes('ExperimentalWarning') && !text.includes('DeprecationWarning')) {
      fullOutput += text;
      send('line', text);
    }
  });

  proc.on('close', (code) => {
    clearInterval(keepaliveInterval);
    clearTimeout(timeoutHandle);
    activeScans.delete(command);
    console.error(`[DBG:server] child closed with code=${code} for: ${command}`);
    const ok = code === 0;
    send('done', ok ? 'SUCCESS' : 'ERROR');
    res.end();

    const ts = new Date().toISOString();

    // Save to history
    saveHistory({
      command,
      label,
      timestamp: ts,
      output: fullOutput,
      ok,
    });

    // Auto-generate HTML report from scan output (printable as PDF)
    try {
      const { generateReportFromOutput } = require('./src/services/dailyReport');
      generateReportFromOutput(label, fullOutput, ts);
    } catch { /* report generation is non-critical */ }
  });

  // Clean up if client disconnects
  req.on('close', () => { clearInterval(keepaliveInterval); clearTimeout(timeoutHandle); try { proc.kill(); } catch {} activeScans.delete(command); });
});

// ── Fallback non-streaming run (kept for compatibility) ──
app.post('/api/run/:command', requireAuth, async (req, res) => {
  const { command } = req.params;
  if (isPausedCommand(command)) return res.status(403).json({ error: 'This sport is paused. Production is focused on NFL and NCAAF; history is preserved.' });
  if (!ALLOWED[command]) return res.status(400).json({ error: 'Unknown command' });

  const { execSync } = require('child_process');
  try {
    const output = execSync(`node --require ts-node/register src/index.ts ${ALLOWED[command]}`, {
      cwd: __dirname, env: { ...process.env }, timeout: 300000, encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    res.json({ ok: true, output });
  } catch (err: any) {
    res.json({ ok: false, output: (err.stdout || '') + (err.stderr || '') || err.message });
  }
});

// College is quote-only: neither route creates picks or touches the NFL ledger.
const collegeMarketBoard = new CollegeMarketBoard();
app.get('/api/college/events', requireAuth, async (_req, res) => {
  try { res.json({ events: await collegeMarketBoard.events(), windowDays: COLLEGE_WINDOW_DAYS, maxCredits: 2 }); }
  catch { res.status(502).json({ error: 'College football schedule unavailable. Please try again later.' }); }
});
app.post('/api/college/markets', requireAuth, async (req, res) => {
  if (typeof req.body?.eventId !== 'string' || Object.keys(req.body).some(k => k !== 'eventId'))
    return res.status(400).json({ error: 'Select a college football game. Only spreads and totals are supported.' });
  try { res.json(await collegeMarketBoard.quotes(req.body.eventId)); }
  catch (err) {
    if (err instanceof MarketBoardError) return res.status(err.status).json({ error: err.message });
    res.status(502).json({ error: 'College odds feed unavailable. No prices were assumed and no pick was created.' });
  }
});

// NFL quote board: event discovery is free; paid odds calls are explicit POSTs.
const nflMarketBoard = new NflMarketBoard();
const nflResearch = new NflResearch();
const nflPaper = new NflPaperLedger(path.join(SNAPSHOT_DIR, 'nfl_paper_picks.json'), nflResearch);
const nflRecommendations = new NflRecommendations(nflMarketBoard, nflResearch, nflPaper);
app.get('/api/nfl/events', requireAuth, async (_req, res) => {
  try {
    res.json({ events: await nflMarketBoard.events(), windowDays: NFL_BOARD_WINDOW_DAYS,
      groups: Object.entries(NFL_MARKET_GROUPS).map(([key, g]) => ({ key, label: g.label, maxCredits: g.markets.length })) });
  } catch {
    res.status(502).json({ error: 'NFL schedule feed unavailable. Please try again later.' });
  }
});
app.post('/api/nfl/markets', requireAuth, async (req, res) => {
  const { eventId, group } = req.body ?? {};
  if (typeof eventId !== 'string' || typeof group !== 'string') return res.status(400).json({ error: 'Select an NFL game and market category.' });
  try {
    const data = await nflMarketBoard.quotes(eventId, group);
    let paperWarning: string | undefined;
    try { nflPaper.observe(eventId, data.quotes); } catch { paperWarning = 'Paper ledger unavailable; pregame observation was not saved.'; }
    res.json({ ...data, paperWarning });
  } catch (err) {
    if (err instanceof MarketBoardError) return res.status(err.status).json({ error: err.message });
    res.status(502).json({ error: 'NFL odds feed unavailable or this request is not supported. No recommendation generated. Try another category later.' });
  }
});

function nflError(res: express.Response, err: unknown) {
  if (err instanceof MarketBoardError) return res.status(err.status).json({ error: err.message });
  return res.status(502).json({ error: 'NFL data or paper storage unavailable. No data was assumed; retry later.' });
}
function nflSelection(body: any) {
  if (typeof body?.eventId !== 'string' || typeof body?.group !== 'string' || typeof body?.quoteId !== 'string')
    throw new MarketBoardError('Select an exact quote from the NFL board.');
  return nflMarketBoard.selection(body.eventId, body.group, body.quoteId);
}
app.post('/api/nfl/research', requireAuth, async (req, res) => {
  try { const { event, quote } = nflSelection(req.body); res.json(await nflResearch.analyze(event, quote)); }
  catch (err) { nflError(res, err); }
});
app.post('/api/nfl/forecast', requireAuth, async (req, res) => {
  try {
    nflSelection(req.body);
    res.json(await nflRecommendations.run(req.body.eventId, req.body.group, req.body.quoteId, req.body.rules));
  } catch (err) { nflError(res, err); }
});
app.get('/api/nfl/paper', requireAuth, (_req, res) => {
  try { const picks = nflPaper.read(); res.json({ picks, report: nflPaperReport(picks) }); }
  catch (err) { nflError(res, err); }
});
app.post('/api/nfl/paper', requireAuth, async (req, res) => {
  try { const { event, quote } = nflSelection(req.body); res.json(await nflPaper.save(event, quote, req.body.rules)); }
  catch (err) { nflError(res, err); }
});
app.post('/api/nfl/paper/grade', requireAuth, async (_req, res) => {
  try { res.json(await nflPaper.grade()); } catch (err) { nflError(res, err); }
});

// ── Picks log ──
app.get('/api/picks', requireAuth, (req, res) => {
  try {
    const f = path.join(SNAPSHOT_DIR, 'picks_log.json');
    if (!fs.existsSync(f)) return res.json([]);
    res.json(JSON.parse(fs.readFileSync(f, 'utf-8')));
  } catch { res.json([]); }
});

// ── P&L record ──
app.get('/api/pnl', requireAuth, (req, res) => {
  try {
    const { rebuildPNL } = require('./src/services/winLossTracker');
    const record = rebuildPNL();
    res.json(record);
  } catch {
    try {
      const f = path.join(SNAPSHOT_DIR, 'pnl_record.json');
      if (!fs.existsSync(f)) return res.json(null);
      res.json(JSON.parse(fs.readFileSync(f, 'utf-8')));
    } catch {
      res.json(null);
    }
  }
});

// ── Scan history ──
app.get('/api/history', requireAuth, (req, res) => {
  res.json(loadHistory());
});

// ── Enter results (web form) ──
app.post('/api/results/enter', requireAuth, (req, res) => {
  try {
    const { pickId, result } = req.body;
    if (!pickId || !['WIN','LOSS','PUSH'].includes(result)) {
      return res.status(400).json({ error: 'Invalid pickId or result' });
    }
    const f = path.join(SNAPSHOT_DIR, 'picks_log.json');
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'No picks log found' });

    const picks = JSON.parse(fs.readFileSync(f, 'utf-8'));
    const idx = picks.findIndex((p: any) => p.pickId === pickId);
    if (idx < 0) return res.status(404).json({ error: 'Pick not found' });

    const pick = picks[idx];
    const price = typeof pick.pickedPrice === 'number' && isFinite(pick.pickedPrice) ? pick.pickedPrice : -110;
    const profit = result === 'WIN'
      ? (price > 0 ? price : (100 / Math.abs(price)) * 100)
      : result === 'LOSS' ? -100 : 0;

    picks[idx].gameResult = result;
    picks[idx].profit = Math.round(profit * 100) / 100;
    fs.writeFileSync(f, JSON.stringify(picks, null, 2));

    try {
      const { rebuildPNL } = require('./src/services/winLossTracker');
      rebuildPNL();
    } catch { /* non-fatal */ }

    res.json({ ok: true, pickId, result, profit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Latest report (print to PDF) ──
app.get('/api/report/latest', requireAuth, (req, res) => {
  try {
    const f = path.join(SNAPSHOT_DIR, 'daily_reports', 'latest.html');
    if (!fs.existsSync(f)) {
      return res.status(404).send('<h2>No report generated yet. Run a scan first.</h2>');
    }
    res.setHeader('Content-Type', 'text/html');
    res.send(fs.readFileSync(f, 'utf-8'));
  } catch { res.status(500).send('Error loading report'); }
});

// ── List saved reports ──
app.get('/api/reports', requireAuth, (req, res) => {
  try {
    const dir = path.join(SNAPSHOT_DIR, 'daily_reports');
    if (!fs.existsSync(dir)) return res.json([]);
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.html') && f !== 'latest.html')
      .sort().reverse().slice(0, 30)
      .map(f => ({ name: f, path: f }));
    res.json(files);
  } catch { res.json([]); }
});

// ── Serve specific report ──
app.get('/api/report/:filename', requireAuth, (req, res) => {
  try {
    const filename = req.params.filename.replace(/[^a-zA-Z0-9_\-\.]/g, '');
    if (!filename.endsWith('.html')) return res.status(400).send('Invalid file');
    const f = path.join(SNAPSHOT_DIR, 'daily_reports', filename);
    if (!fs.existsSync(f)) return res.status(404).send('Report not found');
    res.setHeader('Content-Type', 'text/html');
    res.send(fs.readFileSync(f, 'utf-8'));
  } catch { res.status(500).send('Error loading report'); }
});

// ── Signal weights + retro performance ──
app.get('/api/signals', requireAuth, (req, res) => {
  try {
    const weightsFile = path.join(SNAPSHOT_DIR, 'signal_weights.json');
    const retroFile   = path.join(SNAPSHOT_DIR, 'retro_analysis.json');
    const weights: Record<string, number> = fs.existsSync(weightsFile)
      ? JSON.parse(fs.readFileSync(weightsFile, 'utf-8'))
      : {};
    // Build signal performance from retro_analysis picks
    const retroPicks: any[] = fs.existsSync(retroFile)
      ? JSON.parse(fs.readFileSync(retroFile, 'utf-8'))
      : [];
    const graded = retroPicks.filter((p: any) => p.gameResult === 'WIN' || p.gameResult === 'LOSS');
    const sigMap: Record<string, { wins: number; losses: number }> = {};
    for (const pick of graded) {
      for (const sig of (pick.signals ?? [])) {
        const k = sig.toUpperCase();
        if (!sigMap[k]) sigMap[k] = { wins: 0, losses: 0 };
        if (pick.gameResult === 'WIN') sigMap[k].wins++;
        else sigMap[k].losses++;
      }
    }
    const performance = Object.entries(sigMap)
      .filter(([, d]) => d.wins + d.losses >= 3)
      .map(([signal, d]) => ({
        signal,
        wins: d.wins,
        losses: d.losses,
        winRate: Math.round(d.wins / (d.wins + d.losses) * 100),
        weight: weights[signal] ?? 1.0,
      }))
      .sort((a, b) => b.winRate - a.winRate);
    res.json({ weights, performance, totalGraded: graded.length });
  } catch { res.json({ weights: {}, performance: [], totalGraded: 0 }); }
});

// ── Auto-grade pending picks from ESPN scores ──
app.post('/api/autograde', requireAuth, async (req, res) => {
  try {
    const { autoGradePicks, buildRetroReport } = require('./src/services/retroAnalysis');
    const grading = await autoGradePicks();
    const report = buildRetroReport();
    res.json({
      ok: true,
      graded: grading.graded,
      checked: grading.checked,
      pending: grading.pending,
      missing: grading.missing,
      void: grading.void,
      officialGraded: grading.officialGraded,
      trackedGraded: grading.trackedGraded,
      officialPending: grading.officialPending,
      trackedPending: grading.trackedPending,
      totalGraded: report.picksAnalyzed,
      record: report.overallRecord,
      weightAdjustments: report.weightAdjustments,
      insights: report.insights.slice(0, 3),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── ATS Live (Option 1 — built from our scan snapshots) ──
app.get('/api/ats/live', requireAuth, (req, res) => {
  try {
    const { buildATSReport, getATSDivergenceSummary } = require('./src/services/atsTracker');
    const report     = buildATSReport();
    const divergence = getATSDivergenceSummary();
    res.json({ ok: true, report, divergence });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── ATS Historical (Option 3 — Odds API backfill) ──
app.get('/api/ats/historical', requireAuth, (req, res) => {
  try {
    const { buildHistoricalReport } = require('./src/services/atsHistorical');
    const report = buildHistoricalReport();
    res.json({ ok: true, report });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── ATS Divergence (live vs historical comparison) ──
app.get('/api/ats/divergence', requireAuth, (req, res) => {
  try {
    const { getATSDivergenceSummary, loadATSLive }       = require('./src/services/atsTracker');
    const { loadATSHistorical }                           = require('./src/services/atsHistorical');

    const liveDivergence  = getATSDivergenceSummary();          // within live timeframes
    const liveStore       = loadATSLive();
    const histStore       = loadATSHistorical();

    // Cross-dataset divergence: live monthly vs historical overall
    const crossDivergence: any[] = [];
    for (const liveKey of Object.keys(liveStore.teamRecords)) {
      const live = liveStore.teamRecords[liveKey];
      const hist = histStore.teamRecords[liveKey];
      if (!hist) continue;

      for (const split of ['home', 'away', 'overall'] as const) {
        const liveEntry = live[split];
        const histEntry = split === 'home' ? hist.homeRecord : split === 'away' ? hist.awayRecord : hist.overall;
        const liveMonthly = liveEntry.monthly;
        const liveM  = liveMonthly.wins + liveMonthly.losses;
        const histWL = histEntry.wins + histEntry.losses;
        if (liveM < 3 || histWL < 5) continue;

        const livePct = Math.round((liveMonthly.wins / liveM) * 100);
        const histPct = Math.round((histEntry.wins / histWL) * 100);
        const gap     = livePct - histPct;
        if (Math.abs(gap) < 15) continue;

        crossDivergence.push({
          team:    live.team,
          sport:   live.sportKey,
          split,
          livePct,
          histPct,
          gap,
          signal:  gap >= 15 ? 'HOT vs BASELINE' : 'COLD vs BASELINE',
        });
      }
    }

    crossDivergence.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

    res.json({
      ok: true,
      liveInternalDivergence: liveDivergence,    // monthly vs all-time within live data
      crossDatasetDivergence: crossDivergence,   // live monthly vs historical baseline
      hasHistoricalData: !histStore.gameResults.length === false,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── ATS Historical Backfill trigger (costs credits — manual only) ──
app.post('/api/ats/backfill', requireAuth, async (req, res) => {
  try {
    const { sportKey, gameDates, seasonLabel } = req.body;
    if (!sportKey || !Array.isArray(gameDates) || gameDates.length === 0) {
      return res.status(400).json({ ok: false, error: 'sportKey and gameDates[] required' });
    }
    if (gameDates.length > 60) {
      return res.status(400).json({ ok: false, error: 'Max 60 dates per backfill request (~600 credits)' });
    }
    const { runHistoricalBackfill } = require('./src/services/atsHistorical');
    const result = await runHistoricalBackfill(sportKey, gameDates, seasonLabel ?? 'Historical');
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Health ──
app.get('/api/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── SPA fallback ──
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(Number(PORT), process.env.HOST || '0.0.0.0', () => console.log(`SBE dashboard running on port ${PORT}`));
export default app;
