// On-demand college quotes only. Never issue picks from this board.
let collegeQuotes = [];
let collegeBusy = false;
function openCollegeBoard() {
  const board = document.getElementById('college-market-board');
  board.open = true; board.scrollIntoView({behavior:'smooth',block:'start'});
}
function collegeStatus(message) { document.getElementById('college-status').textContent = message; }
function clearCollegeSelection() {
  collegeQuotes = [];
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
    collegeStatus(`${data.event.awayTeam} @ ${data.event.homeTeam} • ${data.cached?'Cached':'Fetched'} ${nflDisplayTime(data.fetchedAt)} • Credits remaining at fetch: ${data.remainingCredits ?? 'unknown'}. `
      + (data.quotes.length ? 'Posted prices only; no pick has been saved.' : 'No prices posted in the feed for this game. This is not a no-edge conclusion.')
      + (data.missingMarkets.length ? ` No quotes returned for: ${data.missingMarkets.join(', ')}.` : ''));
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
  for (const label of ['Market','Team / selection','Line','Odds','Sportsbook','Updated']) {
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
    body.append(row);
  }
  table.append(body); document.getElementById('college-results').replaceChildren(table);
}
