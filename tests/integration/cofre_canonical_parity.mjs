/** SQL/TS parity on only the disposable local Supabase CLI stack. */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildCofreReport, COFRE_CONTROL_IDS } from '../../supabase/functions/advisory-api/cofre.ts';
const status=JSON.parse(readFileSync(process.env.CAPITAL_SUPABASE_STATUS_FILE,'utf8'));
const db=new URL(status.DB_URL);
if (db.hostname!=='127.0.0.1'||db.port!=='54322'||db.username!=='postgres'||db.pathname!=='/postgres') throw Error('disposable local database required');
const asOf=new Date().toISOString();
const fresh=()=>({schema_version:'cofre-intake-0.1',synthetic:true,profile:{objective:'organize',experience:'beginner',liquidity:'long_term',loss_capacity:'discretionary'},consents:{assessment:true,storage:true,external_sources:false,notifications:false},controls:Object.fromEntries(COFRE_CONTROL_IDS.map(id=>[id,{answer:'unknown',evidence:'unknown'}])),inventory:[{category:'vault',network:'bitcoin',custody:'self'}]});
const cases=[];
for(let combination=0;combination<3**7;combination++){
 const item=fresh();let n=combination;
 for(const id of COFRE_CONTROL_IDS){const answer=['unknown','yes','no'][n%3];n=Math.floor(n/3);item.controls[id]={answer,evidence:answer==='unknown'?'unknown':(combination%2?'observed':'declared')};}
 cases.push(item);
}
for(const liquidity of ['unknown','short_term','long_term']) for(const loss_capacity of ['unknown','essential','limited','discretionary']) for(const inventory of [[],[{category:'apps',network:'unknown',custody:'unknown'}],[{category:'watch',network:'other',custody:'third_party'}]]){
 const item=fresh();item.profile.liquidity=liquidity;item.profile.loss_capacity=loss_capacity;item.inventory=inventory;cases.push(item);
}
for(let i=0;i<cases.length;i+=30){
 const payload=cases.slice(i,i+30).map(intake=>({intake,expected:buildCofreReport(intake,asOf)}));
 const base64=Buffer.from(JSON.stringify(payload)).toString('base64');
 const sql=`select count(*) from jsonb_array_elements(convert_from(decode('${base64}','base64'),'UTF8')::jsonb) as t(value) where capital_web3_private.cofre_canonical_report(value->'intake', '${asOf}') is distinct from value->'expected';`;
 const p=spawnSync('psql',['-X','-t','-A','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:30000,env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'54322',PGDATABASE:'postgres',PGUSER:'postgres',PGPASSWORD:decodeURIComponent(db.password)}});
 if(p.status!==0) { console.error('SQL parity query failed for synthetic batch',i, p.stderr?.slice(-2000));process.exit(1); }
 if(p.stdout.trim()!=='0'){console.error('SQL/TypeScript mismatch on synthetic batch',i);process.exit(1);}
}
console.log('CANONICAL PARITY: '+cases.length+' synthetic cases equal; all 3^7 control combinations and profile/inventory boundaries.');
