'use strict';
// Synthetic DOM contract tests. Browser interaction/layout is covered separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const nodes = {};
let focused = null;
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.attributes = {}; this.handlers = {};
    this.dataset = {}; this.hidden = false; this._text = ''; this.classList = { toggle() {} };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(' '); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  focus() { focused = this; }
}
const document = {
  getElementById: id => nodes[id] || (nodes[id] = new Element()),
  createElement: tag => new Element(tag),
  querySelectorAll: () => [],
};
const context = vm.createContext({
  document, console, URL, setTimeout: () => 0, clearTimeout() {},
  fetch: async () => ({ ok: false, json: async () => ({ error: 'No synthetic session' }) }),
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps/web/app.js'), 'utf8'), context);
const dataContext = payload => {
  context.fixture = payload;
  return vm.runInContext('renderDataContext(fixture)', context);
};
const versionContext = (report, client = false) => {
  context.fixture = report; context.client = client;
  return vm.runInContext('renderVersionContext(fixture, client)', context);
};
const allNodes = element => [element, ...element.children.flatMap(allNodes)];
const check = (name, callback) => { callback(); console.log('PASS: ' + name); };

check('structured report shows synthetic provenance, declared freshness and source cutoff', () => {
  const panel = dataContext({
    status: 'degraded', as_of: '2026-10-11T00:00:00Z',
    data_quality: { mode: 'synthetic_mock', freshness: 'not_live', notes: ['Nenhum modelo analisou o contexto.'] },
    sources: [{ id: 'synthetic-fixture-001', kind: 'synthetic', as_of: '2026-10-10T23:00:00Z' }],
  });
  for (const value of ['Análise com limitações', 'Dados fictícios', 'Sem consulta ao vivo',
    '11/10/2026', '10/10/2026', 'UTC', 'synthetic-fixture-001', 'Nenhum modelo analisou o contexto.']) {
    assert.ok(panel.textContent.includes(value), value);
  }
  assert.equal(panel.attributes['aria-labelledby'], 'data-context-title');
  assert.equal(allNodes(panel).find(node => node.tagName === 'details').children[0].tagName, 'summary');
});

check('missing context stays unknown, with no fabricated totals or freshness', () => {
  const panel = dataContext({});
  assert.ok(panel.textContent.includes('Não informada'));
  assert.ok(panel.textContent.includes('Nenhuma fonte foi registrada'));
  assert.ok(panel.textContent.includes('Moeda de referência e horizonte não são registrados'));
  assert.ok(!panel.textContent.includes('Sem pendências declaradas'));
  assert.ok(!panel.textContent.includes('R$'));
});

check('stale and incomplete data provide a concrete follow-up', () => {
  const panel = dataContext({ status: 'needs_input', data_quality: { mode: 'incomplete', freshness: 'stale' } });
  for (const value of ['Faltam dados para concluir', 'Dados incompletos', 'Dados desatualizados', 'Peça fontes atualizadas']) {
    assert.ok(panel.textContent.includes(value), value);
  }
  assert.ok(dataContext({ data_quality: { freshness: 'as_of_snapshot' } }).textContent.includes('não comprova que os dados continuam atuais'));
  for (const [status, label] of [['blocked', 'Análise bloqueada'], ['error', 'Falha na análise'], ['ok', 'Sem pendências declaradas']]) {
    assert.ok(dataContext({ status }).textContent.includes(label));
  }
});

check('unknown enum values never become a reassuring label through the object prototype', () => {
  for (const value of ['constructor', '__proto__', 'future-state']) {
    const panel = dataContext({ status: value, data_quality: { mode: value, freshness: value } });
    assert.ok(panel.textContent.includes('Não informada'));
    assert.ok(!panel.textContent.includes('[object Object]'));
    assert.ok(!panel.textContent.includes('function Object'));
  }
});

check('dates preserve timezone, reject invalid calendar values and never substitute now', () => {
  context.values = [null, '2026-10-11', 'invalid', '2026-02-30T00:00:00Z', '2026-10-11T24:00:00Z'];
  const results = vm.runInContext('values.map(reportDate)', context);
  assert.equal(results[0], 'Não informada');
  for (const value of results.slice(1)) assert.equal(value, 'Data inválida — confirmar com o consultor');
  const converted = vm.runInContext("reportDate('2026-10-10T22:00:00-03:00')", context);
  assert.ok(converted.includes('11/10/2026'));
  assert.ok(converted.includes('01:00:00'));
  assert.ok(converted.endsWith(' UTC'));
});

check('untrusted notes and source identifiers remain inert text with no external link', () => {
  const attack = '<img src=https://invalid.example/ onerror=alert(1)>';
  const panel = dataContext({ data_quality: { notes: [attack] },
    sources: [{ id: attack, kind: 'document', as_of: 'invalid' }] });
  assert.ok(panel.textContent.includes(attack));
  assert.equal(allNodes(panel).filter(node => ['img', 'script', 'a', 'iframe'].includes(node.tagName)).length, 0);
});

check('version context uses the authorized envelope and explains receipt separately', () => {
  const report = { id: 'report-a-v2', version: 2, is_latest: false, content_hash: 'a'.repeat(64),
    payload: { human_review: { approved: true, reviewer: 'MODEL' } },
    review: { approved_by: null }, publication: { recipients: [] } };
  const panel = versionContext(report);
  assert.ok(panel.textContent.includes('report-a-v2'));
  assert.ok(panel.textContent.includes('Revisão pendente'));
  assert.ok(panel.textContent.includes('Versão anterior'));
  assert.ok(panel.textContent.includes('não aprova uma estratégia'));
  assert.ok(!panel.textContent.includes('MODEL'));
  const approved = versionContext({ ...report, review: { approved_by: 'rui', approved_at: '2026-10-11T00:00:00Z' },
    publication: { recipients: ['client-a'], published_at: '2026-10-11T01:00:00Z' } });
  assert.ok(approved.textContent.includes('rui'));
  assert.ok(approved.textContent.includes('Cliente A'));
});

check('customer version language only refers to versions already available to that customer', () => {
  assert.ok(versionContext({ is_latest: true }, true).textContent.includes('disponíveis para você'));
  assert.ok(versionContext({ is_latest: false }, true).textContent.includes('disponível para você'));
  assert.ok(!versionContext({ is_latest: true }, true).textContent.includes('Versão atual do atendimento'));
  assert.ok(versionContext({}).textContent.includes('Não informada'));
});

check('guided reading moves focus to the selected section without changing the report', () => {
  const nav = vm.runInContext('renderReadingNav()', context);
  assert.equal(nav.attributes['aria-label'], 'Leitura do diagnóstico');
  for (const link of nav.children) {
    let prevented = false;
    link.handlers.click({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(focused, nodes[link.href.slice(1)]);
  }
});
