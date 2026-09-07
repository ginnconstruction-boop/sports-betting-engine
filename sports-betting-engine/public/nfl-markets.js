// Explicit quotes/history/model actions only; experimental model issuance is auto-logged server-side.
let nflQuotes = [];
let nflGroups = [];
let nflBoardBusy = false;
let nflLoadedSelection = null;
let nflActionBusy = false;
const nflCore = new Set(['player_pass_yds','player_rush_yds','player_reception_yds','player_receptions']);
let nflDailyBusy=false;
async function runNflToday(){
  if(nflDailyBusy)return;openNflForecast();nflDailyBusy=true;
  const status=document.getElementById('nfl-daily-status'),panel=document.getElementById('nfl-daily-results');
  for(const id of ['nfl-today-open','nfl-today-btn'])document.getElementById(id).disabled=true;panel.replaceChildren();status.textContent='Starting the free NFL schedule, roster, quarterback, injury/weather and paper-grade preflight...';
  let jobId;
  try{let job=await nflFetch('/api/nfl/today',{method:'POST',body:'{}'});jobId=job.id;
    while(true){status.textContent=job.stage==='discovering'?'Loading today’s remaining NFL games (no odds credits)...':job.stage==='context'?'Checking current NFL context sources (no odds credits)...':`Checking ${job.grading.gamesChecked}/${job.grading.gamesPlanned} completed games for paper results...`;
      if(job.status!=='running'){renderNflDaily(job);break;}await new Promise(resolve=>setTimeout(resolve,1000));job=await nflFetch(`/api/nfl/today/${encodeURIComponent(jobId)}`);}
  }catch(error){status.textContent=`NFL preflight could not be confirmed: ${error.message} ${jobId?'The server may still be finishing; wait before retrying.':'No odds or recommendation was assumed.'}`;}
  finally{for(const id of ['nfl-today-open','nfl-today-btn'])document.getElementById(id).disabled=false;nflDailyBusy=false;}
}
function renderNflDaily(job){
  const status=document.getElementById('nfl-daily-status'),panel=document.getElementById('nfl-daily-results'),data=job.preflight,g=job.grading;panel.replaceChildren();
  status.textContent=`${job.date} Central NFL preflight ${job.status}: ${data?.summary?.games??0} remaining games, ${data?.summary?.teams??0} teams; ${g.picksChecked} paper selections checked. Odds credits: 0. ${job.warnings.join(' ')}`;
  if(!data){nflText(panel,'No completed preflight report is available. Existing paper records remain unchanged.');return;}
  nflText(panel,`Context coverage: ${data.summary.rostersLoaded}/${data.summary.teams} rosters; ${data.summary.expectedQbs}/${data.summary.teams} expected depth-chart QBs; official weekly injury-report teams ${data.summary.officialInjuryTeams}/${data.summary.teams}; team/opponent research ${data.summary.teamResearchLoaded}/${data.summary.teams}; average ${data.summary.averageCompleteness}% diagnostic completeness; verified official game-day availability ${data.summary.officialAvailability}/${data.summary.teams}. No model adjustment or recommendation was created.`);
  const sources=document.createElement('details'),sourceTitle=document.createElement('summary');sourceTitle.textContent='NFL context source status';sources.append(sourceTitle);
  for(const source of data.sourceRegistry.sources)nflText(sources,`${source.category} — ${source.sourceName}: ${source.lastResult}; configured ${source.configured?'yes':'no'}; last attempt ${source.lastAttempt?nflDisplayTime(source.lastAttempt):'never'}${source.failureReason?`; ${source.failureReason}`:''}.`);panel.append(sources);
  const games=document.createElement('details'),gameTitle=document.createElement('summary');gameTitle.textContent='Today’s game context';games.append(gameTitle);
  for(const game of data.games){nflText(games,`${game.event.awayTeam} @ ${game.event.homeTeam} — ${game.teams.map(team=>`${team.teamName}: ${team.roster.status==='SUCCESS'?'roster loaded':'roster needs review'}; expected QB ${team.qb.name??'unknown'} (not confirmed active); ${team.officialInjuryReport.listed===null?'official weekly report not posted':`${team.officialInjuryReport.listed} official weekly injury rows`}; context ${team.completeness}% complete`).join(' · ')}. Weather ${nflFriendlyStatus(game.weather.status)}; verified game-day availability ${nflFriendlyStatus(game.availability.status)}.`);}panel.append(games);
  const checklist=document.createElement('details'),checkTitle=document.createElement('summary');checkTitle.textContent='NFL implementation checklist 1–15';checklist.append(checkTitle);
  for(const item of data.readiness.items)nflText(checklist,`${item.id}. ${item.name} — ${nflFriendlyStatus(item.status)}: ${item.detail}`);panel.append(checklist);
}
function nflFriendlyStatus(value){const labels={SUCCESS:'ready',PARTIAL_SUCCESS:'partial',IMPLEMENTED:'ready',IMPLEMENTED_DIAGNOSTIC:'context only',PAPER_DIAGNOSTIC:'paper test only',
  PARTIAL:'partial',DIAGNOSTIC_ONLY:'context only',ACTIVE:'active',BLOCKED_SOURCE:'waiting for a reliable source',RESEARCH_REQUIRED:'research required',NOT_APPROVED:'not approved',QUOTE_ONLY:'prices only',
  NO_PROVIDER_CONFIGURED:'not connected',NO_SOURCE_ATTEMPTED:'not checked',SOURCE_RETURNED_EMPTY:'no data returned',SOURCE_FIELD_UNAVAILABLE:'data unavailable',SOURCE_HTTP_ERROR:'source unavailable',
  SOURCE_RATE_LIMITED:'source rate-limited',SOURCE_AUTH_FAILED:'source sign-in failed',PARSER_FAILED:'data could not be read',TEAM_MATCH_FAILED:'team match failed',VALIDATION_FAILED:'validation failed'};return labels[value]??String(value).toLowerCase().replaceAll('_',' ');}
function openNflForecast() {
  const board=document.getElementById('nfl-market-board');
  board.open=true;
  board.scrollIntoView({behavior:'smooth',block:'start'});
}
function nflDisplayTime(value) {
  return new Date(value).toLocaleString('en-US', {timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
}
function nflStatus(message) { document.getElementById('nfl-market-status').textContent = message; }
function nflClearQuotes() {
  nflQuotes = [];
  nflLoadedSelection = null;
  document.getElementById('nfl-research-results').replaceChildren();
  document.getElementById('nfl-research-results').classList.remove('nfl-forecast-card');
  document.getElementById('nfl-market-results').replaceChildren();
  document.getElementById('nfl-quote-count').textContent = '';
}
function updateNflCost() {
  nflClearQuotes();
  const selected = nflGroups.find(g => g.key === document.getElementById('nfl-group').value);
  document.getElementById('nfl-cost').textContent = selected
    ? `Up to ${selected.maxCredits} credits for this category / one game / US region. A cached repeat costs no new credits.`
    : 'Select a category.';
  nflStatus('Click Load posted odds when ready.');
}
async function nflFetch(url, options = {}) {
  const r = await fetch(url, { ...options, headers: { 'x-auth-token': authToken, 'Content-Type': 'application/json' } });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Please sign in again.'); }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'NFL feed request failed.');
  return data;
}
async function loadNflEvents() {
  if (nflBoardBusy) return;
  nflBoardBusy = true;
  const button = document.getElementById('nfl-events-btn');
  const quotesButton = document.getElementById('nfl-quotes-btn');
  button.disabled = true; quotesButton.disabled = true;
  nflClearQuotes(); nflStatus('Loading the NFL schedule (no odds credits)...');
  try {
    const data = await nflFetch('/api/nfl/events');
    nflGroups = data.groups;
    const games = document.getElementById('nfl-event');
    const groups = document.getElementById('nfl-group');
    games.replaceChildren(); groups.replaceChildren();
    for (const game of data.events) {
      const o = document.createElement('option'); o.value = game.id;
      o.textContent = `${game.awayTeam} @ ${game.homeTeam} — ${new Date(game.commenceTime).toLocaleString('en-US', {timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} CT`;
      games.append(o);
    }
    for (const group of data.groups) {
      const o = document.createElement('option'); o.value = group.key; o.textContent = group.label; groups.append(o);
    }
    groups.value = 'passing';
    updateNflCost();
    if (!data.events.length) {
      const o = document.createElement('option'); o.value = ''; o.textContent = 'No upcoming games in the next 14 days'; games.append(o);
      nflStatus('No upcoming NFL games in the next 14 days. No odds request was made.');
    } else {
      quotesButton.disabled = false;
      nflStatus(`${data.events.length} upcoming NFL games. Pick one and a market category; no odds have been pulled yet.`);
    }
  } catch (e) { nflStatus(e.message); }
  finally { button.disabled = false; nflBoardBusy = false; }
}
async function loadNflQuotes() {
  if (nflBoardBusy) return;
  const game = document.getElementById('nfl-event');
  const group = document.getElementById('nfl-group');
  if (!game.value || !group.value) { nflStatus('Select a game and category first.'); return; }
  nflBoardBusy = true;
  const button = document.getElementById('nfl-quotes-btn');
  button.disabled = true; game.disabled = true; group.disabled = true;
  nflClearQuotes(); nflStatus('Loading posted bookmaker prices...');
  try {
    const data = await nflFetch('/api/nfl/markets', { method:'POST', body:JSON.stringify({eventId:game.value,group:group.value}) });
    nflQuotes = data.quotes.map((q,i)=>({...q,marketBaseline:data.marketBaselines?.[i]}));
    nflLoadedSelection = {eventId:game.value,group:group.value};
    const stamp = nflDisplayTime(data.fetchedAt);
    const context = `${data.event.awayTeam} @ ${data.event.homeTeam} • ${data.label} • ${data.cached?'Cached':'Fetched'} ${stamp} • Credits remaining at fetch: ${data.remainingCredits ?? 'unknown'}.`;
    const missing = data.missingMarkets.length ? ` No quotes returned for: ${data.missingMarkets.map(m=>m.replace(/_/g,' ')).join(', ')}.` : '';
    nflStatus(context + (data.quotes.length ? ' Quotes only — not model recommendations.' : ' No prices posted in the feed for this category. This is not a "no edge" conclusion.') + missing + (data.paperWarning ? ` ${data.paperWarning}` : ''));
    renderNflQuotes();
  } catch (e) { nflStatus(e.message); }
  finally { nflBoardBusy = false; button.disabled = false; game.disabled = false; group.disabled = false; }
}
function renderNflQuotes() {
  const query = document.getElementById('nfl-market-search').value.toLowerCase().trim();
  const rows = nflQuotes.filter(q => `${q.market.replace(/_/g,' ')} ${q.participant} ${q.side} ${q.book}`.toLowerCase().includes(query))
    .sort((a,b)=>Number(nflCore.has(b.market))-Number(nflCore.has(a.market)));
  const forecastRows=rows.filter(q=>nflCore.has(q.market)).length;
  document.getElementById('nfl-quote-count').textContent = `${rows.length} matching quotes (${nflQuotes.length} total). ${forecastRows?`${forecastRows} core-prop quotes with forecast controls, shown first.`:'No supported core-prop quotes match this view. Choose Passing props or Rushing & receiving props, or clear the search filter; availability varies.'} Showing up to 250; filter to narrow. Lines and periods are kept separate. Yellow timestamps need a fresh sportsbook check.`;
  const table = document.createElement('table'); table.className = 'market-table';
  const header = document.createElement('thead'); const hr = document.createElement('tr');
  for (const label of ['Forecast / paper','Market / period','Player / team','Selection','Line','Odds','Sportsbook','Updated','Market baseline (not model)']) {
    const th = document.createElement('th'); th.textContent = label; if(label==='Forecast / paper')th.className='nfl-actions'; hr.append(th);
  }
  header.append(hr); table.append(header);
  const body = document.createElement('tbody');
  for (const q of rows.slice(0,250)) {
    const tr = document.createElement('tr');
    const age = Date.now() - Date.parse(q.updatedAt ?? '');
    const stale = !Number.isFinite(age) || age > 15*60_000 || age < -60_000;
    const values = [q.market.replace(/_/g,' '),q.participant || '—',q.side,q.line ?? '—',q.price > 0 ? `+${q.price}` : q.price,q.book,q.updatedAt ? nflDisplayTime(q.updatedAt) : 'Unknown'];
    const baseline=q.marketBaseline;
    values.push(baseline?.conditionalNoPushProbability!=null
      ? `${nflPct(baseline.conditionalNoPushProbability)} conditional on no push · ${baseline.referenceBooks.length} other books · not validated EV`
      : 'Unavailable: needs exact two-sided prices from 3 other books.');
    values.forEach((value,i) => { const td=document.createElement('td'); td.textContent=String(value); if(i===6&&stale)td.className='market-stale'; tr.append(td); });
    const actions = document.createElement('td'); actions.className='nfl-actions';
    if (nflCore.has(q.market)) {
      const f = document.createElement('button'); f.textContent='Forecast + track'; f.className='nfl-forecast-action'; f.disabled=stale; f.onclick=()=>nflQuoteAction(q,'forecast'); actions.append(f);
      const b = document.createElement('button'); b.textContent='History'; b.onclick=()=>nflQuoteAction(q,'research'); actions.append(b);
    }
    if(nflCore.has(q.market)||/^(h2h|spreads|totals)(_(q[1-4]|h[12]))?$/.test(q.market)) {
      const b=document.createElement('button'); b.textContent='Save paper'; b.disabled=stale; b.onclick=()=>nflQuoteAction(q,'paper'); actions.append(b);
    }
    if(!actions.children.length)actions.textContent='Quote only';
    tr.prepend(actions);
    body.append(tr);
  }
  table.append(body); document.getElementById('nfl-market-results').replaceChildren(table);
}
document.getElementById('nfl-event').addEventListener('change', () => { nflClearQuotes(); nflStatus('Game changed. Load posted odds to view this matchup.'); });

function nflText(parent, text) { const p=document.createElement('p'); p.textContent=text; parent.append(p); }
function nflFixed(value, digits=1) { return value==null?'unavailable':Number(value).toFixed(digits); }
async function nflQuoteAction(q, action) {
  if(nflActionBusy||!nflLoadedSelection)return;
  if((action==='paper'||action==='forecast')&&!document.getElementById('nfl-paper-rules').checked){nflStatus('Please check the paper-rules box above the quotes first.');document.getElementById('nfl-paper-rules').focus();return;}
  const selection={...nflLoadedSelection,quoteId:q.quoteId};
  const panel=document.getElementById('nfl-research-results');
  panel.classList.remove('nfl-forecast-card');
  nflActionBusy=true; panel.replaceChildren(); nflText(panel,action==='paper'?'Verifying game/player identity and saving paper pick...':action==='forecast'?'Building the experimental workload forecast, testing earlier-game predictions, and logging only an eligible paper selection...':'Loading NFL roster and regular-season observations...');
  try {
    const data=await nflFetch(`/api/nfl/${action}`,{method:'POST',body:JSON.stringify({...selection,rules:'regulation-periods_full-game-includes-ot_v1'})});
    if(!nflLoadedSelection||selection.eventId!==nflLoadedSelection.eventId||selection.group!==nflLoadedSelection.group)return;
    panel.replaceChildren();
    if(action==='forecast') {
      renderNflForecast(panel,data);
      panel.scrollIntoView({behavior:'smooth',block:'start'});
      await loadNflPaper(false);
    } else if(action==='paper') {
      nflText(panel,`${data.duplicate?'Already tracked; no duplicate saved.':'Paper pick saved. No real bet placed.'} ${q.participant||q.side} — ${q.market.replace(/_/g,' ')} ${q.side} ${q.line??''} at ${q.book}.`);
      await loadNflPaper(false);
    } else {
      nflText(panel,`${data.player.name} · ${data.player.team} · ${data.player.position} · roster status ${data.player.rosterStatus}. Roster fetched ${nflDisplayTime(data.player.fetchedAt)}.`);
      nflText(panel,`${data.market.replace(/_/g,' ')} — historical comparison at line ${data.line}; not a projection.`);
      nflText(panel,data.depth.rows.length?`Provisional depth chart: ${data.depth.rows.map(d=>`${d.position.toUpperCase()} listed #${d.listedOrder} in ${d.formation}`).join('; ')}. Not confirmed game-day starters.`:'Depth-chart position unavailable; no starting role assumed.');
      for(const s of data.seasons) nflText(panel,`${s.season} regular season: ${s.games} numeric game rows; mean ${nflFixed(s.mean)}, median ${nflFixed(s.median)}. At this line: ${s.over} over / ${s.under} under / ${s.pushes} push. ${s.otherTeamGames} rows for other teams. Last game: ${s.latestGame?nflDisplayTime(s.latestGame):'none'}.`);
      for(const s of data.seasons) nflText(panel,`${s.season} usage context: ${nflFixed(s.meanOpportunities)} ${data.opportunityLabel} per recorded game (${s.opportunityGames} rows). No snap-share or role adjustment.`);
      for(const w of data.warnings)nflText(panel,w);
      for(const s of data.seasons){const a=document.createElement('a');a.href=s.source;a.textContent=`ESPN ${s.season} source`;a.target='_blank';a.rel='noopener';panel.append(a,document.createTextNode(' · '));}
    }
  } catch(e){ panel.replaceChildren(); nflText(panel,e.message); }
  finally{nflActionBusy=false;}
}
function nflPct(value){return value==null?'unavailable':`${(value*100).toFixed(1)}%`;}
function renderNflForecast(panel,data) {
  panel.replaceChildren(); panel.classList.add('nfl-forecast-card');
  const f=data.forecast,pick=data.pick;
  nflText(panel,pick?`${data.status==='already_tracked'?'Previously issued; original pick unchanged.':'EXPERIMENTAL PAPER RECOMMENDATION — automatically saved.'} ${pick.quote.participant} ${pick.quote.side} ${pick.quote.line} ${pick.quote.market.replace(/_/g,' ')} at ${pick.quote.book} (${pick.quote.price>0?'+':''}${pick.quote.price}).`:'NO PAPER RECOMMENDATION — see the checks below.');
  nflText(panel,`${f.player.name} · ${f.player.team} · ${f.version} · inputs ${nflDisplayTime(f.asOf)}. ${data.books?`Configured books: ${data.books.join(', ')}`:`Original selected sportsbook: ${pick.quote.book}`}.`);
  nflText(panel,`Projected stat: ${nflFixed(f.point?.projection)}. Expected attempts/targets: ${nflFixed(f.point?.workload)}. Production per opportunity: ${nflFixed(f.point?.efficiency,2)}. ${f.usableGames} usable same-team games; ${f.currentSeasonGames} this season; ${f.excludedGames} rows excluded.`);
  nflText(panel,`Earlier-game diagnostic: ${f.evaluation.games} rolling forecasts; average absolute error ${nflFixed(f.evaluation.mae)} versus simple-average error ${nflFixed(f.evaluation.baselineMae)}. Smaller error is better. ${f.evaluation.note}`);
  if(f.workloadContext) {
    const w=f.workloadContext;
    nflText(panel,`Verified recent workload context: ${w.verifiedGames}/${w.requestedGames} listed games; share of team attempts/targets ${nflPct(w.pooledOpportunityShare)}; team attempts/targets per game ${nflFixed(w.meanTeamOpportunities)}.`);
    nflText(panel,w.note);
    const context=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Show verified workload games and missing sources';context.append(heading);
    for(const r of w.rows)nflText(context,`${nflDisplayTime(r.date)} · ${r.opportunity}/${r.teamOpportunity} attempts/targets (${nflPct(r.share)}) · ESPN game ${r.eventId}; retrieved ${nflDisplayTime(r.fetchedAt)}.`);
    for(const r of w.unavailable)nflText(context,`${r.eventId}: ${r.reason}`);
    panel.append(context);
  }
  if(f.snapContext){const s=f.snapContext;nflText(panel,s.recent.length?`Snap-share context: ${s.recent.length} recent recorded games; mean offensive snap share ${nflPct(s.meanRecentOffensePct)}. Current season ${s.current.length} games; prior season ${s.prior.length}. Diagnostic only—no forecast adjustment.`:`Snap-share context: ${s.note}`);
    if(s.recent.length){const detail=document.createElement('details'),title=document.createElement('summary');title.textContent='Show snap-share observations';detail.append(title);for(const row of s.recent)nflText(detail,`${row.date.slice(0,10)} · ${row.team} vs ${row.opponent} · ${row.offenseSnaps} offensive snaps (${nflPct(row.offensePct)}).`);nflText(detail,s.note);panel.append(detail);}}
  if(f.officialInjuryContext){const i=f.officialInjuryContext;if(i.playerRows.length)for(const row of i.playerRows)nflText(panel,`Official weekly injury report: ${row.injury||'injury not stated'}; practice ${row.practiceStatus||'not stated'}; game status ${row.gameStatus||'not stated'}. This is not the game-day inactive list.`);
    else nflText(panel,`Official weekly injury report: ${i.teamRows===null?'team table not posted/verified':`team table checked; player not listed among ${i.teamRows} rows`}. Absence does not confirm active status.`);}
  if(pick){
    nflText(panel,`Stored experimental win estimate: ${nflPct(pick.modelProbability)}; push estimate: ${nflPct(pick.modelPushProbability)}; estimated profit per unit risk: ${nflFixed(pick.estimatedEV,3)}. These estimates are uncalibrated, not demonstrated win rates or returns.`);
    nflText(panel,`Tracking ID ${pick.id}; issued ${nflDisplayTime(pick.savedAt)}; result ${pick.result}. No real bet was placed.`);
  }
  for(const reason of f.reasons)nflText(panel,`Blocked: ${reason}`);
  if(!pick&&f.reasons.length===0){
    const reasons=[...new Set(data.assessments.flatMap(a=>a.reasons))];
    for(const reason of reasons)nflText(panel,`Quote check: ${reason}`);
  }
  for(const warning of f.warnings)nflText(panel,warning);
  if(f.coverage) {
    nflText(panel,`Data coverage: ${f.coverage.playerIdentity} ${f.coverage.availability} ${f.coverage.workload}`);
    nflText(panel,`Not connected or modeled: ${f.coverage.missingFeatures.join(', ')}.`);
  }
  if(data.evidence)nflText(panel,`This forecast attempt (including blocked checks) was archived: ${data.evidence.hash}.`);
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Audit: locked source games and rolling forecast tests';details.append(summary);
  for(const t of f.evaluation.tests)nflText(details,`${t.eventId} · ${nflDisplayTime(t.date)}: forecast ${nflFixed(t.prediction)}, actual ${t.actual}, baseline ${nflFixed(t.baseline)}; training through ${nflDisplayTime(t.trainingThrough)}.`);
  nflText(details,`Input fingerprint: ${f.dataHash}`);panel.append(details);
}
let nflPaperBusy=false;
async function loadNflPaper(grade) {
  if(nflPaperBusy)return;
  nflPaperBusy=true;
  const status=document.getElementById('nfl-paper-status'),panel=document.getElementById('nfl-paper-results');
  status.textContent=grade?'Checking up to ten completed NFL games...':'Loading separate NFL paper record...';
  try {
    const data=await nflFetch(grade==='recheck'?'/api/nfl/paper/recheck':grade?'/api/nfl/paper/grade':'/api/nfl/paper',grade?{method:'POST'}:{});
    panel.replaceChildren();
    status.textContent=`${data.picks.length} paper selections. ${grade?`${data.checked} checked; ${data.remainingGames} additional games awaiting another grading run. ${data.sourceFailures??0} unable-to-grade source failures; settled results are retained on an outage. `:''}${data.report.note}`;
    for(const b of data.report.buckets)nflText(panel,`${b.season} · ${b.origin==='model'?'MODEL PAPER':'MANUAL PAPER'} · ${b.market.replace(/_/g,' ')} · ${b.version}: ${b.wins}W–${b.losses}L–${b.pushes}P · ${b.voids??0} void · ${b.pending} pending · ${b.unableToGrade??0} unable to grade · ${b.legacyReview??0} legacy review · ${b.uniqueEvents} distinct games · ${nflFixed(b.profitUnits,2)} units · settled ROI ${b.roi==null?'unavailable':nflFixed(b.roi*100)+'%'}`);
    for(const m of data.metrics??[]) {
      nflText(panel,`${m.group}: probability-scored ${m.probabilityScored}; Brier ${nflFixed(m.multiclassBrier,3)}, log loss ${nflFixed(m.logLoss,3)} (lower is better). Drawdown ${nflFixed(m.maxDrawdownUnits,2)} units; ${m.distinctSettledGames} distinct settled games. This is not holdout validation.`);
      nflText(panel,`Final-five-minute observations: ${m.closeWindowCaptured} captured, ${m.closeWindowMissed} missed after kickoff. Not verified final closing prices. ${m.settlementRevisions} audited settlement revisions. Game-cluster ROI interval: ${m.approximateGameClusterRoiInterval?m.approximateGameClusterRoiInterval.map(nflPct).join(' to '):'insufficient games'}.`);
      const bins=m.calibration.filter(b=>b.count);
      if(bins.length)nflText(panel,'Calibration (non-push): '+bins.map(b=>`${b.count} picks: predicted ${nflPct(b.meanPredictedNonPush)}, observed ${nflPct(b.observedNonPushWinRate)}`).join('; ')+'. Small/correlated samples remain uncertain.');
    }
    if(data.forwardGate){
      const gate=document.createElement('details'),title=document.createElement('summary');title.textContent='Forward evidence gates for the four core props';gate.append(title);
      nflText(gate,'These gates were frozen before 2026 results. Passing permits a separate research review only—never real-money betting or Kelly staking.');
      for(const market of data.forwardGate.markets){
        const failed=market.checks.filter(check=>!check.pass).map(check=>`${check.id.replace(/_/g,' ')} ${JSON.stringify(check.value)} (needs ${check.required})`);
        nflText(gate,`${market.market.replace(/_/g,' ')} — ${market.status.replace(/_/g,' ')}. ${market.settled} settled picks across ${market.distinctGames} games; model MAE ${nflFixed(market.modelMae)} vs simple average ${nflFixed(market.baselineMae)}; binary Brier ${nflFixed(market.binaryBrier,3)}; observed late quotes ${market.observedCloseWindows}, verified closes ${market.verifiedCloses}. ${failed.length?`Still needed: ${failed.join('; ')}.`:'All frozen checks passed; independent review is still required.'}`);
      }
      nflText(gate,data.forwardGate.note);panel.append(gate);
    }
    const table=document.createElement('table');table.className='market-table';
    const header=document.createElement('tr');for(const title of ['Origin / model','Game','Selection','Saved price / book','Result','Latest pregame line / price','Notes']){const th=document.createElement('th');th.textContent=title;header.append(th);}table.append(header);
    for(const p of [...data.picks].reverse().slice(0,100)){
      const row=document.createElement('tr');
      const values=[`${p.origin==='model'?'MODEL PAPER':'MANUAL PAPER'} / ${p.version}${p.compatibility?.schema==='LEGACY'?' / LEGACY provenance':''}`,`${p.event.awayTeam} @ ${p.event.homeTeam} · ${nflDisplayTime(p.event.commenceTime)}`,`${p.quote.market} ${p.quote.participant} ${p.quote.side} ${p.quote.line??''}`,`${p.quote.price>0?'+':''}${p.quote.price} / ${p.quote.book}`,p.result,p.latestPregame?`${p.latestPregame.line??p.quote.line??''} at ${p.latestPregame.price} · ${nflDisplayTime(p.latestPregame.updatedAt)} (not a verified closing line)`:'Not captured',p.note];
      for(const value of values){const td=document.createElement('td');td.textContent=value;row.append(td);}
      if(p.origin==='model'&&p.forecast){
        const button=document.createElement('button');button.textContent='View original forecast';
        button.onclick=()=>{const card=document.getElementById('nfl-research-results');renderNflForecast(card,{status:'already_tracked',pick:p,forecast:p.forecast,assessments:[]});card.scrollIntoView({behavior:'smooth',block:'start'});};
        row.firstChild.append(document.createElement('br'),button);
      }
      if(p.gradingAudit?.length){
        const replay=document.createElement('button');replay.textContent='Verify saved grading';
        replay.onclick=async()=>{
          replay.disabled=true;
          try {
            const audit=await nflFetch(`/api/nfl/paper/${encodeURIComponent(p.id)}/replay`);
            status.textContent=`${audit.audits.map(a=>`${nflDisplayTime(a.checkedAt)}: ${a.savedResult} — ${a.status.replace(/_/g,' ')}`).join('; ')}. ${audit.note}`;
          }catch(e){status.textContent=e.message;}finally{replay.disabled=false;}
        };
        row.firstChild.append(document.createElement('br'),replay);
      }
      table.append(row);
    }panel.append(table);
    if(data.picks.length>100)nflText(panel,'Showing latest 100 selections. Summary includes the full paper ledger.');
  }catch(e){status.textContent=e.message;}finally{nflPaperBusy=false;}
}
async function exportNflPaper() {
  const status=document.getElementById('nfl-paper-status');
  try {
    const data=await nflFetch('/api/nfl/paper/export');
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download=`nfl-paper-record-${data.exportedAt.slice(0,10)}.json`;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status.textContent=`Exported ${data.picks.length} NFL paper picks and ${Object.keys(data.evidence).length} grading source snapshots. ${data.missingEvidence.length} source snapshots missing/corrupt; ${data.omittedEvidence?.length??0} omitted by the 25 MiB source limit (use a server-disk backup for those). Original records unchanged; keep this file private.`;
  }catch(e){status.textContent=e.message;}
}
