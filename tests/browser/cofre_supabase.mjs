/** Chromium COFRE journey against real disposable Auth/PostgREST.
 * Only the local Edge HTTP transport is bridged to the actual API handler.
 * No database/Auth mocks, HAR, browser traces, credentials or raw call logs.
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

export async function runCofreBrowser({ status, users, workspaceA, handler, origin }) {
  if (status.API_URL !== 'http://127.0.0.1:54321') throw new Error('COFRE browser requires disposable local stack');
  const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
    '/app.mjs': ['app.mjs', 'text/javascript'], '/client.mjs': ['client.mjs', 'text/javascript'],
    '/cofre-ui.mjs': ['cofre-ui.mjs', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'],
    '/auth-controls.mjs': ['auth-controls.mjs','text/javascript'], '/auth-controls-ui.mjs': ['auth-controls-ui.mjs','text/javascript'] };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.url === '/config.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ supabaseUrl: status.API_URL, publishableKey: status.ANON_KEY })); return;
      }
      const file = files[req.url];
      if (!file) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', file[1]);
      res.end(await readFile(new URL('../../apps/staging/' + file[0], import.meta.url)));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const localOrigin = 'http://127.0.0.1:' + server.address().port;
  let browser, gate = 'launch';
  const checks = [], contexts = [], diagnostics = [], writes = [];
  const expect = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  try {
    browser = await chromium.launch({ headless: true });
    async function login(role, mobile = false) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
      contexts.push(context);
      await context.route('http://127.0.0.1:54321/functions/v1/advisory-api/**', async route => {
        const req = route.request();
        const response = await handler(new Request(req.url(), { method: req.method(),
          headers: { ...req.headers(), origin }, ...(req.postData() ? { body: req.postData() } : {}) }));
        const text = await response.text();
        if (req.method() === 'POST' && /\/cofre\/cases\/[a-f0-9-]+\/intake$/.test(new URL(req.url()).pathname) && response.status === 200) {
          try { const data = JSON.parse(text).data; writes.push({ role, case_id: data.case_id, revision: data.revision, report_version_id: data.report_version_id }); } catch { /* assertion below fails without a valid write */ }
        }
        await route.fulfill({ status: response.status,
          headers: { ...Object.fromEntries(response.headers), 'access-control-allow-origin': localOrigin }, body: text });
      });
      const page = await context.newPage(), network = [], errors = [];
      page.on('response', response => network.push({ path: new URL(response.url()).pathname, status: response.status() }));
      page.on('requestfailed', request => network.push({ path: new URL(request.url()).pathname, failed: true }));
      page.on('pageerror', error => errors.push(error.name));
      diagnostics.push({ page, network, errors });
      await page.goto(localOrigin);
      await page.locator('#email').fill(users[role].email);
      await page.locator('#password').fill(users[role].password);
      await page.locator('#login').click();
      await page.locator('#workspace').waitFor({ state: 'visible' });
      return page;
    }
    gate = 'analyst login and create case';
    const analyst = await login('ana');
    await analyst.locator('#cases-tab').click();
    await analyst.locator('#cofre-workspace-select').selectOption(workspaceA);
    await analyst.locator('#cofre-recipient').selectOption(users.clientA.id);
    await analyst.getByRole('button', { name: 'Criar atendimento fictício', exact: true }).click();
    await analyst.getByRole('heading', { name: 'Etapa 1 de 8 · Consentimento', exact: true }).waitFor();
    const next = () => analyst.getByRole('button', { name: 'Continuar', exact: true }).click();
    gate = 'explicit synthetic consent';
    await next();
    await analyst.getByText('Marque as duas autorizações para continuar ou saia sem salvar.', { exact: true }).waitFor();
    checks.push('consent is required before questionnaire progression');
    await analyst.getByLabel('Autorizo a avaliação das respostas fictícias para este diagnóstico.', { exact: true }).check();
    await analyst.getByLabel('Autorizo salvar as respostas fictícias e o histórico de versões neste ambiente de homologação.', { exact: true }).check();
    await next();
    gate = 'navigation preserves unsaved questionnaire';
    await analyst.getByRole('button', { name: 'Novo atendimento', exact: true }).click();
    await analyst.getByRole('button', { name: 'Continuar preenchendo', exact: true }).click();
    await analyst.getByRole('heading', { name: 'Etapa 2 de 8 · Objetivos', exact: true }).waitFor();
    expect(await analyst.getByRole('button', { name: '8. Revisar e gerar', exact: true }).isDisabled(), 'unreached stages cannot bypass questionnaire gates');
    gate = 'profile and liquidity wizard';
    await analyst.locator('#cofre-objective').selectOption('protect_family');
    await analyst.locator('#cofre-experience').selectOption('beginner');
    await next();
    await analyst.locator('input[name="cofre-liquidity"][value="long_term"]').check();
    await analyst.locator('input[name="cofre-loss"][value="limited"]').check();
    await next();
    gate = 'security and evidence wizard';
    await analyst.locator('input[name="control-secret_exposure"][value="no"]').check();
    await analyst.locator('input[name="control-backup_offline"][value="yes"]').check();
    // Unknown recovery is deliberately retained; it must remain a gap in the report.
    await next();
    await analyst.locator('input[name="control-wallet_separation"][value="yes"]').check();
    await analyst.locator('input[name="control-device_updates"][value="yes"]').check();
    await next();
    await analyst.locator('input[name="control-domain_checks"][value="yes"]').check();
    await analyst.locator('input[name="control-permissions_review"][value="no"]').check();
    await next();
    gate = 'manual enum-only inventory';
    await analyst.getByRole('button', { name: 'Adicionar categoria', exact: true }).click();
    await analyst.locator('#inventory-category-0').selectOption('vault');
    await analyst.locator('#inventory-network-0').selectOption('bitcoin');
    await analyst.locator('#inventory-custody-0').selectOption('self');
    await next();
    await analyst.getByRole('heading', { name: 'Etapa 8 de 8 · Revisar e gerar', exact: true }).waitFor();
    expect(await analyst.locator('#cases-panel input[type="text"], #cases-panel textarea').count() === 0,
      'synthetic wizard collects no free text, balances or wallet addresses');
    await analyst.getByRole('button', { name: '2. Objetivos', exact: true }).click();
    expect(await analyst.locator('#cofre-objective').inputValue() === 'protect_family', 'stage navigation preserves the entered objective');
    await analyst.getByRole('button', { name: '8. Revisar e gerar', exact: true }).click();
    gate = 'save actual intake and server-generated report';
    await analyst.getByRole('button', { name: 'Salvar respostas e gerar rascunho', exact: true }).click();
    await analyst.getByText('Respostas salvas. O novo diagnóstico é um rascunho pendente de revisão humana.', { exact: true }).waitFor();
    await analyst.locator('#detail .cofre-report').waitFor();
    const saved = writes.find(row => row.role === 'ana' && row.revision === 1);
    expect(Boolean(saved?.report_version_id), 'wizard persisted a real immutable report version through the API');
    expect(await analyst.getByRole('button', { name: 'Aprovar esta versão', exact: true }).count() === 0,
      'author interface offers no self approval');
    expect(await analyst.locator('#detail .technical').count() === 1,
      'staff has an explicit technical disclosure');
    gate = 'independent reviewer browser login';
    const reviewer = await login('rui');
    await reviewer.locator('#reports-tab').click();
    await reviewer.locator('[data-version="' + saved.report_version_id + '"]').click();
    await reviewer.getByRole('button', { name: 'Aprovar esta versão', exact: true }).waitFor();
    await reviewer.getByRole('button', { name: 'Aprovar esta versão', exact: true }).click();
    await reviewer.getByText('Confirme a leitura desta versão antes de continuar.', { exact: true }).waitFor();
    await reviewer.locator('#observed').check();
    await reviewer.getByRole('button', { name: 'Aprovar esta versão', exact: true }).click();
    await reviewer.getByRole('button', { name: 'Publicar diagnóstico', exact: true }).waitFor();
    expect(await reviewer.locator('.recipient input:checked').count() === 0, 'review does not preselect a publication recipient');
    await reviewer.locator('#observed').check();
    await reviewer.locator('.recipient input[value="' + users.clientA.id + '"]').check();
    await reviewer.locator('#expires').fill('2099-01-01T12:00');
    await reviewer.getByRole('button', { name: 'Publicar diagnóstico', exact: true }).click();
    await reviewer.getByText('Diagnóstico publicado para os destinatários selecionados.', { exact: true }).waitFor();
    checks.push('independent browser review and recipient-specific publication persist');
    gate = 'client readable mobile report';
    const client = await login('clientA', true);
    await client.locator('[data-version="' + saved.report_version_id + '"]').click();
    await client.locator('#detail .cofre-report').waitFor();
    for (const heading of ['Objetivo e contexto', 'Inventário por função', 'Controles e evidências',
      'Pontos que precisam de atenção', 'Plano de ação para revisão', 'Limites deste diagnóstico', 'Próximos passos']) {
      await client.locator('#detail').getByRole('heading', { name: heading, exact: true }).waitFor();
    }
    expect(await client.locator('#detail pre, #detail .technical').count() === 0,
      'client receives a readable report without a raw JSON disclosure');
    expect(await client.getByRole('button', { name: 'Baixar JSON técnico', exact: true }).count() === 0 &&
      await client.getByRole('button', { name: 'Aprovar esta versão', exact: true }).count() === 0,
      'client has neither technical-download nor approval control');
    const shape = await client.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
      local: localStorage.length, session: sessionStorage.length }));
    expect(!shape.overflow && shape.local === 0 && shape.session === 0,
      'mobile report fits viewport and credentials are not persisted');
    await client.getByRole('button', { name: 'Voltar à lista de diagnósticos', exact: true }).click();
    expect(await client.locator('[data-version="' + saved.report_version_id + '"]').evaluate(el => el === document.activeElement), 'mobile return focuses the selected report in its list');
    await client.locator('[data-version="' + saved.report_version_id + '"]').click();
    await client.locator('#detail .cofre-report').waitFor();
    await client.getByText('Ir para uma seção do diagnóstico', { exact: true }).click();
    await client.getByRole('link', { name: 'Plano de ação para revisão', exact: true }).click();
    expect(await client.locator('#detail h3').filter({ hasText: 'Plano de ação para revisão' }).evaluate(el => el === document.activeElement), 'report section navigation moves keyboard focus');
    gate = 'authorized print revalidation';
    await client.evaluate(() => { window.__cofrePrintCalls = 0; window.print = () => { window.__cofrePrintCalls += 1; }; });
    await client.getByRole('button', { name: 'Salvar / imprimir PDF', exact: true }).click();
    await client.waitForFunction(() => window.__cofrePrintCalls === 1);
    checks.push('print opens only after a fresh authorized report request');
    await client.getByRole('button', { name: 'Confirmar recebimento', exact: true }).click();
    await client.getByText('Recebimento registrado. Isso não aprova uma estratégia ou transação.', { exact: true }).waitFor();
    const artifact = process.env.CAPITAL_BROWSER_ARTIFACT_DIR;
    if (artifact) {
      await mkdir(artifact, { recursive: true });
      await client.screenshot({ path: artifact + '/cofre-client-mobile.png', fullPage: true });
      await reviewer.screenshot({ path: artifact + '/cofre-reviewer-desktop.png', fullPage: true });
    }
    gate = 'foreign client has no created version';
    const foreign = await login('clientB');
    await foreign.getByText('Nenhum diagnóstico foi publicado para você. A equipe precisa revisar e liberar uma versão para esta conta.', { exact: true }).waitFor();
    expect(await foreign.locator('[data-version="' + saved.report_version_id + '"]').count() === 0,
      'second client cannot see the COFRE browser case');
    gate = 'revocation prevents a stale printed report';
    await reviewer.getByRole('button', { name: 'Revogar esta entrega', exact: true }).waitFor();
    await reviewer.locator('#observed').check();
    await reviewer.locator('input[id^="reason-"]').fill('Synthetic COFRE browser revocation');
    await reviewer.getByRole('button', { name: 'Revogar esta entrega', exact: true }).click();
    await reviewer.getByText(/Entrega revogada\./).waitFor();
    await client.getByRole('button', { name: 'Salvar / imprimir PDF', exact: true }).click();
    await client.getByRole('heading', { name: 'Confira o acesso novamente', exact: true }).waitFor();
    expect(await client.evaluate(() => window.__cofrePrintCalls) === 1 && await client.locator('#detail .cofre-report').count() === 0,
      'revoked stale page cannot print and clears the rendered report');
    gate = 'logout clears workflow and questionnaire state';
    await analyst.locator('#logout').click();
    await analyst.locator('#login-panel').waitFor({ state: 'visible' });
    expect(await analyst.locator('#cofre-workspace').innerText() === '' && await analyst.locator('#password').inputValue() === '',
      'logout clears questionnaire and password fields');
    expect(diagnostics.every(row => row.errors.length === 0), 'COFRE browser journey has no uncaught page errors');
    if (artifact) await writeFile(artifact + '/cofre-manifest.json', JSON.stringify({ checks, browser: browser.version(),
      synthetic_only: true, transport: 'Chromium Edge route bridge to actual Node handler; real disposable Auth/PostgREST; deployed Edge unvalidated' }, null, 2));
    console.log('COFRE CHROMIUM: ' + checks.length + ' assertions passed; wizard, review and mobile delivery used real local Auth/PostgREST. Edge transport bridged.');
  } catch {
    for (const { network, errors } of diagnostics) console.log('COFRE BROWSER DIAGNOSTIC ' + JSON.stringify({ gate, network, errors }));
    // Raw Playwright errors may include the values passed to credential fields.
    throw new Error('COFRE browser gate failed: ' + gate);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
