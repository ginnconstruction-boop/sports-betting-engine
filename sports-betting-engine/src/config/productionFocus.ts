// Current production scope. Archived records and grading remain available.
export const NFL = 'americanfootball_nfl';
export const NCAAF = 'americanfootball_ncaaf';
export const PRODUCTION_SPORTS = [NFL, NCAAF];

export function assertProductionSport(sportKey: string): void {
  if (!PRODUCTION_SPORTS.includes(sportKey)) {
    throw new Error(`${sportKey} is paused. Production is focused on NFL and NCAAF; historical records are preserved.`);
  }
}

export function productionMarkets(sportKey: string, markets: string[]): string[] {
  assertProductionSport(sportKey);
  return [...new Set(markets)].filter(m => sportKey !== NCAAF || ['spreads', 'totals'].includes(m));
}

export const PAUSED_COMMANDS = new Set([
  'nba', 'mlb', 'nhl', 'ncaab', 'ncaa-baseball', 'nba-props',
  'mlbprops', 'nhlprops', 'firstbasket', 'fb',
  // Legacy specialty models remain disabled; quotes/manual paper stay open.
  'altparlays', 'altparlays-nfl', 'alt', 'sgp', 'sgp-nfl', 'parlay',
  'firsttd', 'ftd', 'teasers', 'teaser',
]);

export function isPausedCommand(command: string): boolean {
  return PAUSED_COMMANDS.has(command);
}
