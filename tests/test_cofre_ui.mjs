import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import { CofreWorkspace, emptyCofreIntake, setControl, renderCofreReport, renderPublicationContext } from '../apps/staging/cofre-ui.mjs';

// Synthetic DOM interaction tests: API boundaries and user-visible states, no layout claims.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.handlers = {}; this.attributes = {}; this._text = ''; this.value = ''; this.hidden = false; this.disabled = false; this.checked = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(row => row.textContent).join(' '); }
  append(...values) { this.children.push(...values); }
  replaceChildren(...values) { this._text = ''; this.children = [...values]; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, run) { this.handlers[name] = run; }
  focus() { focused = this; }
  all() { return [this, ...this.children.flatMap(value => value.all())]; }
  matches(selector) { return selector.startsWith('.') ? (this.className || '').split(' ').includes(selector.slice(1)) : this.tagName === selector; }
  querySelectorAll(selector) { return this.all().slice(1).filter(item => selector.split(',').some(value => item.matches(value.trim()))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  reportValidity() { return !this.querySelectorAll('input,select').some(input => input.required && !input.disabled && !input.value); }
  click() { return this.disabled ? undefined : this.handlers.click?.({ preventDefault() {} }); }
}
let focused;
globalThis.document = { createElement: tag => new Element(tag), createTextNode: value => { const node = new Element('#text'); node.textContent = value; return node; } };
globalThis.crypto ||= webcrypto;
const roster = [
  { workspace_id: 'workspace-a', workspace_label: 'Ensaio A', user_id: 'analyst', display_name: 'Analista fictício', member_role: 'analyst' },
  { workspace_id: 'workspace-a', workspace_label: 'Ensaio A', user_id: 'client-a', display_name: 'Pessoa A fictícia', member_role: 'client' },
];
const entry = { id: 'case-a', client_safe_title: 'Caso fictício A' };
const button = (root, text) => root.all().find(item => item.tagName === 'button' && item.textContent === text);
const field = (root, id) => root.all().find(item => item.id === id);
const change = (input, value) => { input.value = value; input.handlers.change?.(); };
const valid = () => {
  const intake = emptyCofreIntake(); intake.consents.assessment = true; intake.consents.storage = true;
  intake.profile.objective = 'organize'; intake.profile.experience = 'beginner'; return intake;
};
function harness(api = async path => path === '/cases' ? { data: [entry] } : { data: null }) {
  const root = new Element('section'), notices = [], saved = [];
  let user = { user_id: 'analyst', assignments: [{ case_id: entry.id, staff_role: 'analyst' }] };
  const ui = new CofreWorkspace({ root, api, currentSession: () => user, notice: text => notices.push(text), onSaved: id => { saved.push(id); } });
  return { root, ui, notices, saved, setUser: next => { user = next; } };
}

test('unknown stays unknown, consent starts unchecked, and separate intakes share no state', () => {
  const first = emptyCofreIntake(), other = emptyCofreIntake();
  assert.equal(first.synthetic, true); assert.deepEqual(first.consents, { assessment: false, storage: false, external_sources: false, notifications: false });
  for (const control of Object.values(first.controls)) assert.deepEqual(control, { answer: 'unknown', evidence: 'unknown' });
  first.controls.backup_offline.evidence = 'observed'; setControl(first, 'backup_offline', 'unknown');
  assert.deepEqual(first.controls.backup_offline, { answer: 'unknown', evidence: 'unknown' });
  setControl(first, 'backup_offline', 'yes'); assert.equal(first.controls.backup_offline.evidence, 'declared');
  assert.equal(other.controls.backup_offline.answer, 'unknown');
  assert.equal(first.profile.objective, '', 'required objective is never fabricated');
});

test('a client gets readable evidence/action/limits and inert source text, no raw JSON', () => {
  const attack = '<img src=x onerror=alert(1)>';
  const content = { report_kind: 'cofre_individual', status: 'blocked', title: 'COFRE', summary: 'Resumo fictício', profile: valid().profile,
    controls: [{ title: 'Backup', answer: 'unknown', evidence: 'unknown', explanation: 'Não comprovado' }],
    findings: [{ title: attack, severity: 'critical', evidence: 'Exposição declarada', impact: 'Possível perda', action: 'Acionar fluxo de incidente' }],
    plan: [{ priority: 'P0', action: 'Isolar o incidente', owner: 'Pessoa fictícia', deadline: 'Antes de retomar', verification: 'Revisão humana' }],
    limitations: ['Sem consulta externa'], alternatives: ['Interromper o ensaio'], next_steps: ['Revisão por outra pessoa'], sources: [{ label: attack, reference: 'fixture', as_of: '2026-10-17' }],
    human_review: { status: 'approved', note: 'UNTRUSTED_APPROVAL' } };
  const client = renderCofreReport(content);
  for (const text of ['Diagnóstico bloqueado', 'Exposição declarada', 'Possível impacto', 'Ação proposta', 'Como conferir', 'Sem consulta externa', attack]) assert.ok(client.textContent.includes(text), text);
  assert.equal(client.querySelector('pre'), null); assert.equal(client.querySelector('img'), null); assert.equal(client.querySelector('a'), null);
  assert.ok(!client.textContent.includes('UNTRUSTED_APPROVAL'));
  assert.ok(renderCofreReport(content, { staff: true }).querySelector('pre'));
  assert.ok(renderCofreReport({ status: '__proto__' }).textContent.includes('Não informado'));
});

test('published client context uses delivery timestamps with an explicit timezone', () => {
  const context = renderPublicationContext([{ published_at: '2026-10-17T20:24:00Z', expires_at: '2026-10-18T20:24:00+00:00' }]);
  assert.ok(context.textContent.includes('Versão publicada para você em 17/10/2026, 17:24'));
  assert.ok(context.textContent.includes('acesso até 18/10/2026, 17:24')); assert.ok(context.textContent.includes('Brasília'));
  assert.ok(renderPublicationContext([{ published_at: 'bad', expires_at: null }]).textContent.includes('sem data de expiração informada'));
  assert.ok(renderPublicationContext([]).textContent.includes('não estão disponíveis'));
});

test('consent gate, mandatory profile, keyboard focus and three controls per recovery stage', async () => {
  const h = harness(); await h.ui.load(roster); await h.ui.open(entry);
  await button(h.root, 'Continuar').click(); assert.equal(h.ui.step, 0); assert.ok(h.root.textContent.includes('Marque as duas autorizações'));
  const checks = h.root.querySelectorAll('input').filter(input => input.type === 'checkbox');
  assert.ok(checks.every(input => !input.checked));
  for (const input of checks) { input.checked = true; input.handlers.change(); }
  await button(h.root, 'Continuar').click(); assert.equal(h.ui.step, 1); assert.equal(focused.className, 'step-heading');
  await button(h.root, 'Continuar').click(); assert.equal(h.ui.step, 1, 'required profile blocks navigation');
  change(field(h.root, 'cofre-objective'), 'protect_family'); change(field(h.root, 'cofre-experience'), 'beginner');
  await button(h.root, 'Continuar').click(); await button(h.root, 'Continuar').click(); assert.equal(h.ui.step, 3);
  assert.equal(h.root.querySelectorAll('legend').length, 3);
  const yes = h.root.all().find(input => input.name === 'control-backup_offline' && input.value === 'yes');
  yes.checked = true; yes.handlers.change(); assert.deepEqual(h.ui.intake.controls.backup_offline, { answer: 'yes', evidence: 'declared' });
  const unknown = h.root.all().find(input => input.name === 'control-backup_offline' && input.value === 'unknown');
  unknown.checked = true; unknown.handlers.change(); assert.deepEqual(h.ui.intake.controls.backup_offline, { answer: 'unknown', evidence: 'unknown' });
  assert.ok(h.root.querySelectorAll('input').every(input => input.type === 'radio'), 'no secret text entry in recovery');
});

test('inventory exposes three categorical fields at a time and requires an intentional function', async () => {
  const h = harness(); await h.ui.load(roster); await h.ui.open(entry); h.ui.intake = valid(); h.ui.step = 6; h.ui.renderEditor();
  await button(h.root, 'Adicionar categoria').click(); assert.equal(h.ui.intake.inventory[0].category, '');
  assert.equal(h.root.querySelectorAll('select').length, 3);
  await button(h.root, 'Continuar').click(); assert.equal(h.ui.step, 6);
  change(field(h.root, 'inventory-category-0'), 'vault'); await button(h.root, 'Adicionar categoria').click();
  assert.equal(h.root.querySelectorAll('select').length, 3); assert.equal(h.ui.intake.inventory.length, 2);
  change(field(h.root, 'inventory-category-1'), 'apps'); await button(h.root, 'Continuar').click(); assert.equal(h.ui.step, 7);
  assert.equal(h.root.querySelectorAll('textarea').length, 0);
});

test('uncertain save retries exact payload/key with revision and reports only server version', async () => {
  const calls = []; let attempt = 0;
  const h = harness(async (path, body) => {
    if (body) { calls.push({ path, body }); if (++attempt === 1) throw new Error('Conexão indisponível'); return { data: { revision: 1, report_version_id: 'server-version' } }; }
    return path === '/cases' ? { data: [entry] } : { data: null };
  });
  await h.ui.load(roster); await h.ui.open(entry); h.ui.intake = valid(); h.ui.step = 7; h.ui.dirty = true; h.ui.renderEditor();
  await button(h.root, 'Salvar respostas e gerar rascunho').click(); assert.equal(h.saved.length, 0); assert.equal(h.ui.dirty, true);
  await button(h.root, 'Salvar respostas e gerar rascunho').click();
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].body.expected_revision, 0);
  assert.equal(calls[0].body.intake.consents.external_sources, false); assert.deepEqual(h.saved, ['server-version']); assert.equal(h.ui.revision, 1); assert.equal(h.ui.dirty, false);
});

test('revision conflict keeps unsaved answers and offers explicit reload', async () => {
  const h = harness(async (path, body) => { if (body) throw Object.assign(new Error('Atualize a versão'), { status: 409 }); return path === '/cases' ? { data: [entry] } : { data: null }; });
  await h.ui.load(roster); await h.ui.open(entry); h.ui.intake = valid(); h.ui.intake.profile.objective = 'protect_family'; h.ui.step = 7; h.ui.dirty = true; h.ui.renderEditor();
  await button(h.root, 'Salvar respostas e gerar rascunho').click();
  assert.equal(h.ui.intake.profile.objective, 'protect_family'); assert.equal(h.ui.dirty, true); assert.equal(h.saved.length, 0);
  assert.ok(button(h.root, 'Descartar minhas alterações e carregar a revisão salva'));
});

test('a failed list refresh after confirmed save never becomes an uncertain write', async () => {
  const h = harness(async (path, body) => body ? { data: { revision: 1, report_version_id: 'confirmed-version' } } : path === '/cases' ? { data: [entry] } : { data: null });
  await h.ui.load(roster); await h.ui.open(entry); h.ui.intake = valid(); h.ui.step = 7; h.ui.dirty = true;
  h.ui.onSaved = async () => { throw new Error('list failed'); };
  await h.ui.save(); assert.equal(h.ui.revision, 1); assert.equal(h.ui.dirty, false);
  assert.ok(h.notices.at(-1).includes('sem gerar outra versão'));
});

test('late intake and save responses cannot restore a cleared or switched session', async () => {
  let release;
  const h = harness(async path => path === '/cases' ? { data: [entry] } : new Promise(resolve => { release = resolve; }));
  await h.ui.load(roster); const pending = h.ui.open(entry); h.ui.clear(); h.setUser(null);
  release({ data: { revision: 1, intake: valid() } }); await pending;
  assert.equal(h.root.textContent, ''); assert.equal(h.ui.intake, null);
  const s = harness(async (path, body) => body ? new Promise(resolve => { release = resolve; }) : path === '/cases' ? { data: [entry] } : { data: null });
  await s.ui.load(roster); await s.ui.open(entry); s.ui.intake = valid(); const saving = s.ui.save(); s.ui.clear(); s.setUser(null);
  release({ data: { revision: 1, report_version_id: 'private-old-version' } }); await saving;
  assert.equal(s.root.textContent, ''); assert.equal(s.saved.length, 0); assert.equal(s.ui.keys.size, 0);
});

test('reviewer can read saved answers but cannot edit or generate a version', async () => {
  const h = harness(async path => path === '/cases' ? { data: [entry] } : { data: { revision: 1, intake: valid() } });
  h.setUser({ user_id: 'reviewer', assignments: [{ case_id: entry.id, staff_role: 'reviewer' }] });
  await h.ui.load(roster.map(row => row.user_id === 'analyst' ? { ...row, user_id: 'reviewer', member_role: 'reviewer' } : row)); await h.ui.open(entry);
  assert.ok(h.root.textContent.includes('Leitura das respostas salvas'));
  assert.ok(h.root.querySelectorAll('input,select').every(input => input.disabled));
  h.ui.step = 7; h.ui.renderEditor(); assert.equal(button(h.root, 'Salvar respostas e gerar rascunho'), undefined);
});

test('case creation chooses only provisioned workspace clients and refreshes assignment', async () => {
  const requests = []; let created = 0;
  const h = harness(async (path, body) => { requests.push({ path, body }); if (path === '/cofre/cases') { created++; return { data: { case_id: entry.id } }; } return path === '/cases' ? { data: created ? [entry] : [] } : { data: null }; });
  await h.ui.load(roster);
  const recipient = field(h.root, 'cofre-recipient'); assert.equal(recipient.children.length, 2);
  change(recipient, 'client-a'); await button(h.root, 'Criar atendimento fictício').click();
  const post = requests.find(request => request.body); assert.equal(post.path, '/cofre/cases'); assert.equal(post.body.client_user_id, 'client-a'); assert.equal(post.body.workspace_id, 'workspace-a');
  assert.equal(h.ui.active.id, entry.id); assert.equal(h.ui.step, 0);
});

test('new attendance preserves unsaved answers until an explicit discard', async () => {
  const h = harness(); await h.ui.load(roster); await h.ui.open(entry);
  h.ui.intake.profile.objective = 'protect_family'; h.ui.markDirty();
  await button(h.root, 'Novo atendimento').click();
  assert.equal(h.ui.active.id, entry.id); assert.equal(h.ui.intake.profile.objective, 'protect_family');
  await button(h.root, 'Continuar preenchendo').click();
  assert.equal(h.ui.intake.profile.objective, 'protect_family'); assert.equal(focused.className, 'step-heading');
  await button(h.root, 'Novo atendimento').click();
  await button(h.root, 'Descartar alterações e iniciar novo atendimento').click();
  assert.equal(h.ui.active, null); assert.equal(h.ui.intake, null); assert.equal(h.ui.dirty, false);
  assert.ok(button(h.root, 'Criar atendimento fictício')); assert.equal(focused.textContent, 'Abrir um caso fictício');
});

test('stage shortcuts revisit reached steps without losing data or skipping initial gates', async () => {
  const h = harness(); await h.ui.load(roster); await h.ui.open(entry);
  assert.equal(button(h.root, '8. Revisar e gerar').disabled, true);
  await button(h.root, '2. Objetivos').click(); assert.equal(h.ui.step, 0);
  for (const input of h.root.querySelectorAll('input')) { input.checked = true; input.handlers.change(); }
  assert.ok(h.root.querySelector('.save-status').textContent.includes('Alterações não salvas'));
  await button(h.root, 'Continuar').click();
  change(field(h.root, 'cofre-objective'), 'organize'); change(field(h.root, 'cofre-experience'), 'beginner');
  await button(h.root, 'Continuar').click();
  await button(h.root, '1. Consentimento').click(); assert.equal(h.ui.step, 0);
  await button(h.root, '3. Horizonte e perdas').click(); assert.equal(h.ui.step, 2);
  assert.equal(h.ui.intake.profile.objective, 'organize');
  assert.equal(button(h.root, '3. Horizonte e perdas').attributes['aria-current'], 'step');
  assert.equal(button(h.root, '4. Recuperação').disabled, true);
});
