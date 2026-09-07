import * as path from 'path';
import {CollegeForwardOperationalCollector,buildForwardOperationalStatus,ForwardCaptureTrigger} from '../services/collegeForwardOperations';
import {LiveCollegeForwardCollectorAdapter} from '../services/collegeForwardCollectorRuntime';

function option(name:string){const prefix=`--${name}=`;return process.argv.slice(2).find(value=>value.startsWith(prefix))?.slice(prefix.length);}
async function main(){const root=path.resolve(option('root')??process.env.FORWARD_RESEARCH_ROOT??path.join(process.cwd(),'research','forward-archive')),trigger=(option('trigger')??'MANUAL') as ForwardCaptureTrigger,dryRun=process.argv.includes('--dry-run'),status=process.argv.includes('--status');if(!['SCHEDULED_0700_CT','SCHEDULED_1400_CT','MANUAL'].includes(trigger))throw Error('Use --trigger=SCHEDULED_0700_CT, SCHEDULED_1400_CT, or MANUAL.');
  if(status){console.log(JSON.stringify(buildForwardOperationalStatus(root,Date.now(),{scheduler:process.env.FORWARD_SCHEDULER_CONFIGURED==='true',durableStorage:process.env.FORWARD_DURABLE_STORAGE==='git'}),null,2));return;}
  const idempotencyKey=option('idempotency-key')??process.env.FORWARD_IDEMPOTENCY_KEY??(dryRun?'dry-run':undefined);if(trigger==='MANUAL'&&!idempotencyKey)throw Error('Manual collection requires --idempotency-key=<unique safe retry key>.');const adapter=new LiveCollegeForwardCollectorAdapter(root),collector=new CollegeForwardOperationalCollector(root,adapter),result=await collector.run({trigger,dryRun,idempotencyKey});console.log(JSON.stringify(result,null,2));if(!dryRun&&result.status==='FAILED')process.exitCode=1;}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
