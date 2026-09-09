import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const html=fs.readFileSync(path.join(__dirname,'../../public/index.html'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'../../public/nfl-markets.js'),'utf8');
class Element {
  children:Element[]=[]; textContent=''; className=''; value=''; disabled=false; checked=false;
  open=false; scrolled=false; focused=false; onclick?:()=>void;
  classList={remove:()=>{},add:()=>{}};
  append(...elements:Element[]){this.children.push(...elements);}
  prepend(...elements:Element[]){this.children.unshift(...elements);}
  replaceChildren(...elements:Element[]){this.children=elements;}
  addEventListener(){}
  scrollIntoView(){this.scrolled=true;}
  focus(){this.focused=true;}
}
function ui(){
  const elements=new Map<string,Element>();
  const document={getElementById:(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element()};
  const context=vm.createContext({document,Date,Set,console});
  vm.runInContext(source,context);
  return {document,run:(code:string)=>vm.runInContext(code,context)};
}
test('main menu visibly names Forecast + track and opens the guide without buying odds',()=>{
  assert.match(html,/id="nfl-forecast-open"[^>]*onclick="openNflForecast\(\)"[^>]*>.*Forecast \+ track<\/button>/);
  assert.equal((html.match(/id="nfl-paper-rules"/g)||[]).length,1);
  assert.ok(html.indexOf('id="nfl-paper-rules"')<html.indexOf('id="nfl-market-results"'));
  const app=ui();app.run('openNflForecast()');
  assert.equal(app.document.getElementById('nfl-market-board').open,true);
  assert.equal(app.document.getElementById('nfl-market-board').scrolled,true);
});
test('forecast action is first and prominent for core props; specialty rows stay quote-only',()=>{
  const app=ui();app.run(`nflQuotes=['player_anytime_td','player_pass_yds','player_rush_yds','player_reception_yds','player_receptions'].map((market,i)=>({quoteId:String(i),market,participant:'Test Player',side:'Over',line:10.5,price:-110,book:'Test book',updatedAt:new Date().toISOString()}));renderNflQuotes();`);
  const table=app.document.getElementById('nfl-market-results').children[0];
  assert.equal(table.children[0].children[0].children[0].textContent,'Forecast / paper');
  const rows=table.children[1].children;
  for(const row of rows.slice(0,4)){
    const actions=row.children[0];assert.equal(actions.className,'nfl-actions');
    assert.equal(actions.children[0].textContent,'Forecast + track');
    assert.equal(actions.children[0].className,'nfl-forecast-action');
    assert.equal(actions.children[0].disabled,false);
  }
  assert.equal(rows[4].children[0].textContent,'Quote only');
  app.run(`nflQuoteAction=(q,action)=>{document.getElementById('test-call').textContent=q.quoteId+':'+action;}`);
  rows[0].children[0].children[0].onclick();
  assert.equal(app.document.getElementById('test-call').textContent,'1:forecast');
  assert.match(app.document.getElementById('nfl-quote-count').textContent,/4 core-prop quotes/);
});
test('stale quotes disable forecasting and missing rules focus the visible checkbox without a request',async()=>{
  const app=ui();app.run(`nflQuotes=[{quoteId:'stale',market:'player_pass_yds',participant:'Test',side:'Over',line:10.5,price:-110,book:'Test',updatedAt:null}];renderNflQuotes();nflLoadedSelection={eventId:'test',group:'passing'};`);
  const table=app.document.getElementById('nfl-market-results').children[0];
  assert.equal(table.children[1].children[0].children[0].children[0].disabled,true);
  await app.run(`nflQuoteAction(nflQuotes[0],'forecast')`);
  assert.match(app.document.getElementById('nfl-market-status').textContent,/above the quotes/);
  assert.equal(app.document.getElementById('nfl-paper-rules').focused,true);
});

test('exact market baseline is visibly separate from a model forecast',()=>{
  const app=ui();
  app.run(`nflQuotes=[{quoteId:'q',market:'player_receptions',participant:'Test',side:'Over',line:4.5,price:-110,
    book:'Test',updatedAt:new Date().toISOString(),marketBaseline:{conditionalNoPushProbability:.5,referenceBooks:[1,2,3]}}];renderNflQuotes();`);
  const row=app.document.getElementById('nfl-market-results').children[0].children[1].children[0];
  assert.match(row.children.at(-1).textContent,/50.0% conditional on no push/);
  assert.match(row.children.at(-1).textContent,/not validated EV/);
});

test('stat-correction control calls the audit endpoint and renders empty records safely',async()=>{
  const app=ui();
  app.run(`nflFetch=async(url,options)=>{document.getElementById('called-endpoint').textContent=url;return {picks:[],checked:0,remainingGames:0,report:{note:'fixture',buckets:[]},metrics:[]};};`);
  await app.run("loadNflPaper('recheck')");
  assert.equal(app.document.getElementById('called-endpoint').textContent,'/api/nfl/paper/recheck');
  assert.match(app.document.getElementById('nfl-paper-status').textContent,/0 checked/);
});

test('all 15 NFL readiness items and specialty restrictions remain visible and honest',()=>{
  const section=html.split('id="football-readiness"')[1].split('</details>')[0];
  assert.equal((section.match(/<li>/g)||[]).length,15);
  assert.match(section,/free official NFL weekly injury report loads/i);
  assert.match(section,/NFL probabilities are not calibrated/);
  assert.doesNotMatch(html,/onclick="runCmd\('(firsttd|sgp-nfl|altparlays-nfl|teasers)'/);
});

test('one-click NFL preflight is prominent and states that it spends no odds credits',()=>{
  assert.match(html,/id="nfl-today-open"[^>]*onclick="runNflToday\(\)"/);
  assert.match(html,/id="nfl-today-btn"[^>]*onclick="runNflToday\(\)"[^>]*>Run NFL daily preflight \+ grade \(free\)/);
  assert.match(source,/\/api\/nfl\/today/);assert.match(source,/Odds credits: 0/);assert.match(source,/predictiveBoard/);assert.match(html,/predictability grade is relative evidence strength—not win probability/i);
  assert.match(source,/waiting for a reliable source/);assert.match(source,/not confirmed active/);
  assert.match(source,/team\/opponent research/);assert.match(source,/Snap-share context/);assert.match(source,/no forecast adjustment/);
});

test('NFL daily rendering puts predicted score and 60-plus ranking ahead of diagnostics',()=>{
  const app=ui();app.run(`renderNflPredictiveBoard(document.getElementById('board'),{gradeMeaning:'Grade is not probability.',topOverall:[],bestByType:{},games:[{gameId:'g',matchup:'Away @ Home',kickoff:'2026-09-10T00:20:00Z',source:'FORWARD_ARCHIVE',capturedAt:'2026-09-09T03:00:00Z',forecast:{status:'PROJECTED',awayScore:20,homeScore:27,winner:'Home',homeMargin:7,total:47,version:'locked',reconciliation:'midpoint'},projectedWinnerStrength:'MODERATE',gameScript:'Home ahead.',bestGameAngle:null,spread:null,moneyline:null,total:null,teamTotals:[],playerProps:[],sgps:[],derivatives:[],dataQuality:'PARTIAL',keyRisks:['QB pending']}],gradeDistribution:{'60-69':0,'70-77':0,'78-84':0,'85-89':0,'90-100':0},below60:3,diagnostics:[],collection:{mode:'MANUAL_ONLY',scheduled:'DISABLED_BY_CONFIGURATION',newPaidProviderCalls:0,newPaidCredits:0}});`);
  const board=app.document.getElementById('board').children[0];assert.equal(board.children[0].textContent,'NFL PREDICTIVE BOARD');
  const card=board.children.find(child=>child.className==='nfl-game-prediction');assert.match(card.children.find(child=>child.className==='nfl-predicted-score').textContent,/Away 20 — Home 27/);
  assert.match(board.children[1].textContent,/not probability/);
});
