process.env.LOG_LEVEL = 'error';
import * as dotenv from 'dotenv';
dotenv.config();
import { runMorningScan }     from './commands/runMorningScan';
import { runMiddayFinalCard } from './commands/runMiddayFinalCard';
import { runFullScan }        from './commands/runFullScan';
import { runSportScan }       from './commands/runSportScan';
import { runLiveCheck }       from './commands/runLiveCheck';
import { runCLV }             from './commands/runCLV';
import { runResults }         from './commands/runResults';
import { runProps }           from './commands/runProps';
import { runCalibration }     from './commands/runCalibration';
import { runHistorical }      from './commands/runHistorical';
import { runRetro }           from './commands/runRetro';
import { runSGP }             from './commands/runSGP';
import { runAltParlays }      from './commands/runAltParlays';
import { runFixResults }      from './commands/runFixResults';
import { runLineMonitor }     from './commands/runLineMonitor';
import { runFirstScorer }     from './commands/runFirstScorer';
import { runTeasers }         from './commands/runTeasers';
import { runLateGames }       from './commands/runLateGames';
import { printWeeklySummary } from './services/weeklySummary';

const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();
const subcommand = args[1]?.toLowerCase();
const forceRefresh = args.includes('--force') || args.includes('-f');

async function main() {
  switch (command) {
    // -- Scans ----------------------------------------------
    case 'morning':       await runMorningScan({ forceRefresh }); break;
    case 'midday':        await runMiddayFinalCard({ forceRefresh }); break;
    case 'full':          await runFullScan({ forceRefresh }); break;
    case 'live':          await runLiveCheck({ forceRefresh }); break;
    case 'nba':           await runSportScan('basketball_nba', { forceRefresh }); break;
    case 'mlb':           await runSportScan('baseball_mlb', { forceRefresh }); break;
    case 'nhl':           await runSportScan('icehockey_nhl', { forceRefresh }); break;
    case 'nfl':           await runSportScan('americanfootball_nfl', { forceRefresh }); break;
    case 'ncaab':         await runSportScan('basketball_ncaab', { forceRefresh }); break;
    case 'ncaaf':         await runSportScan('americanfootball_ncaaf', { forceRefresh }); break;
    case 'ncaa-baseball': await runSportScan('baseball_ncaa', { forceRefresh }); break;
    case 'sport':
      if (!args[1]) { console.log('Usage: sport <key>'); break; }
      await runSportScan(args[1], { forceRefresh }); break;
    // -- Props -----------------------------------------------
    case 'props': case 'nba-props': await runProps({ forceRun: true, sportKey: 'basketball_nba' }); break;
    case 'mlbprops': await runProps({ forceRun: true, sportKey: 'baseball_mlb' }); break;
    case 'nhlprops': await runProps({ forceRun: true, sportKey: 'icehockey_nhl' }); break;
    case 'nflprops': await runProps({ forceRun: true, sportKey: 'americanfootball_nfl' }); break;
    // -- Tracking --------------------------------------------
    case 'clv':
      if (subcommand === 'report')     await runCLV('report');
      else if (subcommand === 'picks') await runCLV('picks');
      else                             await runCLV('fetch');
      break;
    case 'results':
      if (subcommand === 'report')       await runResults('report');
      else if (subcommand === 'rebuild') await runResults('rebuild');
      else                               await runResults('enter');
      break;
    case 'record': case 'pnl': await runResults('report'); break;
    case 'week': case 'weekly': printWeeklySummary(); break;
    case 'calibrate': case 'model': runCalibration(); break;
    case 'retro': case 'analysis': await runRetro(); break;
    case 'sgp': case 'parlay':
      await runSGP(args[1] ?? 'basketball_nba'); break;
    case 'altparlays': case 'alt':
      await runAltParlays(args[1] ?? 'basketball_nba'); break;
    case 'fixresults': case 'fix':
      await runFixResults(); break;
    case 'monitor': case 'linemonitor':
      await runLineMonitor(); break;
    case 'lategames': case 'late':
      await runLateGames({ forceRefresh }); break;
    case 'firstbasket': case 'fb':
      await runFirstScorer('basketball_nba'); break;
    case 'firsttd': case 'ftd':
      await runFirstScorer('americanfootball_nfl'); break;
    case 'teasers': case 'teaser':
      await runTeasers({ forceRefresh }); break;
    case 'historical': case 'history':
      if (subcommand === 'fetch')  await runHistorical('fetch', args[2]);
      else if (subcommand === 'build') await runHistorical('build');
      else                             await runHistorical('report');
      break;
    // -- Dev -------------------------------------------------
    case 'mock': require('./dev/mockRun'); break;
    default:
      console.log('\n  -- Scans --        morning | midday | full | nba | mlb | nhl | ncaab');
      console.log('  -- Props --        props');
      console.log('  -- Tracking --     results | record | week | clv | calibrate');
      console.log('  -- Historical --   historical | historical build | historical fetch YYYY-MM-DD');
      console.log('  -- Dev --          mock\n');
  }
}
main().catch(err => { console.error('Error:', err.message); process.exit(1); });
