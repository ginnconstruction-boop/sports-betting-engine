// ============================================================
// src/commands/runHistorical.ts
// Historical odds database commands
// ============================================================

import * as dotenv from 'dotenv';
dotenv.config();
import { printHistoricalReport, buildHistoricalFromSnapshots, fetchHistoricalFromOddsAPI } from '../services/historicalOdds';

export async function runHistorical(mode: 'report' | 'build' | 'fetch' = 'report', date?: string) {
  switch (mode) {
    case 'report':
      printHistoricalReport();
      break;
    case 'build':
      console.log('\n  Building historical DB from saved snapshots...');
      const added = buildHistoricalFromSnapshots();
      console.log(`  Added ${added} new games to historical database.\n`);
      printHistoricalReport();
      break;
    case 'fetch':
      if (!date) {
        console.log('\n  Usage: historical fetch YYYY-MM-DD');
        console.log('  Example: historical fetch 2025-04-01');
        console.log('  NOTE: This uses API credits\n');
        return;
      }
      const apiKey = process.env.ODDS_API_KEY ?? '';
      if (!apiKey) { console.log('  ODDS_API_KEY not set'); return; }

      const sports = ['baseball_mlb', 'basketball_nba', 'icehockey_nhl', 'basketball_ncaab'];
      let total = 0;
      for (const sport of sports) {
        try {
          const games = await fetchHistoricalFromOddsAPI(sport, date, apiKey);
          total += games.length;
          if (games.length > 0) console.log(`  ${sport}: ${games.length} games fetched`);
        } catch (err) {
          console.log(`  ${sport}: failed`);
        }
      }
      console.log(`\n  Total: ${total} historical games fetched for ${date}\n`);
      break;
  }
}
