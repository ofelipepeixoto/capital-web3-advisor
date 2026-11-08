import assert from 'node:assert/strict';
import { test } from 'node:test';
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
