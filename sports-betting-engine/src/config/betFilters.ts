// ============================================================
// src/config/betFilters.ts
// All tunable filter settings in one place
// Adjust these to change system behavior without touching code
// ============================================================

export const BET_FILTERS = {

  // #1 -- Minimum signals required
  // Set to 2 -- score threshold (72/78/85) is the real quality gate
  MIN_SIGNALS_REQUIRED: 2,

  // Price range filter
  MIN_PRICE: -200,   // no heavier than -200 (was -250)
  MAX_PRICE: 180,    // no longer than +180 (was +200)

  // Maximum credible price edge vs consensus
  // Gaps larger than this = likely stale/low-liquidity line, not real edge
  MAX_CREDIBLE_EDGE: 80,  // anything over 80pts is suspicious

  // Minimum books for reliable consensus
  MIN_BOOKS_FOR_CONSENSUS: 3,          // default for NBA/NFL
  MIN_BOOKS_MLB: 2,                    // MLB has fewer books posting lines
  MIN_BOOKS_NHL: 2,                    // NHL same
  MIN_BOOKS_NCAA: 2,                   // NCAA markets thin

  // Minimum hours until game
  // Props: 0.25 (15 min) -- books pull lines right at tip
  // Game lines: 1.0 -- need time to act on the edge
  MIN_HOURS_UNTIL_GAME: 1,
  MIN_HOURS_UNTIL_GAME_PROPS: 0.25,

  // Recent movement window
  RECENT_MOVEMENT_HOURS: 2,
  RECENT_MOVEMENT_BONUS: 10,

  // Gap alert threshold
  USER_BOOK_GAP_ALERT_THRESHOLD: 10,

  // Fade the public threshold
  FADE_PUBLIC_LINE_THRESHOLD: 1.5,

  // MAX ENTRIES PER GAME -- 1 for multi-sport scans (forces sport diversity)
  // Single-sport scans use MAX_ENTRIES_PER_GAME_SINGLE below
  MAX_ENTRIES_PER_GAME: 1,

  // For single-sport scans (options 4-10): allow 2 per game
  // With 7 NBA games you get up to 14 candidates, best 5-10 shown
  MAX_ENTRIES_PER_GAME_SINGLE: 2,

  // Split market threshold
  SPLIT_MARKET_SCORE_DIFF: 5,

  // Default window
  WINDOW_HOURS_DEFAULT: 24,

  // MLB RUN LINE -- heavily penalized, prefer ML or team total
  MLB_RUN_LINE_PENALTY: 35,        // raised from 20
  MLB_PREFER_ML_OVER_RUNLINE: true,

  // SCORE THRESHOLDS -- corrected to match labels
  SCORE_BET_MIN: 85,       // NBA/NFL -- 85+
  SCORE_LEAN_MIN: 78,      // NBA/NFL -- 78-84
  SCORE_MONITOR_MIN: 72,   // NBA/NFL -- 72-77

  // MLB and NHL use lower thresholds -- thinner markets score lower
  // but equal quality signals vs NBA/NFL equivalents
  SCORE_BET_MIN_MLB: 72,     // MLB BET tier
  SCORE_LEAN_MIN_MLB: 65,    // MLB LEAN tier
  SCORE_MONITOR_MIN_MLB: 60, // MLB MONITOR tier

  SCORE_BET_MIN_NHL: 72,     // NHL BET tier
  SCORE_LEAN_MIN_NHL: 65,    // NHL LEAN tier
  SCORE_MONITOR_MIN_NHL: 60, // NHL MONITOR tier
  // Anything below 72 is filtered out entirely

  // Signal alignment -- HARD rule, not soft
  // If home and away signals both fire = DROP the play entirely
  REQUIRE_SIGNAL_ALIGNMENT: true,
  DROP_ON_CONTRADICTION: true,    // was just downgrading, now drops

  // Tier caps
  MAX_BET_TIER_PLAYS: 3,        // multi-sport
  MAX_BET_TIER_PLAYS_SINGLE: 4, // single-sport scans
  MAX_LEAN_TIER_PLAYS: 4,       // multi-sport
  MAX_LEAN_TIER_PLAYS_SINGLE: 4, // single-sport scans
  MAX_TOTAL_PLAYS: 10,          // hard cap -- never show more than 10 total plays

  // News relevance -- must match specific team keywords
  NEWS_REQUIRE_EXACT_TEAM_MATCH: true,
};

// Unit sizing -- 1 unit = $10
// Used by printTopTen to express Kelly recommendations as units + dollars
// Example: Kelly 1.0% of $1,000 bankroll = 1.0u / $10
export const UNIT_SIZE = 10;

// Context intelligence weights
export const CONTEXT_WEIGHTS = {
  KEY_PLAYER_OUT_PENALTY:  -15,   // key player missing
  BACK_TO_BACK_PENALTY:    -10,   // team on B2B
  REST_ADVANTAGE_BONUS:     +8,   // 2+ days more rest
  FORM_ADVANTAGE_BONUS:     +8,   // 2+ wins better in last 5
  HOT_STREAK_BONUS:         +5,   // 3+ win streak
  COLD_STREAK_PENALTY:      -5,   // 3+ loss streak
  HIGH_NEWS_PENALTY:       -10,   // high-relevance injury/suspension news
  TRAVEL_FATIGUE_PENALTY:   -5,   // cross-country travel
};
