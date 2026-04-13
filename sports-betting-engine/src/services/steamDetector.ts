// ============================================================
// src/services/steamDetector.ts
// Steam move detection across time
// Detects coordinated sharp money via rapid multi-book movement
// Works with snapshot history -- no extra API calls
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { Snapshot, EventSummary, MarketKey } from '../types/odds';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';

export interface SteamMove {
  eventId: string;
  matchup: string;
  marketKey: MarketKey;
  outcomeName: string;
  // Movement data
  previousLine: number | null;
  currentLine: number | null;
  lineDelta: number;
  previousPrice: number | null;
  currentPrice: number | null;
  priceDelta: number;
  // Steam indicators
  booksMovedCount: number;       // how many books moved same direction
  movementSpeed: string;         // 'fast' | 'moderate' | 'slow'
  isSteam: boolean;
  steamConfidence: 'high' | 'medium' | 'low';
  // Direction
  direction: 'home' | 'away' | 'over' | 'under';
  detail: string;
  detectedAt: string;
}

// ------------------------------------
// Load recent snapshots for comparison
// ------------------------------------

function loadRecentSnapshots(maxSnapshots = 5): Snapshot[] {
  try {
    const files = fs.readdirSync(SNAPSHOT_DIR)
      .filter(f => f.endsWith('.json') && f !== 'run_log.json'
        && f !== 'picks_log.json' && f !== 'clv_record.json'
        && f !== 'pnl_record.json')
      .sort()
      .reverse()
      .slice(0, maxSnapshots);

    return files.map(f => {
      try {
        const raw = fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf-8');
        return JSON.parse(raw) as Snapshot;
      } catch { return null; }
    }).filter((s): s is Snapshot => s !== null);
  } catch { return []; }
}

// ------------------------------------
// Detect steam across recent snapshots
// ------------------------------------

export function detectSteamMoves(
  currentSummaries: EventSummary[]
): SteamMove[] {
  const recentSnapshots = loadRecentSnapshots(6);
  if (recentSnapshots.length < 2) return [];

  const steamMoves: SteamMove[] = [];
  const detectedAt = new Date().toISOString();

  for (const current of currentSummaries) {
    // Find this event across all recent snapshots
    const eventHistory = recentSnapshots
      .map(s => (s.eventSummaries ?? []).find(e => e.eventId === current.eventId))
      .filter((e): e is EventSummary => e !== undefined);

    if (eventHistory.length < 2) continue;

    for (const [mKey, currentMarket] of Object.entries(current.aggregatedMarkets)) {
      const marketKey = mKey as MarketKey;

      for (const currentSide of currentMarket.sides) {
        // Get line history for this side across snapshots
        const lineHistory = eventHistory.map(snap => {
          const market = snap.aggregatedMarkets[marketKey];
          const side = market?.sides.find(s => s.outcomeName === currentSide.outcomeName);
          return {
            line: side?.consensusLine ?? null,
            price: side?.consensusPrice ?? null,
            timestamp: snap.fetchedAt,
          };
        }).filter(h => h.line !== null || h.price !== null);

        if (lineHistory.length < 2) continue;

        const oldest = lineHistory[lineHistory.length - 1];
        const newest = { line: currentSide.consensusLine, price: currentSide.consensusPrice };

        const lineDelta = newest.line !== null && oldest.line !== null
          ? Math.abs(newest.line - oldest.line) : 0;
        const priceDelta = newest.price !== null && oldest.price !== null
          ? Math.abs(newest.price - oldest.price) : 0;

        // Steam criteria: significant movement across multiple data points
        const isSignificantMove = lineDelta >= 1.0 || priceDelta >= 10;
        if (!isSignificantMove) continue;

        // Check how many books moved same direction
        let booksMovedCount = 0;
        const lineDirection = newest.line !== null && oldest.line !== null
          ? (newest.line - oldest.line > 0 ? 1 : -1) : 0;

        for (const offer of (currentSide.offers ?? [])) {
          // Count offers that moved in same direction
          const prevSnapshot = eventHistory[0];
          const prevMarket = prevSnapshot?.aggregatedMarkets[marketKey];
          const prevSide = prevMarket?.sides.find(s => s.outcomeName === currentSide.outcomeName);
          const prevOffer = (prevSide?.offers ?? []).find(o => o.bookmakerKey === offer.bookmakerKey);

          if (prevOffer?.line !== null && offer.line !== null && prevOffer?.line !== undefined) {
            const bookDir = offer.line - prevOffer.line > 0 ? 1 : offer.line - prevOffer.line < 0 ? -1 : 0;
            if (bookDir === lineDirection) booksMovedCount++;
          }
        }

        // Steam = 3+ books moving same direction + significant movement
        const isSteam = booksMovedCount >= 3 && lineDelta >= 0.5;
        const steamConfidence: SteamMove['steamConfidence'] =
          booksMovedCount >= 5 && lineDelta >= 1.5 ? 'high'
          : booksMovedCount >= 3 && lineDelta >= 1.0 ? 'medium'
          : 'low';

        // Determine direction
        let direction: SteamMove['direction'] = 'home';
        const sideName = currentSide.outcomeName.toLowerCase();
        if (sideName === 'over') direction = 'over';
        else if (sideName === 'under') direction = 'under';
        else if (sideName.includes(current.awayTeam.toLowerCase().split(' ').pop() ?? '')) direction = 'away';

        const detail = isSteam
          ? `[R] STEAM: ${booksMovedCount} books moved ${lineDelta > 0 ? `+${lineDelta}` : lineDelta} pts in same direction -- sharp coordinated action`
          : `Line moved ${lineDelta} pts across ${booksMovedCount} books -- possible sharp interest`;

        steamMoves.push({
          eventId: current.eventId,
          matchup: current.matchup,
          marketKey,
          outcomeName: currentSide.outcomeName,
          previousLine: oldest.line,
          currentLine: newest.line,
          lineDelta: Math.round(lineDelta * 10) / 10,
          previousPrice: oldest.price,
          currentPrice: newest.price,
          priceDelta: Math.round(priceDelta),
          booksMovedCount,
          movementSpeed: lineHistory.length <= 2 ? 'fast' : lineHistory.length <= 4 ? 'moderate' : 'slow',
          isSteam,
          steamConfidence,
          direction,
          detail,
          detectedAt,
        });
      }
    }
  }

  // Sort by severity
  return steamMoves.sort((a, b) => {
    const scoreA = (a.isSteam ? 100 : 0) + a.booksMovedCount * 10 + a.lineDelta * 5;
    const scoreB = (b.isSteam ? 100 : 0) + b.booksMovedCount * 10 + b.lineDelta * 5;
    return scoreB - scoreA;
  });
}
