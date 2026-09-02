import { CollegeDayScan,collegeDate } from '../services/collegeDayScan';
export async function runCollegeDayScan(date=collegeDate(Date.now())) {
  console.log(`College FULL-DAY scan: ${date} (America/Chicago). No single-game selection is used.`);
  const r=await new CollegeDayScan().scan(date);
  console.log(`Provider games checked: ${r.providerGames}; fresh odds: ${r.gamesWithFreshOdds}; independent schedule gaps: ${r.unmatchedScheduledGames}.`);
  console.log(`Recommendations: BLOCKED — college model validation pending. Research shortlist: ${r.shortlist.length}.`);
  if(!r.providerGames)console.log(r.providerScheduleAvailable?'No provider-listed games on this date.':'Provider schedule unavailable; this is not an empty successful scan.');
  if(r.nextDate)console.log(`Next provider-listed game day after selected date: ${r.nextDate}. Use the college date selector on the website.`);
  for(const row of r.rows)console.log(`${row.event.awayTeam} @ ${row.event.homeTeam}: ${row.reason}`);
  for(const row of r.unlisted)console.log(`${row.name}: ${row.reason}`);
  for(const row of r.shortlist)console.log(`PRICE RESEARCH ONLY: ${row.event.awayTeam} @ ${row.event.homeTeam}: ${row.quote.side} ${row.quote.line} ${row.quote.book} ${row.quote.price}. Not a betting recommendation.`);
  for(const warning of r.warnings)console.log(`WARNING: ${warning}`);
  console.log(`Odds credits: ${r.creditsUsed??'unknown'}; evidence saved: ${r.evidenceSaved}. No picks or wagers created.`);
}
