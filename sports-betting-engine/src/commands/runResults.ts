// ============================================================
// src/commands/runResults.ts
// Win/Loss result entry + P&L reporting
// ============================================================

import * as dotenv from 'dotenv';
dotenv.config();

import { enterResults, printPNLReport, rebuildPNL } from '../services/winLossTracker';

export async function runResults(mode: 'enter' | 'report' | 'rebuild' = 'enter') {
  switch (mode) {
    case 'enter':  await enterResults(); break;
    case 'report': printPNLReport(); break;
    case 'rebuild': rebuildPNL(); printPNLReport(); break;
  }
}
