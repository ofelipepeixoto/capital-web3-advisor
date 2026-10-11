'use strict';
/** Real Chromium against the real synthetic server, never cloud/customer data. */
const CASES = [
  'review, publish, receive, clarify, isolate and revoke a specific version',
  'a late authorized detail cannot reappear after logout and another identity',
  'a late download cannot create a file after logout and another identity',
  'a late restored session cannot replace a new identity after page reload',
  'desktop and mobile retain visible controls without horizontal overflow',
  'guided demo exposes data context and supports keyboard reading',
  'version context distinguishes published delivery from a newer private draft',
  'incomplete stale and untrusted display fixtures remain explicit at narrow widths',
];
if (process.argv.includes('--list')) {
  console.log(CASES.map((name, index) => `${index + 1}. ${name}`).join('\n'));
  process.exit(0);
}
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '../..');
const OUTPUT = path.resolve(process.env.CAPITAL_BROWSER_ARTIFACT_DIR || path.join(__dirname, 'artifacts'));
let browser, server, origin, contexts = [], pageErrors = [], externalRequests = [], artifacts = [];

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

before(async () => {
  await fs.mkdir(OUTPUT, { recursive: true });
  // Missing Chromium is a failure, not a fabricated pass or skipped gate.
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  contexts = []; pageErrors = []; externalRequests = []; artifacts = [];
  // Ephemeral OS-selected loopback port; fresh in-memory data per test.
  const ready = deferred();
  server = spawn(process.env.CAPITAL_TEST_PYTHON || 'python3', ['-u', '-c',
    'from capital_web3.server import DemoServer; s=DemoServer(("127.0.0.1",0)); print(s.server_address[1],flush=True); s.serve_forever()'],
  { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, CAPITAL_OPENAI_LIVE_ENABLED: 'false', OPENAI_API_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_URL: '',
  } });
  let stdout = '', stderr = '';
  server.stdout.on('data', data => {
    stdout += data.toString();
    const line = stdout.split('\n')[0];
    if (/^\d+$/.test(line)) ready.resolve(`http://127.0.0.1:${line}`);
  });
  server.stderr.on('data', data => { stderr += data.toString(); });
  server.on('error', ready.reject);
  server.on('exit', code => ready.reject(new Error(`Local server exited (${code}): ${stderr}`)));
  const timer = setTimeout(() => ready.reject(new Error('Local server startup exceeded 10s')), 10000);
  try { origin = await ready.promise; } finally { clearTimeout(timer); }
  const health = await fetch(origin + '/health', { signal: AbortSignal.timeout(5000) }).then(response => response.json());
  assert.equal(health.mode, 'synthetic-local');
  assert.equal(health.live_integrations, false);
});
afterEach(async context => {
  // Final browser state helps review failures too. TAP, not this manifest,
  // records the verdict. These screenshots contain synthetic fixtures only.
  try {
    for (let index = 0; index < contexts.length; index++) {
      const page = contexts[index].pages()[0];
      if (page && !page.isClosed()) await screenshot(page, `final-${slug(context.name)}-${index}`).catch(() => {});
    }
    await fs.writeFile(path.join(OUTPUT, `${slug(context.name)}.json`), JSON.stringify({
      test: context.name, synthetic: true, target_browser: 'chromium',
      browser_version: browser?.version() || null, node_version: process.version,
      candidate_commit: process.env.GITHUB_SHA || null,
      observed_at: new Date().toISOString(), screenshots: artifacts,
      page_errors: pageErrors, unexpected_network: externalRequests,
    }, null, 2));
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      let timer;
      const bounded = new Promise((resolve, reject) => {
        timer = setTimeout(() => { server.kill('SIGKILL'); reject(new Error('Local server shutdown exceeded 5s')); }, 5000);
      });
      server.kill('SIGTERM');
      try { await Promise.race([exited, bounded]); } finally { clearTimeout(timer); }
    }
  }
  assert.deepEqual(externalRequests, [], 'Application attempted an external request');
  assert.deepEqual(pageErrors, [], 'Browser JavaScript error');
});

function slug(value) { return value.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 100); }
async function screenshot(page, name) {
  const filename = slug(name) + '.png';
  await page.screenshot({ path: path.join(OUTPUT, filename), fullPage: true, timeout: 5000 });
  artifacts.push(filename);
}
async function newPage(viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  contexts.push(context);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    externalRequests.push(url.origin); // Never log sensitive query/path content.
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  // Test-only observation of completed native body reads. Network/data and
  // application guards are unchanged; this avoids asserting before JSON/blob
  // consumption has completed in the delayed-response scenarios.
  await page.addInitScript(() => {
    window.__capitalBrowserBodyReads = [];
    window.__capitalBrowserObjectUrls = 0;
    for (const method of ['json', 'blob']) {
      const nativeRead = Response.prototype[method];
      Response.prototype[method] = async function (...args) {
        const value = await nativeRead.apply(this, args);
        window.__capitalBrowserBodyReads.push({ url: this.url, method });
        return value;
      };
    }
    const nativeCreateUrl = URL.createObjectURL;
    URL.createObjectURL = function (...args) {
      const value = nativeCreateUrl.apply(this, args);
      window.__capitalBrowserObjectUrls++;
      return value;
    };
  });
  await page.goto(origin);
  await page.locator('#login-view').waitFor({ state: 'visible' });
  return page;
}
async function login(page, persona) {
  const cases = page.waitForResponse(response => response.url() === origin + '/api/cases' && response.status() === 200);
  await page.locator(`[data-persona="${persona}"]`).click();
  await cases;
  await page.locator('#workspace').waitFor({ state: 'visible' });
  await page.locator('#summary .metric').first().waitFor();
  assert.equal(await page.locator('#identity-role').textContent(), persona.startsWith('client-') ? 'Portal do cliente' : 'Equipe Capital Web3');
}
async function logout(page) {
  const response = page.waitForResponse(response => response.url() === origin + '/api/logout');
  await page.getByTitle('Encerrar sessão').click();
  await response;
  await page.locator('#login-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#detail').textContent(), '');
  assert.equal(await page.locator('#report-list').textContent(), '');
  assert.equal(await page.locator('#summary').textContent(), '');
  assert.equal(await page.locator('#risk-output').textContent(), '');
}
async function viewReport(page, id) {
  const response = page.waitForResponse(response => response.url() === `${origin}/api/reports/${id}`);
  await page.locator(`.report-row[data-id="${id}"]`).click();
  await response;
  await page.locator('#detail .meta').waitFor();
}
async function doAction(page, label, endpoint, expectedStatus = 200) {
  const control = await page.getByRole('button', { name: label, exact: true }).elementHandle();
  assert.ok(control, `Missing action: ${label}`);
  const response = page.waitForResponse(response => response.url() === origin + endpoint && response.request().method() === 'POST');
  try {
    await control.click();
    const result = await response;
    const error = result.status() === expectedStatus ? '' : (await result.json()).error || 'Unexpected API status';
    assert.equal(result.status(), expectedStatus, `${label}: ${error}`);
    // action() still refreshes the report after the HTTP response arrives.
    // Observe the original control's finally block, including when refresh
    // replaces that DOM node; do not type into a textarea about to be replaced.
    await page.waitForFunction(control => control.disabled === false, control);
    return result;
  } finally { await control.dispose(); }
}
async function denied(page, id) {
  const denied = await page.request.get(`${origin}/api/reports/${id}`);
  const absent = await page.request.get(`${origin}/api/reports/does-not-exist`);
  const download = await page.request.get(`${origin}/api/reports/${id}/download`);
  assert.equal(denied.status(), 404);
  assert.equal(download.status(), 404);
  assert.deepEqual(await denied.json(), await absent.json());
  assert.deepEqual(await denied.json(), await download.json());
}
async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function readCount(page, url) {
  return page.evaluate(url => window.__capitalBrowserBodyReads.filter(read => read.url === url).length, url);
}
async function bodyConsumed(page, url, before) {
  await page.waitForFunction(({ url, before }) =>
    window.__capitalBrowserBodyReads.filter(read => read.url === url).length > before, { url, before });
  await frames(page); // Flush the application continuation after the native read.
}

test(CASES[0], { timeout: 60000 }, async () => {
  const ana = await newPage();
  await login(ana, 'ana');
  await screenshot(ana, '01-consultant-desktop');
  const draftResult = await doAction(ana, '+ Preparar rascunho', '/api/cases/case-a/draft', 201);
  const report = await draftResult.json();
  const id = report.id;
  await ana.locator('#detail .meta').waitFor();
  assert.equal(await ana.getByRole('button', { name: 'Aprovar esta versão', exact: true }).count(), 0);

  const client = await newPage();
  await login(client, 'client-a');
  assert.equal(await client.locator('.report-row').count(), 0, 'Unpublished draft became visible');
  await denied(client, id);

  const rui = await newPage();
  await login(rui, 'rui');
  await viewReport(rui, id);
  await doAction(rui, 'Aprovar esta versão', `/api/reports/${id}/approve`);
  await rui.getByRole('button', { name: 'Publicar para cliente A', exact: true }).waitFor();
  await doAction(rui, 'Publicar para cliente A', `/api/reports/${id}/publish`);
  await rui.locator('#detail .badge.published').waitFor();
  await screenshot(rui, '02-reviewed-published-desktop');

  await client.reload();
  await client.locator(`.report-row[data-id="${id}"]`).waitFor();
  await viewReport(client, id);
  assert.equal(await client.locator('#risk-tab').isVisible(), false);
  assert.equal(await client.locator('#draft').isVisible(), false);
  assert.equal(await client.getByRole('button', { name: 'Aprovar esta versão', exact: true }).count(), 0);
  assert.equal(await client.getByRole('button', { name: 'Revogar acesso', exact: true }).count(), 0);
  const downloaded = client.waitForEvent('download');
  await client.getByRole('button', { name: 'Baixar diagnóstico', exact: true }).click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(), `${id}.json`);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const delivered = JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(delivered.id, id);
  assert.equal(delivered.version, report.version);
  assert.equal(delivered.case_id, 'case-a');
  // A real receipt refresh is held after authorization. The customer starts
  // typing before it completes; rerender must preserve text and keyboard focus.
  const refreshFetched = deferred(), refreshRelease = deferred(), refreshCompleted = deferred();
  await client.route(`**/api/reports/${id}`, async route => {
    try {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      refreshFetched.resolve(); await refreshRelease.promise;
      await route.fulfill({ response }); refreshCompleted.resolve();
    } catch (error) { refreshFetched.reject(error); refreshCompleted.reject(error); }
  });
  const receiving = doAction(client, 'Confirmar recebimento', `/api/reports/${id}/receipt`);
  await Promise.race([refreshFetched.promise, receiving.then(() => { throw new Error('Receipt completed before its held refresh'); })]);
  const question = 'Pode explicar os limites deste cenário fictício?';
  await client.getByLabel('Dúvida sobre o diagnóstico').fill(question);
  refreshRelease.resolve(); await refreshCompleted.promise; await receiving;
  await client.unroute(`**/api/reports/${id}`);
  assert.equal(await client.getByLabel('Dúvida sobre o diagnóstico').inputValue(), question);
  assert.equal(await client.getByLabel('Dúvida sobre o diagnóstico').evaluate(input => input === document.activeElement), true);
  await client.getByText('Recebimento confirmado para esta versão.', { exact: true }).waitFor();
  // Receipt is idempotent and cannot approve a strategy or authorize a trade.
  await doAction(client, 'Confirmar recebimento', `/api/reports/${id}/receipt`);
  assert.equal(await client.getByLabel('Dúvida sobre o diagnóstico').inputValue(), question);
  await doAction(client, 'Enviar dúvida', `/api/reports/${id}/clarify`);
  await client.getByText(question, { exact: true }).waitFor();
  assert.equal(await client.getByLabel('Dúvida sobre o diagnóstico').inputValue(), '');
  await screenshot(client, '03-client-delivery-receipt-clarification');

  const outsider = await newPage();
  await login(outsider, 'client-b');
  assert.equal(await outsider.locator('.report-row').count(), 1);
  assert.equal(await outsider.locator('.report-row').getAttribute('data-id'), 'report-b-v1');
  await denied(outsider, id);
  await denied(ana, 'report-b-v1');

  await doAction(rui, 'Revogar acesso', `/api/reports/${id}/revoke`);
  await rui.locator('#detail .badge.revoked').waitFor();
  await client.reload();
  await client.getByText('Nenhum diagnóstico foi publicado para você ainda.', { exact: true }).waitFor();
  assert.equal(await client.locator('.report-row').count(), 0);
  await denied(client, id);
  await screenshot(client, '04-client-revoked');
});

test(CASES[1], { timeout: 30000 }, async () => {
  const page = await newPage();
  await login(page, 'rui');
  const detailUrl = origin + '/api/reports/report-a-v1';
  const readsBefore = await readCount(page, detailUrl);
  const fetched = deferred(), release = deferred(), completed = deferred();
  await page.route('**/api/reports/report-a-v1', async route => {
    try {
      // Capture a real authorized server response, then delay transport only.
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      fetched.resolve();
      await release.promise;
      await route.fulfill({ response });
      completed.resolve();
    } catch (error) { fetched.reject(error); completed.reject(error); }
  });
  await page.locator('.report-row[data-id="report-a-v1"]').click();
  await fetched.promise;
  await logout(page);
  await login(page, 'client-b');
  const late = page.waitForResponse(response => response.url() === detailUrl);
  release.resolve();
  await completed.promise; await late; await bodyConsumed(page, detailUrl, readsBefore);
  assert.equal(await page.locator('#identity-name').textContent(), 'Cliente B');
  assert.equal(await page.locator('.report-row').getAttribute('data-id'), 'report-b-v1');
  assert.doesNotMatch(await page.locator('#workspace').textContent(), /case-a|Relatório demonstrativo A/);
  await page.unroute('**/api/reports/report-a-v1');
  await denied(page, 'report-a-v1');
  await screenshot(page, '05-late-detail-blocked-after-persona-switch');
});

test(CASES[2], { timeout: 30000 }, async () => {
  const page = await newPage();
  await login(page, 'rui');
  await viewReport(page, 'report-a-v1');
  const downloadUrl = origin + '/api/reports/report-a-v1/download';
  const readsBefore = await readCount(page, downloadUrl);
  const objectUrlsBefore = await page.evaluate(() => window.__capitalBrowserObjectUrls);
  const fetched = deferred(), release = deferred(), completed = deferred();
  const downloads = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.route('**/api/reports/report-a-v1/download', async route => {
    try {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      fetched.resolve(); await release.promise;
      await route.fulfill({ response }); completed.resolve();
    } catch (error) { fetched.reject(error); completed.reject(error); }
  });
  await page.getByRole('button', { name: 'Baixar diagnóstico', exact: true }).click();
  await fetched.promise;
  await logout(page);
  await login(page, 'client-b');
  const late = page.waitForResponse(response => response.url() === downloadUrl);
  release.resolve(); await completed.promise; await late; await bodyConsumed(page, downloadUrl, readsBefore);
  assert.equal(await page.evaluate(() => window.__capitalBrowserObjectUrls), objectUrlsBefore,
    'A late response created a downloadable blob after switching identity');
  assert.deepEqual(downloads, [], 'A late download was delivered to the new identity');
  assert.doesNotMatch(await page.locator('#workspace').textContent(), /case-a|Relatório demonstrativo A/);
  await screenshot(page, '06-late-download-blocked');
});

test(CASES[3], { timeout: 30000 }, async () => {
  const page = await newPage();
  await login(page, 'rui');
  const sessionUrl = origin + '/api/session';
  const fetched = deferred(), release = deferred(), completed = deferred();
  await page.route('**/api/session', async route => {
    try {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      assert.equal((await response.json()).subject, 'rui');
      fetched.resolve(); await release.promise;
      await route.fulfill({ response }); completed.resolve();
    } catch (error) { fetched.reject(error); completed.reject(error); }
  });
  await page.reload();
  await fetched.promise;
  const readsBefore = await readCount(page, sessionUrl);
  await page.locator('#login-view').waitFor({ state: 'visible' });
  await login(page, 'client-b');
  const late = page.waitForResponse(response => response.url() === sessionUrl);
  release.resolve(); await completed.promise; await late; await bodyConsumed(page, sessionUrl, readsBefore);
  assert.equal(await page.locator('#identity-name').textContent(), 'Cliente B');
  assert.equal(await page.locator('#identity-role').textContent(), 'Portal do cliente');
  assert.equal(await page.locator('#risk-tab').isVisible(), false);
  assert.equal(await page.locator('#draft').isVisible(), false);
  assert.equal(await page.locator('.report-row').getAttribute('data-id'), 'report-b-v1');
  await page.unroute('**/api/session');
  assert.equal((await page.request.get(sessionUrl).then(response => response.json())).subject, 'client-b');
  await denied(page, 'report-a-v1');
  await screenshot(page, '07-late-session-restore-blocked');
});

test(CASES[4], { timeout: 30000 }, async () => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await newPage(viewport);
    const assertNoOverflow = async () => {
      const dimensions = await page.evaluate(() => ({ width: window.innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(dimensions.content <= dimensions.width, `Horizontal overflow: ${JSON.stringify(dimensions)}`);
    };
    await assertNoOverflow();
    await screenshot(page, `08-login-${viewport.width}`);
    await login(page, 'client-b');
    await viewReport(page, 'report-b-v1');
    await assertNoOverflow();
    assert.equal(await page.getByRole('button', { name: 'Baixar diagnóstico', exact: true }).isVisible(), true);
    assert.equal(await page.getByLabel('Dúvida sobre o diagnóstico').isVisible(), true);
    await screenshot(page, `09-client-portal-${viewport.width}`);
    await logout(page);
    await assertNoOverflow();
  }
});


test(CASES[5], { timeout: 30000 }, async () => {
  const page = await newPage();
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('link', { name: 'Ir para o conteúdo' }).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#main-content').evaluate(node => node === document.activeElement), true);
  await page.locator('.demo-guide summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.demo-guide').getAttribute('open'), '');
  assert.match(await page.locator('.demo-guide').textContent(), /registros desaparecem/);
  await login(page, 'ana');
  const created = await doAction(page, '+ Preparar rascunho', '/api/cases/case-a/draft', 201);
  const report = await created.json();
  await page.locator('#data-context-title').waitFor();
  const context = await page.locator('.data-context').textContent();
  for (const label of ['Dados fictícios', 'Análise com limitações', 'Sem consulta ao vivo', '11/10/2026', 'UTC']) {
    assert.ok(context.includes(label), label);
  }
  await page.locator('.data-context summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByText('synthetic-fixture-001', { exact: true }).isVisible(), true);
  for (const [label, id] of [['Conferir dados', 'data-context-title'], ['Ver limites', 'report-limits-title'], ['Conferir versão', 'version-context-title']]) {
    await page.getByRole('link', { name: label, exact: true }).focus();
    await page.keyboard.press('Enter');
    const target = page.locator('#' + id);
    assert.equal(await target.evaluate(node => node === document.activeElement), true);
    const box = await target.boundingBox();
    assert.ok(box && box.y >= 0 && box.y < 1000, 'Focused heading must be in the viewport');
    assert.notEqual(await target.evaluate(node => getComputedStyle(node).outlineStyle), 'none');
  }
  assert.match(await page.locator('.version-context').textContent(), /Revisão pendente/);
  assert.ok((await page.locator('.version-context').textContent()).includes(report.id));
  await screenshot(page, '10-guided-reading-data-version-keyboard');
});

test(CASES[6], { timeout: 30000 }, async () => {
  const rui = await newPage();
  await login(rui, 'rui');
  await viewReport(rui, 'report-a-v1');
  await doAction(rui, 'Aprovar esta versão', '/api/reports/report-a-v1/approve');
  await doAction(rui, 'Publicar para cliente A', '/api/reports/report-a-v1/publish');
  const client = await newPage();
  await login(client, 'client-a');
  await viewReport(client, 'report-a-v1');
  let visible = await client.locator('.version-context').textContent();
  assert.ok(visible.includes('rui'));
  assert.ok(visible.includes('Cliente A'));
  assert.ok(visible.includes('não aprova uma estratégia'));
  const ana = await newPage();
  await login(ana, 'ana');
  const response = await doAction(ana, '+ Preparar rascunho', '/api/cases/case-a/draft', 201);
  const newer = await response.json();
  await client.reload();
  await client.locator('.report-row').waitFor();
  await viewReport(client, 'report-a-v1');
  visible = await client.locator('.version-context').textContent();
  assert.ok(visible.includes('Mais recente entre as versões disponíveis para você'));
  assert.ok(!visible.includes(newer.id));
  await denied(client, newer.id);
  await rui.reload();
  await rui.locator('.report-row').first().waitFor();
  await viewReport(rui, 'report-a-v1');
  assert.ok((await rui.locator('.version-context').textContent()).includes('Versão anterior'));
  assert.equal(await rui.getByRole('button', { name: 'Aprovar esta versão', exact: true }).count(), 0);
  assert.equal(await rui.getByRole('button', { name: 'Publicar para cliente A', exact: true }).count(), 0);
  await screenshot(client, '11-client-authorized-version-context');
  await screenshot(rui, '12-reviewer-previous-version-context');
});

test(CASES[7], { timeout: 30000 }, async () => {
  const page = await newPage({ width: 320, height: 800 });
  await login(page, 'ana');
  // Display-only response fixture. No backend decision or financial data is changed.
  const literal = '<img src="https://invalid.example/pixel" onerror="alert(1)">';
  await page.route('**/api/reports/report-a-v1', async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    const report = await response.json();
    report.payload = {
      status: 'needs_input', as_of: '2026-02-30T00:00:00Z',
      data_quality: { mode: 'incomplete', freshness: 'stale', notes: [literal] },
      sources: [{ id: 'synthetic-source-' + 'x'.repeat(160), kind: 'document', as_of: null }],
      findings: [], limitations: [],
    };
    await route.fulfill({ response, body: JSON.stringify(report) });
  });
  await viewReport(page, 'report-a-v1');
  await page.locator('.data-context summary').click();
  const context = await page.locator('.data-context').textContent();
  for (const label of ['Faltam dados para concluir', 'Dados incompletos', 'Dados desatualizados',
    'Data inválida', 'Peça fontes atualizadas', literal]) assert.ok(context.includes(label), label);
  assert.equal(await page.locator('.data-context img, .data-context iframe, .data-context script').count(), 0);
  assert.ok((await page.locator('#detail').textContent()).includes('Os limites não foram registrados'));
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(size.content <= size.width, 'Context overflow at ' + width + ': ' + JSON.stringify(size));
    await screenshot(page, '13-incomplete-data-context-' + width);
  }
});
