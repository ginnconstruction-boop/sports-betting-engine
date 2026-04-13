// ============================================================
// src/services/pinnacleComparison.ts
// Compares current lines to Pinnacle (sharpest book in world)
// Pinnacle is the market-maker -- gap vs Pinnacle = real edge
// Free API -- no key needed for public data
// ============================================================

import https from 'https';

export interface PinnacleLineData {
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  homeSpread: number | null;
  homeSpreadPrice: number | null;
  awaySpreadPrice: number | null;
  total: number | null;
  overPrice: number | null;
  underPrice: number | null;
  fetchedAt: string;
}

export interface PinnacleComparison {
  hasPinnacleData: boolean;
  pinnacle: PinnacleLineData | null;
  gaps: {
    moneylineGap: number | null;      // our book vs pinnacle ML
    spreadGap: number | null;         // our spread line vs pinnacle spread
    totalGap: number | null;          // our total vs pinnacle total
    overPriceGap: number | null;      // over juice gap
  };
  verdict: string;
  isBeatPinnacle: boolean;            // true if our book is better than Pinnacle
  pinnacleEdgeDetail: string;
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      }
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Parse failed')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Pinnacle uses their own sport IDs -- mapping
const PINNACLE_SPORT_IDS: Record<string, number> = {
  basketball_nba:          4,
  baseball_mlb:            3,
  americanfootball_nfl:    2,
  americanfootball_ncaaf:  6,
  basketball_ncaab:        5,
  icehockey_nhl:           7,
};

function fuzzyMatch(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const na = normalize(a), nb = normalize(b);
  const lastA = a.toLowerCase().split(' ').pop() ?? '';
  const lastB = b.toLowerCase().split(' ').pop() ?? '';
  return na.includes(nb) || nb.includes(na) || lastA === lastB;
}

// Try The Odds API Pinnacle data first (most reliable)
export async function getPinnacleData(
  sportKey: string,
  homeTeam: string,
  awayTeam: string,
  apiKey: string
): Promise<PinnacleLineData | null> {
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=pinnacle`;
    const data = await fetchJson(url);

    if (!Array.isArray(data)) return null;

    const event = data.find((e: any) => {
      return fuzzyMatch(e.home_team ?? '', homeTeam) &&
             fuzzyMatch(e.away_team ?? '', awayTeam);
    });

    if (!event) return null;

    const pinnacleBook = (event.bookmakers ?? []).find((b: any) => b.key === 'pinnacle');
    if (!pinnacleBook) return null;

    const h2h = pinnacleBook.markets?.find((m: any) => m.key === 'h2h');
    const spreads = pinnacleBook.markets?.find((m: any) => m.key === 'spreads');
    const totals = pinnacleBook.markets?.find((m: any) => m.key === 'totals');

    const homeML = h2h?.outcomes?.find((o: any) => fuzzyMatch(o.name, homeTeam));
    const awayML = h2h?.outcomes?.find((o: any) => fuzzyMatch(o.name, awayTeam));
    const homeSpreadOutcome = spreads?.outcomes?.find((o: any) => fuzzyMatch(o.name, homeTeam));
    const awaySpreadOutcome = spreads?.outcomes?.find((o: any) => fuzzyMatch(o.name, awayTeam));
    const over = totals?.outcomes?.find((o: any) => o.name === 'Over');
    const under = totals?.outcomes?.find((o: any) => o.name === 'Under');

    return {
      homeMoneyline: homeML?.price ?? null,
      awayMoneyline: awayML?.price ?? null,
      homeSpread: homeSpreadOutcome?.point ?? null,
      homeSpreadPrice: homeSpreadOutcome?.price ?? null,
      awaySpreadPrice: awaySpreadOutcome?.price ?? null,
      total: over?.point ?? null,
      overPrice: over?.price ?? null,
      underPrice: under?.price ?? null,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ------------------------------------
// Compare our book's lines to Pinnacle
// ------------------------------------

export function compareToPinnacle(
  pinnacle: PinnacleLineData | null,
  ourMoneyline: number | null,
  ourSpread: number | null,
  ourTotal: number | null,
  ourOverPrice: number | null,
  side: 'home' | 'away' | 'over' | 'under'
): PinnacleComparison {
  if (!pinnacle) {
    return {
      hasPinnacleData: false,
      pinnacle: null,
      gaps: { moneylineGap: null, spreadGap: null, totalGap: null, overPriceGap: null },
      verdict: 'Pinnacle data not available',
      isBeatPinnacle: false,
      pinnacleEdgeDetail: '',
    };
  }

  const gaps = {
    moneylineGap: null as number | null,
    spreadGap: null as number | null,
    totalGap: null as number | null,
    overPriceGap: null as number | null,
  };

  let isBeatPinnacle = false;
  const details: string[] = [];

  // Moneyline comparison
  if (ourMoneyline !== null) {
    const pinnML = side === 'home' ? pinnacle.homeMoneyline : pinnacle.awayMoneyline;
    if (pinnML !== null) {
      gaps.moneylineGap = ourMoneyline - pinnML;
      if (gaps.moneylineGap > 5) {
        isBeatPinnacle = true;
        details.push(`ML: our book ${ourMoneyline > 0 ? '+' : ''}${ourMoneyline} vs Pinnacle ${pinnML > 0 ? '+' : ''}${pinnML} (+${gaps.moneylineGap})`);
      }
    }
  }

  // Spread comparison
  if (ourSpread !== null && pinnacle.homeSpread !== null) {
    const pinnSpread = side === 'home' ? pinnacle.homeSpread : -(pinnacle.homeSpread ?? 0);
    gaps.spreadGap = ourSpread - pinnSpread;
    if (Math.abs(gaps.spreadGap) >= 0.5) {
      const favorable = (side === 'home' && gaps.spreadGap > 0) || (side === 'away' && gaps.spreadGap < 0);
      if (favorable) {
        isBeatPinnacle = true;
        details.push(`Spread: our book ${ourSpread > 0 ? '+' : ''}${ourSpread} vs Pinnacle ${pinnSpread > 0 ? '+' : ''}${pinnSpread}`);
      }
    }
  }

  // Total comparison
  if (ourTotal !== null && pinnacle.total !== null) {
    gaps.totalGap = ourTotal - pinnacle.total;
    if (Math.abs(gaps.totalGap) >= 0.5) {
      const favorable = (side === 'over' && gaps.totalGap < 0) || (side === 'under' && gaps.totalGap > 0);
      if (favorable) {
        isBeatPinnacle = true;
        details.push(`Total: our book ${ourTotal} vs Pinnacle ${pinnacle.total} -- better number for ${side}`);
      }
    }
  }

  // Over price comparison
  if (ourOverPrice !== null && pinnacle.overPrice !== null) {
    gaps.overPriceGap = ourOverPrice - pinnacle.overPrice;
    if (gaps.overPriceGap > 5) {
      isBeatPinnacle = true;
      details.push(`Over juice: our book ${ourOverPrice > 0 ? '+' : ''}${ourOverPrice} vs Pinnacle ${pinnacle.overPrice > 0 ? '+' : ''}${pinnacle.overPrice}`);
    }
  }

  const verdict = isBeatPinnacle
    ? `[OK] Our book BEATS Pinnacle -- highest quality edge signal`
    : `Market efficient vs Pinnacle -- standard value`;

  return {
    hasPinnacleData: true,
    pinnacle,
    gaps,
    verdict,
    isBeatPinnacle,
    pinnacleEdgeDetail: details.join(' | '),
  };
}
