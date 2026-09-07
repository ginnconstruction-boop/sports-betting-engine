import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
import {reconstructedRows} from './collegeEdgeResearch';
import {MarketPriorConfig,MarketPriorObservation,marketHomeMarginFromSpread,renderCollegeMarketPriorReport,runCollegeMarketPriorResearch} from '../services/collegeMarketPriorResearch';

const repository=path.resolve(__dirname,'../..');
const read=(file:string)=>JSON.parse(fs.readFileSync(file,'utf8'));
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');

export function phase4Rows():MarketPriorObservation[]{return reconstructedRows().map(row=>{
  const marketHomeMargin=marketHomeMarginFromSpread(row.marketHomeSpread as number),edge=row.modelHomeMargin-marketHomeMargin;
  return {observationId:row.observationId,gameId:row.gameId,evidenceClass:'RECONSTRUCTED_FORECAST',sourceLabel:row.sourceLabel,
    forecastAt:row.forecastAt,marketAt:row.quoteUpdatedAt as string,inputsAsOf:row.inputsAsOf as string,kickoff:row.kickoff,modelVersion:row.modelVersion,
    marketDefinition:'Exact fresh symmetric sportsbook spread from the valid book pair closest to the contemporaneous multi-book median; not a closing line.',
    modelHomeMargin:row.modelHomeMargin,marketHomeMargin,actualHomeMargin:row.actualHomeMargin as number,americanPrice:row.americanPrice,
    priceSide:edge>0?'HOME':edge<0?'AWAY':null,week:row.week,matchupClass:row.matchupClass,marketHomeSpread:row.marketHomeSpread as number,neutralSite:row.neutralSite};});}

function requestedTimestamp(){const arg=process.argv.find(value=>value.startsWith('--generated-at='));return arg?arg.slice('--generated-at='.length):new Date().toISOString();}
function main(){
  const config=read(path.join(repository,'research','college-market-prior-v1-config.json')) as MarketPriorConfig,rows=phase4Rows(),generatedAt=requestedTimestamp();
  const applicationVersion=String(read(path.join(repository,'package.json')).version??'NOT_RECORDED');
  const artifact=runCollegeMarketPriorResearch(rows,{generatedAt,applicationVersion,datasetVersion:'phase3-reconstructed-all-model-sides-2025-v1',config});
  const runId=`${artifact.schemaVersion}-${artifact.datasetHash.slice(0,12)}-${generatedAt.replace(/[:.]/g,'-')}`,root=path.join(repository,'research','results','college-market-prior-v1'),directory=path.join(root,runId);
  const phase3=path.join(repository,'research','results','college-edge-research-v1','college-edge-research-v1-94d06a08f9a0-2026-09-07T04-35-00-000Z','manifest.json');
  const manifest={runId,generatedAt:artifact.generatedAt,datasetVersion:artifact.datasetVersion,datasetHash:artifact.datasetHash,configurationHash:artifact.configurationHash,
    codeHashes:{engine:sha(fs.readFileSync(path.join(repository,'src','services','collegeMarketPriorResearch.ts'))),adapter:sha(fs.readFileSync(__filename)),configuration:sha(fs.readFileSync(path.join(repository,'research','college-market-prior-v1-config.json')))},
    sourceManifest:{path:path.relative(repository,phase3).replace(/\\/g,'/'),sha256:sha(fs.readFileSync(phase3))},selectionMetric:artifact.selectionMetric,productionChanged:false,
    reproductionCommand:`npm run research:college-market-prior -- --generated-at=${artifact.generatedAt}`};
  const files={'artifact.json':JSON.stringify(artifact,null,2),'report.md':renderCollegeMarketPriorReport(artifact),'manifest.json':JSON.stringify(manifest,null,2)};fs.mkdirSync(root,{recursive:true});let reproducibilityVerified=false;
  if(fs.existsSync(directory)){for(const [name,contents]of Object.entries(files)){const file=path.join(directory,name);if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==contents)throw Error(`Immutable Phase 4 artifact collision at ${file}.`);}reproducibilityVerified=true;}
  else{fs.mkdirSync(directory);for(const [name,contents]of Object.entries(files))fs.writeFileSync(path.join(directory,name),contents,{flag:'wx'});}
  console.log(JSON.stringify({directory,reproducibilityVerified,audit:artifact.audit,split:artifact.split,selectedCandidate:artifact.selectedCandidate,lockedFit:artifact.lockedFit.parameters,
    all:artifact.allEligibleModelVsMarket,test:artifact.testComparison,decision:artifact.decision,decisionReasons:artifact.decisionReasons},null,2));
}
if(require.main===module)main();
