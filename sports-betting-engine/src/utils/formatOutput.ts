// ============================================================
// src/utils/formatOutput.ts
// Human-readable console output for event summaries and run results
// ============================================================

import {
  EventSummary,
  RunSummary,
  TradingFlag,
  AggregatedMarket,
  MarketKey,
} from '../types/odds';
import { logger } from './logger';

// ------------------------------------
// Format american odds with sign
// ------------------------------------

function fmtPrice(price: number | null): string {
  if (price === null) return 'N/A';
  return price > 0 ? `+${price}` : `${price}`;
}

function fmtLine(line: number | null): string {
  if (line === null) return '';
  return line > 0 ? `+${line}` : `${line}`;
}

function fmtTime(iso: string): string {
  if (!iso) return 'TBD';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Chicago', // Central -- close to TN
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

// ------------------------------------
// Print a single market block
// ------------------------------------

function printMarket(market: AggregatedMarket, marketKey: MarketKey): void {
  const label = marketKey.toUpperCase().replace(/_/g, ' ');
  console.log(`\n    [~] ${label} (${market.bookCount} books)`);

  for (const side of market.sides) {
    const bestStr =
      side.bestBook
        ? `Best: ${fmtLine(side.bestLine)} ${fmtPrice(side.bestPrice)} @ ${side.bestBook}`
        : 'No offers';

    const consensusStr =
      side.consensusPrice !== null
        ? `Consensus: ${fmtLine(side.consensusLine)} ${fmtPrice(side.consensusPrice)}`
        : '';

    console.log(`      ${side.outcomeName.padEnd(28)} ${bestStr}   ${consensusStr}`);
  }

  if (market.disagreementScore > 0.3) {
    console.log(`      [!]?  Disagreement: ${fmtScore(market.disagreementScore)}`);
  }
  if (market.isStale) {
    console.log(`      ? Stale data detected`);
  }
}

// ------------------------------------
// Print trading flags
// ------------------------------------

function printFlags(flags: TradingFlag[]): void {
  if (flags.length === 0) return;
  console.log('\n    ? Trading Flags:');
  for (const flag of flags) {
    const icon = flag.severity === 'high' ? '[R]' : flag.severity === 'medium' ? '[Y]' : '[G]';
    const inferred = flag.isInferred ? ' [INFERRED]' : '';
    console.log(`      ${icon} [${flag.type}] ${flag.detail}${inferred}`);
  }
}

// ------------------------------------
// Print a single event summary
// ------------------------------------

export function printEventSummary(
  summary: EventSummary,
  flags: TradingFlag[] = []
): void {
  const dq = fmtScore(summary.dataQualityScore);
  console.log(`\n  ? ${summary.matchup}`);
  console.log(`     Start: ${fmtTime(summary.startTime)}  |  Quality: ${dq}`);
  console.log(`     Markets: ${summary.availableMarkets.join(', ')}`);

  for (const [mKey, market] of Object.entries(summary.aggregatedMarkets)) {
    printMarket(market, mKey as MarketKey);
  }

  printFlags(flags);
}

// ------------------------------------
// Print full run summary grouped by sport
// ------------------------------------

export function printRunSummary(run: RunSummary): void {
  logger.section(`${run.runType} -- ${new Date(run.runTimestamp).toLocaleString()}`);

  console.log(`  Sports processed : ${run.sportsProcessed.join(', ')}`);
  console.log(`  Events processed : ${run.eventsProcessed}`);
  console.log(`  Markets processed: ${run.marketsProcessed}`);
  console.log(`  Duration         : ${run.durationMs}ms`);
  console.log(`  API requests made: ${run.quotaUsage.requestsMade}`);
  console.log(`  Quota remaining  : ${run.quotaUsage.remainingRequests ?? 'unknown'}`);

  if (run.errors.length > 0) {
    console.log(`\n  [X] Errors (${run.errors.length}):`);
    for (const e of run.errors) {
      console.log(`     ${e.sportKey}: ${e.error}`);
    }
  }

  // Group events by sport
  const bySport = new Map<string, EventSummary[]>();
  for (const event of run.eventSummaries) {
    const list = bySport.get(event.sport) ?? [];
    list.push(event);
    bySport.set(event.sport, list);
  }

  for (const [sport, events] of bySport) {
    logger.divider();
    console.log(`\n  ? ${sport} (${events.length} games)`);

    for (const event of events) {
      // Find any movement flags for this event from topMovementFlags
      const movFlags = run.topMovementFlags
        .find((f) => f.matchup === event.matchup)
        ?.flags ?? [];
      printEventSummary(event, movFlags);
    }
  }

  logger.divider();

  if (run.topMovementFlags.length > 0) {
    console.log('\n  [^] Top Movement Flags This Run:');
    for (const { matchup, flags } of run.topMovementFlags) {
      for (const flag of flags) {
        const icon = flag.severity === 'high' ? '[R]' : '[Y]';
        console.log(`     ${icon} ${matchup} -- [${flag.type}] ${flag.detail}`);
      }
    }
  }

  console.log('\n');
}
