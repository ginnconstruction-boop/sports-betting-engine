import { createHash } from 'crypto';
import { evaluateNflGameLineSeason, loadNflverseGameResults } from '../services/nflGameLineResearch';

async function main() {
  const games = await loadNflverseGameResults();
  const candidates = [
    {ridge:1,halfLifeDays:180},{ridge:3,halfLifeDays:180},{ridge:10,halfLifeDays:180},
    {ridge:1,halfLifeDays:365},{ridge:3,halfLifeDays:365},{ridge:10,halfLifeDays:365},
    {ridge:1,halfLifeDays:730},{ridge:3,halfLifeDays:730},{ridge:10,halfLifeDays:730},
  ];
  const development = candidates.map(config => evaluateNflGameLineSeason(games, 2024, config));
  const selected = [...development].sort((a,b) => a.modelMargin.rmse! - b.modelMargin.rmse!)[0];
  const holdout = evaluateNflGameLineSeason(games, 2025, selected.config);
  const compact = (row: ReturnType<typeof evaluateNflGameLineSeason>) => ({ season:row.season,config:row.config,games:row.games,excluded:row.excluded,
    modelMargin:row.modelMargin,naiveMargin:row.naiveMargin,marketMargin:row.marketMargin,
    modelTotal:row.modelTotal,naiveTotal:row.naiveTotal,marketTotal:row.marketTotal,paperAts:row.paperAts,disagreementBuckets:row.disagreementBuckets });
  const report = { protocol:'nfl-full-game-score-research-v2-audit-metrics', createdAt:new Date().toISOString(), source:'nflverse schedules CC-BY-4.0',
    sourceHash:createHash('sha256').update(JSON.stringify(games)).digest('hex'), selectionRule:'Lowest 2024 chronological margin RMSE among nine predeclared ridge/half-life candidates; evaluate once on untouched 2025.',
    development:development.map(compact), selectedConfig:selected.config, holdout:compact(holdout), recommendationEnabled:false,moneyBettingApproved:false,
    restrictions:'Closing market spread is evaluation-only and never a predictor. The two-point ATS rule is descriptive, uses closing rather than archived actionable prices, and is not a profitability backtest.' };
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'NFL game-line audit failed');process.exitCode=1;});
