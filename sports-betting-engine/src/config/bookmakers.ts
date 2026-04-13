// ============================================================
// src/config/bookmakers.ts
// Bookmaker mapping layer
//
// IMPORTANT: Two separate concepts here:
//   BETTABLE_BOOKS  -- books the user can actually place bets at
//   ANALYSIS_BOOKS  -- all books used for pricing intelligence
//
// Recommendations always point to BETTABLE_BOOKS only.
// All books feed the consensus/sharp analysis.
// ============================================================

export interface BookmakerConfig {
  key: string;
  displayName: string;
  priority: number;
  enabled: boolean;
  region: 'us' | 'us2' | 'uk' | 'eu' | 'au';
  tennesseeAvailable: boolean;
  userHasAccess: boolean;   // <- the user can actually bet here
}

export const BOOKMAKERS: BookmakerConfig[] = [
  // -- USER'S BOOKS (recommendations point here only) ------
  {
    key: 'fanduel',
    displayName: 'FanDuel',
    priority: 1,
    enabled: true,
    region: 'us',
    tennesseeAvailable: true,
    userHasAccess: true,
  },
  {
    key: 'betmgm',
    displayName: 'BetMGM',
    priority: 2,
    enabled: true,
    region: 'us',
    tennesseeAvailable: true,
    userHasAccess: true,
  },

  // -- ANALYSIS ONLY (used for consensus/sharp intel, never recommended) --
  {
    key: 'draftkings',
    displayName: 'DraftKings',
    priority: 3,
    enabled: true,
    region: 'us',
    tennesseeAvailable: true,
    userHasAccess: false,
  },
  {
    key: 'caesars',
    displayName: 'Caesars',
    priority: 4,
    enabled: true,
    region: 'us',
    tennesseeAvailable: true,
    userHasAccess: false,
  },
  {
    key: 'espnbet',
    displayName: 'ESPN BET',
    priority: 5,
    enabled: true,
    region: 'us',
    tennesseeAvailable: true,
    userHasAccess: false,
  },
  {
    key: 'williamhill_us',
    displayName: 'Caesars (WH)',
    priority: 6,
    enabled: true,
    region: 'us',
    tennesseeAvailable: true,
    userHasAccess: false,
  },
  {
    key: 'bovada',
    displayName: 'Bovada',
    priority: 7,
    enabled: true,
    region: 'us',
    tennesseeAvailable: false,
    userHasAccess: false,
  },
  {
    key: 'betonlineag',
    displayName: 'BetOnline',
    priority: 8,
    enabled: true,
    region: 'us',
    tennesseeAvailable: false,
    userHasAccess: false,
  },
  {
    key: 'fanatics',
    displayName: 'Fanatics',
    priority: 9,
    enabled: true,
    region: 'us',
    tennesseeAvailable: false,
    userHasAccess: false,
  },
  {
    key: 'pointsbetus',
    displayName: 'PointsBet',
    priority: 10,
    enabled: true,
    region: 'us',
    tennesseeAvailable: false,
    userHasAccess: false,
  },
  {
    key: 'betrivers',
    displayName: 'BetRivers',
    priority: 11,
    enabled: true,
    region: 'us',
    tennesseeAvailable: false,
    userHasAccess: false,
  },
  {
    key: 'mybookieag',
    displayName: 'MyBookie',
    priority: 12,
    enabled: true,
    region: 'us',
    tennesseeAvailable: false,
    userHasAccess: false,
  },
  {
    key: 'superbook',
    displayName: 'SuperBook',
    priority: 13,
    enabled: true,
    region: 'us',
    tennesseeAvailable: false,
    userHasAccess: false,
  },
  {
    key: 'lowvig',
    displayName: 'LowVig',
    priority: 14,
    enabled: true,
    region: 'us',
    tennesseeAvailable: false,
    userHasAccess: false,
  },
  {
    key: 'unibet_us',
    displayName: 'Unibet',
    priority: 15,
    enabled: true,
    region: 'us',
    tennesseeAvailable: false,
    userHasAccess: false,
  },
];

// Lookup map
const BOOKMAKER_MAP = new Map<string, BookmakerConfig>(
  BOOKMAKERS.map((b) => [b.key, b])
);

export function getBookmaker(key: string): BookmakerConfig | undefined {
  return BOOKMAKER_MAP.get(key);
}

export function getBookmakerDisplayName(key: string): string {
  return BOOKMAKER_MAP.get(key)?.displayName ?? key;
}

/** Books the user can actually place bets at */
export function getUserBooks(): BookmakerConfig[] {
  return BOOKMAKERS.filter((b) => b.enabled && b.userHasAccess);
}

export function getUserBookKeys(): string[] {
  return getUserBooks().map((b) => b.key);
}

/** All enabled books -- used for analysis/consensus */
export function getAllEnabledBooks(): BookmakerConfig[] {
  return BOOKMAKERS.filter((b) => b.enabled);
}

export function getTennesseeBooks(): BookmakerConfig[] {
  return BOOKMAKERS.filter((b) => b.enabled && b.tennesseeAvailable);
}

export function getEnabledBookmakerKeys(): string {
  return BOOKMAKERS.filter((b) => b.enabled).map((b) => b.key).join(',');
}

export function sortByPriority(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const pa = BOOKMAKER_MAP.get(a)?.priority ?? 999;
    const pb = BOOKMAKER_MAP.get(b)?.priority ?? 999;
    return pa - pb;
  });
}
