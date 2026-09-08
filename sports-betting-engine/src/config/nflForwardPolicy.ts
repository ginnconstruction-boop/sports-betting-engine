export const NFL_FORWARD_POLICY = Object.freeze({
  version: 'nfl-forward-policy-v1',
  protectedCutoff: '2026-09-08T02:19:07.588Z',
  season: 2026,
  timezone: 'America/Chicago',
  collectionHoursCentral: [7, 14] as const,
  horizonHours: 120,
  maxOddsCreditsPerRun: 200,
  maxOddsRequestsPerRun: 20,
  lateQuoteLabel: 'LAST_VERIFIED_PREGAME_QUOTE',
  coreGameMarkets: ['h2h', 'spreads', 'totals'] as const,
  corePropMarkets: [
    'player_pass_yds', 'player_pass_attempts', 'player_pass_completions',
    'player_rush_yds', 'player_rush_attempts',
    'player_reception_yds', 'player_receptions',
  ] as const,
});

export type NflForwardTrigger = 'SCHEDULED_0700_CT' | 'SCHEDULED_1400_CT' | 'MANUAL';
export type NflEvidenceClass = 'LIVE_FORWARD' | 'RECONSTRUCTED' | 'HISTORICAL_SNAPSHOT' | 'DERIVED' | 'UNSAFE_FUTURE_LEAKAGE';
