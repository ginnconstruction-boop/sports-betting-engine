// ============================================================
// src/services/outcomeSignalEngine.ts
// Phase B + Phase C -- Outcome Signal Layer
//
// Adds outcome-based context signals to DecisionCandidates
// BEFORE the sport intelligence engine runs.
//
// Pipeline placement:
//   probability → [outcome signals] → sport intel → signal diversity → risk → label → slate
//
// Scope: NBA player props only.
//   Non-NBA / non-prop candidates pass through unchanged.
//
// Phase B (proxy-based — always available):
//   Role stability and usage trend inferred from posted line magnitude.
//
// Phase C (context-aware — used when OutcomeContext is supplied):
//   Upgrades each signal dimension with real data where available:
//   1. Role / Minutes  — lineupMap (confirmedStarters, scratchedPlayers)
//   2. Injury opp.     — injuryMap (Out/Doubtful teammates)
//   3. Recent form     — contextMap (team homeForm/awayForm last5Avg PPG)
//   4. Matchup         — powerRatings (opponent defensiveRating)
//   Falls back to Phase B proxy silently when context is absent.
//
// Signal merging rules (critical — do not relax):
//   POSITIVE outcome signals that can flip price-only → multi-signal:
//     ROLE_STABLE, MINUTES_SECURE, INJURY_OPPORTUNITY_UP,
//     RECENT_FORM_GOOD, FAVORABLE_MATCHUP
//   These are added to signals[] so signal diversity engine sees them.
//
//   Negative / neutral outcome signals stay in outcomeSignals[] ONLY:
//     ROLE_UNSTABLE, MINUTES_RISK, INJURY_CONTEXT_NEUTRAL,
//     INJURY_OPPORTUNITY_DOWN, RECENT_FORM_BAD, RECENT_FORM_NEUTRAL,
//     MATCHUP_NEUTRAL, TOUGH_MATCHUP, MINUTES_UNKNOWN, USAGE_*
//   Reason: adding ANY non-market-structure signal to signals[] triggers
//   hasStrongSignalDiversity = true → riskScore +2, which must not fire
//   for negative or neutral context.
// ============================================================

import { DecisionCandidate } from './decisionTypes';
import { getATSOutcomeSignal } from './atsTracker';

// ── Context input type (Phase C) ─────────────────────────────

/**
 * Optional context maps passed from each scan command.
 * All fields are optional — absence of any field causes that dimension
 * to fall back silently to the Phase B proxy value.
 *
 * Map key for all entries: eventId string from the Odds API.
 */
export interface OutcomeContext {
  /** keyed by eventId → ESPNInjury[] for both teams in that game */
  injuryMap?: Map<string, any[]>;
  /**
   * keyed by eventId → { home: ConfirmedLineup, away: ConfirmedLineup }
   * ConfirmedLineup has: confirmedStarters: StarterInfo[], scratchedPlayers: ScratchedPlayer[],
   * lineupConfirmed: boolean
   */
  lineupMap?: Map<string, any>;
  /** keyed by eventId → ContextPackage (homeForm, awayForm, homeRest, awayRest, ...) */
  contextMap?: Map<string, any>;
  /**
   * keyed by eventId → { home: PowerRating, away: PowerRating }
   * PowerRating has: offensiveRating, defensiveRating, netRating, recentNetRating
   */
  powerRatings?: Map<string, any>;
  /** Game summaries for team→eventId and home/away position resolution */
  gameSummaries?: Array<{
    eventId: string;
    homeTeam: string;
    awayTeam: string;
    matchup: string;
  }>;
}

// ── Market category ──────────────────────────────────────────

type MarketCategory = 'points' | 'rebounds' | 'assists' | 'pra' | 'threes' | 'other';

function getMarketCategory(market: string | undefined): MarketCategory {
  if (!market) return 'other';
  const m = market.toLowerCase();
  if (m.includes('points_rebounds_assists') || m.includes('pra')) return 'pra';
  if (m.includes('points'))                                        return 'points';
  if (m.includes('rebounds'))                                      return 'rebounds';
  if (m.includes('assists'))                                       return 'assists';
  if (m.includes('threes') || m.includes('three_point'))          return 'threes';
  return 'other';
}

// ── Phase B proxy: role stability ────────────────────────────

interface RoleBracket { stableMin: number; unstableMax: number; }
const ROLE_BRACKETS: Record<MarketCategory, RoleBracket> = {
  points:   { stableMin: 18,  unstableMax: 10  },
  rebounds: { stableMin: 7,   unstableMax: 4   },
  assists:  { stableMin: 6,   unstableMax: 3   },
  pra:      { stableMin: 28,  unstableMax: 20  },
  threes:   { stableMin: 2.5, unstableMax: 1.5 },
  other:    { stableMin: 3,   unstableMax: 1   },
};

type RoleSignal = 'ROLE_STABLE' | 'ROLE_NEUTRAL' | 'ROLE_UNSTABLE';

function getProxyRoleSignal(category: MarketCategory, line: number): RoleSignal {
  const { stableMin, unstableMax } = ROLE_BRACKETS[category];
  if (line >= stableMin)   return 'ROLE_STABLE';
  if (line <  unstableMax) return 'ROLE_UNSTABLE';
  return 'ROLE_NEUTRAL';
}

function outcomeRoleScoreFor(role: RoleSignal): number {
  if (role === 'ROLE_STABLE')   return 75;
  if (role === 'ROLE_UNSTABLE') return 25;
  return 50;
}

// ── Phase B proxy: usage trend ────────────────────────────────

interface UsageBracket { upMin: number; downMax: number; }
const USAGE_BRACKETS: Partial<Record<MarketCategory, UsageBracket>> = {
  points:   { upMin: 22,  downMax: 11 },
  rebounds: { upMin: 9,   downMax: 3  },
  assists:  { upMin: 7,   downMax: 2  },
  pra:      { upMin: 35,  downMax: 21 },
  threes:   { upMin: 3.5, downMax: 1  },
};

type UsageSignal = 'USAGE_UP' | 'USAGE_STABLE' | 'USAGE_DOWN';

function getProxyUsageSignal(category: MarketCategory, line: number): UsageSignal {
  const bracket = USAGE_BRACKETS[category];
  if (!bracket)                return 'USAGE_STABLE';
  if (line >= bracket.upMin)   return 'USAGE_UP';
  if (line <= bracket.downMax) return 'USAGE_DOWN';
  return 'USAGE_STABLE';
}

function usageTrendScoreFor(usage: UsageSignal): number {
  if (usage === 'USAGE_UP')   return 80;
  if (usage === 'USAGE_DOWN') return 25;
  return 50;
}

// ── NBA detection ────────────────────────────────────────────

function isNBAProp(c: DecisionCandidate): boolean {
  if (c.marketType !== 'player_prop') return false;
  return (
    c.sport?.toUpperCase() === 'NBA' ||
    (c.sportKey !== undefined && c.sportKey.includes('basketball_nba'))
  );
}

// ── Phase C helpers ──────────────────────────────────────────

/**
 * Fuzzy team name match.
 * Handles: "Lakers" vs "Los Angeles Lakers", "Celtics" vs "Boston Celtics", etc.
 */
function teamsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  if (al === bl) return true;
  // Last word match (city + name → just name)
  const aLast = al.split(' ').pop() ?? '';
  const bLast = bl.split(' ').pop() ?? '';
  if (aLast.length > 2 && aLast === bLast) return true;
  // Substring match
  return al.includes(bl) || bl.includes(al);
}

/**
 * Attempts to extract an Odds API event ID from the first segment of
 * a DecisionCandidate id.  Event IDs are alphanumeric strings with no spaces.
 * If the first segment contains spaces it is a matchup string, not an event ID.
 */
function extractEventId(candidateId: string): string | undefined {
  const first = candidateId.split('__')[0] ?? '';
  return /^[a-zA-Z0-9-]+$/.test(first) && first.length > 8 ? first : undefined;
}

interface GameRef {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  /** True when the prop player's team is the home team */
  isHome: boolean;
}

/**
 * Resolves a DecisionCandidate to its game event reference.
 * Returns undefined when the game cannot be located or the team
 * cannot be matched to home/away.
 */
function findGame(c: DecisionCandidate, ctx: OutcomeContext): GameRef | undefined {
  if (!ctx.gameSummaries || !c.team) return undefined;

  // Attempt event ID match first (faster, more reliable)
  const extractedId = extractEventId(c.id);
  let game = extractedId
    ? ctx.gameSummaries.find(g => g.eventId === extractedId)
    : undefined;

  // Fall back to matchup string equality
  if (!game) {
    game = ctx.gameSummaries.find(g => g.matchup === c.matchup);
  }
  if (!game) return undefined;

  const isHome = teamsMatch(c.team, game.homeTeam);
  const isAway = teamsMatch(c.team, game.awayTeam);
  if (!isHome && !isAway) return undefined;

  return {
    eventId: game.eventId,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    isHome: !!isHome,
  };
}

// ── Phase C: Role / Minutes from lineupMap ───────────────────

type MinutesSignal = 'MINUTES_SECURE' | 'MINUTES_RISK' | 'MINUTES_UNKNOWN';

interface RoleMinutesResult {
  roleSignal: RoleSignal;
  minutesSignal: MinutesSignal;
  minutesConfidenceScore: number;
  /** 'lineup' means actual confirmation data was used; 'proxy' means line-size fallback */
  source: 'lineup' | 'proxy';
}

function deriveRoleMinutes(
  c: DecisionCandidate,
  game: GameRef | undefined,
  lineupMap: Map<string, any> | undefined,
  proxyRole: RoleSignal
): RoleMinutesResult {
  const proxyFallback: RoleMinutesResult = {
    roleSignal: proxyRole,
    minutesSignal: 'MINUTES_UNKNOWN',
    minutesConfidenceScore: 50,
    source: 'proxy',
  };

  if (!lineupMap || !game) return proxyFallback;

  const lineupEntry = lineupMap.get(game.eventId);
  if (!lineupEntry) return proxyFallback;

  // Select the correct team's lineup (home or away)
  const teamLineup = game.isHome ? lineupEntry.home : lineupEntry.away;
  if (!teamLineup) return proxyFallback;

  const nameLower = (c.playerName ?? '').toLowerCase();
  if (!nameLower) return proxyFallback;

  // --- Scratched check (highest confidence — player is not playing) ---
  const scratched: boolean = (teamLineup.scratchedPlayers ?? []).some((sp: any) => {
    const spName = (sp.playerName ?? '').toLowerCase();
    return spName.includes(nameLower) || nameLower.includes(spName);
  });
  if (scratched) {
    return {
      roleSignal: 'ROLE_UNSTABLE',
      minutesSignal: 'MINUTES_RISK',
      minutesConfidenceScore: 15,
      source: 'lineup',
    };
  }

  // --- Confirmed starter check ---
  // Only trust this when lineup is actually confirmed (within ~90 min of game)
  if (teamLineup.lineupConfirmed === true) {
    const isStarter: boolean = (teamLineup.confirmedStarters ?? []).some((s: any) => {
      const sName = (s.playerName ?? '').toLowerCase();
      return sName.includes(nameLower) || nameLower.includes(sName);
    });
    if (isStarter) {
      return {
        roleSignal: 'ROLE_STABLE',
        minutesSignal: 'MINUTES_SECURE',
        minutesConfidenceScore: 85,
        source: 'lineup',
      };
    }
  }

  // Lineup data exists but player not explicitly found — keep proxy role
  return proxyFallback;
}

// ── Phase C: Injury opportunity from injuryMap ───────────────

type InjurySignal =
  | 'INJURY_OPPORTUNITY_UP'
  | 'INJURY_CONTEXT_NEUTRAL'
  | 'INJURY_OPPORTUNITY_DOWN';

interface InjuryResult {
  signal: InjurySignal;
  score: number;
  /** 'injury_data' means the injuryMap was checked; 'no_data' means no map available */
  source: 'injury_data' | 'no_data';
}

function deriveInjuryOpportunity(
  c: DecisionCandidate,
  game: GameRef | undefined,
  injuryMap: Map<string, any[]> | undefined
): InjuryResult {
  const neutral: InjuryResult = { signal: 'INJURY_CONTEXT_NEUTRAL', score: 50, source: 'no_data' };

  if (!injuryMap || !game || !c.team) return neutral;

  const injuries = injuryMap.get(game.eventId) ?? [];
  if (injuries.length === 0) {
    // Map checked, no injuries for this game — confirmed neutral
    return { ...neutral, source: 'injury_data' };
  }

  const playerNameLower = (c.playerName ?? '').toLowerCase();
  const teamLower       = c.team.toLowerCase();

  // Find same-team injuries that are NOT the player themselves
  const teammateInjuries = injuries.filter((inj: any) => {
    const injTeam   = (inj.team   ?? '').toLowerCase();
    const injPlayer = (inj.playerName ?? '').toLowerCase();
    return teamsMatch(injTeam, teamLower) && injPlayer !== playerNameLower;
  });

  // Out or Doubtful teammates → usage redistribution opportunity
  const criticalOut = teammateInjuries.filter(
    (inj: any) => inj.status === 'Out' || inj.status === 'Doubtful'
  );
  if (criticalOut.length >= 1) {
    return { signal: 'INJURY_OPPORTUNITY_UP', score: 75, source: 'injury_data' };
  }

  return { signal: 'INJURY_CONTEXT_NEUTRAL', score: 50, source: 'injury_data' };
}

// ── Phase C: Recent form from contextMap ─────────────────────

// Only apply team scoring form to markets correlated with team scoring volume
const SCORING_CATEGORIES = new Set<MarketCategory>(['points', 'pra', 'threes']);

// NBA last-5 PPG thresholds (league average ~113–115)
const FORM_GOOD_AVG = 118; // hot-scoring team
const FORM_BAD_AVG  = 105; // struggling offensively

type FormSignal = 'RECENT_FORM_GOOD' | 'RECENT_FORM_BAD' | 'RECENT_FORM_NEUTRAL';

interface FormResult {
  signal: FormSignal;
  score: number;
  source: 'context_data' | 'no_data';
}

function deriveRecentForm(
  c: DecisionCandidate,
  game: GameRef | undefined,
  category: MarketCategory,
  contextMap: Map<string, any> | undefined
): FormResult {
  const neutral: FormResult = { signal: 'RECENT_FORM_NEUTRAL', score: 50, source: 'no_data' };

  // Team-scoring form only correlates with points/PRA/threes
  if (!SCORING_CATEGORIES.has(category)) return neutral;
  if (!contextMap || !game) return neutral;

  const ctxPkg = contextMap.get(game.eventId);
  if (!ctxPkg) return neutral;

  const teamForm = game.isHome ? ctxPkg.homeForm : ctxPkg.awayForm;
  if (!teamForm) return { ...neutral, source: 'context_data' };

  const avg: number = teamForm.last5Avg ?? 0;
  if (avg === 0) return { signal: 'RECENT_FORM_NEUTRAL', score: 50, source: 'context_data' };

  if (avg >= FORM_GOOD_AVG) return { signal: 'RECENT_FORM_GOOD', score: 70, source: 'context_data' };
  if (avg <= FORM_BAD_AVG)  return { signal: 'RECENT_FORM_BAD',  score: 30, source: 'context_data' };
  return { signal: 'RECENT_FORM_NEUTRAL', score: 50, source: 'context_data' };
}

// ── Phase C: Matchup quality from powerRatings ───────────────

// Apply matchup context to scoring-correlated markets
// (opponent defensive rating is a weaker predictor for rebounds/assists)

// NBA defensive rating ranges (PPG allowed):
//   Elite defense:  ≤ 105  → TOUGH_MATCHUP    (opponent very hard to score on)
//   Poor defense:   ≥ 117  → FAVORABLE_MATCHUP (opponent easy to score on)
//   Average:        106–116 → MATCHUP_NEUTRAL
const DEF_FAVORABLE = 117;
const DEF_TOUGH     = 105;

type MatchupSignal = 'FAVORABLE_MATCHUP' | 'TOUGH_MATCHUP' | 'MATCHUP_NEUTRAL';

interface MatchupResult {
  matchupSignal: MatchupSignal;
  matchupScore: number;
  defensiveMatchupScore: number;
  source: 'power_ratings' | 'no_data';
}

function deriveMatchup(
  c: DecisionCandidate,
  game: GameRef | undefined,
  category: MarketCategory,
  powerRatings: Map<string, any> | undefined
): MatchupResult {
  const neutral: MatchupResult = {
    matchupSignal: 'MATCHUP_NEUTRAL',
    matchupScore: 50,
    defensiveMatchupScore: 50,
    source: 'no_data',
  };

  if (!SCORING_CATEGORIES.has(category)) return neutral;
  if (!powerRatings || !game) return neutral;

  const ratings = powerRatings.get(game.eventId);
  if (!ratings) return neutral;

  // Opponent is the OTHER team's rating
  const opponentRating = game.isHome ? ratings.away : ratings.home;
  if (!opponentRating) return { ...neutral, source: 'power_ratings' };

  const defRating: number = opponentRating.defensiveRating ?? 0;
  if (defRating === 0) return { ...neutral, source: 'power_ratings' };

  if (defRating >= DEF_FAVORABLE) {
    // Opponent allows lots of points → prop player benefits
    return {
      matchupSignal: 'FAVORABLE_MATCHUP',
      matchupScore: 78,
      defensiveMatchupScore: 78,
      source: 'power_ratings',
    };
  }
  if (defRating <= DEF_TOUGH) {
    // Opponent is elite defensively → harder for prop player
    return {
      matchupSignal: 'TOUGH_MATCHUP',
      matchupScore: 25,
      defensiveMatchupScore: 25,
      source: 'power_ratings',
    };
  }
  return {
    matchupSignal: 'MATCHUP_NEUTRAL',
    matchupScore: 50,
    defensiveMatchupScore: 50,
    source: 'power_ratings',
  };
}

// ── ATS outcome signal — game-line candidates only ───────────
//
// Routing rules:
//   ATS_STRONG → outcomeSignals[] ONLY  (supporting context — never touches signals[])
//   ATS_WEAK   → outcomeSignals[] ONLY  (supporting context — never touches signals[])
//   ATS_NEUTRAL→ skipped entirely       (no information value in neutral label)
//
// ATS is deliberately excluded from signals[] so it cannot:
//   (a) flip a price-only candidate to multi-signal
//   (b) unlock the BET label on a candidate that has no true predictive signals
//
// signals[] is reserved for true independent predictive signals only.
// ATS is a supporting context signal — it adjusts edge in signalWeightingEngine
// and is visible in weightingReasons, but it never changes classification.
//
// Props are excluded: team cover % is not a player prop predictor.
// Gate: getATSOutcomeSignal enforces ≥ 20-game sample internally.

function applyATSSignal(
  c:   DecisionCandidate,
  ctx: OutcomeContext,
): DecisionCandidate {
  // Props excluded — team ATS is not a valid player prop signal.
  // marketType is typed as 'game_line' | 'player_prop', so includes('prop')
  // catches 'player_prop' explicitly and any future prop variants
  // (e.g. 'batter_prop', 'pitcher_prop') that may appear at runtime.
  if (c.marketType === 'player_prop' || c.marketType?.includes('prop')) return c;

  if (!c.team || !c.sportKey) return c;

  // Resolve home/away using gameSummaries; skip if unresolvable
  const game = findGame(c, ctx);
  if (!game) return c;

  const atsSig = getATSOutcomeSignal(c.team, c.sportKey, game.isHome);

  // Skip neutral — nothing actionable to record
  if (atsSig.signal === 'ATS_NEUTRAL') return c;

  // Write to outcomeSignals[] ONLY — signals[] is never touched
  const existingOutcome   = c.outcomeSignals ? [...c.outcomeSignals] : [];
  const newOutcomeSignals = [...new Set([...existingOutcome, atsSig.signal])];

  return { ...c, outcomeSignals: newOutcomeSignals };
}

// ── Core NBA prop enrichment ──────────────────────────────────

/**
 * Runs all Phase B + Phase C enrichment for a single NBA player prop.
 * Returns partial DecisionCandidate fields to spread onto the candidate.
 */
function enrichNBAProp(
  c: DecisionCandidate,
  ctx: OutcomeContext
): Partial<DecisionCandidate> {
  const line     = c.line ?? 0;
  const category = getMarketCategory(c.market);

  // Phase B proxy baselines
  const proxyRole  = getProxyRoleSignal(category, line);
  const usageSignal = getProxyUsageSignal(category, line);

  // Resolve game reference (needed for all context lookups)
  const game = findGame(c, ctx);

  // Phase C: upgrade each dimension with real data when available
  const roleMinutes = deriveRoleMinutes(c, game, ctx.lineupMap, proxyRole);
  const injury      = deriveInjuryOpportunity(c, game, ctx.injuryMap);
  const form        = deriveRecentForm(c, game, category, ctx.contextMap);
  const matchup     = deriveMatchup(c, game, category, ctx.powerRatings);

  // All outcome signals (stored for debug / downstream inspection)
  const outcomeSignals: string[] = [
    roleMinutes.roleSignal,
    roleMinutes.minutesSignal,
    usageSignal,
    injury.signal,
    form.signal,
    matchup.matchupSignal,
  ];

  // Positive signals only → merged into signals[] (affects signal diversity engine)
  // Negative / neutral signals stay in outcomeSignals[] only
  const positiveToMerge: string[] = [];
  if (roleMinutes.roleSignal  === 'ROLE_STABLE')            positiveToMerge.push('ROLE_STABLE');
  if (roleMinutes.minutesSignal === 'MINUTES_SECURE')       positiveToMerge.push('MINUTES_SECURE');
  if (injury.signal            === 'INJURY_OPPORTUNITY_UP') positiveToMerge.push('INJURY_OPPORTUNITY_UP');
  if (form.signal              === 'RECENT_FORM_GOOD')      positiveToMerge.push('RECENT_FORM_GOOD');
  if (matchup.matchupSignal    === 'FAVORABLE_MATCHUP')     positiveToMerge.push('FAVORABLE_MATCHUP');

  // Merge without duplicates (separate pipeline blocks can run multiple times)
  const existingSignals = c.signals ? [...c.signals] : [];
  const mergedSignals   = positiveToMerge.length > 0
    ? [...new Set([...existingSignals, ...positiveToMerge])]
    : existingSignals;

  return {
    signals:              mergedSignals,
    outcomeSignals,
    outcomeRoleScore:     outcomeRoleScoreFor(roleMinutes.roleSignal),
    usageTrendScore:      usageTrendScoreFor(usageSignal),
    matchupScore:         matchup.matchupScore,
    recentFormScore:      form.score,
    minutesConfidenceScore: roleMinutes.minutesConfidenceScore,
    injuryOpportunityScore: injury.score,
    defensiveMatchupScore:  matchup.defensiveMatchupScore,
  };
}

// ── Public API ────────────────────────────────────────────────

/**
 * Applies outcome signals to all candidates.
 *
 * NBA player props are enriched with Phase B proxy signals and,
 * when `context` is supplied, upgraded with Phase C real-data signals.
 *
 * All other candidates pass through unchanged.
 *
 * @param candidates  DecisionCandidates from the probability stage
 * @param context     Optional real-data context from the scan command.
 *                    Omitting this argument (or passing {}) is safe —
 *                    the engine degrades to Phase B proxy logic.
 */
export function applyOutcomeSignals(
  candidates: DecisionCandidate[],
  context?: OutcomeContext
): DecisionCandidate[] {
  const ctx = context ?? {};

  return candidates.map(c => {
    // ── Pass 1: ATS signal — runs for ALL candidate types ──────
    // Requires ≥ 20-game sample (enforced inside getATSOutcomeSignal).
    // Game line candidates benefit from ATS context; props also eligible
    // but ATS is primarily a team spread signal.
    const withATS = applyATSSignal(c, ctx);

    // ── Pass 2: NBA prop enrichment — props only ───────────────
    if (!isNBAProp(withATS)) return withATS;

    // No line — all signals neutral, all scores 50
    if (withATS.line === undefined || withATS.line === null) {
      return {
        ...withATS,
        outcomeSignals: [
          'ROLE_NEUTRAL', 'MINUTES_UNKNOWN', 'USAGE_STABLE',
          'INJURY_CONTEXT_NEUTRAL', 'RECENT_FORM_NEUTRAL', 'MATCHUP_NEUTRAL',
          // Preserve any ATS signal already placed by Pass 1
          ...(withATS.outcomeSignals?.filter(s => s.startsWith('ATS_')) ?? []),
        ],
        outcomeRoleScore:       50,
        usageTrendScore:        50,
        matchupScore:           50,
        recentFormScore:        50,
        minutesConfidenceScore: 50,
        injuryOpportunityScore: 50,
        defensiveMatchupScore:  50,
      };
    }

    return { ...withATS, ...enrichNBAProp(withATS, ctx) };
  });
}

// ── Debug summary printer ─────────────────────────────────────

/**
 * Prints a compact [OUTCOME] summary after this engine runs.
 * Suppressed when no NBA props were processed.
 */
export function printOutcomeSummary(candidates: DecisionCandidate[]): void {
  // ── ATS summary — all candidates ──────────────────────────
  const withOutcome = candidates.filter(c => c.outcomeSignals !== undefined);
  const atsStrong   = withOutcome.filter(c => c.outcomeSignals!.includes('ATS_STRONG')).length;
  const atsWeak     = withOutcome.filter(c => c.outcomeSignals!.includes('ATS_WEAK')).length;
  const atsTotal    = atsStrong + atsWeak;

  if (atsTotal > 0) {
    // Compute avg sample size for candidates that fired an ATS signal
    const atsFired = withOutcome.filter(
      c => c.outcomeSignals!.includes('ATS_STRONG') || c.outcomeSignals!.includes('ATS_WEAK')
    );
    // sampleSize isn't stored on the candidate — report count only
    console.log(
      `  [ATS] signals triggered: ${atsTotal}` +
      ` | ATS_STRONG: ${atsStrong} | ATS_WEAK: ${atsWeak}` +
      ` | impact applied: via signalWeightingEngine (max ±2.0% edge per candidate)`
    );
  }

  // ── NBA prop outcome summary ───────────────────────────────
  const nbaProps = candidates.filter(
    c => isNBAProp(c) && c.outcomeSignals !== undefined
  );
  if (nbaProps.length === 0) return;

  const count = (sig: string): number =>
    nbaProps.filter(c => c.outcomeSignals!.includes(sig)).length;

  const roleStable    = count('ROLE_STABLE');
  const roleUnstable  = count('ROLE_UNSTABLE');
  const minsSecure    = count('MINUTES_SECURE');
  const minsRisk      = count('MINUTES_RISK');
  const injUp         = count('INJURY_OPPORTUNITY_UP');
  const injDown       = count('INJURY_OPPORTUNITY_DOWN');
  const formGood      = count('RECENT_FORM_GOOD');
  const formBad       = count('RECENT_FORM_BAD');
  const favMatchup    = count('FAVORABLE_MATCHUP');
  const toughMatchup  = count('TOUGH_MATCHUP');

  console.log(
    `  [OUTCOME] role_stable: ${roleStable} | role_unstable: ${roleUnstable}` +
    ` | minutes_secure: ${minsSecure} | minutes_risk: ${minsRisk}` +
    ` | injury_opp_up: ${injUp} | injury_opp_down: ${injDown}` +
    ` | form_good: ${formGood} | form_bad: ${formBad}` +
    ` | favorable_matchup: ${favMatchup} | tough_matchup: ${toughMatchup}`
  );

  // Show up to 3 most-notable candidates (those with at least one positive signal)
  const NOISE_SIGNALS = new Set([
    'RECENT_FORM_NEUTRAL', 'MATCHUP_NEUTRAL', 'INJURY_CONTEXT_NEUTRAL',
    'MINUTES_UNKNOWN', 'USAGE_STABLE', 'ROLE_NEUTRAL',
  ]);
  const notable = nbaProps
    .filter(c =>
      c.outcomeSignals!.some(s => !NOISE_SIGNALS.has(s))
    )
    .slice(0, 3);

  for (const c of notable) {
    const mkt      = c.market?.replace('player_', '') ?? '?';
    const sigList  = c.outcomeSignals!.filter(s => !NOISE_SIGNALS.has(s)).join(', ');
    const scores   =
      `role:${c.outcomeRoleScore ?? '?'}` +
      ` usage:${c.usageTrendScore ?? '?'}` +
      ` matchup:${c.matchupScore ?? '?'}` +
      ` form:${c.recentFormScore ?? '?'}` +
      ` mins:${c.minutesConfidenceScore ?? '?'}` +
      ` inj:${c.injuryOpportunityScore ?? '?'}`;
    console.log(
      `    → ${c.playerName ?? c.id} (${mkt} ${c.line})  ${scores}` +
      (sigList ? `  [${sigList}]` : '')
    );
  }
}
