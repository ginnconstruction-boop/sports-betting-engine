// ============================================================
// src/commands/runLineMonitor.ts
// Line movement monitor -- configurable polling
// Toggle via .env: LINE_MONITOR_ENABLED=true
// Interval via .env: LINE_MONITOR_INTERVAL_MINS=60
// Run via GO.bat option 27 or: npm run monitor
// Press Ctrl+C to stop
// ============================================================
import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getSessionQuota } from '../api/oddsApiClient';
import { normalizeEvents }                       from '../services/normalizeOdds';
import { aggregateAllEvents }                    from '../services/aggregateMarkets';
import { loadLatestSnapshot }                    from '../services/snapshotStore';
import { getEnabledSports }                      from '../config/sports';
import { INITIAL_MARKETS }                       from '../types/odds';
import { sendAlerts }                            from '../services/alertService';

function hoursUntil(t: string): number {
  return (new Date(t).getTime() - Date.now()) / 3600000;
}

function fmtPrice(p: number): string {
  return p > 0 ? `+${p}` : `${p}`;
}

async function runOneCheck(): Promise<void> {
  const quota = getSessionQuota();
  const sportKeys = getEnabledSports().map(s => s.key);

  const { results: rawBySport } = await getOddsForAllSports(sportKeys, INITIAL_MARKETS, true);
  const current: any[] = [];
  for (const [key, events] of rawBySport) {
    current.push(...aggregateAllEvents(normalizeEvents(events, key)));
  }

  const prior = loadLatestSnapshot();
  if (!prior || prior.length === 0) {
    console.log('  [MONITOR] No prior snapshot to compare -- run morning scan first.');
    return;
  }

  const priorMap = new Map(prior.map((e: any) => [e.eventId, e]));
  const alerts: any[] = [];
  const threshold = parseInt(process.env.LINE_MONITOR_THRESHOLD_CENTS ?? '15');

  for (const event of current) {
    const h = hoursUntil(event.startTime);
    if (h < 0.5 || h > 24) continue;

    const priorEvent = priorMap.get(event.eventId);
    if (!priorEvent) continue;

    for (const marketKey of ['spreads', 'totals', 'h2h']) {
      const cur = event.aggregatedMarkets[marketKey];
      const pri = priorEvent.aggregatedMarkets?.[marketKey];
      if (!cur || !pri) continue;

      for (const side of cur.sides ?? []) {
        const priorSide = (pri.sides ?? []).find((s: any) => s.outcomeName === side.outcomeName);
        if (!priorSide) continue;

        const priceDiff = Math.abs((side.consensusPrice ?? 0) - (priorSide.consensusPrice ?? 0));
        const lineDiff  = Math.abs((side.consensusLine ?? 0) - (priorSide.consensusLine ?? 0));

        if (priceDiff >= threshold || lineDiff >= 1.5) {
          alerts.push({
            matchup: event.matchup,
            sport: event.sportKey?.split('_').pop()?.toUpperCase() ?? '',
            market: marketKey,
            side: side.outcomeName,
            priorPrice: priorSide.consensusPrice,
            curPrice: side.consensusPrice,
            priorLine: priorSide.consensusLine,
            curLine: side.consensusLine,
            priceDiff: Math.round(priceDiff),
            lineDiff: Math.round(lineDiff * 10) / 10,
            hoursUntil: Math.round(h * 10) / 10,
          });
        }
      }
    }
  }

  const now = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour12: true });
  console.log(`  [MONITOR] ${now} CT -- checked ${current.length} events, ${alerts.length} movement(s) detected`);

  if (alerts.length > 0) {
    console.log('');
    alerts.forEach(a => {
      const priceChg = a.priceDiff > 0 ? `juice moved ${a.priceDiff}pts` : '';
      const lineChg  = a.lineDiff > 0  ? `line moved ${a.lineDiff}pts` : '';
      const changes  = [priceChg, lineChg].filter(Boolean).join(' + ');
      console.log(`  [MOVE] ${a.sport} ${a.matchup} -- ${a.market} ${a.side}: ${changes} (~${a.hoursUntil}hrs)`);
      if (a.priorLine !== null && a.curLine !== null && a.priorLine !== a.curLine) {
        console.log(`         Line: ${a.priorLine > 0 ? '+':''}${a.priorLine} -> ${a.curLine > 0 ? '+':''}${a.curLine}`);
      }
      if (a.priorPrice !== null && a.curPrice !== null) {
        console.log(`         Price: ${fmtPrice(a.priorPrice)} -> ${fmtPrice(a.curPrice)}`);
      }
    });
    console.log('');

    // Send email/SMS if significant movement
    const significant = alerts.filter(a => a.priceDiff >= 25 || a.lineDiff >= 2);
    if (significant.length > 0) {
      await sendAlerts(
        significant.map(a => ({
          sport: a.sport,
          matchup: a.matchup,
          betType: a.market,
          side: `${a.side} -- line moved ${a.lineDiff}pts`,
          bestUserBook: 'Market',
          bestUserPrice: a.curPrice ?? 0,
          grade: 'MOVE',
          score: 85,
          tier: 'BET',
          hoursUntilGame: a.hoursUntil,
        })),
        'Line Movement Alert'
      );
    }
  }

  console.log(`  Credits used this check: ${quota.requestsMade}`);
}

export async function runLineMonitor(): Promise<void> {
  const enabled = process.env.LINE_MONITOR_ENABLED !== 'false'; // default on if run manually
  const intervalMins = parseInt(process.env.LINE_MONITOR_INTERVAL_MINS ?? '60');
  const intervalMs   = intervalMins * 60 * 1000;

  console.log('\n  ============================================================');
  console.log('  LINE MOVEMENT MONITOR');
  console.log(`  Checking every ${intervalMins} minute(s) for significant line movement`);
  console.log(`  Threshold: ${process.env.LINE_MONITOR_THRESHOLD_CENTS ?? '15'}+ cent juice or 1.5+ point line move`);
  console.log('  Press Ctrl+C to stop');
  console.log('  ============================================================\n');
  console.log('  Configure in .env:');
  console.log('    LINE_MONITOR_ENABLED=true');
  console.log(`    LINE_MONITOR_INTERVAL_MINS=${intervalMins}  (currently ${intervalMins} mins)`);
  console.log('    LINE_MONITOR_THRESHOLD_CENTS=15');
  console.log('    ALERT_EMAIL_ENABLED=true  (to get email alerts on big moves)');
  console.log('');

  if (!enabled) {
    console.log('  LINE_MONITOR_ENABLED=false in .env -- set to true to activate');
    return;
  }

  // Run immediately first
  await runOneCheck();

  // Then on interval
  const timer = setInterval(async () => {
    try {
      await runOneCheck();
    } catch (err: any) {
      console.log(`  [MONITOR] Check failed: ${err.message}`);
    }
  }, intervalMs);

  // Keep alive until Ctrl+C
  await new Promise<never>(() => {});
}
