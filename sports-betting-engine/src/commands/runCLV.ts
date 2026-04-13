// ============================================================
// src/commands/runCLV.ts
// Closing Line Value tracker commands
// Usage:
//   clv          -- fetch closing lines + print full report
//   clv report   -- print report only (no API call)
//   clv picks    -- list all logged picks
// ============================================================

import * as dotenv from 'dotenv';
dotenv.config();

import {
  fetchClosingLines,
  printCLVSummary,
  listPicks,
} from '../services/closingLineTracker';

export async function runCLV(mode: 'fetch' | 'report' | 'picks' = 'fetch') {
  switch (mode) {
    case 'fetch':
      await fetchClosingLines();
      break;
    case 'report':
      printCLVSummary();
      break;
    case 'picks':
      listPicks();
      break;
  }
}
