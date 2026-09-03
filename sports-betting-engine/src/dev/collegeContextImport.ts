import * as fs from 'fs';
import * as path from 'path';
import {appendCollegeRosterSnapshots} from '../services/collegeContext';
// Deliberate operator import, never executed by scans. Does not enable coefficients.
const input=process.argv[2],root=process.env.SNAPSHOT_DIR;
if(!input||!root)throw Error('Usage: set SNAPSHOT_DIR, then collegeContextImport.ts <verified-dated-snapshots.json>. No default production target.');
console.log(JSON.stringify(appendCollegeRosterSnapshots(path.resolve(root),JSON.parse(fs.readFileSync(path.resolve(input),'utf8')),Date.now())));
