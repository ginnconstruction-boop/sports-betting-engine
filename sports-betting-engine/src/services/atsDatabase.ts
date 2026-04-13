// ============================================================
// src/services/atsDatabase.ts
// Historical ATS (Against The Spread) matchup database
// Built from ESPN schedule data + our own snapshot history
// Tracks team ATS performance vs specific opponents
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';
const ATS_DB_FILE = path.join(SNAPSHOT_DIR, 'ats_database.json');

export interface ATSRecord {
  team: string;
  opponent: string;
  sportKey: string;
  wins: number;
  losses: number;
  pushes: number;
  atsWinPct: number;
  avgMarginVsSpread: number;    // positive = covers by avg X pts
  homeRecord: { wins: number; losses: number };
  awayRecord: { wins: number; losses: number };
  lastUpdated: string;
  gamesTracked: number;
}

export interface ATSSituation {
  // Team-level ATS records
  homeATS: ATSRecord | null;
  awayATS: ATSRecord | null;
  // Head-to-head ATS
  h2hATS: ATSRecord | null;
  // Situational records
  homeAsUnderdog: { wins: number; losses: number; winPct: number } | null;
  awayAsFavorite: { wins: number; losses: number; winPct: number } | null;
  // Signals derived
  atsSignals: string[];
  atsScoreBonus: number;
}

// ------------------------------------
// Load / save ATS database
// ------------------------------------

function loadATSDB(): Record<string, ATSRecord> {
  if (!fs.existsSync(ATS_DB_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(ATS_DB_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveATSDB(db: Record<string, ATSRecord>): void {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(ATS_DB_FILE, JSON.stringify(db, null, 2));
  } catch { }
}

function atsKey(team: string, opponent: string, sportKey: string): string {
  return `${sportKey}__${team.toLowerCase().replace(/\s+/g, '_')}__vs__${opponent.toLowerCase().replace(/\s+/g, '_')}`;
}

// ------------------------------------
// Update ATS database from our picks log
// ------------------------------------

export function updateATSFromPicks(): void {
  const picksFile = path.join(SNAPSHOT_DIR, 'picks_log.json');
  if (!fs.existsSync(picksFile)) return;

  try {
    const picks = JSON.parse(fs.readFileSync(picksFile, 'utf-8'));
    const db = loadATSDB();

    for (const pick of picks) {
      if (pick.gameResult === 'PENDING') continue;
      if (pick.betType !== 'Spread') continue;

      const [away, home] = (pick.matchup ?? '').split(' @ ');
      if (!away || !home) continue;

      const team = pick.side;
      const opponent = team === home ? away : home;
      const isHome = team === home;
      const key = atsKey(team, opponent, pick.sport ?? '');

      if (!db[key]) {
        db[key] = {
          team, opponent, sportKey: pick.sport ?? '',
          wins: 0, losses: 0, pushes: 0,
          atsWinPct: 0, avgMarginVsSpread: 0,
          homeRecord: { wins: 0, losses: 0 },
          awayRecord: { wins: 0, losses: 0 },
          lastUpdated: new Date().toISOString(),
          gamesTracked: 0,
        };
      }

      const rec = db[key];
      if (pick.gameResult === 'WIN') {
        rec.wins++;
        if (isHome) rec.homeRecord.wins++;
        else rec.awayRecord.wins++;
      } else if (pick.gameResult === 'LOSS') {
        rec.losses++;
        if (isHome) rec.homeRecord.losses++;
        else rec.awayRecord.losses++;
      } else {
        rec.pushes++;
      }

      const total = rec.wins + rec.losses;
      rec.atsWinPct = total > 0 ? Math.round((rec.wins / total) * 1000) / 10 : 0;
      rec.gamesTracked++;
      rec.lastUpdated = new Date().toISOString();
      db[key] = rec;
    }

    saveATSDB(db);
  } catch { }
}

// ------------------------------------
// Get ATS situation for a game
// ------------------------------------

export function getATSSituation(
  sportKey: string,
  homeTeam: string,
  awayTeam: string,
  postedSpread: number | null
): ATSSituation {
  const db = loadATSDB();

  const homeKey = atsKey(homeTeam, awayTeam, sportKey);
  const awayKey = atsKey(awayTeam, homeTeam, sportKey);

  const homeATS = db[homeKey] ?? null;
  const awayATS = db[awayKey] ?? null;

  const atsSignals: string[] = [];
  let atsScoreBonus = 0;

  // Home team ATS signals
  if (homeATS && homeATS.gamesTracked >= 3) {
    if (homeATS.atsWinPct >= 65) {
      atsSignals.push(`${homeTeam} covers ${homeATS.atsWinPct}% ATS vs ${awayTeam} (${homeATS.wins}-${homeATS.losses})`);
      atsScoreBonus += 6;
    } else if (homeATS.atsWinPct <= 35) {
      atsSignals.push(`${homeTeam} only covers ${homeATS.atsWinPct}% ATS vs ${awayTeam} -- fade spot`);
      atsScoreBonus -= 4;
    }
  }

  // Away team ATS signals
  if (awayATS && awayATS.gamesTracked >= 3) {
    if (awayATS.atsWinPct >= 65) {
      atsSignals.push(`${awayTeam} covers ${awayATS.atsWinPct}% ATS vs ${homeTeam} (${awayATS.wins}-${awayATS.losses})`);
      atsScoreBonus += 6;
    }
  }

  // Home underdog ATS
  let homeAsUnderdog: ATSSituation['homeAsUnderdog'] = null;
  if (postedSpread !== null && postedSpread > 0) {
    const dogRecord = homeATS?.homeRecord;
    if (dogRecord) {
      const total = dogRecord.wins + dogRecord.losses;
      const winPct = total > 0 ? Math.round((dogRecord.wins / total) * 1000) / 10 : 0;
      homeAsUnderdog = { wins: dogRecord.wins, losses: dogRecord.losses, winPct };
      if (winPct >= 60 && total >= 3) {
        atsSignals.push(`${homeTeam} covers ${winPct}% as home dog`);
        atsScoreBonus += 5;
      }
    }
  }

  return {
    homeATS, awayATS, h2hATS: homeATS,
    homeAsUnderdog, awayAsFavorite: null,
    atsSignals, atsScoreBonus: Math.min(atsScoreBonus, 15),
  };
}
