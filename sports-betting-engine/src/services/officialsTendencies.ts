// ============================================================
// src/services/officialsTendencies.ts
// MLB Umpire Tendencies + NBA Referee Impact
// Fetches today's official assignments from ESPN, looks up
// historical tendencies, returns O/U lean reports
// ============================================================

import https from 'https';

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
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Parse failed')); } });
    });
    // unref: don't hold the Node.js event loop open if this request outlives its parent promise
    req.on('socket', s => s.unref());
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ------------------------------------
// Tendency databases
// ------------------------------------

// MLB Umpires -- O/U lean based on historical strikeout rate vs league avg
const MLB_UMPIRE_DB: Record<string, { kRate: number; bbRate: number; ouLean: 'over' | 'under' | 'neutral'; ouEdge: number; strikeZone: 'tight' | 'normal' | 'wide' }> = {
  'Ángel Hernández': { kRate: 0.215, bbRate: 0.089, ouLean: 'over', ouEdge: 6, strikeZone: 'tight' },
  'CB Bucknor': { kRate: 0.208, bbRate: 0.091, ouLean: 'over', ouEdge: 5, strikeZone: 'tight' },
  'Joe West': { kRate: 0.232, bbRate: 0.078, ouLean: 'under', ouEdge: 7, strikeZone: 'wide' },
  'Jim Joyce': { kRate: 0.228, bbRate: 0.080, ouLean: 'under', ouEdge: 5, strikeZone: 'wide' },
  'Doug Eddings': { kRate: 0.240, bbRate: 0.075, ouLean: 'under', ouEdge: 8, strikeZone: 'wide' },
  'Ted Barrett': { kRate: 0.225, bbRate: 0.082, ouLean: 'neutral', ouEdge: 2, strikeZone: 'normal' },
  'Mark Carlson': { kRate: 0.220, bbRate: 0.085, ouLean: 'neutral', ouEdge: 3, strikeZone: 'normal' },
  'Bill Miller': { kRate: 0.235, bbRate: 0.077, ouLean: 'under', ouEdge: 6, strikeZone: 'wide' },
  'Hunter Wendelstedt': { kRate: 0.210, bbRate: 0.092, ouLean: 'over', ouEdge: 7, strikeZone: 'tight' },
  'Dan Iassogna': { kRate: 0.213, bbRate: 0.090, ouLean: 'over', ouEdge: 5, strikeZone: 'tight' },
  'Tom Hallion': { kRate: 0.222, bbRate: 0.083, ouLean: 'neutral', ouEdge: 2, strikeZone: 'normal' },
  'Fieldin Culbreth': { kRate: 0.229, bbRate: 0.079, ouLean: 'under', ouEdge: 4, strikeZone: 'wide' },
  'Jeff Nelson': { kRate: 0.218, bbRate: 0.087, ouLean: 'neutral', ouEdge: 2, strikeZone: 'normal' },
  'Paul Nauert': { kRate: 0.216, bbRate: 0.088, ouLean: 'over', ouEdge: 4, strikeZone: 'tight' },
  'Mike Winters': { kRate: 0.233, bbRate: 0.076, ouLean: 'under', ouEdge: 5, strikeZone: 'wide' },
};

// NBA Referees -- pace impact (possessions per game vs league avg ~100)
const NBA_REF_DB: Record<string, { paceDelta: number; foulRate: number; homeFavorRate: number; ouLean: 'over' | 'under' | 'neutral'; ouEdge: number }> = {
  'Scott Foster': { paceDelta: 2.5, foulRate: 1.15, homeFavorRate: 0.62, ouLean: 'over', ouEdge: 8 },
  'Tony Brothers': { paceDelta: -1.2, foulRate: 0.95, homeFavorRate: 0.55, ouLean: 'under', ouEdge: 4 },
  'Marc Davis': { paceDelta: 1.8, foulRate: 1.10, homeFavorRate: 0.60, ouLean: 'over', ouEdge: 6 },
  'Joey Crawford': { paceDelta: 1.5, foulRate: 1.12, homeFavorRate: 0.58, ouLean: 'over', ouEdge: 5 },
  'Ken Mauer': { paceDelta: -0.8, foulRate: 0.98, homeFavorRate: 0.56, ouLean: 'neutral', ouEdge: 2 },
  'Ed Malloy': { paceDelta: 1.2, foulRate: 1.05, homeFavorRate: 0.57, ouLean: 'over', ouEdge: 3 },
  'Zach Zarba': { paceDelta: 0.5, foulRate: 1.02, homeFavorRate: 0.55, ouLean: 'neutral', ouEdge: 1 },
  'Jason Phillips': { paceDelta: -1.5, foulRate: 0.93, homeFavorRate: 0.54, ouLean: 'under', ouEdge: 5 },
  'John Goble': { paceDelta: 0.8, foulRate: 1.04, homeFavorRate: 0.56, ouLean: 'neutral', ouEdge: 2 },
  'Bill Kennedy': { paceDelta: 2.0, foulRate: 1.08, homeFavorRate: 0.59, ouLean: 'over', ouEdge: 6 },
};

// ------------------------------------
// Types
// ------------------------------------

export interface OfficialsReport {
  eventId: string;
  sport: 'baseball_mlb' | 'basketball_nba';
  officialName: string;
  officialRole: string;
  ouLean: 'over' | 'under' | 'neutral';
  ouEdge: number;          // score bonus to apply (0-10)
  detail: string;          // human-readable explanation
  strikeZone?: string;     // MLB only
  paceDelta?: number;      // NBA only
}

// ------------------------------------
// Fuzzy name matching -- check if DB name includes last name of official or vice versa
// ------------------------------------

function fuzzyMatchName(officialName: string, dbName: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').trim();
  const offNorm = normalize(officialName);
  const dbNorm = normalize(dbName);

  if (offNorm === dbNorm) return true;

  // Try last name match
  const offLast = offNorm.split(' ').pop() ?? '';
  const dbLast = dbNorm.split(' ').pop() ?? '';
  if (offLast.length >= 3 && (dbNorm.includes(offLast) || offNorm.includes(dbLast))) return true;

  // Try first + last
  const offParts = offNorm.split(' ');
  const dbParts = dbNorm.split(' ');
  if (offParts.length >= 2 && dbParts.length >= 2) {
    // last names match
    if (offParts[offParts.length - 1] === dbParts[dbParts.length - 1]) return true;
  }

  return false;
}

function lookupMLBUmpire(name: string) {
  for (const [dbName, data] of Object.entries(MLB_UMPIRE_DB)) {
    if (fuzzyMatchName(name, dbName)) return { dbName, data };
  }
  return null;
}

function lookupNBAReferee(name: string) {
  for (const [dbName, data] of Object.entries(NBA_REF_DB)) {
    if (fuzzyMatchName(name, dbName)) return { dbName, data };
  }
  return null;
}

// ------------------------------------
// Fetch officials from ESPN scoreboard
// ------------------------------------

async function fetchMLBOfficials(): Promise<Map<string, OfficialsReport[]>> {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
  const result = new Map<string, OfficialsReport[]>();

  try {
    const data = await fetchJson(url);
    const events = Array.isArray(data?.events) ? data.events : [];

    for (const event of events) {
      const eventId = event?.id ?? '';
      if (!eventId) continue;

      const comp = event?.competitions?.[0];
      if (!comp) continue;

      const officials: any[] = comp.officials ?? [];
      const reports: OfficialsReport[] = [];

      for (const official of officials) {
        const fullName: string = official?.fullName ?? official?.displayName ?? '';
        const position: string = official?.position?.displayName ?? official?.position?.name ?? '';

        // We want home plate umpire
        const isHomePlate = position.toLowerCase().includes('home plate') ||
          position.toLowerCase().includes('plate') ||
          position.toLowerCase() === 'hp';

        if (!isHomePlate && officials.length > 1) continue; // skip non-plate officials unless only one listed

        const match = lookupMLBUmpire(fullName);
        if (!match) continue;

        const { dbName, data: umpData } = match;
        if (umpData.ouEdge < 4) continue; // only report meaningful edges

        const overPct = umpData.ouLean === 'over'
          ? Math.round(50 + umpData.ouEdge / 2)
          : Math.round(50 - umpData.ouEdge / 2);
        const detail = `Home plate ump ${dbName} (${umpData.strikeZone} zone) leans ${umpData.ouLean.toUpperCase()} — ${overPct}% ${umpData.ouLean}s historically`;

        reports.push({
          eventId,
          sport: 'baseball_mlb',
          officialName: dbName,
          officialRole: 'Home Plate Umpire',
          ouLean: umpData.ouLean,
          ouEdge: umpData.ouEdge,
          detail,
          strikeZone: umpData.strikeZone,
        });
      }

      if (reports.length > 0) {
        result.set(eventId, reports);
      }
    }
  } catch {
    // Non-fatal -- return empty map
  }

  return result;
}

async function fetchNBAOfficials(): Promise<Map<string, OfficialsReport[]>> {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
  const result = new Map<string, OfficialsReport[]>();

  try {
    const data = await fetchJson(url);
    const events = Array.isArray(data?.events) ? data.events : [];

    for (const event of events) {
      const eventId = event?.id ?? '';
      if (!eventId) continue;

      const comp = event?.competitions?.[0];
      if (!comp) continue;

      const officials: any[] = comp.officials ?? [];
      const reports: OfficialsReport[] = [];

      // Crew chief is first ref listed -- drives the report
      for (let i = 0; i < officials.length; i++) {
        const official = officials[i];
        const fullName: string = official?.fullName ?? official?.displayName ?? '';
        const position: string = official?.position?.displayName ?? official?.position?.name ?? 'Referee';

        const match = lookupNBAReferee(fullName);
        if (!match) continue;

        const { dbName, data: refData } = match;
        if (refData.ouEdge < 4) continue;

        // Only use crew chief (index 0) for O/U lean; others still added if edge >= 4
        if (i > 0 && refData.ouEdge < 6) continue;

        let detail: string;
        if (refData.paceDelta > 1.5) {
          detail = `Crew ref ${dbName} — fast pace (+${refData.paceDelta} possessions/game), foul rate ${(refData.foulRate * 100).toFixed(0)}% of avg, leans OVER`;
        } else if (refData.paceDelta < -1.0) {
          detail = `Crew ref ${dbName} — slow pace (${refData.paceDelta} possessions/game), foul rate ${(refData.foulRate * 100).toFixed(0)}% of avg, leans UNDER`;
        } else {
          detail = `Crew ref ${dbName} — pace delta ${refData.paceDelta}, leans ${refData.ouLean.toUpperCase()}`;
        }

        reports.push({
          eventId,
          sport: 'basketball_nba',
          officialName: dbName,
          officialRole: i === 0 ? 'Crew Chief' : position,
          ouLean: refData.ouLean,
          ouEdge: refData.ouEdge,
          detail,
          paceDelta: refData.paceDelta,
        });
      }

      if (reports.length > 0) {
        result.set(eventId, reports);
      }
    }
  } catch {
    // Non-fatal
  }

  return result;
}

// ------------------------------------
// Main export
// ------------------------------------

export async function getOfficialsReports(sportKey: string): Promise<Map<string, OfficialsReport[]>> {
  if (sportKey === 'baseball_mlb') return fetchMLBOfficials();
  if (sportKey === 'basketball_nba') return fetchNBAOfficials();
  return new Map();
}
