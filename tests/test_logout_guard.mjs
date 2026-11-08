import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

// Exercise the actual click handler with a controlled confirmation and session.
const app = await readFile(new URL('../apps/staging/app.mjs', import.meta.url), 'utf8');
const start = app.indexOf("$('logout').addEventListener('click'");
const end = app.indexOf("$('refresh').addEventListener", start);
assert.ok(start >= 0 && end > start, 'logout and refresh handlers are present');
const handlerSource = app.slice(start, end);

async function exercise({ dirty, liteDirty = false, pending = false, litePending = false, accept = false, fail = false }) {
  let handler, prompts = [], logoutCalls = 0, sessionOpen = true, notice = '';
  const cofre = { dirty, pending, answer: 'preservada' };
  const client = { logout: async () => { logoutCalls++; sessionOpen = false; if (fail) throw Error('offline'); } };
  const window = { confirm: text => { prompts.push(text); return accept; } };
  runInNewContext(handlerSource, { $: () => ({ addEventListener: (_, cb) => { handler = cb; } }), cofre, lite: { dirty: liteDirty, pending: litePending }, exercises: { dirty: false }, client, window, message: value => { notice = value; } });
  await handler();
  return { prompts, logoutCalls, sessionOpen, answer: cofre.answer, notice };
}

test('cancelar saída mantém sessão e respostas não salvas', async () => {
  const result = await exercise({ dirty: true, accept: false });
  assert.match(result.prompts[0], /não salvas/);
  assert.equal(result.logoutCalls, 0);
  assert.equal(result.sessionOpen, true);
  assert.equal(result.answer, 'preservada');
});

test('confirmar saída encerra sessão e avisa sobre o resultado', async () => {
  const result = await exercise({ dirty: true, accept: true });
  assert.equal(result.logoutCalls, 1);
  assert.match(result.notice, /Sessão encerrada/);
});

test('saída sem alteração não pede confirmação e comunica falha remota', async () => {
  const result = await exercise({ dirty: false, fail: true });
  assert.equal(result.prompts.length, 0);
  assert.equal(result.logoutCalls, 1);
  assert.match(result.notice, /servidor não confirmou/);
});

test('exercício COFRE Lite não salvo também pede confirmação de saída', async () => {
  const result = await exercise({ dirty: false, liteDirty: true });
  assert.equal(result.prompts.length, 1); assert.equal(result.logoutCalls, 0);
});

test('não permite sair durante gravação e explica como agir após falha ou prazo esgotado', async () => {
  const result = await exercise({ dirty: true, pending: true, accept: true });
  assert.equal(result.logoutCalls, 0); assert.equal(result.prompts.length, 0);
  assert.match(result.notice, /Aguarde o resultado/); assert.match(result.notice, /conexão falhar/);
  const afterFailure = await exercise({ dirty: true, pending: false, accept: false });
  assert.equal(afterFailure.logoutCalls, 0); assert.equal(afterFailure.sessionOpen, true);
});

test('saída aguarda operação Lite ou COFRE terminar', async () => {
  for (const values of [{pending:true},{litePending:true}]) { const result=await exercise({dirty:true,...values,accept:true}); assert.equal(result.logoutCalls,0); assert.equal(result.prompts.length,0); assert.match(result.notice,/Aguarde/); }
});

test('reabrir Lite atualiza a lista de atendimentos sem interromper requisição pendente', () => {
  const start = app.indexOf("$('lite-tab').addEventListener('click'");
  const end = app.indexOf("$('reports-tab').addEventListener", start);
  assert.ok(start>=0 && end>start); const source=app.slice(start,end);
  let handler, renders=0, views=0;
  const lite={ pending:false, root:{children:[{}]}, render:()=>renders++ };
  const $=id=>id==='lite-tab' ? {addEventListener:(_,cb)=>{handler=cb;}} : {hidden:false};
  runInNewContext(source,{$,lite,session:{},showView:()=>views++});
  handler();assert.equal(renders,1);assert.equal(views,1);
  lite.pending=true;handler();assert.equal(renders,1);assert.equal(views,2);
});
