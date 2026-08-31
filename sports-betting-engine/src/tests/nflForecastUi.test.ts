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
  classList={remove:()=>{}};
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
