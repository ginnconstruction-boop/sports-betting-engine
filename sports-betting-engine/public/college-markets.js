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
let collegeScanBusy=false,collegeDailyBusy=false;
function collegeScanControls(disabled){
  for(const id of ['college-open','college-today-btn','college-day-scan-btn','college-scan-date','college-model-paper-rules'])document.getElementById(id).disabled=disabled;
}
async function runCollegeToday(){
  if(collegeScanBusy||collegeDailyBusy)return;
  openCollegeBoard();collegeDailyBusy=true;collegeScanBusy=true;collegeScanControls(true);
  const status=document.getElementById('college-scan-status'),progress=document.getElementById('college-daily-status');
  document.getElementById('college-scan-results').replaceChildren();progress.textContent='Starting today’s college scan, paper tracking and grading...';
  let jobId,shownScan=false;
  try{
    let job=await nflFetch('/api/college/today',{method:'POST',body:'{}'});jobId=job.id;
    document.getElementById('college-scan-date').value=job.date;
    while(true){
      const g=job.grading;
      progress.textContent=job.stage==='scanning'?`${job.date} (Central): scanning all available games and saving qualifying paper spreads...`
        :`${job.date} (Central): checked ${g.gamesChecked}/${g.gamesPlanned} games for results; ${g.picksChecked} paper selections checked.`;
      if(job.scan&&!shownScan){renderCollegeDayScan(job.scan);shownScan=true;}
      else if(!job.scan)status.textContent='Waiting for today’s full-day scan results...';
      if(job.status!=='running'){
        const outcome=job.status==='complete'?'Today’s run finished':job.status==='partial'?'Today’s run finished with safety notices':'Run did not finish';
        progress.textContent=`${outcome}: ${g.gamesChecked}/${g.gamesPlanned} games checked for grading; ${g.pending} pending; ${g.review} review. ${job.warnings.join(' ')} Games not finished stay pending; click College football again later or tomorrow to update them.`;
        if(!job.scan)status.textContent='Today’s scan did not finish. Any saved records are preserved; see the run warning above.';
        break;
      }
      await new Promise(resolve=>setTimeout(resolve,1000));
      job=await nflFetch(`/api/college/today/${encodeURIComponent(jobId)}`);
    }
  }catch(e){progress.textContent=`Could not confirm the run: ${e.message} ${jobId?'It may still be running on the server; click College football to reconnect.':'Do not assume nothing was saved; inspect the paper record before retrying.'}`;}
  finally{await loadCollegePaper(false);collegeDailyBusy=false;collegeScanBusy=false;collegeScanControls(false);}
}
function clearCollegeScan(){document.getElementById('college-scan-results').replaceChildren();document.getElementById('college-scan-status').textContent='Date or paper mode changed. Run a new full-day scan; previous displayed results are cleared. Saved picks are unchanged.';}
async function runCollegeDayScan(){
  if(collegeScanBusy)return;
  const input=document.getElementById('college-scan-date'),button=document.getElementById('college-day-scan-btn'),status=document.getElementById('college-scan-status'),panel=document.getElementById('college-scan-results');
  if(!input.value){openCollegeBoard();}
  collegeScanBusy=true;collegeScanControls(true);panel.replaceChildren();document.getElementById('college-daily-status').textContent='Optional date scan only; use College football for today’s scan + tracking + grading.';
  const paperBox=document.getElementById('college-model-paper-rules'),trackPaper=paperBox.checked;paperBox.disabled=true;
  const date=input.value;status.textContent=`Scanning all college games for ${date} (Central time). Checking schedules, historical scoring model and posted spreads/totals...`;
  try{
    const data=await nflFetch('/api/college/scan',{method:'POST',body:JSON.stringify({date,trackPaper})});
    renderCollegeDayScan(data);
    await loadCollegePaper(false);
  }catch(e){status.textContent=`College scan failed: ${e.message} Saved records may still exist; refresh the paper record before retrying.`;}
  finally{collegeScanBusy=false;collegeScanControls(false);}
}
function renderCollegeDayScan(data){
    const input=document.getElementById('college-scan-date'),status=document.getElementById('college-scan-status'),panel=document.getElementById('college-scan-results');panel.replaceChildren();
    status.textContent=`${data.date} · Central time · ${data.providerGames} provider-listed games checked; ${data.gamesWithFreshOdds} with fresh odds; ${data.unmatchedScheduledGames} independent schedule entries unmatched. ${data.cached?'Cached odds reused. ':''}Odds credits this scan: ${data.creditsUsed??'unknown'}.`;
    const previewCount=(data.projections??[]).reduce((n,r)=>n+(r.selected?.length??0),0);
    nflText(panel,data.recommendationStatus==='preview_only'?`Preview: ${previewCount} experimental paper spread candidates — not yet saved · ${data.projections?.length??0} games projected`
      :`${data.recommendations.length} qualified paper spread recommendations · ${data.monitors?.length??0} monitor-only observations saved · ${data.projections?.length??0} games projected`,'strong');
    if(!data.recommendations.length)nflText(panel,'NO RELIABLE EDGE — monitor/warning classifications are not qualified paper bets.','strong');
    nflText(panel,data.recommendationNote);
    const simple=document.createElement('div');simple.className='nfl-forecast-guide';nflText(simple,'SIMPLE READ','strong');
    nflText(simple,'RECOMMENDATION = qualified paper play · WATCH = model direction, but not enough verified evidence · PASS = neutral/no useful edge · AVOID = data or model warning.');
    for(const row of data.projections??[]){const s=row.safety,q=row.market;let label,explanation;
      if(s.qualified){label='RECOMMENDATION';explanation=`Paper-only recommendation: ${q?`${q.side} ${q.line>0?'+':''}${q.line}`:'spread candidate'}.`;}
      else if(s.classification==='PAPER MONITOR'){label='WATCH';explanation=`Raw model leans ${q?`${q.side} ${q.line>0?'+':''}${q.line}`:'one side'}, but the evidence is not strong enough to recommend it.`;}
      else if(s.classification==='MODEL WARNING'){label='AVOID';explanation='The model and market disagree too much for the available football information. Do not treat this as a pick.';}
      else{label='PASS';explanation='No usable recommendation from this game.';}
      nflText(simple,`${label} — ${row.event.awayTeam} @ ${row.event.homeTeam}: ${explanation}`,label==='RECOMMENDATION'?'strong':undefined);
    }
    panel.append(simple);
    if(data.modelReadiness?.calibration)nflText(panel,'Confidence warning: historical win-probability estimates were overconfident (67% forecast vs 55% observed). These selections are for paper observation only, not real-money betting or stake sizing.');
    if(data.recommendationStatus==='preview_only')nflText(panel,'PREVIEW ONLY: no model picks were saved. Check the paper-tracking box above and scan again to save qualifying spreads.');
    if(['model_data_unavailable','blocked_model_validation'].includes(data.recommendationStatus))nflText(panel,'Model unavailable: this is not a successful no-edge conclusion. Check the warnings below.');
    for(const rec of [...data.recommendations,...(data.monitors??[])]){
      const pick=rec.pick,q=pick.quote,p=pick.collegeForecast.projection,card=document.createElement('div');card.className='nfl-forecast-guide';
      const classification=pick.collegeForecast.safety?.classification??'LEGACY EXPERIMENTAL PAPER';
      nflText(card,`${classification==='PAPER MONITOR'?'WATCH ONLY — raw model lean':'PAPER RECOMMENDATION'}: ${q.side} ${q.line>0?'+':''}${q.line} · ${q.book} ${q.price>0?'+':''}${q.price}`,'strong');
      nflText(card,`${pick.event.awayTeam} @ ${pick.event.homeTeam} — ${nflDisplayTime(pick.event.commenceTime)}`);
      nflText(card,`Model score: ${pick.event.awayTeam} ${nflFixed(p.awayScore,1)}; ${pick.event.homeTeam} ${nflFixed(p.homeScore,1)}. Fair home spread ${nflFixed(p.fairHomeSpread,1)}. ${p.neutral?'Neutral venue.':'Non-neutral venue.'}`);
      nflText(card,`${rec.duplicate?'Already tracked: ORIGINAL pick/price retained, not a refreshed offer.':'Saved before display.'} ${pick.result} · ${p.homeGames}/${p.awayGames} prior games (home/away); current-season games ${p.homeCurrentGames}/${p.awayCurrentGames}.`);
      nflText(card,classification==='PAPER MONITOR'?'Why it is only a watch: current football evidence or calibration is incomplete. It is not a recommendation.':'Paper testing only; no real-money or stake recommendation.');panel.append(card);
    }
    if(data.modelReadiness){const r=data.modelReadiness,v=r.validation,a=r.oddsAudit;
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Model test results and limitations';details.append(summary);
      nflText(details,`2025 chronological score test: ${v.games} eligible games; ${v.excluded} excluded. Spread RMSE ${nflFixed(v.margin.rmse,2)} vs simple baseline ${nflFixed(v.baselineMargin.rmse,2)} — paper gate passed. Total RMSE ${nflFixed(v.total.rmse,2)} vs ${nflFixed(v.baselineTotal.rmse,2)} — failed; no totals model picks.`);
      nflText(details,`Six fixed historical dates: ${a.wins}W–${a.losses}L–${a.pushes}P; ${nflFixed(a.profitUnits,2)} hypothetical units; ${nflFixed(a.roi*100,1)}% ROI. Reconstructed, not archived live forecasts. Win-rate uncertainty approximately ${nflFixed(a.winRate95Wilson[0]*100,1)}%–${nflFixed(a.winRate95Wilson[1]*100,1)}% (95% interval). Not proof of profitability.`);
      if(r.calibration){const c=r.calibration;nflText(details,`Probability calibration FAILED: mean forecast ${(c.meanForecastProbability*100).toFixed(1)}% vs observed ${(c.winRate*100).toFixed(1)}%. Brier error ${nflFixed(c.brier,3)} vs 0.250 for a constant 50% estimate (lower is better). Three of six dates lost units. No model probability is a trustworthy win chance.`);}
      if(r.calibrationResearch){const e=r.calibrationResearch;
        nflText(details,'Calibration research: earlier three fixed dates fit; later three evaluate. Already-inspected historical data, not a new untouched holdout. Neither method approved.');
        for(const [name,m]of Object.entries({raw:{test:e.rawSameTest},...e.methods})){
          const t=m.test;nflText(details,`${name}: ${t.sample} evaluation games; Brier ${nflFixed(t.brier,3)}; slope ${nflFixed(t.calibrationSlope,2)}; intercept ${nflFixed(t.calibrationIntercept,2)}.`);
          for(const b of t.reliability)nflText(details,`${b.label}: n=${b.count}; predicted ${b.predictedAverage==null?'unavailable':nflFixed(b.predictedAverage*100,1)+'%'}; observed ${b.actualWinRate==null?'unavailable':nflFixed(b.actualWinRate*100,1)+'%'}; Brier contribution ${nflFixed(b.brierContribution,4)}.`);
        }
      }
      nflText(details,r.limitations);panel.append(details);
    }
    if(data.contextSourceRegistry){const registry=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Current football-context source status';registry.append(heading);
      nflText(registry,`Evidence load: ${data.contextStorage?.loadStatus??data.contextSourceRegistry.loadStatus}; evidence store: ${data.contextStorage?.storeStatus??'not run'}; source-registry store: ${data.contextStorage?.registryStore?.status??'not run'}.`);
      for(const source of data.contextSourceRegistry.sources)nflText(registry,`${source.category} — ${source.sourceName}: ${source.lastResult}; enabled ${source.enabled?'yes':'no'}; configured ${source.configured?'yes':'no'}; credentials ${source.credentialsRequired?(source.credentialsPresent?'present':'missing'):'not required'}; refresh ${source.refreshInterval}; last attempt ${source.lastAttempt?nflDisplayTime(source.lastAttempt):'never'}; last success ${source.lastSuccess?nflDisplayTime(source.lastSuccess):'never'}${source.failureReason?`; detail ${source.failureReason}`:''}.`);
      panel.append(registry);
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
      if(r.safety)renderCollegeDiagnostic(panel,r);
    }
    panel.append(details);nflText(panel,`${data.evidenceSaved?'Scan evidence saved separately from picks.':'Scan evidence was not saved.'} ${data.note}`);
}
function renderCollegeDiagnostic(panel,row){
  const s=row.safety,p=row.projection,d=document.createElement('details'),title=document.createElement('summary');
  title.textContent=`${row.event.awayTeam} @ ${row.event.homeTeam} — ${s.classification}`;d.append(title);
  const q=row.market;nflText(d,q?`MARKET: ${q.side} ${q.line} ${q.price} · ${q.book}. Consensus home spread ${nflFixed(s.marketConsensus.homeLine,1)} (${s.marketConsensus.books.length} books).`:'MARKET: no usable exact spread.');
  nflText(d,`MODEL: ${row.event.awayTeam} ${nflFixed(p.awayScore,1)}, ${row.event.homeTeam} ${nflFixed(p.homeScore,1)}. Raw home margin ${nflFixed(p.homeMargin,1)}. Talent-adjusted margin ${s.talentAdjustedHomeMargin==null?'unavailable — no invented adjustment':nflFixed(s.talentAdjustedHomeMargin,1)}.`);
  nflText(d,`${s.marketDisagreementStatus}: ${s.marketDisagreementPoints==null?'unavailable':nflFixed(Math.abs(s.marketDisagreementPoints),1)} pts. Context reliability ${s.confidence}; this is not a probability or a 100-point grade.`);
  if(s.marketMovement?.available)nflText(d,`MARKET MOVEMENT (${s.marketMovement.provider}): home spread ${nflFixed(s.marketMovement.openingHomeSpread,1)} → ${nflFixed(s.marketMovement.currentHomeSpread,1)}; ${nflFixed(Math.abs(s.marketMovement.movementPoints),1)} pts ${String(s.marketMovement.movementDirection).toLowerCase().replace(/_/g,' ')}. ${s.marketMovement.label??'No model/market divergence flag.'} No projection change.`);
  if(s.currentContext){for(const side of ['away','home']){const c=s.currentContext[side],team=side==='away'?row.event.awayTeam:row.event.homeTeam;
    nflText(d,`CURRENT CONTEXT — ${team}: ${c.completeness}% complete; reliability ${c.reliability}; QB ${c.qb.starter??'unknown'} — ${c.qb.status}; current-season data ${c.sections.currentSeason?.status??'missing'}; returning production ${c.sections.returningProduction.status}; transfers ${c.sections.transfers.status}; coaching ${c.sections.coaching.status}; talent/depth ${c.sections.talentDepth.status}; injuries ${c.sections.injuries.status}; weather ${c.sections.weather.status}.`);
    const season=c.currentSeason;if(season)nflText(d,`Current season: ${season.gamesPlayed??0} games found; primary QB ${season.primaryQb??'unavailable'}; last opponent ${season.lastOpponent??'unavailable'}; offense ${season.pointsPerGame??'unknown'} PPG / ${season.yardsPerGame??'unknown'} yards; defense ${season.pointsAllowedPerGame??'unknown'} PPG / ${season.yardsAllowedPerGame??'unknown'} yards allowed. Diagnostic only.`);
    const w=c.weather;nflText(d,`Weather diagnostic: ${w.indoor===true?'indoor':w.temperatureF==null?'unavailable':`${w.temperatureF}°F`}; wind ${w.windMph??'unknown'} mph; gust ${w.gustMph??'unknown'} mph; precipitation ${w.precipitationProbability??'unknown'}%. No point adjustment.`);
    const debug=document.createElement('details'),debugTitle=document.createElement('summary');debugTitle.textContent=`Context ingestion diagnostics — ${team}`;debug.append(debugTitle);
    for(const [sectionName,section] of Object.entries(c.sections))for(const [field,resolved] of Object.entries(section.fields??{}))if(resolved.status!=='AVAILABLE')nflText(debug,`${sectionName} / ${field}: ${resolved.status} — ${resolved.diagnosticReason??'NO_SOURCE_ATTEMPTED'}`);
    d.append(debug);
  }nflText(d,`Context-adjusted model: ${s.currentContext.adjustedModel}`);}
  for(const side of ['home','away']){const c=s.rosterContext[side],b=s.rosterContext[side+'Blend'];
    nflText(d,`ROSTER CONTEXT — ${side}: ${c.status}; returning production ${c.features.returningProduction??'unavailable'}; QB verified ${c.qbVerified?'yes':'no'}; QB continuity ${c.features.qbContinuity??'unavailable'}; transfers +${c.features.transferAdditions??'?'} / -${c.features.transferLosses??'?'}; coaching changes ${c.features.headCoachChange??'unknown'}.`);
    nflText(d,`Early-season prior weight ${(b.preseasonWeight*100).toFixed(1)}%; current-season weight ${(b.currentSeasonWeight*100).toFixed(1)}%. Diagnostic/unfitted blend, not an active score correction. ${c.issues.join(' ')}`);
  }
  nflText(d,`FBS/FCS: ${s.mismatch.awayDivision} @ ${s.mismatch.homeDivision}. Current-season sample ${p.awayCurrentGames}/${p.homeCurrentGames}; week ${s.week??'unknown'}. ${s.mismatch.warning??''}`);
  nflText(d,`${s.calibrationStatus}: ${s.rawProbability==null?'unavailable':nflFixed(s.rawProbability*100,1)+'%'}. ${s.calibratedLabel}: ${s.calibratedProbability==null?'unavailable':nflFixed(s.calibratedProbability*100,1)+'% conditional on no push'}. No Kelly or stake sizing.`);
  nflText(d,`MODEL RELIABILITY: spread historical gate ${s.spreadHoldoutPassed?'passed':'failed'}; calibration not approved. Failed checks: ${Object.entries(s.checks).filter(([,ok])=>!ok).map(([name])=>name).join(', ')||'none'}.`);
  nflText(d,`${s.totalsStatus} Research total ${nflFixed(p.total,1)}.`);
  nflText(d,`FINAL: ${s.classification}. WHY: ${s.reasons.join(' ')}`,'strong');panel.append(d);
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
    save.disabled=quote.market==='totals'||!quote.quoteId||!Number.isFinite(age)||age>15*60_000||age< -60_000;
    if(quote.market==='totals')save.textContent='Totals — research only';
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
  if(quote.market==='totals'){collegeStatus('TOTAL PROJECTION — RESEARCH ONLY. Historical holdout gate failed; paper saving disabled.');return;}
  if(!document.getElementById('college-paper-rules').checked){collegeStatus('Check the college paper-rules box first.');document.getElementById('college-paper-rules').focus();return;}
  collegeSetBusy(true);
  try{
    const data=await nflFetch('/api/college/paper',{method:'POST',body:JSON.stringify({eventId:collegeLoadedEvent.id,quoteId:quote.quoteId,rules:'college-full-game-includes-ot_v1'})});
    collegeStatus(`${data.duplicate?'Already saved; original quote unchanged.':'Saved manual college practice pick.'} ${data.pick.quote.side} ${data.pick.quote.line} at ${data.pick.quote.book}. This is your selection, not a model recommendation or real wager.`);
    await loadCollegePaper(false);
  }catch(e){collegeStatus(e.message);}finally{collegeSetBusy(false);renderCollegeQuotes();}
}
let collegePaperBusy=false;
function collegePaperPlainSummary(buckets){
  const add=(rows)=>rows.reduce((a,b)=>({wins:a.wins+(b.wins??0),losses:a.losses+(b.losses??0),pushes:a.pushes+(b.pushes??0),
    pending:a.pending+(b.pending??0),review:a.review+(b.review??0),units:a.units+(b.profitUnits??0)}),{wins:0,losses:0,pushes:0,pending:0,review:0,units:0});
  const model=buckets.filter(b=>b.origin==='model'),qualified=add(model.filter(b=>['PAPER BET','PAPER LEAN'].includes(b.classification))),
    watch=add(model.filter(b=>b.classification==='PAPER MONITOR')),manual=add(buckets.filter(b=>b.origin!=='model'));
  const line=(label,r,note)=>`${label}: ${r.wins}W–${r.losses}L–${r.pushes}P; ${r.pending} pending; ${r.review} review; ${nflFixed(r.units,2)} hypothetical units.${note}`;
  return [line('OFFICIAL MODEL PAPER RECOMMENDATIONS',qualified,''),
    line('WATCH-ONLY MODEL OBSERVATIONS',watch,' These are tracked model leans, not recommendations.'),
    line('YOUR MANUAL PRACTICE PICKS',manual,' These are your selections, not model recommendations.')];
}
async function loadCollegePaper(mode) {
  if(collegeDailyBusy&&mode)return;
  if(collegePaperBusy)return;collegePaperBusy=true;
  const status=document.getElementById('college-paper-status'),panel=document.getElementById('college-paper-results');
  status.textContent=mode?'Checking up to ten college games...':'Loading separate college practice record...';
  try{
    const endpoint=mode==='recheck'?'/api/college/paper/recheck':mode?'/api/college/paper/grade':'/api/college/paper';
    const data=await nflFetch(endpoint,mode?{method:'POST'}:{});panel.replaceChildren();
    status.textContent=`${data.picks.length} college paper selections. ${mode?`${data.checked} checked; ${data.remainingGames} more games; ${data.sourceFailures??0} unavailable/review checks. `:''}Separate from NFL and official records. Grading is on demand; sportsbook rules require separate verification.`;
    for(const summary of collegePaperPlainSummary(data.report.buckets))nflText(panel,summary,'strong');
    for(const b of data.report.buckets)nflText(panel,`${b.season} · ${b.market} · ${b.classification??(b.origin==='model'?'EXPERIMENTAL MODEL PAPER':'MANUAL PAPER')} · ${b.version}: ${b.wins}W–${b.losses}L–${b.pushes}P; ${b.pending} pending; ${b.review} review; ${nflFixed(b.profitUnits,2)} hypothetical units; settled ROI ${b.roi==null?'unavailable':nflFixed(b.roi*100)+'%'}.`);
    if(data.clv){const c=data.clv;nflText(panel,`Separate CLV observation proxies: ${c.lineSamples}/${c.tracked} line samples; average ${c.averageSpreadClv==null?'unavailable':nflFixed(c.averageSpreadClv,2)} pts; median ${c.medianSpreadClv==null?'unavailable':nflFixed(c.medianSpreadClv,2)} pts; positive ${c.positiveClvRate==null?'unavailable':nflFixed(c.positiveClvRate*100,1)+'%'}. Exact-line price CLV ${c.averagePriceClv==null?'unavailable':nflFixed(c.averagePriceClv,2)+' percentage points'} (${c.priceSamples} samples). ${c.note}`);}
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
