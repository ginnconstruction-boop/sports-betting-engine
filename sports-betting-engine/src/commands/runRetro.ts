import * as dotenv from 'dotenv';
dotenv.config();
import { autoGradePicks, buildRetroReport, printRetroReport } from '../services/retroAnalysis';
import { rebuildPNL } from '../services/winLossTracker';

export async function runRetro() {
  console.log('\n  Auto-grading picks from score feeds...');
  const grading = await autoGradePicks();
  console.log(`[GRADING] checked: ${grading.checked} | graded: ${grading.graded} | pending: ${grading.pending} | missing: ${grading.missing} | void: ${grading.void}`);
  if (grading.graded > 0 || grading.missing > 0 || grading.void > 0) {
    rebuildPNL();
  }
  const report = buildRetroReport();
  printRetroReport(report);
}
