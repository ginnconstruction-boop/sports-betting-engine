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
function genToken(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
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

  if (!ALLOWED[command]) {
    res.status(400).end();
    return;
  }

  if (activeScans.has(command)) {
    res.status(409).json({ error: `Scan '${command}' is already running` });
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
  // Use pre-compiled JS when available (production / post-build).
  // Falls back to ts-node transpile-only for local dev where dist/ may not exist.
  const distEntry = path.join(__dirname, 'dist', 'index.js');
  const usingDist = fs.existsSync(distEntry);
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
    const f = path.join(SNAPSHOT_DIR, 'pnl_record.json');
    if (!fs.existsSync(f)) return res.json(null);
    res.json(JSON.parse(fs.readFileSync(f, 'utf-8')));
  } catch { res.json(null); }
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
    const graded: number = await autoGradePicks();
    const report = buildRetroReport();
    res.json({
      ok: true,
      graded,
      totalGraded: report.picksAnalyzed,
      record: report.overallRecord,
      weightAdjustments: report.weightAdjustments,
      insights: report.insights.slice(0, 3),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Health ──
app.get('/api/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── SPA fallback ──
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`SBE dashboard running on port ${PORT}`));
export default app;
