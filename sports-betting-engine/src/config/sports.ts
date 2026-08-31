// ============================================================
// src/config/sports.ts
// All target sports -- dynamically iterated, never hardcoded
// To disable a sport: set enabled: false
// ============================================================

import { SportConfig } from '../types/odds';

export const SPORTS: SportConfig[] = [
  {
    key: 'baseball_mlb',
    name: 'MLB',
    enabled: false,
    inSeason: true,
  },
  {
    key: 'basketball_nba',
    name: 'NBA',
    enabled: false,
    inSeason: true,
  },
  {
    key: 'americanfootball_nfl',
    name: 'NFL',
    enabled: true,
    inSeason: true,
  },
  {
    key: 'americanfootball_ncaaf',
    name: 'NCAAF',
    enabled: true,
    inSeason: true,
  },
  {
    key: 'basketball_ncaab',
    name: 'NCAAB',
    enabled: false,
    inSeason: true,
  },
  {
    key: 'baseball_ncaa',
    name: 'NCAA Baseball',
    enabled: false,
    inSeason: true,
  },
  {
    key: 'icehockey_nhl',
    name: 'NHL',
    enabled: false,
    inSeason: true,
  },
];

/**
 * Returns only enabled sports.
 * Pass onlyInSeason=true to further filter to in-season sports.
 */
export function getEnabledSports(onlyInSeason = false): SportConfig[] {
  return SPORTS.filter(
    (s) => s.enabled && (!onlyInSeason || s.inSeason !== false)
  );
}

/**
 * Look up a sport config by key.
 */
export function getSportByKey(key: string): SportConfig | undefined {
  return SPORTS.find((s) => s.key === key);
}
