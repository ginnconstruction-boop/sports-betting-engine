// College experimental model-paper scans; manual picks remain separately labeled.
let collegeQuotes = [];
let collegeBaselines = [], collegeLoadedEvent = null;
let collegeBusy = false;
function openCollegeBoard() {
  const board = document.getElementById('college-market-board');
  board.open = true; board.scrollIntoView({behavior:'smooth',block:'start'});
  if(!document.getElementById('college-scan-date').value){
    document.getElementById('college-scan-date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  }
}
let collegeScanBusy=false;
function clearCollegeScan(){document.getElementById('college-scan-results').replaceChildren();document.getElementById('college-scan-status').textContent='Date or paper mode changed. Run a new full-day scan; previous displayed results are cleared. Saved picks are unchanged.';}
async function runCollegeDayScan(){
  if(collegeScanBusy)return;
  const input=document.getElementById('college-scan-date'),button=document.getElementById('college-day-scan-btn'),status=document.getElementById('college-scan-status'),panel=document.getElementById('college-scan-results');
  if(!input.value){openCollegeBoard();}
  collegeScanBusy=true;button.disabled=true;input.disabled=true;panel.replaceChildren();
  const paperBox=document.getElementById('college-model-paper-rules'),trackPaper=paperBox.checked;paperBox.disabled=true;
  const date=input.value;status.textContent=`Scanning all college games for ${date} (Central time). Checking schedules, historical scoring model and posted spreads/totals...`;
  try{
    const data=await nflFetch('/api/college/scan',{method:'POST',body:JSON.stringify({date,trackPaper})});
    status.textContent=`${data.date} · Central time · ${data.providerGames} provider-listed games checked; ${data.gamesWithFreshOdds} with fresh odds; ${data.unmatchedScheduledGames} independent schedule entries unmatched. ${data.cached?'Cached odds reused. ':''}Odds credits this scan: ${data.creditsUsed??'unknown'}.`;
    const previewCount=(data.projections??[]).reduce((n,r)=>n+(r.selected?.length??0),0);
    nflText(panel,data.recommendationStatus==='preview_only'?`Preview: ${previewCount} experimental paper spread candidates — not yet saved · ${data.projections?.length??0} games projected`
      :`${data.recommendations.length} saved experimental paper spread recommendations · ${data.projections?.length??0} games projected`,'strong');
    nflText(panel,data.recommendationNote);
    if(data.modelReadiness?.calibration)nflText(panel,'Confidence warning: historical win-probability estimates were overconfident (67% forecast vs 55% observed). These selections are for paper observation only, not real-money betting or stake sizing.');
    if(data.recommendationStatus==='preview_only')nflText(panel,'PREVIEW ONLY: no model picks were saved. Check the paper-tracking box above and scan again to save qualifying spreads.');
    if(['model_data_unavailable','blocked_model_validation'].includes(data.recommendationStatus))nflText(panel,'Model unavailable: this is not a successful no-edge conclusion. Check the warnings below.');
    for(const rec of data.recommendations){
      const pick=rec.pick,q=pick.quote,p=pick.collegeForecast.projection,card=document.createElement('div');card.className='nfl-forecast-guide';
      nflText(card,`${q.side} ${q.line>0?'+':''}${q.line} · ${q.book} ${q.price>0?'+':''}${q.price} — EXPERIMENTAL PAPER`,'strong');
      nflText(card,`${pick.event.awayTeam} @ ${pick.event.homeTeam} — ${nflDisplayTime(pick.event.commenceTime)}`);
      nflText(card,`Model score: ${pick.event.awayTeam} ${nflFixed(p.awayScore,1)}; ${pick.event.homeTeam} ${nflFixed(p.homeScore,1)}. Fair home spread ${nflFixed(p.fairHomeSpread,1)}. ${p.neutral?'Neutral venue.':'Non-neutral venue.'}`);
      nflText(card,`${rec.duplicate?'Already tracked: ORIGINAL pick/price retained, not a refreshed offer.':'Saved before display.'} ${pick.result} · ${p.homeGames}/${p.awayGames} prior games (home/away); current-season games ${p.homeCurrentGames}/${p.awayCurrentGames}.`);
      nflText(card,'No injury, transfer, starting-QB or weather adjustment. This is a paper experiment, not advice to place a real bet.');panel.append(card);
    }
    if(data.modelReadiness){const r=data.modelReadiness,v=r.validation,a=r.oddsAudit;
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Model test results and limitations';details.append(summary);
      nflText(details,`2025 chronological score test: ${v.games} eligible games; ${v.excluded} excluded. Spread RMSE ${nflFixed(v.margin.rmse,2)} vs simple baseline ${nflFixed(v.baselineMargin.rmse,2)} — paper gate passed. Total RMSE ${nflFixed(v.total.rmse,2)} vs ${nflFixed(v.baselineTotal.rmse,2)} — failed; no totals model picks.`);
      nflText(details,`Six fixed historical dates: ${a.wins}W–${a.losses}L–${a.pushes}P; ${nflFixed(a.profitUnits,2)} hypothetical units; ${nflFixed(a.roi*100,1)}% ROI. Reconstructed, not archived live forecasts. Win-rate uncertainty approximately ${nflFixed(a.winRate95Wilson[0]*100,1)}%–${nflFixed(a.winRate95Wilson[1]*100,1)}% (95% interval). Not proof of profitability.`);
      if(r.calibration){const c=r.calibration;nflText(details,`Probability calibration FAILED: mean forecast ${(c.meanForecastProbability*100).toFixed(1)}% vs observed ${(c.winRate*100).toFixed(1)}%. Brier error ${nflFixed(c.brier,3)} vs 0.250 for a constant 50% estimate (lower is better). Three of six dates lost units. No model probability is a trustworthy win chance.`);}
      nflText(details,r.limitations);panel.append(details);
    }
    if(!data.providerGames)nflText(panel,data.providerScheduleAvailable?'No games listed by the odds provider for this date. This is a schedule/coverage result, not a no-edge conclusion.':'The game feed failed. This is not a successful empty scan.');
    if(!data.providerGames&&data.nextDate){
      const next=document.createElement('button');next.textContent=`Scan next listed game day: ${data.nextDate}`;
      next.onclick=()=>{if(collegeScanBusy)return;input.value=data.nextDate;runCollegeDayScan();};panel.append(next);
    }
    for(const warning of data.warnings)nflText(panel,warning);
    const priceDetails=document.createElement('details'),priceSummary=document.createElement('summary');priceSummary.textContent=`Optional sportsbook-price research: ${data.shortlist.length} comparisons shortlisted`;priceDetails.append(priceSummary);
    nflText(priceDetails,'Separate from the score model: needs three other fresh exact-line books and a 2-percentage-point conditional price gap. This is not a football-model recommendation or proven advantage.');
    for(const row of data.shortlist){
      const q=row.quote,b=row.baseline,card=document.createElement('div');card.className='nfl-forecast-guide';
      nflText(card,`${row.event.awayTeam} @ ${row.event.homeTeam} — ${nflDisplayTime(row.event.commenceTime)}`,'strong');
      nflText(card,`${q.market}: ${q.side} ${q.line} · ${q.book} ${q.price>0?'+':''}${q.price} · updated ${nflDisplayTime(q.updatedAt)}`);
      nflText(card,`${(b.conditionalPriceAdvantage*100).toFixed(1)} percentage-point gap against ${b.referenceBooks.length} other exact-line books, conditional on no push. PRICE RESEARCH ONLY.`);priceDetails.append(card);
    }
    panel.append(priceDetails);
    const reasons=Object.entries(data.counts).map(([key,count])=>`${key.replace(/_/g,' ')}: ${count}`).join(' · ');
    if(reasons)nflText(panel,reasons);
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Optional: coverage and reasons for every game';details.append(summary);
    for(const r of data.rows)nflText(details,`${r.event.awayTeam} @ ${r.event.homeTeam}: ${r.modelReason??'No verified model projection.'} Price-comparison detail: ${r.reason} (${r.freshQuotes} fresh quotes; ${r.marketsChecked} markets.)`);
    for(const r of data.unlisted)nflText(details,`${r.name}: ${r.reason}`);
    for(const r of data.projections??[]){const p=r.projection;
      nflText(details,`${r.event.awayTeam} @ ${r.event.homeTeam}: projected away ${nflFixed(p.awayScore,1)}, home ${nflFixed(p.homeScore,1)}; total ${nflFixed(p.total,1)} (research only). ${r.reason}`);
      for(const c of r.selected??[])nflText(details,`Unsaved paper preview: ${c.quote.side} ${c.quote.line} · ${c.quote.book} ${c.quote.price}. Not in the win/loss record until saved.`);
    }
    panel.append(details);nflText(panel,`${data.evidenceSaved?'Scan evidence saved separately from picks.':'Scan evidence was not saved.'} ${data.note}`);
    await loadCollegePaper(false);
  }catch(e){status.textContent=`College scan failed: ${e.message} No recommendation was assumed.`;}
  finally{collegeScanBusy=false;button.disabled=false;input.disabled=false;paperBox.disabled=false;}
}
function collegeStatus(message) { document.getElementById('college-status').textContent = message; }
function clearCollegeSelection() {
  collegeQuotes = [];
  collegeBaselines=[];collegeLoadedEvent=null;
  document.getElementById('college-results').replaceChildren();
  document.getElementById('college-count').textContent = '';
  collegeStatus('Choose a college game, then load its spreads and totals.');
}
function collegeSetBusy(busy) {
  collegeBusy = busy;
  document.getElementById('college-events-btn').disabled = busy;
  document.getElementById('college-event').disabled = busy;
  document.getElementById('college-quotes-btn').disabled = busy || !document.getElementById('college-event').value;
}
async function loadCollegeEvents() {
  if (collegeBusy) return;
  collegeSetBusy(true); clearCollegeSelection();
  const games = document.getElementById('college-event'); games.replaceChildren();
  collegeStatus('Loading upcoming college football games (no odds credits)...');
  try {
    const data = await nflFetch('/api/college/events');
    for (const game of data.events) {
      const option = document.createElement('option'); option.value = game.id;
      option.textContent = `${game.awayTeam} @ ${game.homeTeam} — ${nflDisplayTime(game.commenceTime)}`;
      games.append(option);
    }
    if (!data.events.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'No college games listed in the next 14 days'; games.append(option);
    }
    collegeStatus(data.events.length ? `${data.events.length} upcoming college games. Choose a matchup and load its spreads and totals. No odds have been pulled yet.`
      : 'No upcoming college games listed by the provider in the next 14 days. No odds request was made.');
  } catch (e) { collegeStatus(e.message); }
  finally { collegeSetBusy(false); }
}
async function loadCollegeQuotes() {
  if (collegeBusy) return;
  const eventId = document.getElementById('college-event').value;
  if (!eventId) { collegeStatus('Load and select a college game first.'); return; }
  collegeSetBusy(true); clearCollegeSelection(); collegeStatus('Loading college spreads and totals...');
  try {
    const data = await nflFetch('/api/college/markets', {method:'POST',body:JSON.stringify({eventId})});
    collegeQuotes = data.quotes;
    collegeBaselines=data.marketBaselines??[];collegeLoadedEvent=data.event;
    collegeStatus(`${data.event.awayTeam} @ ${data.event.homeTeam} • ${data.cached?'Cached':'Fetched'} ${nflDisplayTime(data.fetchedAt)} • Credits remaining at fetch: ${data.remainingCredits ?? 'unknown'}. `
      + (data.quotes.length ? 'Posted prices only; no pick has been saved.' : 'No prices posted in the feed for this game. This is not a no-edge conclusion.')
      + (data.missingMarkets.length ? ` No quotes returned for: ${data.missingMarkets.join(', ')}.` : '')+(data.paperWarning?` ${data.paperWarning}`:''));
    renderCollegeQuotes();
  } catch (e) { collegeStatus(e.message); }
  finally { collegeSetBusy(false); }
}
function renderCollegeQuotes() {
  const query = document.getElementById('college-search').value.toLowerCase().trim();
  const rows = collegeQuotes.filter(q => `${q.market} ${q.side} ${q.book}`.toLowerCase().includes(query));
  document.getElementById('college-count').textContent = `${rows.length} matching quotes (${collegeQuotes.length} total). Showing up to 250; filter to narrow. Totals are full-game over/unders.`;
  const table = document.createElement('table'); table.className = 'market-table';
  const head = document.createElement('thead'), header = document.createElement('tr');
  for (const label of ['Market','Team / selection','Line','Odds','Sportsbook','Updated','Paper / market comparison']) {
    const cell = document.createElement('th'); cell.textContent = label; header.append(cell);
  }
  head.append(header); table.append(head); const body = document.createElement('tbody');
  for (const quote of rows.slice(0,250)) {
    const row = document.createElement('tr');
    const age = Date.now() - Date.parse(quote.updatedAt ?? '');
    const values = [quote.market === 'totals'?'Total (over/under)':'Point spread',quote.side,quote.line,
      quote.price > 0?`+${quote.price}`:quote.price,quote.book,quote.updatedAt?nflDisplayTime(quote.updatedAt):'Unknown'];
    values.forEach((value,i) => { const cell = document.createElement('td'); cell.textContent = String(value);
      if (i===5 && (!Number.isFinite(age) || age>15*60_000 || age< -60_000)) cell.className = 'market-stale'; row.append(cell); });
    const actions=document.createElement('td'),save=document.createElement('button');save.textContent='Save college paper';
    save.disabled=!quote.quoteId||!Number.isFinite(age)||age>15*60_000||age< -60_000;
    save.onclick=()=>saveCollegePaper(quote);actions.append(save);
    const b=collegeBaselines.find(b=>b.targetBook===quote.bookKey&&b.market===quote.market&&b.side===quote.side&&b.line===quote.line);
    if(b){const note=document.createElement('p');note.textContent=b.conditionalNoPushProbability==null?'Market comparison unavailable: needs three other fresh exact-line books.'
      :`Other-book no-vig reference: ${(b.conditionalNoPushProbability*100).toFixed(1)}% conditional on no push. Not an independent forecast or validated edge.`;actions.append(note);}
    row.append(actions);
    body.append(row);
  }
  table.append(body); document.getElementById('college-results').replaceChildren(table);
}
async function saveCollegePaper(quote) {
  if(collegeBusy||!collegeLoadedEvent)return;
  if(!document.getElementById('college-paper-rules').checked){collegeStatus('Check the college paper-rules box first.');document.getElementById('college-paper-rules').focus();return;}
  collegeSetBusy(true);
  try{
    const data=await nflFetch('/api/college/paper',{method:'POST',body:JSON.stringify({eventId:collegeLoadedEvent.id,quoteId:quote.quoteId,rules:'college-full-game-includes-ot_v1'})});
    collegeStatus(`${data.duplicate?'Already saved; original quote unchanged.':'Saved manual college practice pick.'} ${data.pick.quote.side} ${data.pick.quote.line} at ${data.pick.quote.book}. This is your selection, not a model recommendation or real wager.`);
    await loadCollegePaper(false);
  }catch(e){collegeStatus(e.message);}finally{collegeSetBusy(false);renderCollegeQuotes();}
}
let collegePaperBusy=false;
async function loadCollegePaper(mode) {
  if(collegePaperBusy)return;collegePaperBusy=true;
  const status=document.getElementById('college-paper-status'),panel=document.getElementById('college-paper-results');
  status.textContent=mode?'Checking up to ten college games...':'Loading separate college practice record...';
  try{
    const endpoint=mode==='recheck'?'/api/college/paper/recheck':mode?'/api/college/paper/grade':'/api/college/paper';
    const data=await nflFetch(endpoint,mode?{method:'POST'}:{});panel.replaceChildren();
    status.textContent=`${data.picks.length} college paper selections. ${mode?`${data.checked} checked; ${data.remainingGames} more games; ${data.sourceFailures??0} unavailable/review checks. `:''}Separate from NFL and official records. Grading is on demand; sportsbook rules require separate verification.`;
    for(const b of data.report.buckets)nflText(panel,`${b.season} · ${b.market} · ${b.origin==='model'?'EXPERIMENTAL MODEL PAPER':'MANUAL PAPER'} · ${b.version}: ${b.wins}W–${b.losses}L–${b.pushes}P; ${b.pending} pending; ${b.review} review; ${nflFixed(b.profitUnits,2)} units; settled ROI ${b.roi==null?'unavailable':nflFixed(b.roi*100)+'%'}.`);
    for(const m of data.metrics??[])nflText(panel,`${m.distinctSettledGames} distinct settled games; ${m.settlementRevisions} result corrections; ${m.closeWindowCaptured} final-five-minute observations, ${m.closeWindowMissed} missed. These are not verified final closing prices or calibrated model results.`);
    const table=document.createElement('table');table.className='market-table';const heading=document.createElement('tr');
    for(const label of ['Game','Selection','Saved book / price','Result','Venue / audit','Notes']){const cell=document.createElement('th');cell.textContent=label;heading.append(cell);}table.append(heading);
    for(const pick of [...data.picks].reverse().slice(0,100)){
      const row=document.createElement('tr');
      for(const value of [`${pick.event.awayTeam} @ ${pick.event.homeTeam} · ${nflDisplayTime(pick.event.commenceTime)}`,`${pick.quote.market} ${pick.quote.side} ${pick.quote.line}`,
        `${pick.quote.book} / ${pick.quote.price}`,pick.result,pick.verifiedEvent?.neutralSite===true?'Neutral site':pick.verifiedEvent?.neutralSite===false?'Non-neutral site':'Venue unknown',pick.note]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
      if(pick.gradingAudit?.length||pick.collegeForecast){const replay=document.createElement('button');replay.textContent='Verify forecast / grading';replay.onclick=async()=>{
        replay.disabled=true;try{const audit=await nflFetch(`/api/college/paper/${encodeURIComponent(pick.id)}/replay`);
          status.textContent=[audit.forecastReplay?`Forecast: ${audit.forecastReplay.status.replace(/_/g,' ')}`:null,...audit.audits.map(a=>`${a.savedResult}: ${a.status.replace(/_/g,' ')}`),audit.note].filter(Boolean).join('. ');
        }catch(e){status.textContent=e.message;}finally{replay.disabled=false;}};row.children[4].append(replay);}
      table.append(row);
    }panel.append(table);if(data.picks.length>100)nflText(panel,'Showing latest 100; summary includes all college paper picks.');
  }catch(e){status.textContent=e.message;}finally{collegePaperBusy=false;}
}
async function exportCollegePaper() {
  const status=document.getElementById('college-paper-status');
  try{const data=await nflFetch('/api/college/paper/export'),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`college-paper-record-${data.exportedAt.slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status.textContent=`Exported ${data.picks.length} college picks; ${Object.keys(data.evidence).length} forecast/grading sources. ${data.missingEvidence.length} missing/corrupt; ${data.omittedEvidence.length} omitted by source-size limit. Keep this file private; a full server backup is still needed for omitted sources.`;
  }catch(e){status.textContent=e.message;}
}
