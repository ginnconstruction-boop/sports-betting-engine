// Explicit full-day production verification. At most one two-credit bulk pull
// in the server cache window; no individual odds requests or paper/official picks.
async function main(){
  const base=process.env.SMOKE_BASE_URL??'http://localhost:3091';
  if(!/^https?:\/\/(localhost:\d+|127\.0\.0\.1:\d+|sports-betting-engine-1\.onrender\.com)$/.test(base))throw Error('Unapproved smoke host');
  const dates=process.argv.slice(2);if(!dates.length||dates.length>3||dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)))throw Error('Supply one to three explicit calendar dates.');
  let token:string|undefined;
  const call=async(route:string,body?:any)=>{
    const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{'x-auth-token':token}:{})},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
    if(!r.ok)throw Error(`Smoke HTTP ${r.status} ${route}`);return r.json() as Promise<any>;
  };
  try{
    const login=await call('/api/login',{username:process.env.DASHBOARD_USER,password:process.env.DASHBOARD_PASS});token=login.token;
    if(!token)throw Error('Login failed');
    let totalCredits=0;const reports=[];
    for(const date of dates){
      const r=await call('/api/college/scan',{date,trackPaper:false});
      if(r.date!==date||r.timezone!=='America/Chicago'||r.rows.length!==r.providerGames||r.recommendations.length!==0||!r.evidenceSaved)throw Error('College scan contract failed');
      if(r.creditsUsed===null)throw Error('Uncertain odds credits; stop without retry');
      totalCredits+=r.creditsUsed;if(totalCredits>2)throw Error('Unexpected repeated bulk odds charge');
      reports.push({date,providerGames:r.providerGames,independentGames:r.independentScheduledGames,freshGames:r.gamesWithFreshOdds,
        missing:r.unmatchedScheduledGames,counts:r.counts,shortlist:r.shortlist.length,recommendationStatus:r.recommendationStatus,
        projections:r.projections?.length,paperPreview:r.projections?.reduce((n:number,p:any)=>n+(p.selected?.length??0),0),
        modelMarkets:r.modelReadiness?.validation.paperApproved,
        cached:r.cached,credits:r.creditsUsed,remaining:r.remainingCredits,evidenceSaved:r.evidenceSaved,warnings:r.warnings});
      // Failures must be investigated, never retried automatically.
      if(r.coverage==='incomplete'||r.oddsStatus==='unavailable')throw Error('Source coverage incomplete; stop without another paid attempt');
      if(r.providerGames&&(!r.projections?.length||r.recommendationStatus!=='preview_only'))throw Error('Model projection check failed');
    }
    console.log(JSON.stringify({checks:reports,totalCredits,createdPicks:0},null,2));
  }finally{if(token)await call('/api/logout',{}).catch(()=>undefined);}
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1;});
export {};
