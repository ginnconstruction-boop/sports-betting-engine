import tsParser from '@typescript-eslint/parser';
export default [{
  files:['src/services/college*.ts','src/services/nflPaper.ts','src/services/footballGuardrail.ts','src/services/footballValidation.ts',
    'src/services/closingLineTracker.ts','src/dev/college*.ts','src/tests/college*.ts','server.ts','public/college-markets.js'],
  languageOptions:{parser:tsParser,ecmaVersion:'latest',sourceType:'module'},
  rules:{'no-debugger':'error','no-dupe-args':'error','no-dupe-keys':'error','no-unsafe-finally':'error',
    'valid-typeof':'error','no-unreachable':'error','no-async-promise-executor':'error','no-constant-binary-expression':'error'},
}];
