// ============================================================
// src/services/snapshotStore.ts
// File-based snapshot persistence
// Snapshots are ONLY created when a command explicitly runs
// No background writes, no auto-polling
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { Snapshot, EventSummary, RunType, SnapshotMetadata, QuotaUsage } from '../types/odds';
import { logger } from '../utils/logger';

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? './snapshots';

// ------------------------------------
// Init
// ------------------------------------

function ensureSnapshotDir(): void {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    logger.info(`[SNAPSHOT] Created snapshot directory: ${SNAPSHOT_DIR}`);
  }
}

// ------------------------------------
// Generate snapshot ID
// ------------------------------------

function generateSnapshotId(runType: RunType): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${runType.toLowerCase()}_${ts}`;
}

// ------------------------------------
// File path helpers
// ------------------------------------

function snapshotFilePath(snapshotId: string): string {
  return path.join(SNAPSHOT_DIR, `${snapshotId}.json`);
}

function runLogFilePath(): string {
  return path.join(SNAPSHOT_DIR, 'run_log.json');
}

// ------------------------------------
// Save snapshot
// ------------------------------------

export function saveSnapshot(
  runType: RunType,
  eventSummaries: EventSummary[],
  quotaUsage: QuotaUsage,
  durationMs: number,
  errors: Array<{ sportKey: string; error: string; timestamp: string }>
): Snapshot {
  ensureSnapshotDir();

  const sportsProcessed = [...new Set(eventSummaries.map((e) => e.sportKey))];
  const marketsProcessed = eventSummaries.reduce(
    (sum, e) => sum + e.availableMarkets.length,
    0
  );

  const snapshotId = generateSnapshotId(runType);

  const metadata: SnapshotMetadata = {
    snapshotId,
    runType,
    runTimestamp: new Date().toISOString(),
    sportsProcessed,
    eventsProcessed: eventSummaries.length,
    marketsProcessed,
    quotaUsage,
    durationMs,
  };

  const snapshot: Snapshot = { metadata, eventSummaries };

  const filePath = snapshotFilePath(snapshotId);

  try {
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    logger.info(`[SNAPSHOT] Saved -> ${filePath}`);
  } catch (err) {
    logger.error(`[SNAPSHOT] Failed to save snapshot: ${String(err)}`);
  }

  // Append to run log
  appendRunLog(metadata, errors);

  return snapshot;
}

// ------------------------------------
// Append to run log
// ------------------------------------

function appendRunLog(
  metadata: SnapshotMetadata,
  errors: Array<{ sportKey: string; error: string; timestamp: string }>
): void {
  const logPath = runLogFilePath();
  let log: unknown[] = [];

  try {
    if (fs.existsSync(logPath)) {
      const raw = fs.readFileSync(logPath, 'utf-8');
      log = JSON.parse(raw);
    }
  } catch {
    log = [];
  }

  log.push({ ...metadata, errors });

  try {
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
  } catch (err) {
    logger.warn(`[SNAPSHOT] Could not write run log: ${String(err)}`);
  }
}

// ------------------------------------
// Load most recent snapshot (for comparison)
// ------------------------------------

export function loadLatestSnapshot(runType?: RunType): Snapshot | null {
  ensureSnapshotDir();

  try {
    const files = fs
      .readdirSync(SNAPSHOT_DIR)
      .filter((f) => f.endsWith('.json') && f !== 'run_log.json')
      .filter((f) => !runType || f.startsWith(runType.toLowerCase()))
      .sort()
      .reverse();

    if (files.length === 0) {
      logger.info('[SNAPSHOT] No prior snapshots found');
      return null;
    }

    const latest = files[0];
    const raw = fs.readFileSync(path.join(SNAPSHOT_DIR, latest), 'utf-8');
    const snapshot: Snapshot = JSON.parse(raw);
    logger.info(`[SNAPSHOT] Loaded prior snapshot: ${latest}`);
    return snapshot;
  } catch (err) {
    logger.warn(`[SNAPSHOT] Could not load prior snapshot: ${String(err)}`);
    return null;
  }
}

// ------------------------------------
// Load a specific snapshot by ID
// ------------------------------------

export function loadSnapshot(snapshotId: string): Snapshot | null {
  const filePath = snapshotFilePath(snapshotId);

  if (!fs.existsSync(filePath)) {
    logger.warn(`[SNAPSHOT] Snapshot not found: ${snapshotId}`);
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Snapshot;
  } catch (err) {
    logger.error(`[SNAPSHOT] Failed to load snapshot ${snapshotId}: ${String(err)}`);
    return null;
  }
}

// ------------------------------------
// List all run log entries
// ------------------------------------

export function listRunLog(): unknown[] {
  const logPath = runLogFilePath();
  if (!fs.existsSync(logPath)) return [];

  try {
    const raw = fs.readFileSync(logPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
