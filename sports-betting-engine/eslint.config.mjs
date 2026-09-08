import tsParser from '@typescript-eslint/parser';
export default [{
  files:['src/services/college*.ts','src/services/nflPaper.ts','src/services/footballGuardrail.ts','src/services/footballValidation.ts',
    'src/services/closingLineTracker.ts','src/services/nflContext*.ts','src/services/nflDailyRun.ts','src/services/nflReadiness.ts','src/services/nflOfficial*.ts','src/services/nflFreeResearchData.ts','src/services/nflSnapResearch.ts','src/services/nflForward*.ts','src/services/nflOpportunity*.ts','src/services/nflSpreadPhase3A.ts','src/services/nflGameDayAvailability.ts','src/services/nflGameLineResearch.ts',
    'src/dev/college*.ts','src/dev/nflContextAudit.ts','src/dev/nflGameLineAudit.ts','src/dev/nflForwardCollector.ts','src/dev/nflOpportunityResearch.ts','src/dev/nflSpreadPhase3AResearch.ts','src/tests/college*.ts','src/tests/nflContext*.ts','src/tests/nflDailyRun.test.ts','src/tests/nflOfficial*.ts','src/tests/nflFreeResearchData.test.ts','src/tests/nflSnapResearch.test.ts','src/tests/nflForward*.ts','src/tests/nflOpportunity*.ts','src/tests/nflSpreadPhase3A.test.ts','src/tests/nflGameLineResearch.test.ts','server.ts','public/college-markets.js','public/nfl-markets.js'],
  languageOptions:{parser:tsParser,ecmaVersion:'latest',sourceType:'module'},
  rules:{'no-debugger':'error','no-dupe-args':'error','no-dupe-keys':'error','no-unsafe-finally':'error',
    'valid-typeof':'error','no-unreachable':'error','no-async-promise-executor':'error','no-constant-binary-expression':'error'},
}];
