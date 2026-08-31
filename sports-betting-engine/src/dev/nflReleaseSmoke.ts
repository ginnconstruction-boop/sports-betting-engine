// Read-only release smoke check. No odds purchases, valid forecast, grading or
// pick creation. Credentials come from the invoking process and are never logged.
async function main() {
  const base = process.env.SMOKE_BASE_URL ?? 'http://localhost:3091';
  if (!/^https?:\/\/(localhost:\d+|127\.0\.0\.1:\d+|sports-betting-engine-1\.onrender\.com)$/.test(base)) throw new Error('Unapproved smoke-check host');
  let token: string | undefined;
  const rows = [];
  const call = async (route: string, method='GET', body?: unknown, authorized=true) => {
    const response=await fetch(base+route,{method,headers:{'content-type':'application/json',...(authorized&&token?{'x-auth-token':token}:{})},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const data:any=await response.json();return {status:response.status,data};
  };
  try {
    for(const route of ['/api/nfl/paper/export','/api/nfl/paper/no-such-pick/replay']) {
      const r=await call(route,'GET',undefined,false);rows.push({route,anonymous:r.status});if(r.status!==401)throw new Error('Anonymous protection failed');
    }
    const login=await call('/api/login','POST',{username:process.env.DASHBOARD_USER,password:process.env.DASHBOARD_PASS},false);
    if(login.status!==200||!login.data.token)throw new Error('Smoke login failed');token=login.data.token;
    for(const route of ['/api/health','/api/nfl/paper','/api/nfl/paper/export','/api/nfl/events','/api/college/events']) {
      const r=await call(route);if(r.status!==200)throw new Error('Smoke endpoint failed: '+route);
      rows.push({route,status:r.status,release:r.data.release,picks:r.data.picks?.length,events:r.data.events?.length,
        archivedSources:r.data.evidence?Object.keys(r.data.evidence).length:undefined,missingSources:r.data.missingEvidence?.length});
    }
    const missing=await call('/api/nfl/paper/no-such-pick/replay');if(missing.status!==404)throw new Error('Missing replay did not return 404');
    rows.push({route:'/api/nfl/paper/no-such-pick/replay',status:missing.status});
    const invalid=await call('/api/nfl/forecast','POST',{});if(invalid.status!==400)throw new Error('Invalid forecast not rejected');
    rows.push({route:'/api/nfl/forecast (invalid)',status:invalid.status});
    console.log(JSON.stringify({base,checks:rows,paidOddsCalls:0,createdPicks:0},null,2));
  } finally {if(token)await call('/api/logout','POST',{}).catch(()=>undefined);}
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1;});
