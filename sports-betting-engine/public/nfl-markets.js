// Quote-only explorer. No background odds pulls, pick logging or estimated probabilities.
let nflQuotes = [];
let nflGroups = [];
let nflBoardBusy = false;
function nflDisplayTime(value) {
  return new Date(value).toLocaleString('en-US', {timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
}
function nflStatus(message) { document.getElementById('nfl-market-status').textContent = message; }
function nflClearQuotes() {
  nflQuotes = [];
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
    nflQuotes = data.quotes;
    const stamp = nflDisplayTime(data.fetchedAt);
    const context = `${data.event.awayTeam} @ ${data.event.homeTeam} • ${data.label} • ${data.cached?'Cached':'Fetched'} ${stamp} • Credits remaining at fetch: ${data.remainingCredits ?? 'unknown'}.`;
    const missing = data.missingMarkets.length ? ` No quotes returned for: ${data.missingMarkets.map(m=>m.replace(/_/g,' ')).join(', ')}.` : '';
    nflStatus(context + (data.quotes.length ? ' Quotes only — not model recommendations.' : ' No prices posted in the feed for this category. This is not a "no edge" conclusion.') + missing);
    renderNflQuotes();
  } catch (e) { nflStatus(e.message); }
  finally { nflBoardBusy = false; button.disabled = false; game.disabled = false; group.disabled = false; }
}
function renderNflQuotes() {
  const query = document.getElementById('nfl-market-search').value.toLowerCase().trim();
  const rows = nflQuotes.filter(q => `${q.market.replace(/_/g,' ')} ${q.participant} ${q.side} ${q.book}`.toLowerCase().includes(query));
  document.getElementById('nfl-quote-count').textContent = `${rows.length} matching quotes (${nflQuotes.length} total). Showing up to 250; filter to narrow. Lines and periods are kept separate. Yellow timestamps need a fresh sportsbook check.`;
  const table = document.createElement('table'); table.className = 'market-table';
  const header = document.createElement('thead'); const hr = document.createElement('tr');
  for (const label of ['Market / period','Player / team','Selection','Line','Odds','Sportsbook','Updated']) {
    const th = document.createElement('th'); th.textContent = label; hr.append(th);
  }
  header.append(hr); table.append(header);
  const body = document.createElement('tbody');
  for (const q of rows.slice(0,250)) {
    const tr = document.createElement('tr');
    const age = Date.now() - Date.parse(q.updatedAt ?? '');
    const stale = !Number.isFinite(age) || age > 15*60_000 || age < -60_000;
    const values = [q.market.replace(/_/g,' '),q.participant || '—',q.side,q.line ?? '—',q.price > 0 ? `+${q.price}` : q.price,q.book,q.updatedAt ? nflDisplayTime(q.updatedAt) : 'Unknown'];
    values.forEach((value,i) => { const td=document.createElement('td'); td.textContent=String(value); if(i===6&&stale)td.className='market-stale'; tr.append(td); });
    body.append(tr);
  }
  table.append(body); document.getElementById('nfl-market-results').replaceChildren(table);
}
document.getElementById('nfl-event').addEventListener('change', () => { nflClearQuotes(); nflStatus('Game changed. Load posted odds to view this matchup.'); });
