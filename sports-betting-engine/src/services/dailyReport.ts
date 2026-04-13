// ============================================================
// src/services/dailyReport.ts
// Auto-generates a printable PDF after every morning scan
// Saved to snapshots/daily_reports/SBE_YYYY-MM-DD.pdf
// ============================================================
import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const REPORTS_DIR  = path.join(SNAPSHOT_DIR, 'daily_reports');

function ensureDir() {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  if (!fs.existsSync(REPORTS_DIR))  fs.mkdirSync(REPORTS_DIR,  { recursive: true });
}

function fmtPrice(p: number): string {
  return p > 0 ? `+${p}` : `${p}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

// Generate a clean HTML report that can be printed to PDF via browser
export function generateDailyReport(
  bets: any[],
  props: any[],
  date: string = new Date().toISOString()
): string {
  ensureDir();

  const dateStr  = date.split('T')[0];
  const dateLabel = fmtDate(date);

  const betRows = bets.map((b, i) => `
    <tr class="${b.tier === 'BET' ? 'hot' : b.tier === 'LEAN' ? 'lean' : ''}">
      <td>#${i+1}</td>
      <td>${b.sport}</td>
      <td>${b.matchup}</td>
      <td>${b.betType}</td>
      <td><strong>${b.side}</strong></td>
      <td>${b.bestUserBook}</td>
      <td class="price">${fmtPrice(b.bestUserPrice)}</td>
      <td>${b.grade}</td>
      <td>${b.score}/100</td>
      <td>${b.tier}</td>
    </tr>`).join('');

  const propRows = props.map((p, i) => `
    <tr>
      <td>#${i+1}</td>
      <td>${p.sport ?? 'NBA'}</td>
      <td>${p.matchup}</td>
      <td>${p.playerName}</td>
      <td>${p.market}</td>
      <td><strong>${p.side} ${p.line}</strong></td>
      <td>${p.bestUserBook}</td>
      <td class="price">${fmtPrice(p.bestUserPrice)}</td>
      <td>${p.grade}</td>
      <td>${p.score}/100</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SBE Daily Report -- ${dateLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Courier New', monospace; font-size: 11px; color: #1a1a1a; padding: 20px; }
  h1 { font-size: 20px; color: #1a6b2a; margin-bottom: 4px; }
  h2 { font-size: 13px; color: #555; font-weight: normal; margin-bottom: 16px; }
  h3 { font-size: 12px; color: #1a6b2a; margin: 16px 0 8px; border-bottom: 1px solid #1a6b2a; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #1a1a1a; color: #39d353; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; padding: 5px 6px; text-align: left; }
  td { padding: 4px 6px; border-bottom: 1px solid #e5e5e5; vertical-align: middle; }
  tr.hot td { background: #f0fff4; }
  tr.lean td { background: #fffbeb; }
  .price { font-weight: bold; color: #1a6b2a; }
  .footer { margin-top: 20px; font-size: 9px; color: #888; border-top: 1px solid #ddd; padding-top: 8px; }
  .meta { display: flex; gap: 20px; margin-bottom: 16px; }
  .meta-card { border: 1px solid #ddd; padding: 8px 14px; border-radius: 4px; }
  .meta-label { font-size: 8px; color: #888; letter-spacing: 0.1em; text-transform: uppercase; }
  .meta-value { font-size: 16px; font-weight: bold; color: #1a1a1a; }
  .meta-value.green { color: #1a6b2a; }
  .no-picks { color: #888; font-style: italic; padding: 8px 0; }
  @media print { body { padding: 10px; } }
</style>
</head>
<body>
<h1>SPORTS BETTING ENGINE</h1>
<h2>Elite Model v2.2 // Daily Pick Report // ${dateLabel}</h2>

<div class="meta">
  <div class="meta-card">
    <div class="meta-label">Game Line Picks</div>
    <div class="meta-value green">${bets.length}</div>
  </div>
  <div class="meta-card">
    <div class="meta-label">Prop Picks</div>
    <div class="meta-value green">${props.length}</div>
  </div>
  <div class="meta-card">
    <div class="meta-label">BET Tier</div>
    <div class="meta-value green">${bets.filter((b:any)=>b.tier==='BET').length}</div>
  </div>
  <div class="meta-card">
    <div class="meta-label">LEAN Tier</div>
    <div class="meta-value">${bets.filter((b:any)=>b.tier==='LEAN').length}</div>
  </div>
</div>

<h3>GAME LINES</h3>
${bets.length > 0 ? `
<table>
  <thead><tr><th>#</th><th>Sport</th><th>Game</th><th>Type</th><th>Pick</th><th>Book</th><th>Price</th><th>Grade</th><th>Score</th><th>Tier</th></tr></thead>
  <tbody>${betRows}</tbody>
</table>` : '<p class="no-picks">No qualifying game line plays today.</p>'}

<h3>PLAYER PROPS</h3>
${props.length > 0 ? `
<table>
  <thead><tr><th>#</th><th>Sport</th><th>Game</th><th>Player</th><th>Market</th><th>Pick</th><th>Book</th><th>Price</th><th>Grade</th><th>Score</th></tr></thead>
  <tbody>${propRows}</tbody>
</table>` : '<p class="no-picks">No qualifying prop plays today. Run option 11 closer to game time.</p>'}

<div class="footer">
  Generated by SBE Elite Model v2.2 // FanDuel + BetMGM only // Score 85+ = BET | 78-84 = LEAN | 72-77 = MONITOR //
  Always verify player status before placing prop bets. Past performance does not guarantee future results.
</div>
</body>
</html>`;

  const filename = path.join(REPORTS_DIR, `SBE_${dateStr}.html`);
  fs.writeFileSync(filename, html, 'utf-8');
  return filename;
}

export function printDailyReportPath(filepath: string): void {
  console.log(`  [PDF] Daily report saved: ${filepath}`);
  console.log('  Open in any browser and Print -> Save as PDF to get printable version.');
}

// ============================================================
// Generate a printable HTML report from any raw scan output
// Called after any scan completes -- text output -> clean PDF
// ============================================================
export function generateReportFromOutput(
  scanName: string,
  rawOutput: string,
  date: string = new Date().toISOString()
): string {
  ensureDir();

  const dateStr   = date.split('T')[0];
  const timeStr   = new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Chicago'
  });
  const dateLabel = new Date(date).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Colorize terminal output to HTML spans
  const lines = rawOutput.split('\n').map(line => {
    const esc = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    if (/\[HOT\]|Grade: A\+|BET tier/.test(esc))
      return `<span class="hot">${esc}</span>`;
    if (/LEAN|Grade: [AB]/.test(esc))
      return `<span class="lean">${esc}</span>`;
    if (/LOSS|error|failed/.test(esc))
      return `<span class="err">${esc}</span>`;
    if (/FanDuel|BetMGM|Credits|API/.test(esc))
      return `<span class="info">${esc}</span>`;
    if (/^[\s]*[=+|\-]{3,}/.test(esc))
      return `<span class="rule">${esc}</span>`;
    return esc;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SBE -- ${scanName} -- ${dateLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px;
    line-height: 1.6;
    background: #ffffff;
    color: #1a1a1a;
    padding: 24px;
  }
  .header {
    border-bottom: 2px solid #1a6b2a;
    padding-bottom: 12px;
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .title { font-size: 22px; font-weight: bold; color: #1a6b2a; font-family: sans-serif; }
  .subtitle { font-size: 11px; color: #555; font-family: sans-serif; }
  .meta { text-align: right; font-size: 10px; color: #777; font-family: sans-serif; }
  .output {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .hot  { color: #1a6b2a; font-weight: bold; }
  .lean { color: #b38600; }
  .err  { color: #c0392b; }
  .info { color: #2471a3; }
  .rule { color: #666; }
  .footer {
    margin-top: 20px;
    padding-top: 10px;
    border-top: 1px solid #ddd;
    font-size: 9px;
    color: #999;
    font-family: sans-serif;
  }
  @media print {
    body { padding: 12px; }
    @page { margin: 1cm; }
  }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="title">SBE // ELITE v2.2</div>
    <div class="subtitle">${scanName} &nbsp;&bull;&nbsp; ${dateLabel} &nbsp;&bull;&nbsp; ${timeStr} CT</div>
  </div>
  <div class="meta">
    FanDuel + BetMGM only<br>
    sports-betting-engine-1.onrender.com
  </div>
</div>
<div class="output">${lines}</div>
<div class="footer">
  Generated by SBE Elite Model v2.2 &bull;
  Scores reflect composite signal strength at time of scan &bull;
  Always verify player status before placing prop bets &bull;
  Past performance does not guarantee future results.
</div>
</body>
</html>`;

  // Save to daily_reports folder
  const filename = path.join(
    REPORTS_DIR,
    `SBE_${dateStr}_${scanName.replace(/[^a-zA-Z0-9]/g, '_')}.html`
  );
  fs.writeFileSync(filename, html, 'utf-8');

  // Also overwrite latest.html so server can always serve /api/report/latest
  const latestPath = path.join(REPORTS_DIR, 'latest.html');
  fs.writeFileSync(latestPath, html, 'utf-8');

  return filename;
}

export function getLatestReportPath(): string {
  return path.join(REPORTS_DIR, 'latest.html');
}
