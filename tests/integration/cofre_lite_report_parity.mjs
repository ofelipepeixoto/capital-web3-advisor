/** Compare the candidate SQL/JS deterministic report in a disposable local database. */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildLiteReport, LITE_CONTROL_IDS } from '../../supabase/functions/advisory-api/cofre-lite-report.mjs';
import { SIGNAL_IDS } from '../../supabase/functions/advisory-api/cofre-lite-signals.mjs';
const status=JSON.parse(readFileSync(process.env.CAPITAL_SUPABASE_STATUS_FILE,'utf8'));
const db=new URL(status.DB_URL);
if (db.hostname!=='127.0.0.1'||db.port!=='54322'||db.username!=='postgres'||db.pathname!=='/postgres') throw Error('disposable local database required');
const fresh=()=>({schema_version:'cofre-lite-intake-0.2',synthetic:true,consents:{assessment:true,storage:true},profile:{experience:'beginner'},
 controls:Object.fromEntries(LITE_CONTROL_IDS.map(id=>[id,'unknown'])),signals:Object.fromEntries(SIGNAL_IDS.map(id=>[id,'unknown']))});
const cases=[];
for(let combination=0;combination<3**7;combination++){
 const item=fresh();let n=combination;
 for(const id of SIGNAL_IDS.slice(0,7)){item.signals[id]=['unknown','yes','no'][n%3];n=Math.floor(n/3);}
 cases.push(item);
}
for(const experience of ['beginner','some','unknown']) for(const state of ['yes','no','unknown','not_applicable']) {
 const item=fresh();item.profile.experience=experience;
 for(const id of LITE_CONTROL_IDS) item.controls[id]=id==='secret_exposure'&&state==='not_applicable'?'unknown':state;
 for(const id of SIGNAL_IDS) item.signals[id]=state;
 cases.push(item);
}
for(const id of LITE_CONTROL_IDS) for(const state of ['yes','no','unknown','not_applicable']) {
 if(id==='secret_exposure' && state==='not_applicable') continue;
 const item=fresh();item.controls[id]=state;cases.push(item);
}
for(let i=0;i<cases.length;i+=30){
 const payload=cases.slice(i,i+30).map(intake=>({intake,expected:buildLiteReport(intake)}));
 const base64=Buffer.from(JSON.stringify(payload)).toString('base64');
 const sql=`select count(*) from jsonb_array_elements(convert_from(decode('${base64}','base64'),'UTF8')::jsonb) as t(value) where capital_web3_private.cofre_lite_canonical_report(value->'intake') is distinct from value->'expected';`;
 const p=spawnSync('psql',['-X','-t','-A','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:30000,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'54322',PGDATABASE:'postgres',PGUSER:'postgres',PGPASSWORD:decodeURIComponent(db.password)}});
 if(p.status!==0){console.error('Lite SQL parity query failed for synthetic batch',i,p.stderr?.slice(-2000));process.exit(1);}
 if(p.stdout.trim()!=='0'){console.error('Lite SQL/JS mismatch on synthetic batch',i);process.exit(1);}
}
console.log('LITE CANONICAL PARITY: '+cases.length+' synthetic cases equal; signal combinations and control boundaries.');
