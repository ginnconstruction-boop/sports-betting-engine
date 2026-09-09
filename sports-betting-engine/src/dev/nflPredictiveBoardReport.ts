import * as path from 'path';
import {printNflPredictiveBoard,readNflPredictiveBoard} from '../services/nflPredictiveBoard';

const projectRoot=path.resolve(__dirname,'../..');
const archiveRoot=path.resolve(process.env.NFL_FORWARD_RESEARCH_ROOT??path.join(projectRoot,'research','nfl-forward-archive'));
const report=readNflPredictiveBoard(archiveRoot,projectRoot);
printNflPredictiveBoard(report);
console.log(JSON.stringify({
  generatedAt:report.generatedAt,
  games:report.games.length,
  forecasts:report.games.filter(game=>game.forecast.status==='PROJECTED').length,
  playerProjections:report.games.reduce((sum,game)=>sum+game.playerProps.length,0),
  displayedOpportunities:report.topOverall.length,
  gradeDistribution:report.gradeDistribution,
  below60:report.below60,
  collection:report.collection,
  finalDecision:report.finalDecision,
},null,2));
