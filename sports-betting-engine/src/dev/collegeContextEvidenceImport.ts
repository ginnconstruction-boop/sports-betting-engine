import * as fs from 'fs';
import {appendCollegeContextRecords,NewCollegeContextRecord} from '../services/collegeContextEvidence';

const input=process.argv[2],root=process.env.SNAPSHOT_DIR;
if(!input||!root)throw Error('Usage: set SNAPSHOT_DIR, then collegeContextEvidenceImport.ts <verified-context-records.json>. No default production target.');
const payload=JSON.parse(fs.readFileSync(input,'utf8'));
if(payload.schema!==1||!Array.isArray(payload.records))throw Error('Expected {schema:1, records:[...]}.');
const result=appendCollegeContextRecords(root,payload.records as NewCollegeContextRecord[]);
console.log(JSON.stringify({...result,note:'Append-only import complete. Existing records were not edited.'},null,2));

