import * as fs from 'fs';
import * as path from 'path';
import {CollegeForwardResearchArchive,ForwardFailure,NewForwardCorrection,NewForwardFinal,NewForwardResearchSnapshot} from '../services/collegeForwardResearch';

interface ImportBundle {raw?:Array<{provider:string;url:string;retrievedAt:string;payload:unknown}>;snapshots?:NewForwardResearchSnapshot[];finals?:NewForwardFinal[];corrections?:NewForwardCorrection[];failures?:ForwardFailure[];}
function argument(name:string){return process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);}
function main(){const input=argument('input'),root=argument('root')??process.env.FORWARD_RESEARCH_ROOT;if(!input||!root)throw Error('Usage: --input=<bundle.json> --root=<research-root>, or set FORWARD_RESEARCH_ROOT. No default production target.');
  const file=path.resolve(input),target=path.resolve(root);if(!fs.existsSync(file))throw Error('Forward research import bundle does not exist.');const bundle=JSON.parse(fs.readFileSync(file,'utf8')) as ImportBundle,archive=new CollegeForwardResearchArchive(target),result={raw:0,snapshots:0,finals:0,corrections:0,failures:0};
  for(const row of bundle.raw??[]){archive.archiveRaw(row.provider,row.url,row.retrievedAt,row.payload);result.raw++;}for(const row of bundle.snapshots??[]){archive.capture(row);result.snapshots++;}for(const row of bundle.finals??[]){archive.archiveFinal(row);result.finals++;}for(const row of bundle.corrections??[]){archive.appendCorrection(row);result.corrections++;}for(const row of bundle.failures??[]){archive.logFailure(row);result.failures++;}
  console.log(JSON.stringify({target,result,archive:archive.load()},null,2));}
if(require.main===module)main();
