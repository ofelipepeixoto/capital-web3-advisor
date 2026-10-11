/** Chromium + real disposable Auth + actual API handler + RLS/Storage.
 * Only the not-yet-deployed Edge transport is bridged by Playwright routing.
 * Never targets a hosted project. Never logs credentials or raw browser errors.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';

export async function runStagingBrowser({ status, users, ids, handler, origin }) {
  if (status.API_URL !== 'http://127.0.0.1:54321') throw new Error('local stack required');
  const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
    '/app.mjs': ['app.mjs', 'text/javascript'], '/client.mjs': ['client.mjs', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.url === '/config.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ supabaseUrl: status.API_URL, publishableKey: status.ANON_KEY })); return;
      }
      const file = files[req.url];
      if (!file) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', file[1]); res.end(await readFile(new URL('../../apps/staging/' + file[0], import.meta.url)));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser; let gate = 'launch'; const checks = [];
  const expect = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); };
  try {
    browser = await chromium.launch({ headless: true });
    const contexts = [];
    async function login(role, mobile = false) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, acceptDownloads: true });
      contexts.push(context);
      await context.route('http://127.0.0.1:54321/functions/v1/advisory-api/**', async route => {
        const req = route.request();
        const headers = { ...req.headers(), origin };
        const response = await handler(new Request(req.url(), {
          method: req.method(), headers, ...(req.postData() ? { body: req.postData() } : {}),
        }));
        const outputHeaders = Object.fromEntries(response.headers);
        outputHeaders['access-control-allow-origin'] = 'http://127.0.0.1:' + server.address().port;
        await route.fulfill({ status: response.status, headers: outputHeaders, body: await response.text() });
      });
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.locator('#email').fill(users[role].email);
      await page.locator('#password').fill(users[role].password);
      await page.locator('#login').click();
      await page.locator('#workspace').waitFor({ state: 'visible' });
      return page;
    }
    gate = 'staff browser login'; const reviewer = await login('rui');
    await reviewer.locator('[data-version="' + ids.versionA1 + '"]').click();
    await reviewer.getByText('Esta versão possui anexos.', { exact: false }).waitFor();
    expect(await reviewer.getByRole('button', { name: 'Publicar diagnóstico', exact: true }).count() === 0,
      'asset manifest alone cannot enable publication');
    await reviewer.locator('[data-version="' + ids.versionA2 + '"]').click();
    await reviewer.getByRole('button', { name: 'Aprovar esta versão', exact: true }).waitFor();
    await reviewer.getByRole('button', { name: 'Aprovar esta versão', exact: true }).click();
    await reviewer.getByText('Confirme a leitura desta versão antes de continuar.', { exact: true }).waitFor();
    checks.push('explicit review acknowledgement required');
    gate = 'review and publish from browser';
    await reviewer.locator('#observed').check();
    await reviewer.getByRole('button', { name: 'Aprovar esta versão', exact: true }).click();
    await reviewer.getByRole('button', { name: 'Publicar diagnóstico', exact: true }).waitFor();
    await reviewer.locator('#observed').check();
    expect(await reviewer.locator('.recipient input:checked').count() === 0, 'no preselected recipients');
    await reviewer.locator('.recipient input[value="' + users.clientA.id + '"]').check();
    await reviewer.locator('#expires').fill('2099-01-01T12:00');
    await reviewer.getByRole('button', { name: 'Publicar diagnóstico', exact: true }).click();
    await reviewer.getByText('Diagnóstico publicado para os destinatários selecionados.', { exact: true }).waitFor();
    checks.push('review and publication persist through authenticated RPCs');
    gate = 'client browser login'; const client = await login('clientA', true);
    await client.locator('[data-version="' + ids.versionA2 + '"]').click();
    await client.getByRole('button', { name: 'Confirmar recebimento', exact: true }).waitFor();
    expect(await client.getByRole('button', { name: 'Aprovar esta versão', exact: true }).count() === 0, 'client has no approval control');
    expect(await client.locator('#password').inputValue() === '', 'password cleared after sign in');
    const storage = await client.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length,
      overflow: document.documentElement.scrollWidth > innerWidth }));
    expect(storage.local === 0 && storage.session === 0, 'no persistent browser tokens');
    expect(!storage.overflow, 'mobile page fits viewport');
    const artifact = process.env.CAPITAL_BROWSER_ARTIFACT_DIR;
    if (artifact) {
      await mkdir(artifact, { recursive: true });
      await client.screenshot({ path: artifact + '/staging-client-mobile.png', fullPage: true });
      await reviewer.screenshot({ path: artifact + '/staging-reviewer-desktop.png', fullPage: true });
    }
    gate = 'authorized download';
    const downloadPromise = client.waitForEvent('download');
    await client.getByRole('button', { name: 'Baixar diagnóstico', exact: true }).click();
    const download = await downloadPromise;
    const downloaded = JSON.parse(await readFile(await download.path(), 'utf8'));
    expect(downloaded.id === ids.versionA2, 'download contains authorized version');
    gate = 'receipt'; await client.getByRole('button', { name: 'Confirmar recebimento', exact: true }).click();
    await client.getByText('Recebimento registrado. Isso não aprova uma estratégia ou transação.', { exact: true }).waitFor();
    checks.push('client receipt persisted through RPC');
    gate = 'foreign client isolation'; const foreign = await login('clientB');
    await foreign.getByText('Nenhum diagnóstico disponível para esta conta.', { exact: true }).waitFor();
    expect(await foreign.locator('[data-version="' + ids.versionA2 + '"]').count() === 0, 'foreign client sees no diagnosis');
    gate = 'revoke from browser';
    await reviewer.getByRole('button', { name: 'Revogar esta entrega', exact: true }).waitFor();
    await reviewer.locator('#observed').check(); await reviewer.locator('input[id^="reason-"]').fill('Synthetic browser revocation');
    await reviewer.getByRole('button', { name: 'Revogar esta entrega', exact: true }).click();
    await reviewer.getByText(/Entrega revogada\./).waitFor();
    await client.locator('#refresh').click();
    await client.getByText('Nenhum diagnóstico disponível para esta conta.', { exact: true }).waitFor();
    expect(!(await client.locator('#detail').innerText()).includes('Synthetic diagnosis A v2'), 'revocation refresh clears rendered diagnosis');
    gate = 'logout and reload'; await client.locator('#logout').click();
    await client.locator('#login-panel').waitFor({ state: 'visible' }); await client.reload();
    expect(await client.locator('#workspace').isHidden(), 'reload cannot restore previous session');
    if (artifact) {
      await mkdir(artifact, { recursive: true });
      await client.screenshot({ path: artifact + '/staging-client-signed-out.png', fullPage: true });
      // Only synthetic identifiers and test data. No tokens or HAR/trace files.
      const { writeFile } = await import('node:fs/promises');
      await writeFile(artifact + '/staging-manifest.json', JSON.stringify({ checks, browser: browser.version(),
        download_sha256: createHash('sha256').update(JSON.stringify(downloaded)).digest('hex'),
        transport: 'Chromium route bridge to actual Node handler; real local Auth/PostgREST; Edge deployment pending' }, null, 2));
    }
    console.log('STAGING CHROMIUM: ' + checks.length + ' assertions passed; real local Auth and database. Edge transport bridged.');
    for (const context of contexts) await context.close();
  } catch {
    // Raw Playwright call logs can contain values filled into credential fields.
    throw new Error('Staging browser gate failed: ' + gate);
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
