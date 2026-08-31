import * as fs from 'fs';
import * as path from 'path';
import { nflSeason } from './nflResearch';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
export interface ATSRecord {
  team: string; opponent: string; sportKey: string;
  wins: number; losses: number; pushes: number; atsWinPct: number;
  avgMarginVsSpread: number | null;
  homeRecord: { wins: number; losses: number }; awayRecord: { wins: number; losses: number };
  lastUpdated: string; gamesTracked: number;
}
export interface ATSSituation {
  homeATS: ATSRecord | null; awayATS: ATSRecord | null; h2hATS: ATSRecord | null;
  homeAsUnderdog: { wins: number; losses: number; winPct: number } | null;
  awayAsFavorite: { wins: number; losses: number; winPct: number } | null;
  atsSignals: string[]; atsScoreBonus: number;
}
export interface SelectedSpread {
  key: string; eventId: string; team: string; opponent: string; sportKey: string;
  line: number; result: 'WIN' | 'LOSS' | 'PUSH'; home: boolean;
  neutralSite: boolean | null; season: number; gameTime: string;
  capturedAt: string; book: string; source: 'selected_pick_not_closing';
}
/** Derive from immutable picks, never increment an old aggregate. Conflicting
 * duplicate selections are excluded instead of deciding which result to trust.
 * One event/side/line is one selection; this is NOT all-game team ATS history. */
export function deriveSelectedATS(picks: any[], now = Date.now()) {
  const rows = new Map<string, SelectedSpread>();
  const conflicts = new Set<string>();
  let excluded = 0, duplicates = 0;
  for (const p of picks) {
    if (!['spread', 'spreads'].includes(String(p.betType).toLowerCase())) continue;
    const [away, home, extra] = String(p.matchup ?? '').split(' @ ');
    const sportKey = p.sportKey ?? ({ NFL: 'americanfootball_nfl', NCAAF: 'americanfootball_ncaaf' }[p.sport]);
    const start = Date.parse(p.gameTime ?? ''), captured = Date.parse(p.date ?? '');
    if (!p.eventId || !sportKey || !away || !home || extra || ![away, home].includes(p.side)
      || !['WIN', 'LOSS', 'PUSH'].includes(p.gameResult) || !Number.isFinite(p.pickedLine)
      || !Number.isFinite(start) || start > now || !Number.isFinite(captured) || captured >= start) { excluded++; continue; }
    const key = JSON.stringify([sportKey, p.eventId, p.side, p.pickedLine]);
    const row: SelectedSpread = { key, eventId: p.eventId, team: p.side, opponent: p.side === home ? away : home,
      sportKey, line: p.pickedLine, result: p.gameResult, home: p.side === home,
      neutralSite: typeof p.neutralSite === 'boolean' ? p.neutralSite : null,
      season: nflSeason(start), gameTime: p.gameTime, capturedAt: p.date,
      book: p.pickedBook ?? 'Unknown', source: 'selected_pick_not_closing' };
    const old = rows.get(key);
    if (old) {
      duplicates++;
      if (old.result !== row.result || old.gameTime !== row.gameTime || old.opponent !== row.opponent
        || old.neutralSite !== row.neutralSite) conflicts.add(key);
    } else rows.set(key, row);
  }
  return { schema: 2, scope: 'selected_picks_only', rows: [...rows.values()].filter(r => !conflicts.has(r.key)),
    excluded, duplicates, conflictingSelections: conflicts.size };
}
function readPicks(): any[] {
  const file = path.join(SNAPSHOT_DIR, 'picks_log.json');
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data)) throw new Error('ATS source ledger is not an array; no data changed.');
  return data;
}
export function updateATSFromPicks(): void {
  // Deliberately never read/write ats_database.json: it may contain duplicated
  // legacy aggregates. The authoritative source here remains picks_log.json.
  const view = deriveSelectedATS(readPicks());
  const file = path.join(SNAPSHOT_DIR, 'ats_selected_v2.json');
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(view, null, 2));
  fs.renameSync(file + '.tmp', file);
}
function summarize(rows: SelectedSpread[], team: string, opponent: string, sportKey: string): ATSRecord | null {
  if (!rows.length) return null;
  const count = (xs: SelectedSpread[]) => ({ wins: xs.filter(r => r.result === 'WIN').length,
    losses: xs.filter(r => r.result === 'LOSS').length });
  const c = count(rows);
  return { team, opponent, sportKey, ...c, pushes: rows.filter(r => r.result === 'PUSH').length,
    atsWinPct: c.wins + c.losses ? 100 * c.wins / (c.wins + c.losses) : 0,
    avgMarginVsSpread: null, homeRecord: count(rows.filter(r => r.home && r.neutralSite === false)),
    awayRecord: count(rows.filter(r => !r.home && r.neutralSite === false)),
    lastUpdated: rows.map(r => r.gameTime).sort().at(-1), gamesTracked: rows.length };
}
export function selectedATSSituation(picks: any[], sportKey: string, home: string, away: string,
  postedSpread: number | null, now = Date.now()): ATSSituation {
  const view = deriveSelectedATS(picks, now);
  const rows = view.rows.filter(r => r.sportKey === sportKey && r.season === nflSeason(now));
  const homeRows = rows.filter(r => r.team === home), awayRows = rows.filter(r => r.team === away);
  const split = (xs: SelectedSpread[]) => {
    const wins = xs.filter(r => r.result === 'WIN').length, losses = xs.filter(r => r.result === 'LOSS').length;
    return wins + losses ? { wins, losses, winPct: 100 * wins / (wins + losses) } : null;
  };
  return { homeATS: summarize(homeRows, home, 'All selected opponents', sportKey),
    awayATS: summarize(awayRows, away, 'All selected opponents', sportKey),
    h2hATS: summarize(homeRows.filter(r => r.opponent === away), home, away, sportKey),
    homeAsUnderdog: postedSpread > 0 ? split(homeRows.filter(r => r.home && r.line > 0 && r.neutralSite === false)) : null,
    awayAsFavorite: postedSpread > 0 ? split(awayRows.filter(r => !r.home && r.line < 0 && r.neutralSite === false)) : null,
    atsSignals: ['Selected-pick ATS only; current football season, not complete team ATS. Unknown neutral sites excluded from venue splits.',
      'Descriptive history only; no ATS score bonus.'], atsScoreBonus: 0 };
}
export function getATSSituation(sportKey: string, home: string, away: string, spread: number | null): ATSSituation {
  return selectedATSSituation(readPicks(), sportKey, home, away, spread);
}
