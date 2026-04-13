// ============================================================
// src/config/propConfig.ts
// Player prop configuration
// Props are ENABLED by default (PROPS_ENABLED: true)
// NBA and NFL have full player intelligence (ESPN game logs)
// MLB and NHL have market scoring only -- no player profile data
// ============================================================

export const PROP_CONFIG = {

  // Master switch -- set to false to disable all prop scanning
  PROPS_ENABLED: true,

  // Sports with props enabled
  ENABLED_SPORTS: ['basketball_nba', 'americanfootball_nfl', 'baseball_mlb', 'icehockey_nhl'] as string[],

  // MLB prop markets -- pitcher and batter props
  MLB_PROP_MARKETS: [
    'batter_hits', 'batter_home_runs', 'batter_rbis',
    'batter_strikeouts', 'batter_total_bases',
    'pitcher_strikeouts', 'pitcher_hits_allowed', 'pitcher_earned_runs',
  ] as const,

  // NHL prop markets
  NHL_PROP_MARKETS: [
    'player_points', 'player_goals', 'player_assists',
    'player_shots_on_goal', 'goalie_saves',
  ] as const,

  // Minimum line gap between FanDuel and BetMGM to flag (in points)
  MIN_LINE_GAP: 1.5,

  // Minimum juice gap between books to flag (american odds points)
  MIN_JUICE_GAP: 8,

  // Recent form window (games)
  RECENT_FORM_GAMES: 5,

  // Minimum implied line vs posted line gap to flag
  MIN_IMPLIED_GAP: 1.5,

  // Back-to-back penalty -- lean under when player on B2B
  BACK_TO_BACK_PENALTY: true,

  // Minimum minutes average for a prop to be considered reliable
  MIN_MINUTES_THRESHOLD: 20,

  // Price range for props (tighter than game lines)
  MIN_PRICE: -140,   // tighter range for props
  MAX_PRICE: 120,

  // Prop markets to pull (when enabled)
  // These are The Odds API market keys
  NBA_PROP_MARKETS: [
    'player_points',
    'player_rebounds',
    'player_assists',
    'player_points_rebounds_assists',
    'player_threes',
    'player_blocks',
    'player_steals',
    'player_turnovers',
    'player_points_rebounds',
    'player_points_assists',
  ] as string[],

  // First scorer market keys
  NBA_FIRST_SCORER_MARKETS: ['player_first_basket'] as string[],
  NFL_FIRST_SCORER_MARKETS: ['player_first_touchdown', 'player_anytime_td'] as string[],

  // How many top prop picks to show
  TOP_N: 10,  // show top 10 props across all games
  MAX_PROPS_PER_GAME: 2,  // max 2 props per game to force slate diversity
};

// ------------------------------------
// Check if props are enabled
// ------------------------------------

export function propsEnabled(): boolean {
  return PROP_CONFIG.PROPS_ENABLED;
}

export function enableProps(): void {
  PROP_CONFIG.PROPS_ENABLED = true;
}

export function disableProps(): void {
  PROP_CONFIG.PROPS_ENABLED = false;
}
