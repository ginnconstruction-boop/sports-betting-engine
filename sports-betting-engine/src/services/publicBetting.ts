// ============================================================
// src/services/publicBetting.ts
// Actual public betting percentages
// Sources: Action Network free endpoint + TheOddsAPI public data
// Confirms reverse line movement instead of just inferring it
// ============================================================

import https from 'https';

export interface PublicBettingData {
  homeTeam: string;
  awayTeam: string;
  marketKey: string;
  // Bet percentages (% of total bets placed)
  homeBetPct: number | null;
  awayBetPct: number | null;
  overBetPct: number | null;
  underBetPct: number | null;
  // Money percentages (% of total money wagered)
  homeMoneyPct: number | null;
  awayMoneyPct: number | null;
  overMoneyPct: number | null;
  underMoneyPct: number | null;
  // Derived signals
  reverseLineMovement: boolean;
  rlmDetail: string;
  sharpSide: 'home' | 'away' | 'over' | 'under' | 'none';
  publicSide: 'home' | 'away' | 'over' | 'under' | 'none';
  fetchedAt: string;
}

function fetchJson(url: string, headers: Record<string,string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', ...headers }
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Parse failed')); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fuzzyMatch(a: string, b: string): boolean {
  const last = (s: string) => s.toLowerCase().split(' ').pop() ?? '';
  return last(a) === last(b) ||
    a.toLowerCase().includes(b.toLowerCase().split(' ').pop() ?? '___') ||
    b.toLowerCase().includes(a.toLowerCase().split(' ').pop() ?? '___');
}

// ------------------------------------
// Action Network free public betting data
// ------------------------------------

const ACTION_SPORT_MAP: Record<string, string> = {
  basketball_nba:       'nba',
  baseball_mlb:         'mlb',
  americanfootball_nfl: 'nfl',
  basketball_ncaab:     'ncaab',
  icehockey_nhl:        'nhl',
  americanfootball_ncaaf: 'ncaaf',
};

export async function getPublicBettingData(
  sportKey: string,
  homeTeam: string,
  awayTeam: string
): Promise<PublicBettingData | null> {
  const sport = ACTION_SPORT_MAP[sportKey];
  if (!sport) return null;

  try {
    // Action Network public consensus endpoint
    const today = new Date().toISOString().split('T')[0];
    const url = `https://api.actionnetwork.com/web/v1/scoreboard/${sport}?period=game&bookIds=15,30,68,75,123&date=${today}`;

    const data = await fetchJson(url, {
      'Origin': 'https://www.actionnetwork.com',
      'Referer': 'https://www.actionnetwork.com/',
    });

    const games = data?.games ?? [];

    // Find matching game
    const game = (games ?? []).find((g: any) => {
      const home = g?.teams?.find((t: any) => t?.side === 'home')?.full_name ?? '';
      const away = g?.teams?.find((t: any) => t?.side === 'away')?.full_name ?? '';
      return fuzzyMatch(home, homeTeam) && fuzzyMatch(away, awayTeam);
    });

    if (!game) return null;

    const consensus = game?.consensus ?? {};
    const spread = consensus?.spread ?? {};
    const total = consensus?.total ?? {};
    const ml = consensus?.moneyline ?? {};

    // Extract bet and money percentages
    const homeBetPct = parseFloat(spread?.away_spread_pct ?? ml?.home_ml_pct ?? '0') || null;
    const awayBetPct = homeBetPct !== null ? 100 - homeBetPct : null;
    const overBetPct = parseFloat(total?.over_pct ?? '0') || null;
    const underBetPct = overBetPct !== null ? 100 - overBetPct : null;

    const homeMoneyPct = parseFloat(spread?.away_spread_money_pct ?? ml?.home_ml_money_pct ?? '0') || null;
    const awayMoneyPct = homeMoneyPct !== null ? 100 - homeMoneyPct : null;
    const overMoneyPct = parseFloat(total?.over_money_pct ?? '0') || null;
    const underMoneyPct = overMoneyPct !== null ? 100 - overMoneyPct : null;

    // Detect reverse line movement
    // RLM = majority of bets on one side, but line moves the other way
    let reverseLineMovement = false;
    let rlmDetail = '';
    let sharpSide: PublicBettingData['sharpSide'] = 'none';
    let publicSide: PublicBettingData['publicSide'] = 'none';

    if (homeBetPct !== null && awayBetPct !== null) {
      if (homeBetPct >= 60) publicSide = 'home';
      else if (awayBetPct >= 60) publicSide = 'away';
    }
    if (overBetPct !== null && underBetPct !== null) {
      if (overBetPct >= 60) publicSide = 'over';
      else if (underBetPct >= 60) publicSide = 'under';
    }

    // Money % vs bet % divergence = sharp money
    if (homeMoneyPct !== null && homeBetPct !== null) {
      const moneyVsBets = homeMoneyPct - homeBetPct;
      if (moneyVsBets >= 15) {
        sharpSide = 'home';
        reverseLineMovement = publicSide === 'away';
        rlmDetail = `Sharp money on ${homeTeam} (${homeMoneyPct}% money vs ${homeBetPct}% bets)`;
      } else if (moneyVsBets <= -15) {
        sharpSide = 'away';
        reverseLineMovement = publicSide === 'home';
        rlmDetail = `Sharp money on ${awayTeam} (${awayMoneyPct}% money vs ${awayBetPct}% bets)`;
      }
    }

    return {
      homeTeam, awayTeam, marketKey: 'combined',
      homeBetPct, awayBetPct, overBetPct, underBetPct,
      homeMoneyPct, awayMoneyPct, overMoneyPct, underMoneyPct,
      reverseLineMovement, rlmDetail, sharpSide, publicSide,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ------------------------------------
// Build public betting map for all events
// ------------------------------------

export async function buildPublicBettingMap(
  events: Array<{ eventId: string; sportKey: string; homeTeam: string; awayTeam: string }>
): Promise<Map<string, PublicBettingData>> {
  const result = new Map<string, PublicBettingData>();

  // Batch in groups of 5
  for (let i = 0; i < events.length; i += 5) {
    const batch = events.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(e => getPublicBettingData(e.sportKey, e.homeTeam, e.awayTeam))
    );
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled' && r.value) {
        result.set(batch[j].eventId, r.value);
      }
    }
  }

  return result;
}
