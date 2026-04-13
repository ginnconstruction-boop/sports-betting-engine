import * as dotenv from 'dotenv';
dotenv.config();
import { autoGradePicks, buildRetroReport, printRetroReport } from '../services/retroAnalysis';

export async function runRetro() {
  console.log('\n  Auto-grading picks from ESPN scores...');
  const graded = await autoGradePicks();
  console.log(`  Graded ${graded} new pick(s).`);
  const report = buildRetroReport();
  printRetroReport(report);
}
