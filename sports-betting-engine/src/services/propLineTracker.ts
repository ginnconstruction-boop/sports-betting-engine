// ============================================================
// src/services/propLineTracker.ts
// Prop line movement tracking
//
// Saves prop line snapshots and detects significant movement
// Sharp money on props moves lines -- we track it
// A prop that has moved 1.5+ pts since it opened is a signal
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const PROP_LINES_FILE = path.join(SNAPSHOT_DIR, 'prop_line_history.json');

export interface PropLineSnapshot {
  playerName: string;
  team: string;
  market: string;
  eventId: string;
  matchup: string;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  bookCount: number;
  timestamp: string;
  date: string;
}

export interface PropLineMovement {
  playerName: string;
  team: string;
  market: string;
  matchup: string;
  openingLine: number;
  currentLine: number;
  lineMove: number;          // positive = line moved up, negative = line moved down
  openingOverPrice: number | null;
  currentOverPrice: number | null;
  priceMove: number | null;  // juice movement
  isSignificant: boolean;    // 1.5+ pts or 20+ juice points
  direction: 'up' | 'down' | 'none';
  sharpSignal: boolean;      // line moved opposite to public expectation
  hoursTracked: number;
  detail: string;
}

// ------------------------------------
// Save prop line snapshot
// Called after props are scored
// ------------------------------------

export function savePropLineSnapshot(
  props: Array<{
    playerName: string;
    team?: string;
    market?: string;
    statType?: string;
    eventId?: string;
    matchup?: string;
    line: number | null;
    overBestPrice?: number | null;
    underBestPrice?: number | null;
    bookCount?: number;
  }>
): void {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }

  const existing = loadPropLineHistory();
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  for (const prop of props) {
    if (!prop.line || !prop.playerName) continue;
    const key = `${prop.playerName}__${prop.market ?? prop.statType}__${prop.eventId}`;

    const snapshot: PropLineSnapshot = {
      playerName:  prop.playerName,
      team:        prop.team ?? '',
      market:      prop.market ?? prop.statType ?? '',
      eventId:     prop.eventId ?? '',
      matchup:     prop.matchup ?? '',
      line:        prop.line,
      overPrice:   prop.overBestPrice ?? null,
      underPrice:  prop.underBestPrice ?? null,
      bookCount:   prop.bookCount ?? 0,
      timestamp:   now,
      date:        today,
    };

    if (!existing[key]) existing[key] = [];
    // Only save if line or price changed since last snapshot
    const last = existing[key][existing[key].length - 1];
    if (!last || last.line !== snapshot.line || last.overPrice !== snapshot.overPrice) {
      existing[key].push(snapshot);
      // Keep max 20 snapshots per prop
      if (existing[key].length > 20) existing[key] = existing[key].slice(-20);
    }
  }

  try {
    fs.writeFileSync(PROP_LINES_FILE, JSON.stringify(existing, null, 2));
  } catch { }
}

function loadPropLineHistory(): Record<string, PropLineSnapshot[]> {
  if (!fs.existsSync(PROP_LINES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PROP_LINES_FILE, 'utf-8')); }
  catch { return {}; }
}

// ------------------------------------
// Detect line movement
// Called when displaying prop output
// ------------------------------------

export function detectPropLineMovement(
  props: Array<{
    playerName: string;
    team?: string;
    market?: string;
    statType?: string;
    eventId?: string;
    matchup?: string;
    line: number | null;
    overBestPrice?: number | null;
    underBestPrice?: number | null;
  }>
): Map<string, PropLineMovement> {
  const movements = new Map<string, PropLineMovement>();
  const history = loadPropLineHistory();
  const now = Date.now();

  for (const prop of props) {
    if (!prop.line || !prop.playerName) continue;
    const key = `${prop.playerName}__${prop.market ?? prop.statType}__${prop.eventId}`;
    const snapshots = history[key];
    if (!snapshots || snapshots.length < 2) continue;

    // Opening line = first snapshot today
    const today = new Date().toISOString().split('T')[0];
    const todaySnaps = snapshots.filter(s => s.date === today);
    if (todaySnaps.length < 2) continue;

    const opening = todaySnaps[0];
    const lineMove = prop.line - opening.line;
    const priceMove = (prop.overBestPrice != null && opening.overPrice != null)
      ? prop.overBestPrice - opening.overPrice : null;

    const isSignificant = Math.abs(lineMove) >= 1.5 || Math.abs(priceMove ?? 0) >= 20;
    const direction: PropLineMovement['direction'] =
      lineMove > 0 ? 'up' : lineMove < 0 ? 'down' : 'none';

    // Sharp signal: line moved down on an over-heavy prop (public bets over, sharp takes under)
    // or line moved up significantly without obvious public reason
    const sharpSignal = isSignificant && (
      (direction === 'down' && Math.abs(lineMove) >= 2) ||
      (direction === 'up' && Math.abs(lineMove) >= 2.5)
    );

    const hoursTracked = (now - new Date(opening.timestamp).getTime()) / 3600000;

    let detail = '';
    if (isSignificant) {
      detail = `Line moved ${direction === 'up' ? '+' : ''}${lineMove.toFixed(1)} pts since open`;
      if (priceMove != null && Math.abs(priceMove) >= 15) {
        detail += `, juice moved ${priceMove > 0 ? '+' : ''}${priceMove} pts`;
      }
      if (sharpSignal) detail += ' -- SHARP SIGNAL';
    }

    if (isSignificant) {
      movements.set(key, {
        playerName:       prop.playerName,
        team:             prop.team ?? '',
        market:           prop.market ?? prop.statType ?? '',
        matchup:          prop.matchup ?? '',
        openingLine:      opening.line,
        currentLine:      prop.line,
        lineMove:         Math.round(lineMove * 10) / 10,
        openingOverPrice: opening.overPrice,
        currentOverPrice: prop.overBestPrice ?? null,
        priceMove:        priceMove != null ? Math.round(priceMove) : null,
        isSignificant,
        direction,
        sharpSignal,
        hoursTracked:     Math.round(hoursTracked * 10) / 10,
        detail,
      });
    }
  }

  return movements;
}

// ------------------------------------
// Get movement score bonus for prop scorer
// Sharp prop line movement = signal boost
// ------------------------------------

export function getPropMovementBonus(
  movement: PropLineMovement | undefined,
  side: 'over' | 'under'
): { bonus: number; reason: string } {
  if (!movement || !movement.isSignificant) return { bonus: 0, reason: '' };

  // Line moved down + betting over = sharp took under, fade the over
  if (movement.direction === 'down' && side === 'over') {
    return {
      bonus: movement.sharpSignal ? -12 : -6,
      reason: `Prop line moved down ${movement.lineMove} pts -- sharp money on under`,
    };
  }
  // Line moved down + betting under = confirming our under bet
  if (movement.direction === 'down' && side === 'under') {
    return {
      bonus: movement.sharpSignal ? 12 : 6,
      reason: `Prop line moved down ${movement.lineMove} pts -- confirms under value`,
    };
  }
  // Line moved up + betting over = line moving our way
  if (movement.direction === 'up' && side === 'over') {
    return {
      bonus: movement.sharpSignal ? 8 : 4,
      reason: `Prop line moved up ${movement.lineMove} pts -- over demand pushing line`,
    };
  }

  return { bonus: 0, reason: '' };
}
