// Explicit verification of the one-click workflow. May save real paper selections
// for TODAY and grade previously saved college picks. Never alter the date/clock.
async function main(){
  const base=process.env.SMOKE_BASE_URL??'http://localhost:3091';
  if(!/^https?:\/\/(localhost:\d+|127\.0\.0\.1:\d+|sports-betting-engine-1\.onrender\.com)$/.test(base))throw Error('Unapproved smoke host');
  let token:string|undefined;
  const call=async(route:string,body?:any)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{'x-auth-token':token}:{})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`One-click HTTP ${r.status}`);return r.json() as Promise<any>;};
  try{
    const login=await call('/api/login',{username:process.env.DASHBOARD_USER,password:process.env.DASHBOARD_PASS});token=login.token;if(!token)throw Error('Login failed');
    const before=await call('/api/college/paper');
    let job=await call('/api/college/today',{});
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if(job.date!==date||!job.id)throw Error('One-click date/ID contract failed');
    for(let i=0;job.status==='running'&&i<120;i++){await new Promise(r=>setTimeout(r,1000));job=await call('/api/college/today/'+encodeURIComponent(job.id));}
    if(job.status==='running'||job.status==='failed')throw Error('One-click did not finish');
    const after=await call('/api/college/paper');
    console.log(JSON.stringify({date:job.date,status:job.status,stage:job.stage,providerGames:job.scan?.providerGames,recommendations:job.scan?.recommendations?.length,
      creditsUsed:job.scan?.creditsUsed,grading:job.grading,warnings:job.warnings,picksBefore:before.picks.length,picksAfter:after.picks.length},null,2));
  }finally{if(token)await call('/api/logout',{}).catch(()=>undefined);}
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1;});
export {};
