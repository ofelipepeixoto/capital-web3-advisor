import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const app = await readFile(new URL('../apps/staging/app.mjs', import.meta.url), 'utf8');
const html = await readFile(new URL('../apps/staging/index.html', import.meta.url), 'utf8');
const view = app.slice(app.indexOf('function showView('), app.indexOf('cofre = new CofreWorkspace'));
const handlers = app.slice(app.indexOf("$('journeys-tab').addEventListener"), app.indexOf("window.addEventListener('beforeunload'"));
function harness({ signedIn = true, staff = true } = {}) {
  const nodes = Object.fromEntries(['workspace-nav','journeys-panel','cases-panel','diagnostics-panel','lite-panel','journeys-tab','cases-tab','reports-tab','lite-tab','lite-heading','journeys-heading','cases-heading','reports-heading','open-cofre'].map(id => [id, {
    hidden:false, attrs:{}, handlers:{}, setAttribute(k,v){this.attrs[k]=v;}, focus(){this.focused=true;}, addEventListener(k,cb){this.handlers[k]=cb;}
  }]));
  nodes['workspace-nav'].hidden = !staff;
  const context = { $: id => nodes[id], session: signedIn ? {} : null, activeView: null, lite: { root: { children: [] }, render() {} } };
  runInNewContext(view + '\n' + handlers, context);
  return {nodes,context};
}
test('jornada disponível abre atendimentos, permite voltar e mantém os painéis separados', () => {
  const {nodes,context} = harness();
  nodes['journeys-tab'].handlers.click();
  assert.equal(context.activeView,'journeys'); assert.equal(nodes['journeys-panel'].hidden,false); assert.equal(nodes['cases-panel'].hidden,true);
  assert.equal(nodes['journeys-tab'].attrs['aria-current'],'page'); assert.equal(nodes['journeys-heading'].focused,true);
  nodes['open-cofre'].handlers.click();
  assert.equal(context.activeView,'cases'); assert.equal(nodes['cases-panel'].hidden,false); assert.equal(nodes['journeys-panel'].hidden,true);
  assert.equal(nodes['cases-heading'].focused,true);
  nodes['reports-tab'].handlers.click(); assert.equal(nodes['diagnostics-panel'].hidden,false); assert.equal(nodes['cases-panel'].hidden,true);
});
test('sem sessão ou sem navegação da equipe, botões de jornadas não abrem atendimento', () => {
  for (const options of [{signedIn:false},{staff:false}]) {
    const {nodes,context}=harness(options); nodes['open-cofre'].handlers.click(); nodes['journeys-tab'].handlers.click();
    assert.equal(context.activeView,null);
  }
});
test('jornadas futuras estão descritas como planejamento, sem acionadores falsos', () => {
  assert.match(html,/Estas jornadas completas ainda não podem ser iniciadas/);
  assert.match(html,/COFRE Lite e COFRE-6/); assert.match(html,/RASTRO/); assert.match(html,/Tesouraria multisig/);
  const section=html.split('<section class="journey-planned"')[1].split('</section>')[0];
  assert.doesNotMatch(section,/<button|<a\s/);
});
