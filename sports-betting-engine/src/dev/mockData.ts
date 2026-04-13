// ============================================================
// src/dev/mockData.ts
// Realistic mock odds data -- zero API calls, zero credits
// Simulates a real morning scan output for MLB/NBA/NHL/NCAAB
// ============================================================

import { RawEvent } from '../types/odds';

const now = new Date();
function gameTime(hoursFromNow: number): string {
  return new Date(now.getTime() + hoursFromNow * 3600000).toISOString();
}

export const MOCK_EVENTS: RawEvent[] = [

  // -----------------------------------------
  // MLB
  // -----------------------------------------
  {
    id: 'mlb_001',
    sport_key: 'baseball_mlb',
    sport_title: 'MLB',
    commence_time: gameTime(4),
    home_team: 'New York Yankees',
    away_team: 'Boston Red Sox',
    bookmakers: [
      {
        key: 'draftkings',
        title: 'DraftKings',
        last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'New York Yankees', price: -145 },
            { name: 'Boston Red Sox', price: +125 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'New York Yankees', price: -110, point: -1.5 },
            { name: 'Boston Red Sox', price: -110, point: +1.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -115, point: 8.5 },
            { name: 'Under', price: -105, point: 8.5 },
          ]},
        ],
      },
      {
        key: 'fanduel',
        title: 'FanDuel',
        last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'New York Yankees', price: -148 },
            { name: 'Boston Red Sox', price: +128 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'New York Yankees', price: -112, point: -1.5 },
            { name: 'Boston Red Sox', price: -108, point: +1.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -118, point: 8.5 },
            { name: 'Under', price: -102, point: 8.5 },
          ]},
        ],
      },
      {
        key: 'betmgm',
        title: 'BetMGM',
        last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'New York Yankees', price: -142 },
            { name: 'Boston Red Sox', price: +120 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'New York Yankees', price: -108, point: -1.5 },
            { name: 'Boston Red Sox', price: -112, point: +1.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -110, point: 9.0 },  // BetMGM has different total
            { name: 'Under', price: -110, point: 9.0 },
          ]},
        ],
      },
      {
        key: 'caesars',
        title: 'Caesars',
        last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'New York Yankees', price: -150 },
            { name: 'Boston Red Sox', price: +130 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'New York Yankees', price: -110, point: -1.5 },
            { name: 'Boston Red Sox', price: -110, point: +1.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -112, point: 8.5 },
            { name: 'Under', price: -108, point: 8.5 },
          ]},
        ],
      },
      {
        key: 'espnbet',
        title: 'ESPN BET',
        last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'New York Yankees', price: -144 },
            { name: 'Boston Red Sox', price: +122 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'New York Yankees', price: -109, point: -1.5 },
            { name: 'Boston Red Sox', price: -111, point: +1.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -114, point: 8.5 },
            { name: 'Under', price: -106, point: 8.5 },
          ]},
        ],
      },
    ],
  },

  {
    id: 'mlb_002',
    sport_key: 'baseball_mlb',
    sport_title: 'MLB',
    commence_time: gameTime(5),
    home_team: 'Los Angeles Dodgers',
    away_team: 'San Francisco Giants',
    bookmakers: [
      {
        key: 'draftkings', title: 'DraftKings', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Los Angeles Dodgers', price: -175 },
            { name: 'San Francisco Giants', price: +150 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Los Angeles Dodgers', price: -110, point: -1.5 },
            { name: 'San Francisco Giants', price: -110, point: +1.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -110, point: 7.5 },
            { name: 'Under', price: -110, point: 7.5 },
          ]},
        ],
      },
      {
        key: 'fanduel', title: 'FanDuel', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Los Angeles Dodgers', price: -180 },
            { name: 'San Francisco Giants', price: +155 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Los Angeles Dodgers', price: -115, point: -1.5 },
            { name: 'San Francisco Giants', price: -105, point: +1.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -108, point: 7.5 },
            { name: 'Under', price: -112, point: 7.5 },
          ]},
        ],
      },
      {
        key: 'espnbet', title: 'ESPN BET', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Los Angeles Dodgers', price: -172 },
            { name: 'San Francisco Giants', price: +148 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Los Angeles Dodgers', price: -110, point: -1.5 },
            { name: 'San Francisco Giants', price: -110, point: +1.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -112, point: 7.5 },
            { name: 'Under', price: -108, point: 7.5 },
          ]},
        ],
      },
    ],
  },

  // -----------------------------------------
  // NBA
  // -----------------------------------------
  {
    id: 'nba_001',
    sport_key: 'basketball_nba',
    sport_title: 'NBA',
    commence_time: gameTime(6),
    home_team: 'Golden State Warriors',
    away_team: 'Denver Nuggets',
    bookmakers: [
      {
        key: 'draftkings', title: 'DraftKings', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Golden State Warriors', price: +138 },
            { name: 'Denver Nuggets', price: -162 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Golden State Warriors', price: -110, point: +4.5 },
            { name: 'Denver Nuggets', price: -110, point: -4.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -110, point: 224.5 },
            { name: 'Under', price: -110, point: 224.5 },
          ]},
        ],
      },
      {
        key: 'fanduel', title: 'FanDuel', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Golden State Warriors', price: +142 },
            { name: 'Denver Nuggets', price: -168 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Golden State Warriors', price: -108, point: +4.5 },
            { name: 'Denver Nuggets', price: -112, point: -4.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -112, point: 224.5 },
            { name: 'Under', price: -108, point: 224.5 },
          ]},
        ],
      },
      {
        key: 'betmgm', title: 'BetMGM', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Golden State Warriors', price: +135 },
            { name: 'Denver Nuggets', price: -160 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Golden State Warriors', price: -110, point: +5.0 }, // BetMGM half-point different
            { name: 'Denver Nuggets', price: -110, point: -5.0 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -110, point: 225.0 },
            { name: 'Under', price: -110, point: 225.0 },
          ]},
        ],
      },
      {
        key: 'caesars', title: 'Caesars', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Golden State Warriors', price: +140 },
            { name: 'Denver Nuggets', price: -165 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Golden State Warriors', price: -110, point: +4.5 },
            { name: 'Denver Nuggets', price: -110, point: -4.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -115, point: 224.5 },
            { name: 'Under', price: -105, point: 224.5 },
          ]},
        ],
      },
      {
        key: 'espnbet', title: 'ESPN BET', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Golden State Warriors', price: +145 },  // Best dog price
            { name: 'Denver Nuggets', price: -170 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Golden State Warriors', price: -105, point: +4.5 }, // Best spread price
            { name: 'Denver Nuggets', price: -115, point: -4.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -110, point: 224.5 },
            { name: 'Under', price: -110, point: 224.5 },
          ]},
        ],
      },
    ],
  },

  // -----------------------------------------
  // NHL
  // -----------------------------------------
  {
    id: 'nhl_001',
    sport_key: 'icehockey_nhl',
    sport_title: 'NHL',
    commence_time: gameTime(5),
    home_team: 'Tampa Bay Lightning',
    away_team: 'Florida Panthers',
    bookmakers: [
      {
        key: 'draftkings', title: 'DraftKings', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Tampa Bay Lightning', price: +115 },
            { name: 'Florida Panthers', price: -135 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Tampa Bay Lightning', price: -110, point: +1.5 },
            { name: 'Florida Panthers', price: -110, point: -1.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -115, point: 6.0 },
            { name: 'Under', price: -105, point: 6.0 },
          ]},
        ],
      },
      {
        key: 'fanduel', title: 'FanDuel', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Tampa Bay Lightning', price: +118 },
            { name: 'Florida Panthers', price: -140 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Tampa Bay Lightning', price: -112, point: +1.5 },
            { name: 'Florida Panthers', price: -108, point: -1.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -110, point: 6.0 },
            { name: 'Under', price: -110, point: 6.0 },
          ]},
        ],
      },
      {
        key: 'caesars', title: 'Caesars', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Tampa Bay Lightning', price: +112 },
            { name: 'Florida Panthers', price: -132 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Tampa Bay Lightning', price: -110, point: +1.5 },
            { name: 'Florida Panthers', price: -110, point: -1.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -112, point: 6.0 },
            { name: 'Under', price: -108, point: 6.0 },
          ]},
        ],
      },
    ],
  },

  // -----------------------------------------
  // NCAAB
  // -----------------------------------------
  {
    id: 'ncaab_001',
    sport_key: 'basketball_ncaab',
    sport_title: 'NCAAB',
    commence_time: gameTime(3),
    home_team: 'Duke Blue Devils',
    away_team: 'North Carolina Tar Heels',
    bookmakers: [
      {
        key: 'draftkings', title: 'DraftKings', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Duke Blue Devils', price: -190 },
            { name: 'North Carolina Tar Heels', price: +162 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Duke Blue Devils', price: -110, point: -5.5 },
            { name: 'North Carolina Tar Heels', price: -110, point: +5.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -110, point: 152.5 },
            { name: 'Under', price: -110, point: 152.5 },
          ]},
        ],
      },
      {
        key: 'fanduel', title: 'FanDuel', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Duke Blue Devils', price: -195 },
            { name: 'North Carolina Tar Heels', price: +165 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Duke Blue Devils', price: -112, point: -5.5 },
            { name: 'North Carolina Tar Heels', price: -108, point: +5.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -108, point: 153.0 },
            { name: 'Under', price: -112, point: 153.0 },
          ]},
        ],
      },
      {
        key: 'betmgm', title: 'BetMGM', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Duke Blue Devils', price: -185 },
            { name: 'North Carolina Tar Heels', price: +158 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Duke Blue Devils', price: -108, point: -5.5 },
            { name: 'North Carolina Tar Heels', price: -112, point: +5.5 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -110, point: 152.5 },
            { name: 'Under', price: -110, point: 152.5 },
          ]},
        ],
      },
      {
        key: 'espnbet', title: 'ESPN BET', last_update: new Date().toISOString(),
        markets: [
          { key: 'h2h', last_update: new Date().toISOString(), outcomes: [
            { name: 'Duke Blue Devils', price: -188 },
            { name: 'North Carolina Tar Heels', price: +160 },
          ]},
          { key: 'spreads', last_update: new Date().toISOString(), outcomes: [
            { name: 'Duke Blue Devils', price: -110, point: -6.0 }, // ESPN has different line
            { name: 'North Carolina Tar Heels', price: -110, point: +6.0 },
          ]},
          { key: 'totals', last_update: new Date().toISOString(), outcomes: [
            { name: 'Over', price: -115, point: 152.5 },
            { name: 'Under', price: -105, point: 152.5 },
          ]},
        ],
      },
    ],
  },
];
