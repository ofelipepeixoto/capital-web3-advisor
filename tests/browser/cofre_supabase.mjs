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
    '/cofre-ui.mjs': ['cofre-ui.mjs', 'text/javascript'], '/cofre-lite-simulation.mjs': ['cofre-lite-simulation.mjs', 'text/javascript'], '/cofre-lite-signals.mjs': ['cofre-lite-signals.mjs', 'text/javascript'], '/journey-exercise.mjs': ['journey-exercise.mjs', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'],
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
  let browser, gate = 'launch', eligibilityOffline = false;
  const checks = [], contexts = [], diagnostics = [], writes = [];
  const expect = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  try {
    browser = await chromium.launch({ headless: true });
    async function login(role, mobile = false) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
      contexts.push(context);
      await context.route('http://127.0.0.1:54321/functions/v1/advisory-api/**', async route => {
        const req = route.request();
        if (eligibilityOffline && /\/lite-eligibility$/.test(new URL(req.url()).pathname)) { await route.fulfill({status:503, headers:{'access-control-allow-origin':localOrigin,'content-type':'application/json'}, body:'{}'}); return; }
        const response = await handler(new Request(req.url(), { method: req.method(),
          headers: { ...req.headers(), origin }, ...(req.postData() ? { body: req.postData() } : {}) }));
        const text = await response.text();
        if (req.method() === 'POST' && /\/cofre\/cases$/.test(new URL(req.url()).pathname) && response.status === 200) {
          try { const data = JSON.parse(text).data; writes.push({ role, kind: 'case', case_id: data.case_id }); } catch { /* assertion below fails without a valid case */ }
        }
        if (req.method() === 'POST' && /\/cofre\/cases\/[a-f0-9-]+\/lite-report$/.test(new URL(req.url()).pathname) && response.status === 200) {
          try { const data = JSON.parse(text).data; writes.push({ role, kind: 'lite-report', ...data }); } catch { /* assertion fails without a valid version */ }
        }
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
    await analyst.locator('#journeys-panel').waitFor({ state: 'visible' });
    gate = 'synthetic RASTRO exercise';
    await analyst.getByRole('button', {name:'RASTRO',exact:true}).click();
    await analyst.getByRole('button', {name:'Conferir situação do exemplo',exact:true}).click();
    await analyst.getByText('Exercício incompleto: há etapas não avaliadas ou desconhecidas.', {exact:true}).waitFor();
    expect(await analyst.getByText('Exercício sem pontuação, verificação independente ou publicação. Nada foi salvo.', {exact:true}).count() === 1,
      'RASTRO example is incomplete and explicitly not saved or approved');
    expect(await analyst.getByText('Estas jornadas completas ainda não podem ser iniciadas nesta aplicação. Um exercício COFRE Lite fictício está disponível no menu.', { exact: true }).isVisible(),
      'planned journeys are identified as unavailable');
    for (const [name, field] of [['Investidor avançado','Ativos e passivos'], ['Empresa ou DAO','Multisig e módulos']]) {
      await analyst.getByRole('button', {name:'Escolher outro exercício',exact:true}).click();
      await analyst.getByRole('button', {name,exact:true}).click();
      expect(await analyst.getByLabel(field,{exact:true}).isVisible(), name + ' shows its own stages');
      await analyst.getByRole('button', {name:'Conferir situação do exemplo',exact:true}).click();
      await analyst.getByText('Exercício incompleto: há etapas não avaliadas ou desconhecidas.', {exact:true}).waitFor();
      expect(await analyst.getByText('Exercício sem pontuação, verificação independente ou publicação. Nada foi salvo.', {exact:true}).count() === 1,
        name + ' remains a synthetic and unsaved exercise');
    }
    await analyst.getByRole('button', { name: 'Abrir atendimentos COFRE', exact: true }).click();
    expect(await analyst.locator('#cases-panel').isVisible(), 'available journey opens assigned COFRE cases');
    gate = 'synthetic Lite learning exercise';
    await analyst.locator('#lite-tab').click();
    expect((await analyst.locator('#lite-panel').innerText()).includes('salve as respostas fictícias em um atendimento autorizado'), 'Lite identifies the synthetic case workflow');
    await analyst.locator('#lite-panel input[name="lite-experience"][value="beginner"]').check();
    await analyst.locator('#lite-panel').getByRole('button', { name: 'Continuar', exact: true }).click();
    await analyst.locator('#lite-panel').getByRole('button', { name: 'Continuar', exact: true }).click();
    await analyst.locator('#lite-panel input[name="lite-secret_exposure"][value="yes"]').check();
    expect((await analyst.locator('#lite-panel [role="status"]').first().innerText()).includes('Alerta crítico'), 'Lite immediately warns about declared secret exposure');
    expect(await analyst.locator('#lite-panel input:not([type="radio"]), #lite-panel textarea').count() === 0, 'Lite requests no free-text secrets or addresses');
    await analyst.locator('#cases-tab').click();
    await analyst.locator('#cofre-workspace-select').selectOption(workspaceA);
    await analyst.locator('#cofre-recipient').selectOption(users.clientA.id);
    await analyst.getByRole('button', { name: 'Criar atendimento fictício', exact: true }).click();
    await analyst.getByRole('heading', { name: 'Etapa 1 de 8 · Consentimento', exact: true }).waitFor();
    gate = 'Lite persistence and independent login resume';
    const browserCase = writes.find(row => row.role === 'ana' && row.kind === 'case')?.case_id;
    expect(Boolean(browserCase), 'new case exists before binding Lite');
    await analyst.locator('#lite-tab').click();
    analyst.once('dialog', dialog => dialog.accept());
    gate = 'Lite initial case selection';
    await analyst.locator('#lite-case').selectOption(browserCase);
    await analyst.getByRole('button', { name: 'Carregar respostas do atendimento', exact: true }).click();
    await analyst.getByText('Nenhuma resposta salva neste atendimento. Marque os dois consentimentos antes de salvar.', { exact: true }).waitFor();
    await analyst.getByLabel('Autorizo a avaliação das respostas fictícias.', { exact: true }).check();
    await analyst.getByLabel('Autorizo salvar as respostas fictícias neste atendimento.', { exact: true }).check();
    await analyst.locator('input[name="lite-experience"][value="beginner"]').check();
    await analyst.locator('input[name="lite-backup"][value="not_applicable"]').check();
    for (let i=0; i<3; i++) await analyst.locator('#lite-panel').getByRole('button', { name: 'Continuar', exact: true }).click();
    await analyst.locator('input[name="lite-urgency"][value="yes"]').check();
    gate = 'Lite initial save';
    await analyst.getByRole('button', { name: 'Salvar respostas no atendimento', exact: true }).click();
    await analyst.getByText('Respostas salvas neste atendimento. Nenhum relatório foi gerado.', { exact: true }).waitFor();
    gate = 'Lite independent login';
    const resumed = await login('ana');
    await resumed.locator('#lite-tab').click();
    gate = 'Lite resumed case availability';
    await resumed.locator('#lite-case option[value="' + browserCase + '"]').waitFor({ state: 'attached' });
    await resumed.locator('#lite-case').selectOption(browserCase);
    gate = 'Lite resumed signals load';
    await resumed.getByRole('button', { name: 'Carregar respostas do atendimento', exact: true }).click();
    await resumed.getByText('Respostas salvas carregadas. Revise as etapas antes de continuar.', { exact: true }).waitFor();
    expect(await resumed.locator('input[name="lite-experience"][value="beginner"]').isChecked() && await resumed.locator('input[name="lite-backup"][value="not_applicable"]').isChecked(), 'Lite profile and not-applicable control persist across a new real Auth session');
    for (let i=0; i<3; i++) await resumed.locator('#lite-panel').getByRole('button', { name: 'Continuar', exact: true }).click();
    expect(await resumed.locator('input[name="lite-urgency"][value="yes"]').isChecked(), 'Lite signals persist across a new real Auth session');
    gate = 'Lite server-generated draft opens for staff review';
    const generateLite = resumed.getByRole('button', { name: 'Gerar rascunho para revisão', exact: true });
    expect(await generateLite.isEnabled(), 'saved Lite intake enables draft generation');
    await resumed.locator('input[name="lite-urgency"][value="no"]').check();
    expect(await generateLite.isDisabled(), 'unsaved edit disables Lite generation');
    await resumed.getByRole('button', { name: 'Salvar respostas no atendimento', exact: true }).click();
    await resumed.getByText('Respostas salvas neste atendimento. Nenhum relatório foi gerado.', { exact: true }).waitFor();
    await resumed.getByRole('button', { name: 'Gerar rascunho para revisão', exact: true }).click();
    await resumed.locator('#detail .cofre-report').waitFor();
    expect((await resumed.locator('#detail').innerText()).includes('Faltam informações'), 'staff reads incomplete Lite draft rather than invented approval');
    expect((await resumed.locator('#detail').innerText()).includes('Plano para revisão'), 'Lite review displays the server-generated plan');
    expect(await resumed.getByText('Faltam respostas antes da revisão.', { exact: true }).isVisible(), 'incomplete Lite report explains why it cannot be reviewed');
    expect(await resumed.getByRole('button', {name:'Aprovar esta versão',exact:true}).count() === 0, 'incomplete Lite draft cannot be approved in UI');
    gate = 'complete synthetic Lite intake';
    await resumed.locator('#lite-tab').click();
    for (let i=0; i<3; i++) await resumed.locator('#lite-panel').getByRole('button', {name:'Voltar',exact:true}).click();
    const liteStages = [
      { experience:'beginner', backup:'yes' },
      { vault:'yes', apps:'yes', spending:'yes', testing:'yes', watch:'yes' },
      { recovery:'yes', secret_exposure:'no' },
      { source:'yes', urgency:'no', guaranteed_return:'no', unsolicited_link:'no', different_domain:'no', unverified_contract:'no', unlimited_approval:'no', secret_request:'no', missing_team_docs:'no', unclear_tokenomics:'no', profit_screenshots:'no' },
      { permissions:'yes', payload:'yes' }, { routine:'yes' },
    ];
    for (let stage=0; stage<liteStages.length; stage++) {
      for (const [id,value] of Object.entries(liteStages[stage])) await resumed.locator('input[name="lite-' + id + '"][value="' + value + '"]').check();
      if (stage < liteStages.length-1) await resumed.locator('#lite-panel').getByRole('button',{name:'Continuar',exact:true}).click();
    }
    await resumed.getByRole('button',{name:'Salvar respostas no atendimento',exact:true}).click();
    await resumed.getByText('Respostas salvas neste atendimento. Nenhum relatório foi gerado.',{exact:true}).waitFor();
    await resumed.getByRole('button',{name:'Gerar rascunho para revisão',exact:true}).click();
    await resumed.locator('#detail .cofre-report').waitFor();
    const liteSaved = writes.filter(row => row.role === 'ana' && row.kind === 'lite-report').at(-1);
    expect(Boolean(liteSaved?.report_version_id), 'complete Lite draft generated by the server');
    expect(await resumed.getByRole('button',{name:'Aprovar esta versão',exact:true}).count() === 0, 'analyst cannot self-review Lite');
    await analyst.locator('#cases-tab').click();
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
    gate = 'Lite eligibility service failure closes actions';
    eligibilityOffline = true;
    await reviewer.locator('[data-version="' + liteSaved.report_version_id + '"]').click();
    await reviewer.getByText('Não foi possível confirmar a situação desta versão. Reabra o diagnóstico antes de continuar.',{exact:true}).waitFor();
    expect(await reviewer.getByRole('button',{name:'Aprovar esta versão',exact:true}).count() === 0 && await reviewer.getByRole('button',{name:'Publicar diagnóstico',exact:true}).count() === 0, 'eligibility outage disables Lite actions');
    eligibilityOffline = false;
    gate = 'independent Lite review and delivery';
    await reviewer.locator('[data-version="' + liteSaved.report_version_id + '"]').click();
    await reviewer.getByRole('button',{name:'Aprovar esta versão',exact:true}).waitFor();
    await reviewer.locator('#observed').check();
    await reviewer.getByRole('button',{name:'Aprovar esta versão',exact:true}).click();
    await reviewer.getByRole('button',{name:'Publicar diagnóstico',exact:true}).waitFor();
    expect(await reviewer.locator('.recipient input:checked').count() === 0, 'Lite recipient must be selected explicitly');
    await reviewer.locator('#observed').check();
    await reviewer.locator('.recipient input[value="' + users.clientA.id + '"]').check();
    await reviewer.locator('#expires').fill('2099-01-01T12:00');
    await reviewer.getByRole('button',{name:'Publicar diagnóstico',exact:true}).click();
    await reviewer.getByText('Diagnóstico publicado para os destinatários selecionados.',{exact:true}).waitFor();
    await reviewer.getByRole('button',{name:'Revogar esta entrega',exact:true}).waitFor();
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
    gate = 'Lite client read and stale access';
    await client.locator('[data-version="' + liteSaved.report_version_id + '"]').click();
    await client.locator('#detail .cofre-report').waitFor();
    expect((await client.locator('#detail').innerText()).includes('Plano para revisão'), 'client can read the reviewed Lite report');
    expect(await client.locator('#detail pre, #detail .technical').count() === 0, 'client Lite report is readable without raw JSON');
    await client.evaluate(() => { window.__litePrintCalls = 0; window.print = () => { window.__litePrintCalls += 1; }; });
    await client.getByRole('button',{name:'Salvar / imprimir PDF',exact:true}).click();
    await client.waitForFunction(() => window.__litePrintCalls === 1);
    // Keep the reviewer form based on an eligible snapshot, then change the intake.
    await reviewer.locator('[data-version="' + liteSaved.report_version_id + '"]').click();
    await reviewer.getByRole('button',{name:'Publicar diagnóstico',exact:true}).waitFor();
    await reviewer.locator('#observed').check();
    await reviewer.locator('.recipient input[value="' + users.clientA.id + '"]').check();
    await reviewer.locator('#expires').fill('2098-01-01T12:00');
    await resumed.locator('#lite-tab').click();
    await resumed.locator('input[name="lite-routine"][value="no"]').check();
    await resumed.getByRole('button',{name:'Salvar respostas no atendimento',exact:true}).click();
    await resumed.getByText('Respostas salvas neste atendimento. Nenhum relatório foi gerado.',{exact:true}).waitFor();
    await reviewer.getByRole('button',{name:'Publicar diagnóstico',exact:true}).click();
    await reviewer.getByRole('heading',{name:'Confira o acesso novamente',exact:true}).waitFor();
    expect(await reviewer.locator('#detail .cofre-report').count() === 0, 'stale eligibility leads to failed publish and clears the previously displayed report');
    await client.getByRole('button',{name:'Salvar / imprimir PDF',exact:true}).click();
    await client.getByRole('heading',{name:'Confira o acesso novamente',exact:true}).waitFor();
    expect(await client.evaluate(() => window.__litePrintCalls) === 1 && await client.locator('#detail .cofre-report').count() === 0, 'saving new intake denies stale Lite print and clears displayed content');
    await reviewer.locator('#refresh').click();
    await reviewer.locator('[data-version="' + liteSaved.report_version_id + '"]').click();
    await reviewer.getByText('As respostas mudaram. Gere outro rascunho a partir da revisão atual.',{exact:true}).waitFor();
    expect(await reviewer.getByRole('button',{name:'Publicar diagnóstico',exact:true}).count() === 0, 'stale Lite version cannot be published again');
    await client.locator('#refresh').click();
    gate = 'new Lite version and explicit revocation';
    await resumed.getByRole('button',{name:'Gerar rascunho para revisão',exact:true}).click();
    await resumed.locator('#detail .cofre-report').waitFor();
    const liteNew = writes.filter(row => row.role === 'ana' && row.kind === 'lite-report').at(-1);
    expect(liteNew.report_version_id !== liteSaved.report_version_id, 'new intake produces a new Lite version');
    await reviewer.locator('#refresh').click();
    await reviewer.locator('[data-version="' + liteNew.report_version_id + '"]').click();
    await reviewer.getByRole('button',{name:'Aprovar esta versão',exact:true}).waitFor();
    await reviewer.locator('#observed').check();
    await reviewer.getByRole('button',{name:'Aprovar esta versão',exact:true}).click();
    await reviewer.getByRole('button',{name:'Publicar diagnóstico',exact:true}).waitFor();
    await reviewer.locator('#observed').check();
    await reviewer.locator('.recipient input[value="' + users.clientA.id + '"]').check();
    await reviewer.locator('#expires').fill('2099-01-01T12:00');
    await reviewer.getByRole('button',{name:'Publicar diagnóstico',exact:true}).click();
    await reviewer.getByText('Diagnóstico publicado para os destinatários selecionados.',{exact:true}).waitFor();
    await reviewer.getByRole('button',{name:'Revogar esta entrega',exact:true}).waitFor();
    await client.locator('#refresh').click();
    await client.locator('[data-version="' + liteNew.report_version_id + '"]').click();
    await client.locator('#detail .cofre-report').waitFor();
    await reviewer.locator('#observed').check();
    await reviewer.locator('input[id^="reason-"]').fill('Synthetic Lite revocation');
    await reviewer.getByRole('button',{name:'Revogar esta entrega',exact:true}).click();
    await reviewer.getByText(/Entrega revogada\./).waitFor();
    await client.getByRole('button',{name:'Salvar / imprimir PDF',exact:true}).click();
    await client.getByRole('heading',{name:'Confira o acesso novamente',exact:true}).waitFor();
    expect(await client.evaluate(() => window.__litePrintCalls) === 1 && await client.locator('#detail .cofre-report').count() === 0, 'revoked Lite delivery cannot be printed and is removed from the screen');
    await client.locator('#refresh').click();
    await reviewer.locator('[data-version="' + saved.report_version_id + '"]').click();
    expect(await client.locator('#workspace-nav').isHidden(), 'client does not see staff journey navigation');
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
    expect(await foreign.locator('[data-version="' + liteSaved.report_version_id + '"]').count() === 0 && await foreign.locator('[data-version="' + liteNew.report_version_id + '"]').count() === 0, 'second client cannot see either Lite version');
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
    gate = 'cancel logout preserves unsaved questionnaire';
    await analyst.locator('#cases-tab').click();
    await analyst.getByRole('button', { name: '2. Objetivos', exact: true }).click();
    await analyst.locator('#cofre-objective').selectOption('organize');
    let logoutWarning = '';
    analyst.once('dialog', async dialog => { logoutWarning = dialog.message(); await dialog.dismiss(); });
    await analyst.locator('#logout').click();
    expect(logoutWarning.includes('respostas não salvas') &&
      await analyst.locator('#workspace').isVisible() &&
      await analyst.locator('#cofre-objective').inputValue() === 'organize',
      'canceling logout retains the active session and unsaved answer');
    gate = 'confirmed logout clears workflow and questionnaire state';
    analyst.once('dialog', dialog => dialog.accept());
    await analyst.locator('#logout').click();
    await analyst.locator('#login-panel').waitFor({ state: 'visible' });
    expect(await analyst.locator('#cofre-workspace').innerText() === '' && await analyst.locator('#password').inputValue() === '',
      'logout clears questionnaire and password fields');
    gate = 'logout without edits does not prompt';
    let cleanPrompt = false;
    foreign.once('dialog', async dialog => { cleanPrompt = true; await dialog.dismiss(); });
    await foreign.locator('#logout').click();
    await foreign.locator('#login-panel').waitFor({ state: 'visible' });
    expect(!cleanPrompt, 'logout without unsaved changes does not prompt');
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
