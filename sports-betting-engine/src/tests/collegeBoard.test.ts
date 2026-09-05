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
  children:Element[]=[];textContent='';className='';value='';disabled=false;open=false;scrolled=false;checked=false;
  append(...items:Element[]){this.children.push(...items);if(!this.value&&items[0]?.value)this.value=items[0].value;}
  replaceChildren(...items:Element[]){this.children=items;this.value='';}
  scrollIntoView(){this.scrolled=true;}
}
function ui(fetcher:(url:string,options?:any)=>Promise<any>){
  const elements=new Map<string,Element>();
  const document={getElementById:(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element()};
  const ctx=vm.createContext({document,Date,setTimeout:(f:()=>void)=>setImmediate(f),nflFetch:fetcher,nflDisplayTime:(s:string)=>s,nflFixed:(v:number,n=1)=>v.toFixed(n),
    nflText:(parent:Element,text:string)=>{const p=new Element();p.textContent=text;parent.append(p);}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../public/college-markets.js'),'utf8'),ctx);
  return {document,run:(code:string)=>vm.runInContext(code,ctx)};
}
test('college main-menu invokes one-click workflow; expanding the section alone remains read-only',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../../public/index.html'),'utf8');
  assert.match(html,/id="college-open"[^>]*onclick="runCollegeToday\(\)".*College football/);
  assert.match(html,/src="\/college-markets.js\?v=/);
  const app=ui(async()=>{throw Error('No API calls on open');});app.run('openCollegeBoard()');
  assert.equal(app.document.getElementById('college-market-board').open,true);
  assert.equal(app.document.getElementById('college-market-board').scrolled,true);
});
test('college scan UI leads with plain-language recommendation/watch/pass/avoid meanings',()=>{
  const script=fs.readFileSync(path.join(__dirname,'../../public/college-markets.js'),'utf8');
  assert.match(script,/SIMPLE READ/);assert.match(script,/RECOMMENDATION = qualified paper play/);assert.match(script,/WATCH ONLY — raw model lean/);
  assert.match(script,/Today’s run finished with safety notices/);assert.doesNotMatch(script,/Run finished with issues/);
  assert.match(script,/Current football-context source status/);assert.match(script,/source\.lastResult/);
});
test('simple read renders a plain label and explanation for every projected game',()=>{
  const app=ui(async()=>({})),projection=(classification:string,qualified=false)=>({event:{...game},projection:{awayScore:20,homeScore:24,total:44},market:{side:'Away',line:3.5},
    safety:{classification,qualified},reason:'Paper-only fixture.'});
  app.run(`renderCollegeDiagnostic=()=>{};renderCollegeDayScan(${JSON.stringify({date:'2026-09-03',recommendations:[],monitors:[],projections:[
    projection('PAPER MONITOR'),projection('PAPER PASS'),projection('MODEL WARNING')],recommendationNote:'Paper only.',warnings:[],shortlist:[],counts:{},rows:[],unlisted:[]})})`);
  const text=(node:Element):string=>[node.textContent,...node.children.map(text)].join(' '),rendered=text(app.document.getElementById('college-scan-results'));
  assert.match(rendered,/WATCH — Away @ Home: Raw model leans Away \+3\.5, but the evidence is not strong enough/);
  assert.match(rendered,/PASS — Away @ Home: No usable recommendation/);assert.match(rendered,/AVOID — Away @ Home: The model and market disagree too much/);
});

test('college paper record plainly separates recommendations, watch-only observations and manual picks',async()=>{
  const buckets=[
    {origin:'model',classification:'PAPER BET',wins:1,losses:0,pushes:0,pending:0,review:0,profitUnits:.91},
    {origin:'model',classification:'PAPER MONITOR',wins:0,losses:1,pushes:0,pending:1,review:0,profitUnits:-1},
    {origin:'manual',wins:2,losses:1,pushes:1,pending:0,review:1,profitUnits:.5},
  ];
  const app=ui(async()=>({picks:[],report:{buckets}}));await app.run('loadCollegePaper(false)');
  const panel=app.document.getElementById('college-paper-results'),text=panel.children.map(c=>c.textContent).join(' ');
  assert.match(text,/OFFICIAL MODEL PAPER RECOMMENDATIONS: 1W–0L–0P/);
  assert.match(text,/WATCH-ONLY MODEL OBSERVATIONS: 0W–1L–0P; 1 pending/);
  assert.match(text,/not recommendations/);
  assert.match(text,/YOUR MANUAL PRACTICE PICKS: 2W–1L–1P/);
});

test('one-click UI ignores date/checkbox, sends one start request and displays grading progress',async()=>{
  const calls:any[]=[];let polls=0;
  const scan={date:'2026-09-04',providerGames:2,gamesWithFreshOdds:2,unmatchedScheduledGames:0,creditsUsed:2,
    recommendations:[],projections:[],warnings:[],shortlist:[],counts:{},rows:[],unlisted:[],evidenceSaved:true};
  const job={id:'job1',date:'2026-09-04',stage:'scanning',status:'running',scan:null,warnings:[],grading:{gamesChecked:0,gamesPlanned:21,picksChecked:0,pending:2,review:0}};
  const app=ui(async(url,opts)=>{calls.push({url,body:opts?.body});
    if(url==='/api/college/paper')return{picks:[],report:{buckets:[]}};
    if(url==='/api/college/today')return job;
    polls++;return{...job,scan,stage:polls===1?'grading':'finished',status:polls===1?'running':'complete',grading:{...job.grading,gamesChecked:polls===1?10:21,picksChecked:polls===1?10:21}};
  });
  app.document.getElementById('college-scan-date').value='2026-10-01';
  await app.run('Promise.all([runCollegeToday(),runCollegeToday()])');
  assert.deepEqual(calls[0],{url:'/api/college/today',body:'{}'});assert.equal(calls.filter(c=>c.url==='/api/college/today').length,1);
  assert.equal(calls.some(c=>c.url==='/api/college/scan'),false);assert.equal(app.document.getElementById('college-scan-date').value,'2026-09-04');
  assert.match(app.document.getElementById('college-daily-status').textContent,/21\/21 games checked/);
  assert.equal(app.document.getElementById('college-open').disabled,false);assert.equal(app.document.getElementById('college-today-btn').disabled,false);
});
test('one-click UI network failure restores controls and does not automatically restart the job',async()=>{
  let starts=0;const app=ui(async(url)=>{if(url==='/api/college/paper')return{picks:[],report:{buckets:[]}};starts++;throw Error('offline');});
  await app.run('runCollegeToday()');assert.equal(starts,1);assert.equal(app.document.getElementById('college-open').disabled,false);
  assert.match(app.document.getElementById('college-daily-status').textContent,/Could not confirm/);
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

test('college full-day UI sends only date and explicit paper mode, hides game-list details and restores buttons on failure',async()=>{
  const html=fs.readFileSync(path.join(__dirname,'../../public/index.html'),'utf8');
  assert.match(html,/<details id="college-advanced"><summary>Optional:/);
  assert.doesNotMatch(html,/onclick="runCmd\('ncaaf'/);
  const calls:any[]=[];const app=ui(async(url,opts)=>{
    if(url==='/api/college/paper')return{picks:[],report:{buckets:[]}};
    calls.push({url,body:JSON.parse(opts.body)});
    return {date:'2026-09-03',providerGames:2,gamesWithFreshOdds:1,unmatchedScheduledGames:0,creditsUsed:2,cached:false,
      recommendations:[],projections:[],recommendationNote:'Not a betting recommendation',warnings:[],shortlist:[],counts:{no_price_candidate:1},rows:[],unlisted:[],evidenceSaved:true,note:''};});
  app.document.getElementById('college-scan-date').value='2026-09-03';
  app.document.getElementById('college-event').value='irrelevant-game';
  await app.run('runCollegeDayScan()');assert.deepEqual(calls,[{url:'/api/college/scan',body:{date:'2026-09-03',trackPaper:false}}]);
  assert.match(app.document.getElementById('college-scan-status').textContent,/2 provider-listed games checked/);
  assert.equal(app.document.getElementById('college-day-scan-btn').disabled,false);
  app.run('clearCollegeScan()');assert.equal(app.document.getElementById('college-scan-results').children.length,0);
  const fail=ui(async()=>{throw Error('offline');});fail.document.getElementById('college-scan-date').value='2026-09-03';
  await fail.run('runCollegeDayScan()');assert.match(fail.document.getElementById('college-scan-status').textContent,/failed/);
  assert.equal(fail.document.getElementById('college-scan-date').disabled,false);
  assert.equal(fail.document.getElementById('college-model-paper-rules').disabled,false);
  app.document.getElementById('college-model-paper-rules').checked=true;await app.run('runCollegeDayScan()');
  assert.equal(calls.at(-1).body.trackPaper,true);
});
