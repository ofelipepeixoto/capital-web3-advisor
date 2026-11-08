import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { LiteSimulation, liteSummary } from '../apps/staging/cofre-lite-simulation.mjs';
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.handlers = {}; this.attributes = {}; this._text = ''; this.checked = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(' '); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener(k, v) { this.handlers[k] = v; }
  focus() { focused = this; }
  all() { return [this, ...this.children.flatMap(child => child.all())]; }
  click() { this.handlers.click?.(); }
}
let focused;
globalThis.document = { createElement: tag => new Element(tag), createTextNode: text => { let n = new Element('#text'); n.textContent = text; return n; } };
const find = (root, tag, content) => root.all().find(n => n.tagName === tag && n.textContent === content);
const select = (root, name, value) => { const input = root.all().find(n => n.name === name && n.value === value); assert.ok(input); input.checked = true; input.handlers.change(); };
test('vazio é incompleto e sinal crítico prevalece sobre lacunas', () => {
  assert.equal(liteSummary({}).state, 'incomplete');
  assert.equal(liteSummary({ secret_exposure: 'yes' }).state, 'blocked');
  assert.equal(liteSummary({ secret_request: 'yes', secret_exposure: 'unknown' }).state, 'blocked');
});
test('jornada preserva respostas ao navegar, sinaliza risco e nunca pede segredos', () => {
  const root = new Element('section'), ui = new LiteSimulation(root); ui.render();
  select(root, 'lite-experience', 'beginner'); assert.equal(ui.dirty, true);
  find(root, 'button', 'Continuar').click(); find(root, 'button', 'Voltar').click();
  assert.equal(ui.answers.experience, 'beginner'); assert.match(focused.textContent, /Etapa 1/);
  find(root, 'button', 'Continuar').click(); find(root, 'button', 'Continuar').click();
  select(root, 'lite-secret_exposure', 'yes'); assert.ok(root.textContent.includes('Alerta crítico'));
  assert.ok(root.all().filter(item => item.tagName === 'input').every(item => item.type === 'radio'));
  for (let i = 0; i < 3; i++) find(root, 'button', 'Continuar').click();
  assert.ok(root.textContent.includes('Alerta crítico')); assert.ok(root.textContent.includes('não gera pontuação'));
  ui.clear(); assert.deepEqual(ui.answers, {}); assert.equal(ui.dirty, false); assert.equal(root.textContent, '');
});
test('panorama incompleto se atualiza após responder na última etapa', () => {
  const root = new Element('section'), ui = new LiteSimulation(root); ui.render();
  for (let i = 0; i < 5; i++) find(root, 'button', 'Continuar').click();
  const before = liteSummary(ui.answers).missing; select(root, 'lite-routine', 'yes');
  assert.equal(liteSummary(ui.answers).missing, before - 1);
  assert.ok(root.textContent.includes(`Exercício incompleto: ${before - 1} respostas`));
});

test('os dez sinais da prevenção usam a mesma regra do serviço sem pontuação', async () => {
  const { SIGNAL_IDS, assessSignals } = await import('../apps/staging/cofre-lite-signals.mjs');
  const root = new Element('section'), ui = new LiteSimulation(root); ui.render();
  for (let i = 0; i < 3; i++) find(root, 'button', 'Continuar').click();
  const ids = new Set(root.all().filter(item => item.tagName === 'input').map(input => input.name.replace('lite-', '')));
  for (const id of SIGNAL_IDS) assert.ok(ids.has(id), id);
  select(root, 'lite-guaranteed_return', 'yes');
  const values = Object.fromEntries(SIGNAL_IDS.map(id => [id, ui.answers[id] || 'unknown']));
  assert.equal(assessSignals(values).status, 'blocked');
  assert.equal(liteSummary(ui.answers).state, 'blocked');
  assert.match(root.textContent, /Alerta crítico/);
});

// Development browser files are duplicated so the test server can serve them.
// A divergent copy would show clients a different signal policy.
test('browser signal module matches the Edge-local source', async () => {
  const browser = await readFile(new URL('../apps/staging/cofre-lite-signals.mjs', import.meta.url), 'utf8');
  const edge = await readFile(new URL('../supabase/functions/advisory-api/cofre-lite-signals.mjs', import.meta.url), 'utf8');
  assert.equal(browser, edge);
});

test('consented Lite intake saves every control and resumes on a fresh session', async () => {
  let stored = null, requests = [];
  const api = async (path, body) => { requests.push({path,body}); if (!body) return {data:stored}; stored = {revision:(stored?.revision || 0)+1,intake:body.intake}; return {data:{revision:stored.revision}}; };
  const options = {api, cases:()=>[{id:'case-1',client_safe_title:'Fictício'}], confirm:()=>true};
  const root = new Element('section'), ui = new LiteSimulation(root,options); ui.caseId='case-1'; await ui.load();
  ui.answers.urgency='yes'; ui.answers.experience='beginner'; ui.consents.assessment=true; ui.consents.storage=true; ui.dirty=true;
  await ui.save(); assert.equal(stored.revision,1); assert.equal(stored.intake.signals.urgency,'yes');
  assert.equal(stored.intake.profile.experience,'beginner'); assert.equal(stored.intake.controls.backup,'unknown'); assert.equal(ui.dirty,false);
  ui.clear(); const next = new LiteSimulation(new Element('section'),options); next.caseId='case-1'; await next.load();
  assert.equal(next.answers.urgency,'yes'); assert.equal(next.answers.experience,'beginner'); assert.equal(next.answers.backup,'unknown'); assert.equal(next.revision,1);
  assert.equal(requests.filter(r=>r.body).length,1);
});

test('disabled feature, conflicts and late responses preserve unsaved session answers', async () => {
  let mode='off', release; const api = async (path, body) => {
    if (mode==='off') throw Object.assign(Error('denied'),{status:404});
    if (mode==='conflict') throw Object.assign(Error('conflict'),{status:409});
    return new Promise(resolve=>{release=resolve;});
  };
  const ui=new LiteSimulation(new Element('section'),{api,cases:()=>[{id:'case-1'}],confirm:()=>true});ui.caseId='case-1';
  await ui.load(); assert.equal(ui.loaded,false);assert.match(ui.notice,/desabilitada/);
  ui.loaded=true;ui.consents={assessment:true,storage:true};ui.answers.urgency='yes';ui.dirty=true;mode='conflict';
  await ui.save();assert.equal(ui.answers.urgency,'yes');assert.equal(ui.dirty,true);assert.match(ui.notice,/Outra revisão/);
  mode='pending';const pending=ui.load();ui.clear();release({data:null});await pending;
  assert.equal(ui.caseId,'');assert.deepEqual(ui.answers,{});assert.equal(ui.loaded,false);
});


test('pending load disables inputs and navigation until the server response arrives', async () => {
  let release; const api = async () => new Promise(resolve => { release = resolve; });
  const root = new Element('section'), ui = new LiteSimulation(root,{api,cases:()=>[{id:'case-1'}],confirm:()=>true});
  ui.caseId='case-1'; ui.render(); const pending=ui.load();
  assert.ok(root.all().filter(item=>item.tagName==='input').every(input=>input.disabled));
  assert.equal(find(root,'button','Continuar').disabled,true);
  release({data:null}); await pending;
  assert.equal(find(root,'button','Continuar').disabled,false);
});

test('uncertain Lite save keeps local answers and retries identical payload and idempotency key', async () => {
  let attempt=0; const calls=[];
  const api=async(path,body)=>{calls.push({path,body:structuredClone(body)});if(++attempt===1)throw new Error('timeout');return {data:{revision:1}};};
  const ui=new LiteSimulation(new Element('section'),{api,cases:()=>[{id:'case-1'}],confirm:()=>true});
  ui.caseId='case-1';ui.loaded=true;ui.consents={assessment:true,storage:true};ui.answers.urgency='yes';ui.dirty=true;
  await ui.save();assert.equal(ui.answers.urgency,'yes');assert.equal(ui.dirty,true);assert.match(ui.notice,/Não foi possível confirmar/);
  await ui.save();assert.equal(ui.revision,1);assert.equal(ui.dirty,false);assert.deepEqual(calls[0],calls[1]);
});


test('unanswered controls are stored as unknown and not applicable is preserved', async () => {
  let stored; const api=async(path,body)=>{stored=structuredClone(body);return {data:{revision:1}};};
  const ui=new LiteSimulation(new Element('section'),{api,cases:()=>[{id:'case-1'}],confirm:()=>true});
  ui.caseId='case-1';ui.loaded=true;ui.consents={assessment:true,storage:true};
  ui.answers.vault='not_applicable';ui.answers.secret_exposure='no';ui.dirty=true;await ui.save();
  assert.equal(stored.intake.schema_version,'cofre-lite-intake-0.2');assert.equal(stored.legacy_revision,null);
  assert.equal(stored.intake.controls.vault,'not_applicable');assert.equal(stored.intake.controls.apps,'unknown');
  assert.equal(stored.intake.profile.experience,'unknown');assert.equal(stored.intake.signals.urgency,'unknown');
  assert.ok(!('address' in stored.intake));assert.equal(ui.dirty,false);
});

test('invalid server intake never replaces existing answers', async () => {
  const api=async()=>({data:{revision:1,intake:{schema_version:'cofre-lite-intake-0.2',synthetic:true}}});
  const ui=new LiteSimulation(new Element('section'),{api,cases:()=>[{id:'case-1'}],confirm:()=>true});
  ui.caseId='case-1';ui.answers.backup='yes';ui.dirty=true;await ui.load();
  assert.equal(ui.answers.backup,'yes');assert.equal(ui.dirty,true);assert.equal(ui.loaded,false);
});

test('legacy signals require explicit import and renewed consent; no data is lost silently', async () => {
  const { SIGNAL_IDS } = await import('../apps/staging/cofre-lite-signals.mjs');
  const signals = Object.fromEntries(SIGNAL_IDS.map(id => [id, id === 'urgency' ? 'yes' : 'unknown']));
  const requests=[]; const api=async(path,body)=>{requests.push({path,body});if(path.endsWith('/lite-intake'))return {data:{legacy_available:true,legacy_revision:1}};
    return {data:{revision:1,intake:{schema_version:'cofre-lite-signals-0.1',synthetic:true,consents:{assessment:true,storage:true},signals}}};};
  const root=new Element('section'), ui=new LiteSimulation(root,{api,cases:()=>[{id:'case-1'}],confirm:()=>true});ui.caseId='case-1';await ui.load();
  assert.equal(ui.legacyAvailable,true);assert.equal(ui.loaded,false);assert.equal(requests.length,1);
  assert.ok(find(root,'button','Carregar sinais anteriores'));assert.ok(find(root,'button','Iniciar sem sinais anteriores'));
  await ui.importLegacy();assert.equal(ui.answers.urgency,'yes');assert.equal(ui.dirty,true);assert.equal(ui.loaded,true);
  assert.deepEqual(ui.consents,{assessment:false,storage:false});assert.equal(ui.intake().profile.experience,'unknown');
  await ui.save();assert.equal(requests.length,2);assert.match(ui.notice,/consentimentos/);
  ui.consents={assessment:true,storage:true}; const saved=[];ui.api=async(path,body)=>{saved.push(body);return {data:{revision:saved.length}};};
  await ui.save();assert.equal(saved[0].legacy_revision,1);assert.equal(ui.legacyRevision,null);
  ui.answers.urgency='no';await ui.save();assert.equal(saved[1].legacy_revision,null);
});

test('legacy data that changes before explicit import is not loaded or silently acknowledged', async () => {
  const { SIGNAL_IDS }=await import('../apps/staging/cofre-lite-signals.mjs');
  const signals=Object.fromEntries(SIGNAL_IDS.map(id=>[id,'unknown']));
  const api=async(path)=>path.endsWith('/lite-intake') ? {data:{legacy_available:true,legacy_revision:1}} :
    {data:{revision:2,intake:{schema_version:'cofre-lite-signals-0.1',synthetic:true,consents:{assessment:true,storage:true},signals}}};
  const ui=new LiteSimulation(new Element('section'),{api,cases:()=>[{id:'case-1'}],confirm:()=>true});
  ui.caseId='case-1';await ui.load();await ui.importLegacy();
  assert.equal(ui.loaded,false);assert.equal(ui.legacyAvailable,true);assert.match(ui.notice,/sinais anteriores mudaram/i);assert.match(ui.notice,/Carregar respostas do atendimento/);assert.deepEqual(ui.answers,{});
});

test('new blank intake requires explicit confirmation when legacy data exists', async () => {
  const root=new Element('section');let confirmed=false;
  const ui=new LiteSimulation(root,{api:async()=>({data:{legacy_available:true,legacy_revision:4}}),cases:()=>[{id:'case-1'}],confirm:()=>confirmed});
  ui.caseId='case-1';await ui.load();ui.startWithoutLegacy();assert.equal(ui.loaded,false);assert.equal(ui.legacyAvailable,true);
  confirmed=true;ui.startWithoutLegacy();assert.equal(ui.loaded,true);assert.equal(ui.legacyRevision,4);assert.deepEqual(ui.consents,{assessment:false,storage:false});
});

test('rascunho exige versão salva e repete a mesma chave após resposta incerta', async () => {
  const requests = [], opened = [];
  let fail = true;
  const id = '11111111-1111-4111-8111-111111111111';
  const report = '22222222-2222-4222-8222-222222222222';
  const api = async (path, body) => { requests.push({path, body}); if (fail) { fail = false; throw Error('network'); } return {data:{case_id:id,intake_revision:3,report_version_id:report}}; };
  const root = new Element('section'), ui = new LiteSimulation(root, { api, cases: () => [{id}], onGenerated: async value => opened.push(value) });
  ui.caseId=id; ui.loaded=true; ui.revision=3; ui.consents={assessment:true,storage:true}; ui.dirty=true; ui.render();
  assert.equal(find(root, 'button', 'Gerar rascunho para revisão').disabled, true); await ui.generateDraft(); assert.equal(requests.length,0);
  ui.dirty=false; ui.render(); assert.equal(find(root, 'button', 'Gerar rascunho para revisão').disabled, false);
  await ui.generateDraft(); assert.match(ui.notice, /Não foi possível confirmar/); assert.deepEqual(opened,[]);
  await ui.generateDraft(); assert.deepEqual(opened,[report]);
  assert.equal(requests[0].body.idempotency_key,requests[1].body.idempotency_key);
  assert.deepEqual(Object.keys(requests[0].body).sort(),['expected_revision','idempotency_key']);
  assert.equal(requests[0].body.expected_revision,3);
  ui.render(); select(root,'lite-experience','beginner'); assert.equal(find(root,'button','Gerar rascunho para revisão').disabled,true);
});

test('conflito, troca de sessão e falha de navegação não inventam entrega', async () => {
  const id='11111111-1111-4111-8111-111111111111', report='22222222-2222-4222-8222-222222222222'; let release, mode='conflict', opened=0;
  const api = async () => { if (mode==='conflict') throw Object.assign(Error('conflict'), {status:409}); if (mode==='late') return new Promise(resolve => {release=resolve}); return {data:{case_id:id,intake_revision:2,report_version_id:report}}; };
  const ui = new LiteSimulation(new Element('section'),{api,cases:()=>[{id}],onGenerated:async()=>{opened++;throw Error('offline')}});
  ui.caseId=id; ui.loaded=true; ui.revision=2; ui.consents={assessment:true,storage:true};
  await ui.generateDraft(); assert.match(ui.notice,/Recarregue/); assert.equal(opened,0);
  mode='late'; const pending=ui.generateDraft(); ui.clear(); release({data:{case_id:id,intake_revision:2,report_version_id:report}}); await pending; assert.equal(opened,0);
  ui.caseId=id; ui.loaded=true; ui.revision=2; ui.consents={assessment:true,storage:true}; mode='success'; await ui.generateDraft(); assert.equal(opened,1); assert.match(ui.notice,/Rascunho gerado/);
});
