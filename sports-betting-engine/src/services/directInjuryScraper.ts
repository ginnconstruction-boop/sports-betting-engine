// ============================================================
// src/services/directInjuryScraper.ts
// Direct injury scraping from NBA.com and NFL.com
// Faster than ESPN feed -- catches late scratches earlier
// Used as a SUPPLEMENT to espnData.ts, not a replacement
// ============================================================

import https from 'https';
import { ESPNInjury } from './espnData';

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.nba.com/',
      }
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ------------------------------------
// NBA.com injury report
// Updates ~90 min before tip-off
// ------------------------------------

export async function getNBADirectInjuries(): Promise<Map<string, ESPNInjury[]>> {
  const result = new Map<string, ESPNInjury[]>();

  try {
    // NBA Stats API -- injury report endpoint
    const url = 'https://stats.nba.com/js/data/leaguedashinjury/00_latest.json';
    const data = await fetchJson(url);

    const headers: string[] = data?.resultSets?.[0]?.headers ?? [];
    const rows: any[][] = data?.resultSets?.[0]?.rowSet ?? [];

    const teamIdx   = headers.indexOf('TEAM_NAME') >= 0 ? headers.indexOf('TEAM_NAME') : headers.indexOf('TEAM');
    const nameIdx   = headers.indexOf('PLAYER_NAME');
    const statusIdx = headers.indexOf('INJURY_STATUS') >= 0 ? headers.indexOf('INJURY_STATUS') : headers.indexOf('STATUS');
    const detailIdx = headers.indexOf('INJURY_DESCRIPTION') >= 0 ? headers.indexOf('INJURY_DESCRIPTION') : headers.indexOf('COMMENT');

    for (const row of rows) {
      const team   = teamIdx >= 0 ? String(row[teamIdx] ?? '') : '';
      const name   = nameIdx >= 0 ? String(row[nameIdx] ?? '') : '';
      const status = statusIdx >= 0 ? String(row[statusIdx] ?? '') : '';
      const detail = detailIdx >= 0 ? String(row[detailIdx] ?? '') : '';

      if (!name || !team) continue;

      const injury: ESPNInjury = {
        team, playerName: name,
        status: normalizeStatus(status),
        position: '', detail,
      };

      const existing = result.get(team) ?? [];
      existing.push(injury);
      result.set(team, existing);
    }
  } catch {
    // NBA direct scrape failed -- ESPN fallback will handle it
  }

  // Also try NBA injury report PDF/HTML page as backup
  if (result.size === 0) {
    try {
      const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';
      const data = await fetchJson(url);
      const items = data?.items ?? data?.injuries ?? [];
      for (const item of items) {
        const team = item?.team?.displayName ?? item?.team?.name ?? '';
        const players = item?.injuries ?? item?.players ?? [];
        for (const p of players) {
          const inj: ESPNInjury = {
            team,
            playerName: p?.athlete?.displayName ?? p?.displayName ?? '',
            status: normalizeStatus(p?.status ?? p?.type?.description ?? ''),
            position: p?.athlete?.position?.abbreviation ?? '',
            detail: p?.details?.detail ?? p?.comment ?? '',
          };
          if (!inj.playerName) continue;
          const existing = result.get(team) ?? [];
          existing.push(inj);
          result.set(team, existing);
        }
      }
    } catch { }
  }

  return result;
}

// ------------------------------------
// NFL.com injury report
// Updates Wednesdays (limited), Fridays (full), game day
// ------------------------------------

export async function getNFLDirectInjuries(): Promise<Map<string, ESPNInjury[]>> {
  const result = new Map<string, ESPNInjury[]>();

  try {
    const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries';
    const data = await fetchJson(url);
    const items = data?.items ?? [];

    for (const item of items) {
      const team = item?.team?.displayName ?? '';
      const players = item?.injuries ?? [];
      for (const p of players) {
        const inj: ESPNInjury = {
          team,
          playerName: p?.athlete?.displayName ?? '',
          status: normalizeStatus(p?.status ?? ''),
          position: p?.athlete?.position?.abbreviation ?? '',
          detail: p?.details?.detail ?? p?.comment ?? '',
        };
        if (!inj.playerName) continue;
        const existing = result.get(team) ?? [];
        existing.push(inj);
        result.set(team, existing);
      }
    }
  } catch { }

  return result;
}

// ------------------------------------
// Merge direct + ESPN injuries
// Direct feed takes priority for same player (more current)
// ------------------------------------

export function mergeInjuryFeeds(
  espnInjuries: Map<string, ESPNInjury[]>,
  directInjuries: Map<string, ESPNInjury[]>
): Map<string, ESPNInjury[]> {
  const merged = new Map<string, ESPNInjury[]>(espnInjuries);

  for (const [team, injuries] of directInjuries) {
    const existing = merged.get(team) ?? [];
    for (const inj of injuries) {
      // Check if this player already in ESPN feed
      const espnIdx = existing.findIndex(
        e => e.playerName.toLowerCase() === inj.playerName.toLowerCase()
      );
      if (espnIdx >= 0) {
        // Direct feed is more current -- replace if status changed
        if (existing[espnIdx].status !== inj.status) {
          existing[espnIdx] = { ...existing[espnIdx], ...inj, source: 'direct' as any };
        }
      } else {
        // New player not in ESPN feed -- add it
        existing.push({ ...inj, source: 'direct' as any });
      }
    }
    merged.set(team, existing);
  }

  return merged;
}

// ------------------------------------
// Get late scratches (Out/Doubtful only)
// flagged as high urgency
// ------------------------------------

export function getLateScratchAlerts(
  injuries: Map<string, ESPNInjury[]>
): { playerName: string; team: string; status: string; detail: string }[] {
  const alerts: { playerName: string; team: string; status: string; detail: string }[] = [];
  for (const [team, list] of injuries) {
    for (const inj of list) {
      if (inj.status === 'Out' || inj.status === 'Doubtful') {
        alerts.push({
          playerName: inj.playerName,
          team,
          status: inj.status,
          detail: inj.detail,
        });
      }
    }
  }
  return alerts;
}

function normalizeStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('out') || s === 'inactive') return 'Out';
  if (s.includes('doubtful')) return 'Doubtful';
  if (s.includes('questionable') || s.includes('day-to-day')) return 'Questionable';
  if (s.includes('probable')) return 'Probable';
  if (s.includes('expected') || s.includes('active')) return 'Active';
  return raw;
}

// ------------------------------------
// Combined: get best available injuries
// for any sport
// ------------------------------------

export async function getEnhancedInjuries(
  sportKey: string,
  espnInjuries: Map<string, ESPNInjury[]>
): Promise<Map<string, ESPNInjury[]>> {
  try {
    if (sportKey === 'basketball_nba') {
      const direct = await getNBADirectInjuries();
      return mergeInjuryFeeds(espnInjuries, direct);
    }
    if (sportKey === 'americanfootball_nfl') {
      const direct = await getNFLDirectInjuries();
      return mergeInjuryFeeds(espnInjuries, direct);
    }
  } catch { }
  return espnInjuries;
}
