import * as dotenv from 'dotenv';
dotenv.config();
import { autoGradePicks, buildRetroReport, printRetroReport } from '../services/retroAnalysis';

export async function runRetro() {
  console.log('\n  Auto-grading picks from ESPN scores...');
  const grading = await autoGradePicks();
  console.log(`[GRADING] checked: ${grading.checked} | graded: ${grading.graded} | pending: ${grading.pending} | missing: ${grading.missing}`);
  const report = buildRetroReport();
  printRetroReport(report);
}
