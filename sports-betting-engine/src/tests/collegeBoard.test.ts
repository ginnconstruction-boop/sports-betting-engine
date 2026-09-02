import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { CollegeMarketBoard } from '../services/collegeMarketBoard';
import { NCAAF, NFL } from '../config/productionFocus';
import { RawEvent } from '../types/odds';
const now = Date.parse('2026-08-31T12:00:00Z');
const game = {id:'college1',sportKey:NCAAF,homeTeam:'Home',awayTeam:'Away',commenceTime:'2026-09-05T18:00:00Z'};
const quota = {remainingRequests:19900,usedRequests:100,requestsMade:1};
const raw = (overrides: Partial<RawEvent> = {}): RawEvent => ({id:game.id,sport_key:NCAAF,sport_title:'College football',
  home_team:game.homeTeam,away_team:game.awayTeam,commence_time:game.commenceTime,bookmakers:[{
    key:'fanduel',title:'FanDuel',last_update:new Date(now).toISOString(),markets:[
      {key:'spreads',last_update:new Date(now).toISOString(),outcomes:[{name:'Home',point:-3.5,price:-110},{name:'Away',point:3.5,price:-110},{name:'Bad team',point:3,price:-110}]},
      {key:'totals',last_update:new Date(now).toISOString(),outcomes:[{name:'Over',point:45.5,price:-110},{name:'Under',point:45.5,price:-110},{name:'Over',price:-110}]},
      {key:'h2h',last_update:new Date(now).toISOString(),outcomes:[{name:'Home',price:-150}]},
      {key:'player_pass_yds',last_update:new Date(now).toISOString(),outcomes:[{name:'Over',description:'Player',point:200.5,price:-110}]},
    ]}],...overrides});
test('college discovery excludes NFL, past and distant games without buying odds',async()=>{
  let calls=0; const board=new CollegeMarketBoard({now:()=>now,upcoming:async()=>[game,{...game,id:'nfl',sportKey:NFL},
    {...game,id:'past',commenceTime:new Date(now).toISOString()},{...game,id:'far',commenceTime:'2026-10-01T00:00:00Z'}],
    odds:async()=>{calls++;return {event:raw(),quota};}});
  assert.deepEqual((await board.events()).map(e=>e.id),['college1']);
  for(const id of ['nfl','past','far','../bad'])await assert.rejects(()=>board.quotes(id));
  assert.equal(calls,0);
});
test('college quotes enforce exact market scope, valid lines and five-minute cache',async()=>{
  let clock=now,calls=0; const board=new CollegeMarketBoard({now:()=>clock,upcoming:async()=>[game],odds:async(id,markets)=>{
    assert.equal(id,game.id);assert.deepEqual(markets,['spreads','totals']);calls++;return {event:raw(),quota};}});
  const first=await board.quotes(game.id); assert.equal(first.quotes.length,4);assert.equal(first.cached,false);
  assert.equal((await board.quotes(game.id)).cached,true);assert.equal(calls,1);
  clock+=5*60_000;assert.equal((await board.quotes(game.id)).cached,false);assert.equal(calls,2);
  clock=Date.parse(game.commenceTime);await assert.rejects(()=>board.quotes(game.id),/upcoming/);
});
test('college missing feed, wrong identity, started games and unposted markets are explicit',async()=>{
  const deps={now:()=>now,upcoming:async()=>[game]};
  for(const event of [null,raw({id:'wrong'}),raw({sport_key:NFL}),raw({home_team:'wrong'}),raw({commence_time:new Date(now).toISOString()})]) {
    await assert.rejects(()=>new CollegeMarketBoard({...deps,odds:async()=>({event,quota})}).quotes(game.id));
  }
  const empty=await new CollegeMarketBoard({...deps,odds:async()=>({event:raw({bookmakers:[]}),quota})}).quotes(game.id);
  assert.equal(empty.status,'not_posted');assert.deepEqual(empty.missingMarkets,['spreads','totals']);
});
test('college simultaneous identical requests coalesce; another game cannot fan out',async()=>{
  let calls=0,release:()=>void;const gate=new Promise<void>(r=>{release=r;});
  const board=new CollegeMarketBoard({now:()=>now,upcoming:async()=>[game,{...game,id:'second'}],odds:async()=>{
    calls++;await gate;return {event:raw(),quota};}});
  await board.events();const a=board.quotes(game.id),b=board.quotes(game.id);
  await new Promise(r=>setImmediate(r));await assert.rejects(()=>board.quotes('second'),/Another college/);
  release();await Promise.all([a,b]);assert.equal(calls,1);
});
class Element {
  children:Element[]=[];textContent='';className='';value='';disabled=false;open=false;scrolled=false;
  append(...items:Element[]){this.children.push(...items);if(!this.value&&items[0]?.value)this.value=items[0].value;}
  replaceChildren(...items:Element[]){this.children=items;this.value='';}
  scrollIntoView(){this.scrolled=true;}
}
function ui(fetcher:(url:string,options?:any)=>Promise<any>){
  const elements=new Map<string,Element>();
  const document={getElementById:(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element()};
  const ctx=vm.createContext({document,Date,nflFetch:fetcher,nflDisplayTime:(s:string)=>s,
    nflText:(parent:Element,text:string)=>{const p=new Element();p.textContent=text;parent.append(p);}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../public/college-markets.js'),'utf8'),ctx);
  return {document,run:(code:string)=>vm.runInContext(code,ctx)};
}
test('college main-menu entry opens its own section without an API call',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../../public/index.html'),'utf8');
  assert.match(html,/id="college-open"[^>]*onclick="openCollegeBoard\(\)".*College football/);
  assert.match(html,/src="\/college-markets.js\?v=/);
  const app=ui(async()=>{throw Error('No API calls on open');});app.run('openCollegeBoard()');
  assert.equal(app.document.getElementById('college-market-board').open,true);
  assert.equal(app.document.getElementById('college-market-board').scrolled,true);
});
test('college UI discovers freely, loads only selected game, renders safely and clears old quotes',async()=>{
  const calls:string[]=[];const app=ui(async(url,options)=>{calls.push(url);
    if(url.endsWith('/events'))return {events:[game]};
    assert.equal(options.method,'POST');assert.equal(options.body,JSON.stringify({eventId:game.id}));
    return {event:game,quotes:[{market:'totals',side:'Over',line:45.5,price:-110,book:'<script>bad</script>',updatedAt:null}],
      fetchedAt:new Date(now).toISOString(),missingMarkets:['spreads']};});
  await app.run('loadCollegeEvents()');assert.deepEqual(calls,['/api/college/events']);
  assert.equal(app.document.getElementById('college-quotes-btn').disabled,false);
  await app.run('loadCollegeQuotes()');assert.equal(calls.length,2);
  const row=app.document.getElementById('college-results').children[0].children[1].children[0];
  assert.equal(row.children[4].textContent,'<script>bad</script>');assert.equal(row.children[5].className,'market-stale');
  app.run('clearCollegeSelection()');assert.equal(app.document.getElementById('college-results').children.length,0);
});
test('college empty/failed schedule leaves odds disabled',async()=>{
  for(const failed of [false,true]){
    const app=ui(async()=>{if(failed)throw Error('Unavailable');return {events:[]};});
    await app.run('loadCollegeEvents()');assert.equal(app.document.getElementById('college-quotes-btn').disabled,true);
    assert.equal(app.document.getElementById('college-events-btn').disabled,false);
  }
});

test('college full-day UI sends only date, hides game-list details, clears stale results and restores buttons on failure',async()=>{
  const html=fs.readFileSync(path.join(__dirname,'../../public/index.html'),'utf8');
  assert.match(html,/<details id="college-advanced"><summary>Optional:/);
  assert.doesNotMatch(html,/onclick="runCmd\('ncaaf'/);
  const calls:any[]=[];const app=ui(async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});
    return {date:'2026-09-03',providerGames:2,gamesWithFreshOdds:1,unmatchedScheduledGames:0,creditsUsed:2,cached:false,
      recommendationNote:'Not a betting recommendation',warnings:[],shortlist:[],counts:{no_price_candidate:1},rows:[],unlisted:[],evidenceSaved:true,note:''};});
  app.document.getElementById('college-scan-date').value='2026-09-03';
  app.document.getElementById('college-event').value='irrelevant-game';
  await app.run('runCollegeDayScan()');assert.deepEqual(calls,[{url:'/api/college/scan',body:{date:'2026-09-03'}}]);
  assert.match(app.document.getElementById('college-scan-status').textContent,/2 provider-listed games checked/);
  assert.equal(app.document.getElementById('college-day-scan-btn').disabled,false);
  app.run('clearCollegeScan()');assert.equal(app.document.getElementById('college-scan-results').children.length,0);
  const fail=ui(async()=>{throw Error('offline');});fail.document.getElementById('college-scan-date').value='2026-09-03';
  await fail.run('runCollegeDayScan()');assert.match(fail.document.getElementById('college-scan-status').textContent,/failed/);
  assert.equal(fail.document.getElementById('college-scan-date').disabled,false);
});
